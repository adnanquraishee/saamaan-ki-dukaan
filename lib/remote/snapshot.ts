import { STATE_VERSION, type AppState } from "@/lib/store/state";
import type { Courier, Order, Product, ReturnRequest, Shipment, WarehouseId } from "@/lib/types";

export interface PublicSnapshot {
  version: number;
  tick: number;
  catalog: Product[];
  inventory: Record<string, Record<WarehouseId, number>>;
  couriers: Courier[];
  orders: Order[];
  shipments: Shipment[];
  returns: ReturnRequest[];
  holds: AppState["holds"];
  forecastsHot: string[];
  wall: number;
}

export function buildSnapshot(s: AppState): PublicSnapshot {
  const ids = new Set(s.storefrontOrderIds);
  return {
    version: STATE_VERSION,
    tick: s.clock.tick,
    catalog: s.catalog,
    inventory: s.inventory,
    couriers: s.couriers,
    orders: s.orders.filter((o) => ids.has(o.id)),
    shipments: s.shipments.filter((x) => ids.has(x.orderId)),
    returns: s.returns.filter((r) => r.source === "storefront"),
    holds: s.holds,
    forecastsHot: Object.entries(s.forecasts).filter(([, f]) => f.velocityMult >= 2.5).map(([k]) => k),
    wall: Date.now(),
  };
}
