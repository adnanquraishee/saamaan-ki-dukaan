// Simulation gate: run a consequential action against a cloned slice of state and project fill rate.

import { WAREHOUSE_IDS } from "@/lib/config/network";
import { elasticityFor } from "@/lib/ml/elasticity";
import type { AppState } from "@/lib/store/state";
import type { Action, Product, WarehouseId } from "@/lib/types";
import { catalogIndex, warehouseDaily } from "@/lib/agents/shared";
import { HOME_WAREHOUSE } from "@/lib/config/network";

const HORIZON = 10;

function project(s: AppState, p: Product, twin: { stock: Record<WarehouseId, number>; priceMult: Record<WarehouseId, number>; arrivals: { day: number; wh: WarehouseId; qty: number }[] }) {
  let demand = 0;
  let served = 0;
  const stock = { ...twin.stock };
  const e = elasticityFor(p.cluster);
  for (let day = 0; day < HORIZON; day++) {
    for (const a of twin.arrivals) if (a.day === day) stock[a.wh] += a.qty;
    for (const wh of WAREHOUSE_IDS) {
      const d = warehouseDaily(s, p, wh) * Math.pow(twin.priceMult[wh], e);
      const x = Math.min(stock[wh], d);
      stock[wh] -= x;
      demand += d;
      served += x;
    }
  }
  return demand > 0 ? served / demand : 1;
}

export function simulationGate(s: AppState, action: Action) {
  let sku: string | null = null;
  if (action.type === "SET_PRICE" || action.type === "TRANSFER_STOCK") sku = action.sku;
  if (!sku) return null;
  const p = catalogIndex(s)[sku];
  // cloned twin of the SKU's slice of state
  const base = {
    stock: structuredClone(s.inventory[sku]),
    priceMult: Object.fromEntries(WAREHOUSE_IDS.map((w) => [w, 1])) as Record<WarehouseId, number>,
    arrivals: [
      ...s.purchaseOrders.filter((po) => po.sku === sku && po.status === "open").map((po) => ({ day: Math.max(0, Math.floor((po.etaTick - s.clock.tick) / 24)), wh: po.warehouseId, qty: po.qty })),
      ...s.transfers.filter((t) => t.sku === sku).map((t) => ({ day: Math.max(0, Math.floor((t.arriveTick - s.clock.tick) / 24)), wh: t.to, qty: t.qty })),
    ],
  };
  const twin = structuredClone(base);
  if (action.type === "SET_PRICE") {
    for (const wh of WAREHOUSE_IDS) {
      const zones = action.zones.filter((z) => HOME_WAREHOUSE[z] === wh);
      if (zones.length) twin.priceMult[wh] = action.price / action.prevPrice;
    }
  } else if (action.type === "TRANSFER_STOCK") {
    twin.stock[action.from] = Math.max(0, twin.stock[action.from] - action.qty);
    twin.arrivals.push({ day: 2, wh: action.to, qty: action.qty });
  }
  const without = project(s, p, base);
  const withAction = project(s, p, twin);
  return { without, withAction };
}
