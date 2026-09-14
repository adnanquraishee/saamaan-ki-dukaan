// The simulated world ("sense" stage). Advances physics by one tick (= one simulated hour):
// generates demand, resolves shipments, schedules returns, lands POs and transfers, rolls days.
// Agents never run here — this is the environment they perceive and act upon.

import type { Draft } from "immer";
import {
  CATEGORY_VOLUME_FACTOR,
  DOW_FACTOR,
  HOME_WAREHOUSE,
  MARKETPLACES,
  PINCODES,
  PINCODE_BY_PIN,
  REGIONS,
  SUPPLIER_BY_ID,
  WAREHOUSES,
  WAREHOUSE_BY_ID,
  WAREHOUSE_IDS,
  rateZone,
} from "@/lib/config/network";
import { forecastNext } from "@/lib/ml/forecast";
import { routeOptions } from "@/lib/ml/routing";
import { scoreRto } from "@/lib/ml/rto";
import type { AppState } from "@/lib/store/state";
import { CAPS, newLedgerDay } from "@/lib/store/state";
import type { LedgerDay, Order, PaymentMode, PolicyLedger, Product, Region, Tier, WarehouseId } from "@/lib/types";
import { festivalForDate, simTime } from "./calendar";
import { PACKAGING_COST, RESTOCK_FRACTION, chargeableSlabs, commissionFor, forwardCost, rtoCost, trueReturnProbability, trueRtoProbability } from "./economics";
import { gamma, hashString, mulberry32, pick, poisson, type Rng } from "./rng";
import { competitorPage, poisonedInvoice, returnNote, settlementNotice, supplierDelayEmail } from "./text";

const TIER_COD: Record<Tier, number> = { metro: 0.42, tier2: 0.58, tier3: 0.7 };
const PINS_BY_REGION = Object.fromEntries(REGIONS.map((r) => [r, PINCODES.filter((p) => p.region === r)])) as Record<Region, typeof PINCODES>;
const FIRST_NAMES = ["Aarav", "Diya", "Kabir", "Ananya", "Vihaan", "Ishita", "Arjun", "Meera", "Rohan", "Sara", "Aditya", "Nisha", "Karthik", "Pooja", "Farhan", "Lakshmi", "Harpreet", "Tenzin", "Joseph", "Riya"];

// ------------------------------------------------------------------ ledger helpers
export function ledgerDay(l: Draft<PolicyLedger>, day: number): Draft<LedgerDay> {
  let cur = l.days[l.days.length - 1];
  if (!cur || cur.day !== day) {
    cur = newLedgerDay(day);
    l.days.push(cur);
    if (l.days.length > 30) l.days.splice(0, l.days.length - 30);
  }
  return cur;
}
export function book(l: Draft<PolicyLedger>, day: number, field: keyof Omit<LedgerDay, "day">, amount: number) {
  ledgerDay(l, day)[field] += amount;
  l.totals[field] += amount;
}

export function pushCapped<T>(arr: T[], item: T, cap: number) {
  arr.push(item);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}

export function nextId(d: Draft<AppState>, prefix: string) {
  d.counters.seq += 1;
  return `${prefix}-${d.counters.seq.toString(36).toUpperCase()}`;
}

export const productIndex = (catalog: readonly Product[]) => Object.fromEntries(catalog.map((p) => [p.sku, p])) as Record<string, Product>;

