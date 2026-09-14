"use client";
// Single persisted store. One versioned localStorage key; writes are debounced and only the engine tab
// persists (single writer). Ring buffers in state.ts keep the payload far below the 5 MB quota.
import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";
import { CAPS, STATE_VERSION, STORAGE_KEY, createInitialState, normaliseState, type AppState } from "./state";

let persistEnabled = false;
export function setPersistEnabled(on: boolean) {
  persistEnabled = on;
}

let pending: { name: string; value: StorageValue<AppState> } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function write(name: string, value: StorageValue<AppState>) {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch {
    // Quota: shed the largest ring buffers and retry once.
    const s = value.state;
    const trimmed = { ...value, state: { ...s, decisions: s.decisions.slice(-150), shipments: s.shipments.filter((x) => x.outcome === "in_transit"), orders: s.orders.slice(-200), history: s.history.slice(-120) } };
    try {
      localStorage.setItem(name, JSON.stringify(trimmed));
    } catch {
      /* give up silently; in-memory state is still authoritative */
    }
  }
}

export function flushPersist() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (pending) write(pending.name, pending.value);
  pending = null;
}

const storage: PersistStorage<AppState> = {
  getItem: (name) => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(name);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StorageValue<AppState>;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    if (typeof window === "undefined" || !persistEnabled) return;
    pending = { name, value };
    if (!timer) timer = setTimeout(flushPersist, 1500);
  },
  removeItem: (name) => {
    if (typeof window !== "undefined") localStorage.removeItem(name);
  },
};

export const useApp = create<AppState>()(
  persist(() => createInitialState(), {
    name: STORAGE_KEY,
    version: STATE_VERSION,
    storage,
    skipHydration: true,
    // incompatible versions re-seed rather than attempting a migration
    migrate: () => createInitialState(),
    merge: (persisted, current) => normaliseState({ ...current, ...(persisted as Partial<AppState>) }),
  }),
);

export function hardReset() {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = null;
  for (const k of Object.keys(localStorage)) if (k.startsWith("sct:")) localStorage.removeItem(k);
}

export { CAPS };
