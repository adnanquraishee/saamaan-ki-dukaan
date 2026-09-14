"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// Per-visitor UI state (cart, delivery pincode, own order ids). Kept out of the shared simulation state
// on purpose: two visitors in two tabs should not share a cart.
interface CartState {
  items: { sku: string; qty: number }[];
  pincode: string;
  name: string;
  myOrders: string[];
  myReturns: string[];
  add: (sku: string, qty?: number) => void;
  setQty: (sku: string, qty: number) => void;
  clear: () => void;
  setPincode: (pin: string) => void;
  setName: (n: string) => void;
  rememberOrder: (id: string) => void;
  rememberReturn: (id: string) => void;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      pincode: "400053",
      name: "",
      myOrders: [],
      myReturns: [],
      add: (sku, qty = 1) => set((s) => ({ items: s.items.some((i) => i.sku === sku) ? s.items.map((i) => (i.sku === sku ? { ...i, qty: Math.min(5, i.qty + qty) } : i)) : [...s.items, { sku, qty }] })),
      setQty: (sku, qty) => set((s) => ({ items: qty <= 0 ? s.items.filter((i) => i.sku !== sku) : s.items.map((i) => (i.sku === sku ? { ...i, qty: Math.min(5, qty) } : i)) })),
      clear: () => set({ items: [] }),
      setPincode: (pincode) => set({ pincode }),
      setName: (name) => set({ name }),
      rememberOrder: (id) => set((s) => ({ myOrders: [id, ...s.myOrders].slice(0, 50) })),
      rememberReturn: (id) => set((s) => ({ myReturns: [id, ...s.myReturns].slice(0, 50) })),
    }),
    { name: "sct:cart:v1" },
  ),
);