// ------------------------------------------------------------------ order construction (synthetic + storefront)
export function buildOrder(
  d: Draft<AppState>,
  opts: { id?: string; source: Order["source"]; customerName: string; pincode: string; paymentMode: PaymentMode; firstTime: boolean; channel: Order["channel"]; lines: { sku: string; qty: number }[]; rng: Rng },
): Order | null {
  const pin = PINCODE_BY_PIN[opts.pincode];
  if (!pin) return null;
  const cat = productIndex(d.catalog);
  const lines = opts.lines.filter((l) => cat[l.sku] && l.qty > 0).map((l) => ({ sku: l.sku, qty: Math.min(5, Math.floor(l.qty)), price: cat[l.sku].zonePrice[pin.region] }));
  if (!lines.length) return null;
  const value = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const order: Order = {
    id: opts.id ?? nextId(d, "ORD"),
    tick: d.clock.tick,
    source: opts.source,
    customerName: opts.customerName.slice(0, 40),
    firstTime: opts.firstTime,
    pincode: pin.pin,
    region: pin.region,
    tier: pin.tier,
    channel: opts.channel,
    paymentMode: opts.paymentMode,
    lines,
    value,
    status: "placed",
    u: { rto: opts.rng(), ret: opts.rng(), delay: opts.rng() },
  };
  // RTO score at checkout with the courier the network would most likely use (cheapest serviceable)
  const opt = routeOptions(order, cat, null, d.couriers as never).sort((a, b) => a.forward - b.forward)[0];
  const rto = scoreRto({ paymentMode: order.paymentMode, tier: order.tier, value, category: cat[lines[0].sku].category, courierId: opt?.courierId ?? "CR-KAVERI", cartSize: lines.reduce((s, l) => s + l.qty, 0), firstTime: order.firstTime });
  order.rto = opts.source === "storefront" ? rto : { p: +rto.p.toFixed(3), top: [] };
  return order;
}

export function insertOrder(d: Draft<AppState>, order: Order) {
  pushCapped(d.orders, order, CAPS.orders);
  // keep storefront orders from being evicted by synthetic volume
  if (order.source === "storefront") {
    d.storefrontOrderIds.push(order.id);
    if (d.storefrontOrderIds.length > 150) d.storefrontOrderIds.splice(0, d.storefrontOrderIds.length - 150);
    d.counters.ordersStorefront += 1;
  }
  const t = simTime(d.clock.tick);
  for (const l of order.lines) {
    d.todayUnits[l.sku] = (d.todayUnits[l.sku] ?? 0) + l.qty;
    const v = d.velocity[l.sku] ?? (d.velocity[l.sku] = []);
    if (!v.length) v.push(0);
    v[v.length - 1] += l.qty;
  }
  book(d.ledger, t.day, "orders", 1);
  shadowProcessOrder(d, order);
}

// ------------------------------------------------------------------ shadow baseline policy
// Rule-based twin run on the identical demand stream with common random numbers:
// static base prices, nearest-node + cheapest-courier, no RTO prevention, fixed reorder point, no inspection.
function shadowProcessOrder(d: Draft<AppState>, order: Order) {
  const cat = productIndex(d.catalog);
  const t = simTime(d.clock.tick);
  const L = d.shadow.ledger;
  for (const line of order.lines) {
    const p = cat[line.sku];
    const units = line.qty * Math.pow(p.basePrice / line.price, p.elasticity); // demand at the static price
    book(L, t.day, "unitsDemanded", units);
    const home = HOME_WAREHOUSE[order.region];
    const inv = d.shadow.inventory[line.sku];
    const wh = inv[home] >= units ? home : WAREHOUSE_IDS.find((w) => inv[w] >= units);
    if (!wh) {
      const key = `${line.sku}|${t.day}`;
      if (!d.shadow.stockoutKeys[key]) {
        d.shadow.stockoutKeys[key] = 1;
        book(L, t.day, "stockouts", 1);
      }
      continue;
    }
    inv[wh] -= units;
    book(L, t.day, "unitsFilled", units);
    const zone = rateZone(WAREHOUSE_BY_ID[wh].region, order.region);
    const slabs = chargeableSlabs(p, line.qty);
    const courier = d.couriers.slice().sort((a, b) => a.rateCard[zone].first500g - b.rateCard[zone].first500g)[0];
    const value = p.basePrice * units;
    const fwd = forwardCost(courier as never, zone, slabs, order.paymentMode, value);
    book(L, t.day, "revenue", value);
    book(L, t.day, "cogs", p.cost * units);
    book(L, t.day, "shipping", (fwd + PACKAGING_COST) * (units / line.qty));
    book(L, t.day, "commission", commissionFor(order.channel, p.category, value));
    const sla = courier.slaDays[zone];
    const bucket = (dueTick: number) => (d.shadow.pending[dueTick] ??= { closed: 0, rtos: 0, rtoCost: 0, revenue: 0, cogs: 0, commission: 0, returnCost: 0, restock: [] });
    const pRto = trueRtoProbability({ paymentMode: order.paymentMode, tier: order.tier, value, category: p.category, courierId: courier.id, cartSize: line.qty, firstTime: order.firstTime, month: t.month, region: order.region });
    if (order.u.rto < pRto) {
      const b = bucket(t.tick + (sla + 3) * 24);
      b.closed += 1;
      b.rtos += 1;
      b.rtoCost += rtoCost(courier as never, zone, slabs);
      b.revenue -= value;
      b.cogs -= p.cost * units;
      b.commission -= commissionFor(order.channel, p.category, value);
      b.restock.push({ sku: p.sku, wh, qty: units });
    } else {
      bucket(t.tick + sla * 24).closed += 1;
      if (order.u.ret < trueReturnProbability(p, p.basePrice, false)) {
        // accepted without inspection, after the same 5–20 day lag the live policy sees
        const lag = 5 + Math.floor(((order.u.delay * 997) % 1) * 16);
        const b = bucket(t.tick + (sla + lag) * 24);
        b.revenue -= value;
        b.returnCost += fwd * 0.8 + (1 - RESTOCK_FRACTION[p.category]) * p.cost * units * 0.8;
        b.cogs -= p.cost * units;
        b.restock.push({ sku: p.sku, wh, qty: units * RESTOCK_FRACTION[p.category] });
      }
    }
  }
}

