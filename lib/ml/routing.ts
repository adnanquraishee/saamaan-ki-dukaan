// Fulfilment + courier routing: greedy min-cost assignment with SLA constraints.
// At ~40 orders/hour across 3 nodes × 4 carriers, full enumeration (12 options/order) is exact
// for the single-order problem; a VRP is unnecessary because carriers own the linehaul and last mile.

import { PINCODE_BY_PIN, WAREHOUSE_BY_ID, WAREHOUSE_IDS, rateZone } from "@/lib/config/network";
import { PACKAGING_COST, chargeableSlabs, forwardCost, rtoCost } from "@/lib/engine/economics";
import { hashString } from "@/lib/engine/rng";
import mapData from "@/data/india-map.json";
import { HOME_WAREHOUSE } from "@/lib/config/network";
import type { Courier, Order, OrderLine, Product, RateZone, ShipLeg, WarehouseId } from "@/lib/types";
import { scoreRto } from "./rto";

export const MAX_SLA_DAYS = 7;

export interface RouteOption {
  warehouseId: WarehouseId;
  courierId: string;
  zone: RateZone;
  slabs: number;
  forward: number;
  rtoCharge: number;
  rtoP: number;
  expected: number; // forward + packaging + P(RTO) × (RTO charge + lost contribution) + routing-weight penalty
  slaDays: number;
}

export function serviceable(c: Courier, pin: string) {
  return (hashString(`${pin}:${c.id}`) % 1000) / 1000 < c.coverage;
}

export function orderSlabs(order: Pick<Order, "lines">, catalog: Record<string, Product>) {
  return order.lines.reduce((s, l) => s + chargeableSlabs(catalog[l.sku], l.qty), 0);
}

export function canFill(order: Pick<Order, "lines">, inv: Record<string, Record<WarehouseId, number>>, wh: WarehouseId) {
  return order.lines.every((l) => (inv[l.sku]?.[wh] ?? 0) >= l.qty);
}

export function routeOptions(
  order: Pick<Order, "lines" | "pincode" | "region" | "tier" | "paymentMode" | "value" | "firstTime">,
  catalog: Record<string, Product>,
  inv: Record<string, Record<WarehouseId, number>> | null,
  couriers: Courier[],
  opts: { ivr?: boolean; warehouses?: WarehouseId[] } = {},
): RouteOption[] {
  const out: RouteOption[] = [];
  const slabs = orderSlabs(order, catalog);
  const category = catalog[order.lines[0].sku].category;
  const cartSize = order.lines.reduce((s, l) => s + l.qty, 0);
  // an RTO is a lost sale, not just a return charge: the order's gross margin never materialises
  const grossMargin = order.lines.reduce((s, l) => s + Math.max(0, (l.price - catalog[l.sku].cost) * l.qty), 0);
  for (const wh of opts.warehouses ?? WAREHOUSE_IDS) {
    if (inv && !canFill(order, inv, wh)) continue;
    const zone = rateZone(WAREHOUSE_BY_ID[wh].region, order.region);
    for (const c of couriers) {
      if (!serviceable(c, order.pincode) || c.weight <= 0) continue;
      const slaDays = c.slaDays[zone] * (c.regionStrength[order.region] ?? 1) * c.slaHealth;
      if (slaDays > MAX_SLA_DAYS) continue;
      const forward = forwardCost(c, zone, slabs, order.paymentMode, order.value);
      const rc = rtoCost(c, zone, slabs);
      const rto = scoreRto({ paymentMode: order.paymentMode, tier: order.tier, value: order.value, category, courierId: c.id, cartSize, firstTime: order.firstTime }, opts.ivr ? -0.55 : 0);
      const penalty = (1 - Math.min(1, c.weight)) * 120;
      out.push({ warehouseId: wh, courierId: c.id, zone, slabs, forward, rtoCharge: rc, rtoP: rto.p, expected: Math.round(forward + PACKAGING_COST + rto.p * (rc + grossMargin) + penalty), slaDays: +slaDays.toFixed(1) });
    }
  }
  return out;
}

type RoutableOrder = Pick<Order, "lines" | "pincode" | "region" | "tier" | "paymentMode" | "value" | "firstTime">;
export const MAX_PARCELS = WAREHOUSE_IDS.length;

