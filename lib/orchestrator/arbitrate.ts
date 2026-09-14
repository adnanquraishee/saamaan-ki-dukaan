// Arbitration: detect conflicts on shared resources (price-by-zone, orders, cash) and resolve them
// against one objective — minimise total landed cost subject to the fill-rate floor.

import { bestCourierOption } from "@/lib/agents/courier";
import { fulfilmentScore } from "@/lib/agents/fulfilment";
import { sizingEconomics } from "@/lib/agents/returns";
import { businessScore, catalogIndex, coverDays, inr, propose } from "@/lib/agents/shared";
import { CASH_BUFFER } from "@/lib/config/envelopes";
import { COURIER_BY_ID, HOME_WAREHOUSE, REGION_LABEL, WAREHOUSE_BY_ID, WAREHOUSE_IDS } from "@/lib/config/network";
import { routeOptions } from "@/lib/ml/routing";
import type { AppState } from "@/lib/store/state";
import type { Action, CourierAssignment, Proposal, Region } from "@/lib/types";

export interface ConflictRecord {
  kind: "pricing_vs_inventory" | "fulfilment_vs_courier" | "procurement_vs_finance" | "returns_vs_pricing";
  title: string;
  agents: string[];
  reasoning: string;
  resolution: string;
  details?: Record<string, unknown>;
  scenario?: string;
}

export function proposalKey(p: Proposal): string | null {
  const a = p.action;
  switch (a.type) {
    case "SET_PRICE":
      return `price:${a.sku}`;
    case "CREATE_PO":
      return `po:${a.sku}`;
    case "TRANSFER_STOCK":
      return `xfer:${a.sku}`;
    case "RESOLVE_RETURN":
      return `ret:${a.returnId}`;
    case "RAISE_DISPUTE":
      return `dispute:${a.settlementId}`;
    case "RELEASE_PAYOUT":
      return `pay:${a.poId}`;
    case "EXPEDITE_PO":
      return `exp:${a.poId}`;
    case "ADJUST_COURIER_WEIGHT":
      return `courier:${a.courierId}`;
    case "RAISE_ALERT":
      return (p.meta?.cooldown as string) ?? `alert:${a.pattern}`;
    case "FIX_SIZE_GUIDE":
      return `size:${a.sku}`;
    default:
      return null;
  }
}