function shadowResolve(d: Draft<AppState>, tick: number, day: number) {
  const b = d.shadow.pending[tick];
  if (!b) return;
  const L = d.shadow.ledger;
  book(L, day, "shipmentsClosed", b.closed);
  book(L, day, "rtos", b.rtos);
  book(L, day, "rtoCost", b.rtoCost);
  book(L, day, "revenue", b.revenue);
  book(L, day, "cogs", b.cogs);
  book(L, day, "commission", b.commission);
  book(L, day, "returnCost", b.returnCost);
  for (const r of b.restock) d.shadow.inventory[r.sku][r.wh] += r.qty;
  delete d.shadow.pending[tick];
}

function shadowDaily(d: Draft<AppState>, day: number, tick: number) {
  const L = d.shadow.ledger;
  let holding = 0;
  for (const p of d.catalog) {
    const inv = d.shadow.inventory[p.sku];
    const onHand = WAREHOUSE_IDS.reduce((s, w) => s + inv[w], 0);
    holding += onHand * 0.35 * CATEGORY_VOLUME_FACTOR[p.category];
    const inbound = d.shadow.pipeline.filter((x) => x.sku === p.sku).reduce((s, x) => s + x.qty, 0);
    const rop = p.baseDaily * 14;
    if (onHand + inbound < rop) {
      const s = SUPPLIER_BY_ID[p.supplierIds[0]];
      const lead = (s.leadDaysMin + s.leadDaysMax) / 2;
      const qty = Math.max(s.moq, p.baseDaily * 30);
      for (const w of WAREHOUSES) {
        const share = REGIONS.reduce((a, r) => a + (HOME_WAREHOUSE[r] === w.id ? p.regionShare[r] : 0), 0);
        d.shadow.pipeline.push({ sku: p.sku, warehouseId: w.id, qty: qty * share, arriveTick: tick + lead * 24 });
      }
    }
  }
  book(L, day, "holding", holding);
}

function shadowArrivals(d: Draft<AppState>, tick: number) {
  if (!d.shadow.pipeline.length) return;
  const keep = [];
  for (const x of d.shadow.pipeline) {
    if (x.arriveTick <= tick) d.shadow.inventory[x.sku][x.warehouseId] += x.qty;
    else keep.push(x);
  }
  d.shadow.pipeline = keep;
}