const MAP_POS = (mapData as unknown as { cities: Record<string, [number, number]>; warehouses: Record<string, [number, number]> });

/** Home FC first, then every other FC by straight-line distance from the customer's city. */
export function warehousesByProximity(order: Pick<Order, "pincode" | "region">): WarehouseId[] {
  const home = HOME_WAREHOUSE[order.region];
  const city = PINCODE_BY_PIN[order.pincode]?.city;
  const at = (city && MAP_POS.cities[city]) || MAP_POS.warehouses[home];
  const dist = (wh: WarehouseId) => Math.hypot(MAP_POS.warehouses[wh][0] - at[0], MAP_POS.warehouses[wh][1] - at[1]);
  return [home, ...WAREHOUSE_IDS.filter((w) => w !== home).sort((a, b) => dist(a) - dist(b))];
}

/**
 * Home-first fulfilment. Take whatever the customer's home FC holds (partial quantities included), then fill what
 * is left from the nearest FC that has stock, and so on. Each resulting parcel gets its own carrier via `choose`.
 * Returns null only when the network as a whole cannot fill the order (backorder).
 */
export function planFulfilment(
  order: RoutableOrder,
  catalog: Record<string, Product>,
  inv: Record<string, Record<WarehouseId, number>>,
  couriers: Courier[],
  choose: (opts: RouteOption[]) => RouteOption | null,
  opts: { ivr?: boolean } = {},
): ShipLeg[] | null {
  const remaining = new Map(order.lines.map((l) => [l.sku, l.qty]));
  const price = new Map(order.lines.map((l) => [l.sku, l.price]));
  const legs: ShipLeg[] = [];
  for (const wh of warehousesByProximity(order)) {
    if (!Array.from(remaining.values()).some((q) => q > 0)) break;
    const lines: OrderLine[] = [];
    for (const [sku, q] of Array.from(remaining.entries())) {
      const n = Math.min(q, Math.max(0, Math.floor(inv[sku]?.[wh] ?? 0)));
      if (n > 0) lines.push({ sku, qty: n, price: price.get(sku)! });
    }
    if (!lines.length) continue;
    const legOrder = { ...order, lines, value: lines.reduce((a, l) => a + l.price * l.qty, 0) };
    const pick = choose(routeOptions(legOrder, catalog, null, couriers, { warehouses: [wh], ivr: opts.ivr }));
    if (!pick) continue; // no carrier can serve this lane within SLA: try the next-nearest node
    for (const l of lines) remaining.set(l.sku, remaining.get(l.sku)! - l.qty);
    legs.push({ warehouseId: wh, courierId: pick.courierId, lines, cost: pick.forward, expectedCost: pick.expected, rtoP: +pick.rtoP.toFixed(3), slaDays: pick.slaDays });
  }
  return Array.from(remaining.values()).some((q) => q > 0) || legs.length > MAX_PARCELS ? null : legs;
}

/** @deprecated kept for callers written before home-first fulfilment; same behaviour as planFulfilment. */
export const planSplit = planFulfilment;

const cheapestExpected = (opts: RouteOption[]) => (opts.length ? opts.reduce((a, b) => (a.expected <= b.expected ? a : b)) : null);

/** Customer-facing promise, computed with exactly the plan fulfilment will use. */
export function deliveryPromise(order: RoutableOrder, catalog: Record<string, Product>, inv: Record<string, Record<WarehouseId, number>>, couriers: Courier[]) {
  const legs = planFulfilment(order, catalog, inv, couriers, cheapestExpected);
  if (!legs || !legs.length) return null;
  const days = Math.ceil(Math.max(...legs.map((l) => l.slaDays)) + 0.5);
  const fastest = Math.ceil(Math.min(...legs.map((l) => l.slaDays)) + 0.5);
  const home = HOME_WAREHOUSE[order.region];
  return { days, fastestDays: fastest, warehouseId: legs[0].warehouseId, parcels: legs.length, warehouses: legs.map((l) => l.warehouseId), fromHome: legs[0].warehouseId === home };
}

export { PINCODE_BY_PIN };
