import { ENVELOPES } from "@/lib/config/envelopes";
import { COURIER_BY_ID } from "@/lib/config/network";
import { routeOptions, type RouteOption } from "@/lib/ml/routing";
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
  return (within.length ? within : opts).reduce((a, b) => (a.expected <= b.expected ? a : b));
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
      const opts = routeOptions(o, cat, inv, s.couriers, { ivr: o.rtoMeasure === "ivr_confirm" });
      const best = bestCourierOption(opts);
      if (!best) continue;
      for (const l of o.lines) inv[l.sku][best.warehouseId] -= l.qty;
      used.add(best.courierId);
      assignments.push({ orderId: o.id, warehouseId: best.warehouseId, courierId: best.courierId, cost: best.forward, expectedCost: best.expected, rtoP: +best.rtoP.toFixed(3), slaDays: best.slaDays });
      alternatives[o.id] = opts.sort((a, b) => a.expected - b.expected).slice(0, 4);
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
    return [
      propose("courier", { type: "ASSIGN_COURIERS", assignments }, {
        reasoning: `Chose carrier per shipment by expected landed cost = forward rate + COD fee + P(RTO) × (RTO charge + lost margin), within an ${ENVELOPES.courier.courierPremiumCeilingPct}% premium ceiling. Mix: ${Object.entries(byCourier).map(([k, v]) => `${COURIER_BY_ID[k].name} ${v}`).join(", ")}.`,
        confidence: 0.8,
        costImpact: assignments.reduce((a, x) => a + x.expectedCost, 0),
        serviceImpact: assignments.length,
        citations,
        resources: assignments.map((a) => ({ kind: "order" as const, key: a.orderId })),
        meta: { alternatives },
      }),
    ];
  },
};