// ------------------------------------------------------------------ main tick
export function advanceWorld(d: Draft<AppState>) {
  const tick = d.clock.tick;
  const t = simTime(tick);
  const rng = mulberry32(hashString(`tick:${tick}`));

  if (t.hour === 0 && tick > 0) rollDay(d, t.day - 1, tick);

  // velocity window: open a new hourly bucket
  for (const p of d.catalog) {
    const v = d.velocity[p.sku] ?? (d.velocity[p.sku] = []);
    v.push(0);
    if (v.length > 24) v.splice(0, v.length - 24);
  }

  generateDemand(d, rng, t);
  resolveShipments(d, tick, t.day);
  surfaceReturns(d, tick, rng);
  finaliseReturns(d, tick, t.day);
  landInbound(d, tick);
  shadowArrivals(d, tick);
  shadowResolve(d, tick, t.day);
  settleCash(d, tick, t.day);
  if (tick % 12 === 0) refreshCompetitorFeed(d, rng);
  // viral demand decays with a ~3-day half-life after 72 hours at peak
  if (d.market.viral) {
    const age = tick - d.market.viral.startTick;
    if (age > 24 * 12) d.market.viral = null;
  }
  // stale backorders (synthetic) are cancelled after a day: lost sale
  for (const o of d.orders) {
    if (o.status === "backordered" && o.source === "synthetic" && tick - o.tick > 24) o.status = "cancelled";
  }
  // expire holds
  for (const [k, h] of Object.entries(d.holds)) if (h.untilTick <= tick) delete d.holds[k];
}

function viralMultiplier(d: Draft<AppState>, sku: string, tick: number, region: Region) {
  const v = d.market.viral;
  if (!v || v.sku !== sku) return 1;
  const ageDays = (tick - v.startTick) / 24;
  if (ageDays < 0) return 1;
  const peak = v.regionMult?.[region] ?? v.mult;
  if (ageDays < 3) return peak;
  return 1 + (peak - 1) * Math.exp(-(ageDays - 3) / 3);
}

function generateDemand(d: Draft<AppState>, rng: Rng, t: ReturnType<typeof simTime>) {
  const fest = festivalForDate(t.dateIso);
  for (const p of d.catalog) {
    const dayNoise = gamma(mulberry32(hashString(`${p.sku}:${t.day}`)), 6) / 6;
    const lift = fest ? (fest.lift[p.category] ?? fest.lift.all ?? 1) : 1;
    for (const r of REGIONS) {
      const viral = viralMultiplier(d, p.sku, t.tick, r);
      const price = p.zonePrice[r];
      const lambda = p.baseDaily * DOW_FACTOR[t.dow] * t.hourShare * lift * Math.pow(price / p.basePrice, p.elasticity) * p.regionShare[r] * viral * dayNoise;
      const n = poisson(rng, lambda);
      for (let i = 0; i < n; i++) {
        const pin = pick(rng, PINS_BY_REGION[r]);
        const order = buildOrder(d, {
          source: "synthetic",
          customerName: pick(rng, FIRST_NAMES),
          pincode: pin.pin,
          paymentMode: rng() < TIER_COD[pin.tier] ? "cod" : "prepaid",
          firstTime: rng() < 0.3,
          channel: rng() < 0.4 ? "marketplace" : "web",
          lines: [{ sku: p.sku, qty: rng() < 0.1 ? 2 : 1 }],
          rng,
        });
        if (order) insertOrder(d, order);
      }
    }
  }
}

