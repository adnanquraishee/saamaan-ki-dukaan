import type { AppState } from "@/lib/store/state";
import type { Courier, Order, Product, ReturnRequest, WarehouseId } from "@/lib/types";

export interface PublicSnapshot {
  tick: number;
  catalog: Product[];
  inventory: Record<string, Record<WarehouseId, number>>;
  couriers: Courier[];
  orders: Order[];
  returns: ReturnRequest[];
  holds: AppState["holds"];
  forecastsHot: string[];
  wall: number;
}

export function buildSnapshot(s: AppState): PublicSnapshot {
  const ids = new Set(s.storefrontOrderIds);
  return {
    tick: s.clock.tick,
    catalog: s.catalog,
    inventory: s.inventory,
    couriers: s.couriers,
    orders: s.orders.filter((o) => ids.has(o.id)),
    returns: s.returns.filter((r) => r.source === "storefront"),
    holds: s.holds,
    forecastsHot: Object.entries(s.forecasts).filter(([, f]) => f.velocityMult >= 2.5).map(([k]) => k),
    wall: Date.now(),
  };
}
