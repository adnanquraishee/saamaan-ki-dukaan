import { ENVELOPES } from "@/lib/config/envelopes";
import { HOME_WAREHOUSE, WAREHOUSE_IDS } from "@/lib/config/network";
import { MAX_SLA_DAYS, planFulfilment } from "@/lib/ml/routing";
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
    let splits = 0;
    for (const o of orders) {
      const legs = planFulfilment(o, cat, inv, s.couriers, (opts) => (opts.length ? opts.reduce((a, b) => (a.forward <= b.forward ? a : b)) : null));
      if (!legs || !legs.length || Math.max(...legs.map((l) => l.slaDays)) > MAX_SLA_DAYS) {
        allocations.push({ orderId: o.id, warehouseId: null, shipCost: 0, slaDays: 0 });
        backorders++;
        continue;
      }
      for (const leg of legs) for (const l of leg.lines) inv[l.sku][leg.warehouseId] -= l.qty;
      if (legs.length > 1) splits++;
      const shipCost = legs.reduce((a, l) => a + l.cost, 0);
      allocations.push({ orderId: o.id, warehouseId: legs[0].warehouseId, courierId: legs[0].courierId, shipCost, slaDays: Math.max(...legs.map((l) => l.slaDays)), legs: legs.length > 1 ? legs : undefined });
      meta[o.id] = { score: fulfilmentScore(s, o, legs[0].warehouseId, shipCost), scarcePenalty: false };
    }
    return [
      propose("fulfilment", { type: "ALLOCATE_ORDERS", allocations }, {
        reasoning: `Allocated ${allocations.length - backorders} orders home-first: each ships what its home FC holds and the remainder comes from the nearest FC with stock (cheapest-rate carrier per parcel); ${splits} split across warehouses; ${backorders} cannot be filled from any combination of nodes.`,
        confidence: 0.82,
        costImpact: allocations.reduce((a, x) => a + x.shipCost, 0),
        serviceImpact: allocations.length - backorders,
        resources: allocations.map((a) => ({ kind: "order" as const, key: a.orderId })),
        meta: { scores: meta, backorders, splits },
      }),
    ];
  },
};