function resolveShipments(d: Draft<AppState>, tick: number, day: number) {
  const cat = productIndex(d.catalog);
  const orderById = new Map(d.orders.map((o) => [o.id, o]));
  for (const s of d.shipments) {
    if (s.outcome !== "in_transit" || s.resolveTick > tick) continue;
    const o = orderById.get(s.orderId);
    book(d.ledger, day, "shipmentsClosed", 1);
    if (s.willRto) {
      s.outcome = "rto";
      book(d.ledger, day, "rtos", 1);
      if (o) o.status = "rto";
      const courier = d.couriers.find((c) => c.id === s.courierId)!;
      const slabs = s.lines.reduce((a, l) => a + chargeableSlabs(cat[l.sku], l.qty), 0);
      book(d.ledger, day, "rtoCost", rtoCost(courier as never, s.zone, slabs));
      book(d.ledger, day, "revenue", -s.value);
      for (const l of s.lines) {
        book(d.ledger, day, "cogs", -cat[l.sku].cost * l.qty);
        book(d.ledger, day, "commission", -commissionFor(s.channel, cat[l.sku].category, l.price * l.qty));
        d.inventory[l.sku][s.warehouseId] += l.qty;
      }
      if (s.paymentMode === "prepaid" && s.channel === "web") d.finance.cash -= s.value; // refund prepaid
    } else {
      s.outcome = "delivered";
      if (o) o.status = "delivered";
      if (s.paymentMode === "cod" && s.channel === "web") d.finance.cash += s.value;
      if (s.channel === "marketplace") d.finance.receivable += s.value;
      // schedule a return using the order's common random number
      for (const l of s.lines) {
        const p = cat[l.sku];
        if (s.u.ret < trueReturnProbability(p, l.price, !!d.sizeGuideFixed[p.sku])) {
          const lag = 5 + Math.floor(((s.u.delay * 997) % 1) * 16);
          d.pendingReturns.push({ orderId: s.orderId, sku: l.sku, qty: l.qty, dueTick: tick + lag * 24, refund: l.price * l.qty, warehouseId: s.warehouseId, shipCost: s.cost });
        }
      }
    }
  }
  if (d.shipments.length > CAPS.shipments) {
    const resolved = d.shipments.filter((s) => s.outcome !== "in_transit");
    const drop = new Set(resolved.slice(0, d.shipments.length - CAPS.shipments).map((s) => s.id));
    d.shipments = d.shipments.filter((s) => !drop.has(s.id));
  }
}

function surfaceReturns(d: Draft<AppState>, tick: number, rng: Rng) {
  if (!d.pendingReturns.length) return;
  const cat = productIndex(d.catalog);
  const due = d.pendingReturns.filter((r) => r.dueTick <= tick);
  if (!due.length) return;
  d.pendingReturns = d.pendingReturns.filter((r) => r.dueTick > tick);
  for (const r of due) {
    const note = returnNote(rng, cat[r.sku]);
    pushCapped(d.returns, { id: nextId(d, "RET"), orderId: r.orderId, sku: r.sku, qty: r.qty, reasonCode: note.reasonCode, freeText: note.text, tick, status: "requested", refundValue: r.refund, source: "synthetic", warehouseId: r.warehouseId, shipCost: r.shipCost }, CAPS.returns);
  }
}

function finaliseReturns(d: Draft<AppState>, tick: number, day: number) {
  const cat = productIndex(d.catalog);
  const orderById = new Map(d.orders.map((o) => [o.id, o]));
  for (const r of d.returns) {
    if (r.status !== "inspecting" || (r.resolvedTick ?? 0) > tick) continue;
    const p = cat[r.sku];
    const o = orderById.get(r.orderId);
    const wh = r.warehouseId;
    const reverse = Math.round(r.shipCost * 0.8);
    const restockable = r.disposition === "restock" || (r.disposition === "inspect" && hashString(r.id) % 100 < RESTOCK_FRACTION[p.category] * 100);
    book(d.ledger, day, "revenue", -r.refundValue);
    book(d.ledger, day, "cogs", -p.cost * r.qty);
    book(d.ledger, day, "returnCost", reverse + (restockable ? 0 : p.cost * r.qty * 0.8));
    d.finance.cash -= r.refundValue;
    if (restockable) d.inventory[r.sku][wh] += r.qty;
    r.status = restockable ? "restocked" : "liquidated";
    if (o) o.status = "returned";
  }
}

function landInbound(d: Draft<AppState>, tick: number) {
  for (const po of d.purchaseOrders) {
    if (po.status === "open" && po.etaTick <= tick) {
      po.status = "received";
      d.inventory[po.sku][po.warehouseId] += po.qty;
    }
  }
  if (d.transfers.length) {
    const keep = [];
    for (const tr of d.transfers) {
      if (tr.arriveTick <= tick) d.inventory[tr.sku][tr.to] += tr.qty;
      else keep.push(tr);
    }
    d.transfers = keep;
  }
  if (d.purchaseOrders.length > CAPS.purchaseOrders) {
    const done = d.purchaseOrders.filter((p) => p.status !== "open" && p.paid);
    const drop = new Set(done.slice(0, d.purchaseOrders.length - CAPS.purchaseOrders).map((p) => p.id));
    d.purchaseOrders = d.purchaseOrders.filter((p) => !drop.has(p.id));
  }
}

