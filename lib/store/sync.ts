"use client";
// Cross-tab sync over BroadcastChannel('sct').
//  - every local mutation publishes a diff of the top-level keys that changed (by reference)
//  - tabs apply diffs they did not originate
//  - non-engine tabs never mutate domain state: they send commands to the engine tab, which applies them
//  - the engine lock lives in state (`engine`) and is claimed via heartbeat
import { produce } from "immer";
import { applyCommand, type Command } from "@/lib/engine/commands";
import { STATE_VERSION, STORAGE_KEY, type AppState } from "./state";
import { flushPersist, hardReset, setPersistEnabled, useApp } from "./store";
import { useUi } from "./ui";

type Msg =
  | { t: "diff"; from: string; keys: Partial<AppState> }
  | { t: "hello"; from: string }
  | { t: "snapshot"; from: string; to: string; state: AppState }
  | { t: "cmd"; from: string; id: string; cmd: Command }
  | { t: "ack"; from: string; id: string }
  | { t: "reload"; from: string };

const STALE_MS = 4000;
let claimAllowed = true;
let resetting = false;
export function setClaimAllowed(on: boolean) {
  claimAllowed = on;
}
let channel: BroadcastChannel | null = null;
let applyingRemote = false;
let tabId = "";
const pendingCmds = new Map<string, { cmd: Command; sent: number }>();
const listeners = new Set<(id: string) => void>();

export function getTabId() {
  return tabId;
}

function isHolder(s: AppState = useApp.getState()) {
  return s.engine.holderId === tabId;
}

/** Deterministic lock arbitration: newer claim wins; ties broken by tab id. */
function incomingLockWins(local: AppState["engine"], incoming: AppState["engine"]) {
  if (local.holderId !== tabId) return true;
  if (incoming.holderId === tabId) return true;
  if (incoming.claimedAt !== local.claimedAt) return incoming.claimedAt > local.claimedAt;
  return incoming.holderId > tabId;
}

export function executeCommand(cmd: Command) {
  useApp.setState((s) => produce(s, (d) => void applyCommand(d, cmd)));
}

/** Route a command to whichever tab runs the engine. Resolves when acknowledged. */
export function dispatch(cmd: Command): Promise<void> {
  const id = `${tabId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
  if (isHolder()) {
    executeCommand(cmd);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    pendingCmds.set(id, { cmd, sent: Date.now() });
    const done = (ackId: string) => {
      if (ackId !== id) return;
      listeners.delete(done);
      resolve();
    };
    listeners.add(done);
    channel?.postMessage({ t: "cmd", from: tabId, id, cmd } satisfies Msg);
  });
}

/** Reset demo: every open tab drops its state and reloads; the first to boot re-seeds from the warm state. */
export function resetDemo() {
  resetting = true;
  setPersistEnabled(false);
  channel?.postMessage({ t: "reload", from: tabId } satisfies Msg);
  hardReset();
  setTimeout(() => window.location.reload(), 150);
}

export function startSync() {
  if (channel) return () => {};
  tabId = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  useUi.setState({ tabId });
  channel = new BroadcastChannel("sct");

  const unsub = useApp.subscribe((state, prev) => {
    const holder = state.engine.holderId === tabId;
    if (useUi.getState().isEngine !== holder) {
      useUi.setState({ isEngine: holder });
      setPersistEnabled(holder);
    }
    if (applyingRemote) return;
    const keys: Partial<AppState> = {};
    let n = 0;
    for (const k of Object.keys(state) as (keyof AppState)[]) {
      if (state[k] !== prev[k]) {
        (keys as Record<string, unknown>)[k] = state[k];
        n++;
      }
    }
    // viewers only ever originate lock changes
    if (!holder && !("engine" in keys)) return;
    if (n) channel?.postMessage({ t: "diff", from: tabId, keys: holder ? keys : { engine: state.engine } } satisfies Msg);
  });

  channel.onmessage = (ev: MessageEvent<Msg>) => {
    const m = ev.data;
    if (!m || m.from === tabId) return;
    const s = useApp.getState();
    switch (m.t) {
      case "diff": {
        const keys = { ...m.keys };
        if (keys.engine && !incomingLockWins(s.engine, keys.engine)) {
          delete keys.engine;
          channel?.postMessage({ t: "diff", from: tabId, keys: { engine: s.engine } } satisfies Msg);
        }
        // a tab that has just lost the lock must not overwrite state from its stale copy
        if (isHolder(s) && !keys.engine) {
          const { engine: _e, ...rest } = keys;
          if (Object.keys(rest).length) return;
        }
        applyingRemote = true;
        useApp.setState(keys);
        applyingRemote = false;
        const holder = useApp.getState().engine.holderId === tabId;
        useUi.setState({ isEngine: holder });
        setPersistEnabled(holder);
        break;
      }
      case "hello":
        if (isHolder(s)) channel?.postMessage({ t: "snapshot", from: tabId, to: m.from, state: s } satisfies Msg);
        break;
      case "snapshot":
        if (m.to === tabId && !isHolder(s)) {
          applyingRemote = true;
          useApp.setState(m.state);
          applyingRemote = false;
        }
        break;
      case "cmd":
        if (isHolder(s)) {
          executeCommand(m.cmd);
          channel?.postMessage({ t: "ack", from: tabId, id: m.id } satisfies Msg);
        }
        break;
      case "reload":
        resetting = true;
        setPersistEnabled(false);
        window.location.reload();
        break;
      case "ack":
        pendingCmds.delete(m.id);
        listeners.forEach((l) => l(m.id));
        break;
    }
  };

  channel.postMessage({ t: "hello", from: tabId } satisfies Msg);

  // heartbeat + claim + resend
  const beat = setInterval(() => {
    const s = useApp.getState();
    const now = Date.now();
    const visible = typeof document !== "undefined" ? !document.hidden : true;
    if (s.engine.holderId === tabId) {
      useApp.setState({ engine: { ...s.engine, heartbeat: now, visible } });
    } else {
      const stale = !s.engine.holderId || now - s.engine.heartbeat > STALE_MS;
      // background tabs are throttled by the browser; hand the engine to a visible tab
      const handoff = visible && !s.engine.visible && now - s.engine.heartbeat < STALE_MS && now - s.engine.claimedAt > 3000;
      if (claimAllowed && (stale || handoff)) useApp.setState({ engine: { holderId: tabId, heartbeat: now, claimedAt: now, visible } });
    }
    for (const [id, p] of Array.from(pendingCmds.entries())) {
      if (isHolder()) {
        executeCommand(p.cmd);
        pendingCmds.delete(id);
        listeners.forEach((l) => l(id));
      } else if (now - p.sent > 1500) {
        p.sent = now;
        channel?.postMessage({ t: "cmd", from: tabId, id, cmd: p.cmd } satisfies Msg);
      }
    }
  }, 1000);

  const release = () => {
    if (resetting) return;
    const s = useApp.getState();
    if (s.engine.holderId === tabId) {
      const released = { ...s.engine, heartbeat: 0, holderId: "" };
      useApp.setState({ engine: released });
      flushPersist();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: useApp.getState(), version: STATE_VERSION }));
      } catch {
        /* quota — the next tab simply waits for the heartbeat to go stale */
      }
    }
  };
  window.addEventListener("pagehide", release);

  return () => {
    clearInterval(beat);
    unsub();
    window.removeEventListener("pagehide", release);
    channel?.close();
    channel = null;
  };
}
