// Fulfilment + courier routing: greedy min-cost assignment with SLA constraints.
// At ~40 orders/hour across 3 nodes × 4 carriers, full enumeration (12 options/order) is exact
// for the single-order problem; a VRP is unnecessary because carriers own the linehaul and last mile.

import { PINCODE_BY_PIN, WAREHOUSE_BY_ID, WAREHOUSE_IDS, rateZone } from "@/lib/config/network";
import { PACKAGING_COST, chargeableSlabs, forwardCost, rtoCost } from "@/lib/engine/economics";
import { hashString } from "@/lib/engine/rng";
import type { Courier, Order, Product, RateZone, WarehouseId } from "@/lib/types";
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

/** Customer-facing promise: fastest serviceable option from any node holding stock. */
export function deliveryPromise(
  order: Pick<Order, "lines" | "pincode" | "region" | "tier" | "paymentMode" | "value" | "firstTime">,
  catalog: Record<string, Product>,
  inv: Record<string, Record<WarehouseId, number>>,
  couriers: Courier[],
) {
  const opts = routeOptions(order, catalog, inv, couriers);
  if (!opts.length) return null;
  const cheapest = opts.reduce((a, b) => (a.expected <= b.expected ? a : b));
  const fastest = opts.reduce((a, b) => (a.slaDays <= b.slaDays ? a : b));
  return { days: Math.ceil(cheapest.slaDays + 0.5), fastestDays: Math.ceil(fastest.slaDays + 0.5), warehouseId: cheapest.warehouseId };
}

export { PINCODE_BY_PIN };