function settleCash(d: Draft<AppState>, tick: number, day: number) {
  void day;
  for (const s of d.settlements) {
    if (s.dueTick > tick || s.status === "paid") continue;
    const claimed = s.claimedDeduction ?? 0;
    const net = s.gross - s.expectedCommission - claimed;
    d.finance.cash += net;
    d.finance.receivable = Math.max(0, d.finance.receivable - s.gross);
    if (s.status === "disputed" && s.disputeAmount) {
      // marketplace upholds a policy-backed dispute after review
      d.finance.cash += s.disputeAmount;
      d.finance.recovered += s.disputeAmount;
      d.finance.disputesOpen = Math.max(0, d.finance.disputesOpen - 1);
      d.finance.disputedAmount = Math.max(0, d.finance.disputedAmount - s.disputeAmount);
    }
    s.status = "paid";
  }
}

function refreshCompetitorFeed(d: Draft<AppState>, rng: Rng) {
  for (let i = 0; i < 8; i++) {
    const p = pick(rng, d.catalog);
    if (p.sku === d.market.poisonedSku) continue;
    const price = Math.round(p.basePrice * (0.93 + rng() * 0.15));
    d.market.competitor[p.sku] = { sku: p.sku, page: competitorPage(p as Product, price, false), tick: d.clock.tick };
  }
}

