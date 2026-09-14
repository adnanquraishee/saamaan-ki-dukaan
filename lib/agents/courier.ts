import { ENVELOPES } from "@/lib/config/envelopes";
import { COURIER_BY_ID } from "@/lib/config/network";
import { planFulfilment, routeOptions, type RouteOption } from "@/lib/ml/routing";
import { retrieve } from "@/lib/rag/retrieve";
import type { AppState } from "@/lib/store/state";
import type { Citation, CourierAssignment, Order, Proposal } from "@/lib/types";
import { openOrders } from "./fulfilment";
import { catalogIndex, propose } from "./shared";
import type { Agent } from "./types";

/** Courier objective: minimum expected landed cost (rate + COD fee + P(RTO) × RTO charge) within the premium ceiling. */
export function bestCourierOption(opts: RouteOption[]) {
  if (!opts.length) return null;
  const cheapestFwd = Math.min(...opts.map((o) => o.forward));
  const ceiling = 1 + (ENVELOPES.courier.courierPremiumCeilingPct ?? 80) / 100;
  const within = opts.filter((o) => o.forward <= cheapestFwd * ceiling);
  // Balance economic cost with service speed. A day beyond the fastest viable
  // option costs a modest ₹18/day, so a clearly faster nearby route can win
  // without allowing an uneconomic premium carrier.
  const candidates = within.length ? within : opts;
  const fastest = Math.min(...candidates.map((o) => o.slaDays));
  return candidates.reduce((a, b) => (b.expected + (b.slaDays - fastest) * 18 < a.expected + (a.slaDays - fastest) * 18 ? b : a));
}

export const courierAgent: Agent<{ s: AppState; orders: Order[] }> = {
  id: "courier",
  name: "Courier",
  envelope: ENVELOPES.courier,
  perceive: (s) => ({ s, orders: openOrders(s) }),
  decide: ({ s, orders }) => {
    if (!orders.length) return [];
    const cat = catalogIndex(s);
    const inv = JSON.parse(JSON.stringify(s.inventory)) as AppState["inventory"];
    const assignments: CourierAssignment[] = [];
    const used = new Set<string>();
    const alternatives: Record<string, RouteOption[]> = {};
    for (const o of orders) {
      // Home-first: ship what the customer's home FC holds, fetch the rest from the nearest FCs with stock.
      const legs = planFulfilment(o, cat, inv, s.couriers, bestCourierOption, { ivr: o.rtoMeasure === "ivr_confirm" });
      if (!legs) continue;
      for (const leg of legs) {
        for (const l of leg.lines) inv[l.sku][leg.warehouseId] -= l.qty;
        used.add(leg.courierId);
      }
      const value = (leg: (typeof legs)[number]) => leg.lines.reduce((x, l) => x + l.price * l.qty, 0);
      const primary = legs.reduce((a, b) => (value(b) > value(a) ? b : a));
      assignments.push({
        orderId: o.id,
        warehouseId: primary.warehouseId,
        courierId: primary.courierId,
        cost: legs.reduce((a, l) => a + l.cost, 0),
        expectedCost: legs.reduce((a, l) => a + l.expectedCost, 0),
        rtoP: primary.rtoP,
        slaDays: Math.max(...legs.map((l) => l.slaDays)),
        legs: legs.length > 1 ? legs : undefined,
      });
      alternatives[o.id] = routeOptions(o, cat, null, s.couriers, { warehouses: [primary.warehouseId] }).sort((a, b) => a.expected - b.expected).slice(0, 4);
    }
    if (!assignments.length) return [];
    // Grounding: retrieve each carrier's rate card before assigning.
    const citations: Citation[] = [];
    for (const id of Array.from(used)) {
      const c = COURIER_BY_ID[id];
      const hit = retrieve(`${c.name} rate card zone first 0.5 kg additional slab COD fee RTO charge`, { k: 1, sourcePrefix: c.contractDoc });
      citations.push(...hit);
    }
    const byCourier = assignments.reduce<Record<string, number>>((m, a) => ((m[a.courierId] = (m[a.courierId] ?? 0) + 1), m), {});
    // Compatible shipments on the same warehouse → courier → customer-region
    // corridor share pickup/manifest handling. This is a conservative handling
    // saving, capped at ₹15 per shipment, rather than an invented freight rate cut.
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const corridors = assignments.reduce<Record<string, CourierAssignment[]>>((m, a) => { const order = orderById.get(a.orderId)!; const key = `${a.warehouseId}|${a.courierId}|${order.region}`; (m[key] ??= []).push(a); return m; }, {});
    let batchSavings = 0;
    for (const group of Object.values(corridors)) {
      if (group.length < 3) continue;
      for (const assignment of group) {
        const saving = Math.min(15, Math.round(assignment.cost * 0.05));
        assignment.cost -= saving;
        assignment.expectedCost -= saving;
        batchSavings += saving;
      }
    }
    return [
      propose("courier", { type: "ASSIGN_COURIERS", assignments }, {
        reasoning: `Home-first fulfilment: each order ships what its home FC holds and fetches the rest from the nearest FCs with stock; the carrier per parcel is chosen by expected landed cost plus a small SLA penalty, within an ${ENVELOPES.courier.courierPremiumCeilingPct}% premium ceiling. Same-corridor groups of 3+ share pickup and manifest handling, saving ${batchSavings ? `₹${batchSavings.toLocaleString("en-IN")}` : "₹0"}. Mix: ${Object.entries(byCourier).map(([k, v]) => `${COURIER_BY_ID[k].name} ${v}`).join(", ")}.`,
        confidence: 0.8,
        costImpact: assignments.reduce((a, x) => a + x.expectedCost, 0),
        serviceImpact: assignments.length,
        citations,
        resources: assignments.map((a) => ({ kind: "order" as const, key: a.orderId })),
        meta: { alternatives, batchSavings, corridors: Object.fromEntries(Object.entries(corridors).map(([key, group]) => [key, group.length])) },
      }),
    ];
  },
};
