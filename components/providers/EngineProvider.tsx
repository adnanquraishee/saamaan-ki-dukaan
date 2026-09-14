"use client";
import { useEffect } from "react";
import { probeLlm } from "@/lib/llm/client";
import { probeRelay, startRelayPublisher, startRemotePoll } from "@/lib/remote/relayClient";
import { startEngineLoop, stopEngineLoop } from "@/lib/engine/runner";
import { STORAGE_KEY } from "@/lib/store/state";
import { useApp } from "@/lib/store/store";
import { setClaimAllowed, startSync } from "@/lib/store/sync";
import { useUi } from "@/lib/store/ui";

export function EngineProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let stops: (() => void)[] = [];
    let cancelled = false;
    (async () => {
      const relay = await probeRelay();
      if (cancelled) return;
      if (relay.remoteEngine) {
        // Another device runs the engine: this browser is a storefront client of it.
        setClaimAllowed(false);
        useUi.setState({ mode: "remote", relay: true, hydrated: true });
        stops.push(startRemotePoll());
        return;
      }
      await useApp.persist.rehydrate();
      if (cancelled) return;
      // Keep dashboard metrics sourced from this browser's live runtime state.
      stops.push(startSync());
      useUi.setState({ hydrated: true, mode: "local", relay: relay.enabled });
      startEngineLoop();
      stops.push(stopEngineLoop);
      if (relay.enabled) stops.push(startRelayPublisher());
      probeLlm().then((llm) => useUi.setState({ llm }));
    })();
    return () => {
      cancelled = true;
      stops.forEach((s) => s());
      stops = [];
    };
  }, []);
  return <>{children}</>;
}
