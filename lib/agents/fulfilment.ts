import { ENVELOPES } from "@/lib/config/envelopes";
import { HOME_WAREHOUSE, WAREHOUSE_IDS } from "@/lib/config/network";
import { MAX_SLA_DAYS, canFill, routeOptions } from "@/lib/ml/routing";
import type { AppState } from "@/lib/store/state";
import type { Allocation, Order, Proposal, WarehouseId } from "@/lib/types";
import { catalogIndex, coverDays, propose } from "./shared";
import type { Agent } from "./types";

export function openOrders(s: AppState): Order[] {
  return s.orders.filter((o) => o.status === "placed" || (o.status === "backordered" && o.source === "storefront")).slice(0, 250);
}

export const PROTECTION_PENALTY = 80;

/** Fulfilment objective: cheapest ship-from node by rate card, penalising drawing down a scarce non-home node. */
export function fulfilmentScore(s: AppState, o: Order, wh: WarehouseId, cheapestForward: number) {
  const cat = catalogIndex(s);
  const scarce = wh !== HOME_WAREHOUSE[o.region] && o.lines.some((l) => coverDays(s, cat[l.sku], wh) < 10);
  return cheapestForward + (scarce ? PROTECTION_PENALTY : 0);
}

export const fulfilmentAgent: Agent<{ s: AppState; orders: Order[] }> = {
  id: "fulfilment",
  name: "Fulfilment",
  envelope: ENVELOPES.fulfilment,
  perceive: (s) => ({ s, orders: openOrders(s) }),
  decide: ({ s, orders }) => {
    if (!orders.length) return [];
    const cat = catalogIndex(s);
    const inv = JSON.parse(JSON.stringify(s.inventory)) as AppState["inventory"];
    const allocations: Allocation[] = [];
    const meta: Record<string, { score: number; scarcePenalty: boolean }> = {};
    let backorders = 0;
    for (const o of orders) {
      let best: { wh: WarehouseId; score: number; fwd: number; sla: number; courierId: string } | null = null;
      for (const wh of WAREHOUSE_IDS) {
        if (!canFill(o, inv, wh)) continue;
        const opts = routeOptions(o, cat, null, s.couriers, { warehouses: [wh] });
        if (!opts.length) continue;
        const cheapest = opts.reduce((a, b) => (a.forward <= b.forward ? a : b));
        const score = fulfilmentScore(s, o, wh, cheapest.forward);
        if (!best || score < best.score) best = { wh, score, fwd: cheapest.forward, sla: cheapest.slaDays, courierId: cheapest.courierId };
      }
      if (!best || best.sla > MAX_SLA_DAYS) {
        allocations.push({ orderId: o.id, warehouseId: null, shipCost: 0, slaDays: 0 });
        backorders++;
        continue;
      }
      for (const l of o.lines) inv[l.sku][best.wh] -= l.qty;
      allocations.push({ orderId: o.id, warehouseId: best.wh, courierId: best.courierId, shipCost: best.fwd, slaDays: best.sla });
      meta[o.id] = { score: best.score, scarcePenalty: best.score > best.fwd };
    }
    return [
      propose("fulfilment", { type: "ALLOCATE_ORDERS", allocations }, {
        reasoning: `Allocated ${allocations.length - backorders} orders to the cheapest ship-from node and carrier by rate card, penalising draws on scarce non-home nodes (+₹${PROTECTION_PENALTY}); ${backorders} cannot be filled from any node.`,
        confidence: 0.82,
        costImpact: allocations.reduce((a, x) => a + x.shipCost, 0),
        serviceImpact: allocations.length - backorders,
        resources: allocations.map((a) => ({ kind: "order" as const, key: a.orderId })),
        meta: { scores: meta, backorders },
      }),
    ];
  },
};
