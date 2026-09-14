"use client";
import { useMemo } from "react";
import { PINCODE_BY_PIN, WAREHOUSE_IDS } from "@/lib/config/network";
import type { Command } from "@/lib/engine/commands";
import { deliveryPromise } from "@/lib/ml/routing";
import { sendRemote, useRemote } from "@/lib/remote/relayClient";
import { useApp } from "@/lib/store/store";
import { dispatch } from "@/lib/store/sync";
import { useUi } from "@/lib/store/ui";
import type { Courier, Order, Product, Region, ReturnRequest, WarehouseId } from "@/lib/types";

export interface ShopData {
  ready: boolean;
  mode: "local" | "remote";
  tick: number;
  catalog: Product[];
  inventory: Record<string, Record<WarehouseId, number>>;
  couriers: Courier[];
  orders: Order[];
  returns: ReturnRequest[];
  hot: Set<string>;
}

export function useShop(): ShopData {
  const mode = useUi((s) => s.mode);
  const hydrated = useUi((s) => s.hydrated);
  const catalog = useApp((s) => s.catalog);
  const inventory = useApp((s) => s.inventory);
  const couriers = useApp((s) => s.couriers);
  const orders = useApp((s) => s.orders);
  const returns = useApp((s) => s.returns);
  const forecasts = useApp((s) => s.forecasts);
  const tick = useApp((s) => s.clock.tick);
  const snap = useRemote((s) => s.snapshot);
  return useMemo(() => {
    if (mode === "remote") {
      return { ready: !!snap, mode, tick: snap?.tick ?? 0, catalog: snap?.catalog ?? [], inventory: snap?.inventory ?? {}, couriers: snap?.couriers ?? [], orders: snap?.orders ?? [], returns: snap?.returns ?? [], hot: new Set(snap?.forecastsHot ?? []) };
    }
    const hot = new Set(Object.entries(forecasts).filter(([, f]) => f.velocityMult >= 2.5).map(([k]) => k));
    return { ready: hydrated, mode, tick, catalog, inventory, couriers, orders, returns, hot };
  }, [mode, hydrated, snap, catalog, inventory, couriers, orders, returns, forecasts, tick]);
}

export function sendShopCommand(cmd: Command) {
  if (useUi.getState().mode === "remote") return sendRemote(cmd);
  return dispatch(cmd);
}

export function regionOf(pin: string): Region {
  return PINCODE_BY_PIN[pin]?.region ?? "west";
}

export function totalStock(inv: ShopData["inventory"], sku: string) {
  const r = inv[sku];
  return r ? WAREHOUSE_IDS.reduce((a, w) => a + Math.max(0, r[w]), 0) : 0;
}

export function promiseFor(data: ShopData, pin: string, lines: { sku: string; qty: number }[], paymentMode: "cod" | "prepaid" = "prepaid") {
  const p = PINCODE_BY_PIN[pin];
  if (!p || !data.catalog.length) return null;
  const cat = Object.fromEntries(data.catalog.map((x) => [x.sku, x]));
  const priced = lines.filter((l) => cat[l.sku]).map((l) => ({ ...l, price: cat[l.sku].zonePrice[p.region] }));
  if (!priced.length) return null;
  const value = priced.reduce((a, l) => a + l.price * l.qty, 0);
  return deliveryPromise({ lines: priced, pincode: pin, region: p.region, tier: p.tier, paymentMode, value, firstTime: false }, cat, data.inventory, data.couriers);
}

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
