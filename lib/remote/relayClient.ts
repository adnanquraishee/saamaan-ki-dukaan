"use client";
import { create } from "zustand";
import type { Command } from "@/lib/engine/commands";
import { executeCommand } from "@/lib/store/sync";
import { useApp } from "@/lib/store/store";
import { useUi } from "@/lib/store/ui";
import { buildSnapshot, type PublicSnapshot } from "./snapshot";

export const useRemote = create<{ snapshot: PublicSnapshot | null; lastOk: number }>(() => ({ snapshot: null, lastOk: 0 }));

export function clientId() {
  let id = localStorage.getItem("sct:client");
  if (!id) {
    id = `c-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("sct:client", id);
  }
  return id;
}

export async function probeRelay(): Promise<{ enabled: boolean; remoteEngine: boolean }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1200);
    const r = await fetch("/api/relay?kind=snapshot", { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    const j = await r.json();
    if (!j.enabled) return { enabled: false, remoteEngine: false };
    const remoteEngine = !!j.alive && j.engineClient && j.engineClient !== clientId();
    if (remoteEngine) useRemote.setState({ snapshot: j.snapshot, lastOk: Date.now() });
    return { enabled: true, remoteEngine };
  } catch {
    return { enabled: false, remoteEngine: false };
  }
}

/** Engine side: publish the public snapshot and apply commands queued by remote storefronts. */
export function startRelayPublisher() {
  const me = clientId();
  let n = 0;
  const iv = setInterval(async () => {
    if (!useUi.getState().isEngine) return;
    n++;
    try {
      const pull = await fetch(`/api/relay?kind=pull&client=${me}`, { cache: "no-store" }).then((r) => r.json());
      for (const c of pull.commands ?? []) executeCommand(c.cmd as Command);
      if (n % 2 === 0) {
        await fetch("/api/relay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "snapshot", client: me, snapshot: buildSnapshot(useApp.getState()) }) });
      }
    } catch {
      /* relay unavailable: local-only demo continues */
    }
  }, 1000);
  return () => clearInterval(iv);
}

/** Remote side: poll the snapshot. */
export function startRemotePoll() {
  const iv = setInterval(async () => {
    try {
      const j = await fetch("/api/relay?kind=snapshot", { cache: "no-store" }).then((r) => r.json());
      if (j.snapshot) useRemote.setState({ snapshot: j.snapshot, lastOk: Date.now() });
    } catch {
      /* keep last snapshot */
    }
  }, 2000);
  return () => clearInterval(iv);
}

export async function sendRemote(cmd: Command) {
  await fetch("/api/relay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "command", id: Math.random().toString(36).slice(2), cmd }) });
}