export function arbitrate(s: AppState, proposals: Proposal[]) {
  const tick = s.clock.tick;
  const conflicts: ConflictRecord[] = [];
  const openKeys = new Set(s.escalations.filter((e) => e.status === "open").map((e) => e.key));
  let list = proposals.filter((p) => {
    const k = proposalKey(p);
    return !k || (!openKeys.has(k) && (s.cooldowns[k] ?? 0) <= tick);
  });
  const cat = catalogIndex(s);
  const scenarioSku = s.scenario.id ? s.scenario.sku : undefined;

  // ---------------------------------------------------------------- Returns vs Pricing
  for (const fix of list.filter((p) => p.action.type === "FIX_SIZE_GUIDE")) {
    const sku = (fix.action as Extract<Action, { type: "FIX_SIZE_GUIDE" }>).sku;
    const cut = list.find((p) => p.action.type === "SET_PRICE" && p.action.sku === sku && p.action.price < p.action.prevPrice);
    if (!cut) continue;
    const prod = cat[sku];
    const econ = sizingEconomics(s, prod);
    const keepFix = econ.fix.perDay >= econ.discount.perDay;
    list = list.filter((p) => p !== (keepFix ? cut : fix));
    conflicts.push({
      kind: "returns_vs_pricing",
      title: `Returns vs Pricing · ${prod.name}`,
      agents: ["returns", "pricing"],
      reasoning:
        `Pricing proposed a ${inr(prod.currentPrice)} → ${inr((cut.action as { price: number }).price)} cut to lift sell-through. Returns attributes the weak net sales to sizing (${(prod.returnRate * 100).toFixed(0)}% return rate, size/fit reason codes). ` +
        `Cut: ${econ.discount.units.toFixed(1)} units/day at ${(econ.discount.returnRate * 100).toFixed(0)}% returns → contribution ${inr(econ.discount.perDay)}/day. ` +
        `Fix size guide at current price: ${econ.fix.units.toFixed(1)} units/day at ${(econ.fix.returnRate * 100).toFixed(0)}% returns → ${inr(econ.fix.perDay)}/day.`,
      resolution: keepFix ? `Hold price and fix the size guide (+${inr(econ.fix.perDay - econ.discount.perDay)}/day vs discounting). Lower price would raise volume and returns together.` : `Discount wins on contribution; size-guide fix deferred.`,
      details: { sku, econ },
    });
  }

  // ---------------------------------------------------------------- Pricing vs Inventory (zone-level)
  const holdsThisTick = list.filter((p) => p.action.type === "HOLD_PRICE") as (Proposal & { action: Extract<Action, { type: "HOLD_PRICE" }> })[];
  list = list.flatMap((p) => {
    if (p.action.type !== "SET_PRICE" || p.action.price >= p.action.prevPrice) return [p];
    const a = p.action;
    const held = new Set<Region>();
    for (const h of holdsThisTick) if (h.action.sku === a.sku) held.add(h.action.zone);
    for (const h of Object.values(s.holds)) if (h.sku === a.sku && h.untilTick > tick) held.add(h.zone);
    const clash = a.zones.filter((z) => held.has(z));
    if (!clash.length) return [p];
    const keep = a.zones.filter((z) => !held.has(z));
    const prod = cat[a.sku];
    const covers = Object.fromEntries(WAREHOUSE_IDS.map((w) => [w, coverDays(s, prod, w)]));
    conflicts.push({
      kind: "pricing_vs_inventory",
      title: `Pricing vs Inventory · ${prod.name}`,
      agents: ["pricing", "inventory"],
      reasoning:
        `Pricing wants ${inr(a.prevPrice)} → ${inr(a.price)} nationally (${a.reason}). Inventory holds price in ${clash.map((z) => REGION_LABEL[z]).join(", ")}: ` +
        `${clash.map((z) => `${WAREHOUSE_BY_ID[HOME_WAREHOUSE[z]].name} ${covers[HOME_WAREHOUSE[z]].toFixed(1)}d cover`).filter((v, i, arr) => arr.indexOf(v) === i).join("; ")}. ` +
        `Surplus sits at ${Object.entries(covers).filter(([, c]) => c > 30).map(([w, c]) => `${WAREHOUSE_BY_ID[w as keyof typeof WAREHOUSE_BY_ID].name} ${c.toFixed(0)}d`).join(", ") || "no node"}. A national discount would accelerate the constrained zone's stockout while clearing surplus elsewhere.`,
      resolution: keep.length ? `Split by zone: discount in ${keep.map((z) => REGION_LABEL[z]).join(", ")}; hold in ${clash.map((z) => REGION_LABEL[z]).join(", ")}.` : `Discount withdrawn — every target zone is held.`,
      details: { sku: a.sku, discounted: keep, held: clash, covers },
      scenario: scenarioSku === a.sku ? s.scenario.id ?? undefined : undefined,
    });
    if (!keep.length) return [];
    return [{ ...p, action: { ...a, zones: keep }, reasoning: `${p.reasoning} [Arbitrated: zones limited to ${keep.map((z) => REGION_LABEL[z]).join(", ")}.]` }];
  });

  // ---------------------------------------------------------------- Fulfilment vs Courier (per order, joint)
  const fp = list.find((p) => p.action.type === "ALLOCATE_ORDERS");
  const cp = list.find((p) => p.action.type === "ASSIGN_COURIERS");
  if (fp && cp) {
    const allocs = (fp.action as Extract<Action, { type: "ALLOCATE_ORDERS" }>).allocations;
    const assigns = (cp.action as Extract<Action, { type: "ASSIGN_COURIERS" }>).assignments;
    const byOrder = new Map(assigns.map((a) => [a.orderId, a]));
    const orders = new Map(s.orders.map((o) => [o.id, o]));
    const merged: CourierAssignment[] = [];
    const backorders: string[] = [];
    let disagreements = 0;
    let fulfilmentWins = 0;
    let showcase: ConflictRecord | null = null;
    for (const al of allocs) {
      const c = byOrder.get(al.orderId);
      const o = orders.get(al.orderId)!;
      if (!c) {
        backorders.push(al.orderId);
        continue;
      }
      if (!al.warehouseId || c.legs || al.legs || (al.warehouseId === c.warehouseId && al.courierId === c.courierId)) {
        merged.push(c);
        continue;
      }
      disagreements++;
      // Joint evaluation of both agents' preferred (node, carrier) pairs on one objective:
      // expected landed cost (rate + COD fee + P(RTO) × RTO cost) + stock-protection penalty.
      const opts = routeOptions(o, cat, s.inventory, s.couriers, { warehouses: Array.from(new Set([al.warehouseId, c.warehouseId])), ivr: o.rtoMeasure === "ivr_confirm" });
      const fOpt = opts.find((x) => x.warehouseId === al.warehouseId && x.courierId === al.courierId);
      const penalty = (wh: typeof al.warehouseId) => (wh && fulfilmentScore(s, o, wh, 0) > 0 ? 80 : 0);
      const scoreF = fOpt ? fOpt.expected + penalty(fOpt.warehouseId) : Infinity;
      const scoreC = c.expectedCost + penalty(c.warehouseId);
      const pickF = !!fOpt && scoreF < scoreC;
      if (pickF && fOpt) {
        fulfilmentWins++;
        merged.push({ orderId: o.id, warehouseId: fOpt.warehouseId, courierId: fOpt.courierId, cost: fOpt.forward, expectedCost: fOpt.expected, rtoP: +fOpt.rtoP.toFixed(3), slaDays: fOpt.slaDays });
      } else merged.push(c);
      const margin = o.lines.reduce((m, l) => m + (l.price - cat[l.sku].cost) * l.qty, 0);
      const interesting = fOpt && fOpt.rtoP >= 0.18 && o.value < 800;
      if (fOpt && (!showcase || (interesting && !showcase.details?.interesting))) {
        const premium = opts.filter((x) => x.courierId === "CR-VAYU").sort((x, y) => x.expected - y.expected)[0];
        showcase = {
          kind: "fulfilment_vs_courier",
          title: `Fulfilment vs Courier · ${o.id} (${inr(o.value)} ${o.paymentMode.toUpperCase()}, ${o.tier} ${o.pincode})`,
          agents: ["fulfilment", "courier"],
          reasoning:
            `Fulfilment: ${WAREHOUSE_BY_ID[al.warehouseId].name} + ${COURIER_BY_ID[fOpt.courierId].name}, cheapest rate ${inr(fOpt.forward)} — but ${(fOpt.rtoP * 100).toFixed(0)}% RTO risk on this pincode/payment mode makes expected landed cost ${inr(fOpt.expected)}. ` +
            (premium ? `Premium ${COURIER_BY_ID[premium.courierId].name}: ${inr(premium.forward)}, ${(premium.rtoP * 100).toFixed(0)}% RTO → ${inr(premium.expected)}, ${((premium.expected / Math.max(1, margin)) * 100).toFixed(0)}% of the ${inr(margin)} gross margin. ` : "") +
            `Courier: ${WAREHOUSE_BY_ID[c.warehouseId].name} + ${COURIER_BY_ID[c.courierId].name}, ${inr(c.cost)} at ${(c.rtoP * 100).toFixed(0)}% RTO → ${inr(c.expectedCost)} expected. Joint score: ${inr(scoreF)} vs ${inr(scoreC)}.`,
          resolution: pickF ? `Ship ${WAREHOUSE_BY_ID[fOpt.warehouseId].city} via ${COURIER_BY_ID[fOpt.courierId].name} (${inr(fOpt.expected)} expected).` : `Ship ${WAREHOUSE_BY_ID[c.warehouseId].city} via ${COURIER_BY_ID[c.courierId].name} (${inr(c.expectedCost)} expected, saves ${inr(scoreF - scoreC)} vs cheapest-rate).`,
          details: { value: o.value, interesting },
        };
      }
    }
    // one showcase per 6 ticks keeps the stream readable; every disagreement is still resolved and counted
    if (showcase && tick % 6 === 0) {
      showcase.details = { ...showcase.details, disagreements, fulfilmentWins, courierWins: disagreements - fulfilmentWins };
      showcase.resolution += ` This tick: ${disagreements} disagreements (${fulfilmentWins} → fulfilment, ${disagreements - fulfilmentWins} → courier).`;
      conflicts.push(showcase);
    }
    list = list.filter((p) => p !== fp && p !== cp);
    list.push({ ...cp, action: { type: "ASSIGN_COURIERS", assignments: merged }, meta: { ...cp.meta, disagreements, fulfilmentWins } });
    if (backorders.length) list.push({ ...fp, action: { type: "ALLOCATE_ORDERS", allocations: allocs.filter((a) => backorders.includes(a.orderId)).map((a) => ({ ...a, warehouseId: null })) } });
  }

  // ---------------------------------------------------------------- Procurement vs Finance (cash)
  const cash = list.find((p) => p.action.type === "CASH_CONSTRAINT");
  const pos = list.filter((p) => p.action.type === "CREATE_PO").sort((a, b) => Number(b.meta?.urgent) - Number(a.meta?.urgent));
  if (cash && pos.length) {
    let headroom = (cash.action as Extract<Action, { type: "CASH_CONSTRAINT" }>).available - CASH_BUFFER;
    const replaced = new Map<Proposal, Proposal | null>();
    for (const po of pos) {
      const a = po.action as Extract<Action, { type: "CREATE_PO" }>;
      const claim = po.resources?.find((r) => r.kind === "cash")?.amount ?? a.qty * a.unitCost;
      if (claim <= headroom) {
        headroom -= claim;
        continue;
      }
      const needQty = Number(po.meta?.needQty ?? a.qty);
      const unitAtNeed = Number(po.meta?.unitCostAtNeed ?? a.unitCost);
      const prod = cat[a.sku];
      const terms = Number(po.meta?.paymentTermsDays ?? 30);
      if (needQty < a.qty) {
        const newValue = needQty * unitAtNeed;
        const newClaim = newValue;
        void terms;
        const forgone = a.qty * (unitAtNeed - a.unitCost);
        const next = propose("procurement", { ...a, qty: needQty, unitCost: unitAtNeed }, {
          reasoning: `${po.reasoning} [Arbitrated with Finance: downsized ${a.qty} → ${needQty} units to protect the cash buffer.]`,
          confidence: po.confidence,
          costImpact: newValue,
          serviceImpact: po.serviceImpact,
          citations: po.citations,
          resources: [{ kind: "cash", key: "cash", amount: newClaim }],
          meta: { ...po.meta, value: newValue, downsizedFrom: a.qty },
        });
        replaced.set(po, next);
        conflicts.push({
          kind: "procurement_vs_finance",
          title: `Procurement vs Finance · ${prod.name}`,
          agents: ["procurement", "finance"],
          reasoning:
            `Procurement proposed ${a.qty.toLocaleString("en-IN")} units at the price break (${inr(a.unitCost)}/unit, ${inr(a.qty * a.unitCost)}). Finance: cash headroom above the ${inr(CASH_BUFFER)} buffer is ${inr(Math.max(0, headroom))} ` +
            `and marketplace settlements arrive on a T+14 cycle (next inflow ${(((cash.meta?.nextInflowTick as number) - tick) / 24).toFixed(1)} days). The break saves ${inr(forgone)} but would breach the buffer by ${inr(claim - Math.max(0, headroom))}.`,
          resolution: `Order the need quantity only: ${needQty.toLocaleString("en-IN")} units at ${inr(unitAtNeed)} (${inr(newValue)}). Discount forgone ${inr(forgone)}; liquidity preserved until settlement.`,
          details: { sku: a.sku, proposedQty: a.qty, needQty, forgone, headroom },
          scenario: scenarioSku === a.sku ? s.scenario.id ?? undefined : undefined,
        });
        headroom -= newClaim;
      } else if (!po.meta?.urgent) {
        replaced.set(po, null);
        conflicts.push({
          kind: "procurement_vs_finance",
          title: `Procurement vs Finance · ${prod.name}`,
          agents: ["procurement", "finance"],
          reasoning: `Non-urgent PO ${inr(claim)} exceeds cash headroom ${inr(Math.max(0, headroom))} above buffer.`,
          resolution: "Deferred 24h until settlement inflows land.",
          details: { sku: a.sku },
        });
      } else {
        headroom -= claim;
      }
    }
    list = list.flatMap((p) => (replaced.has(p) ? (replaced.get(p) ? [replaced.get(p)!] : []) : [p]));
  }

  // Make the final execution order explicit: protect service first, then cost,
  // while allowing confidence to break ties. Guardrails still decide validity.
  list.sort((a, b) => businessScore(b) - businessScore(a));
  return { survivors: list, conflicts };
}