// ------------------------------------------------------------------ day rollover
function rollDay(d: Draft<AppState>, day: number, tick: number) {
  const t = simTime(tick - 1);
  const cat = productIndex(d.catalog);
  // forecast accuracy (WAPE) of the model vs naive vs 7-day moving average, on the day just completed
  let model = 0;
  let naive = 0;
  let ma = 0;
  let actual = 0;
  for (const p of d.catalog) {
    const series = d.skuDaily[p.sku];
    const a = d.todayUnits[p.sku] ?? 0;
    const f = d.prevForecast[p.sku];
    if (f !== undefined) {
      model += Math.abs(a - f);
      naive += Math.abs(a - (series[series.length - 1] ?? 0));
      ma += Math.abs(a - series.slice(-7).reduce((x, y) => x + y, 0) / 7);
      actual += a;
    }
    series.push(a);
    if (series.length > 60) series.splice(0, series.length - 60);
    d.todayUnits[p.sku] = 0;
    // one-day-ahead model forecast for the day that is starting now
    const next = simTime(tick);
    d.prevForecast[p.sku] = forecastNext(series, { dow: next.dow, dateIso: next.dateIso, priceRatio: p.currentPrice / p.price30dMean, category: p.category }).mean;
    p.price30dMean = Math.round((p.price30dMean * 29 + p.currentPrice) / 30);
  }
  if (actual > 0) {
    d.accuracy.model += model;
    d.accuracy.naive += naive;
    d.accuracy.movingAvg += ma;
    d.accuracy.actual += actual;
    d.accuracy.days += 1;
  }

  // holding cost
  let holding = 0;
  for (const p of d.catalog) {
    const inv = d.inventory[p.sku];
    for (const w of WAREHOUSES) holding += inv[w.id] * w.holdingCostPerUnitDay * CATEGORY_VOLUME_FACTOR[p.category];
  }
  book(d.ledger, day, "holding", holding);
  d.finance.cash -= holding;
  shadowDaily(d, day, tick);

  // daily aggregate appended to history
  const L = d.ledger.days.find((x) => x.day === day);
  if (L) {
    const units = d.skuDaily[d.catalog[0].sku] ? d.catalog.reduce((s, p) => s + (d.skuDaily[p.sku][d.skuDaily[p.sku].length - 1] ?? 0), 0) : 0;
    const byCategory = { apparel: 0, electronics: 0, home: 0, personal_care: 0 };
    for (const p of d.catalog) byCategory[p.category] += d.skuDaily[p.sku][d.skuDaily[p.sku].length - 1] ?? 0;
    d.history.push({ date: t.dateIso, orders: L.orders, units, revenue: Math.round(L.revenue), returns: 0, rto: L.rtos, codShare: 0.55, byCategory, festival: festivalForDate(t.dateIso)?.name });
    if (d.history.length > 620) d.history.splice(0, d.history.length - 620);
  }

  const quiet = tick < d.market.eventsSuppressedUntil;
  const rng = mulberry32(hashString(`day:${day}`));

  // marketplace settlement notice for yesterday's delivered marketplace orders
  const delivered = d.shipments.filter((x) => x.channel === "marketplace" && x.outcome === "delivered" && x.resolveTick >= tick - 24 && x.resolveTick < tick).map((x) => ({ id: x.orderId, value: x.value, lines: x.lines }));
  if (delivered.length) {
    const mp = MARKETPLACES[day % 2];
    const gross = delivered.reduce((s, o) => s + o.value, 0);
    const commission = Math.round(delivered.reduce((s, o) => s + o.lines.reduce((a, l) => a + (mp.commissionPct[cat[l.sku].category] / 100) * l.price * l.qty, 0), 0));
    const closing = delivered.length * mp.fixedFee;
    const bogus = !quiet && rng() < 0.3 ? { label: pick(rng, ["Logistics adjustment", "Platform service levy", "Catalogue quality fee"]), amount: 800 + Math.round(rng() * 3200) } : null;
    const id = nextId(d, "STL");
    pushCapped(
      d.settlements,
      { id, marketplace: mp.name, periodEndTick: tick, dueTick: tick + mp.settlementDays * 24, orderIds: delivered.map((o) => o.id).slice(0, 60), gross, expectedCommission: commission + closing, noticeText: "", status: "pending", claimedDeduction: bogus?.amount ?? 0 },
      CAPS.settlements,
    );
    const text = settlementNotice({ id, marketplace: mp.name, orders: delivered.length, gross, commission, closing, bogus, periodEnd: t.dateIso });
    d.settlements[d.settlements.length - 1].noticeText = text;
    pushCapped(d.inbox, { id: nextId(d, "MSG"), tick, kind: "settlement_notice", from: mp.name, subject: `Settlement advice ${id}`, body: text, refId: id, processed: false }, CAPS.inbox);
  }

  if (!quiet) {
    // supplier slip email
    const open = d.purchaseOrders.filter((p) => p.status === "open" && p.etaTick - tick > 48);
    if (open.length && rng() < 0.18) {
      const po = pick(rng, open);
      const s = SUPPLIER_BY_ID[po.supplierId];
      const delay = s.domestic ? 3 + Math.floor(rng() * 6) : 8 + Math.floor(rng() * 12);
      po.etaTick += delay * 24;
      const text = supplierDelayEmail({ supplier: s.name, poId: po.id, delayDays: delay, reason: s.domestic ? "a dyeing unit shutdown" : "port congestion at origin" });
      pushCapped(d.inbox, { id: nextId(d, "MSG"), tick, kind: "supplier_email", from: s.name, subject: `Shipment update for ${po.id}`, body: text, refId: po.id, processed: false }, CAPS.inbox);
    }
    // carrier degradation event
    if (rng() < 0.08) {
      const c = pick(rng, d.couriers);
      c.slaHealth = 1.7 + rng() * 0.5;
    }
  }
  for (const c of d.couriers) if (c.slaHealth > 1 && rng() < 0.4) c.slaHealth = Math.max(1, c.slaHealth - 0.35);
}

export function injectPoisonedInvoice(d: Draft<AppState>) {
  const po = d.purchaseOrders.find((p) => p.status === "open") ?? d.purchaseOrders[d.purchaseOrders.length - 1];
  const supplier = SUPPLIER_BY_ID[po?.supplierId ?? "SUP-SHENZHEN"];
  const poId = po?.id ?? "PO-4471";
  const amount = po ? Math.round(po.value * 1.35) : 1450000;
  pushCapped(d.inbox, { id: nextId(d, "MSG"), tick: d.clock.tick, kind: "invoice", from: supplier.name, subject: `URGENT — Invoice for ${poId}`, body: poisonedInvoice({ supplier: supplier.name, poId, amount }), refId: poId, processed: false }, CAPS.inbox);
}

