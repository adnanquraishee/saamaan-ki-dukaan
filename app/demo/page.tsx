"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SCENARIOS, type ScenarioId } from "@/lib/engine/scenarios";
import { useApp } from "@/lib/store/store";
import { dispatch, resetDemo } from "@/lib/store/sync";
import { useUi } from "@/lib/store/ui";

const ORDER: { id: ScenarioId; n: string }[] = [
  { id: "normal", n: "1" },
  { id: "viral", n: "2" },
  { id: "conflict", n: "3" },
  { id: "attack_return", n: "4a" },
  { id: "attack_competitor", n: "4b" },
  { id: "attack_invoice", n: "4c" },
];

export default function DemoPanel() {
  const hydrated = useUi((s) => s.hydrated);
  const isEngine = useUi((s) => s.isEngine);
  const relay = useUi((s) => s.relay);
  const llm = useUi((s) => s.llm);
  const scenario = useApp((s) => s.scenario);
  const settings = useApp((s) => s.settings);
  const clock = useApp((s) => s.clock);
  const counters = useApp((s) => s.counters);
  const openEsc = useApp((s) => s.escalations.filter((e) => e.status === "open").length);
  const [now, setNow] = useState(Date.now());
  const [host, setHost] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    setHost(window.location.host);
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, []);
  const normalLeft = scenario.id === "normal" ? Math.max(0, 60 - Math.floor((now - scenario.startedWall) / 1000)) : 0;

  const reset = () => resetDemo();

  if (!hydrated) return <div className="tower grid min-h-screen place-items-center bg-tower-bg font-mono text-sm text-tower-dim">connecting…</div>;

  return (
    <div className="tower min-h-screen bg-tower-bg px-4 py-8 text-tower-text sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-tower-line pb-5">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-tower-dim">Saamaan ki Dukaan · presenter panel</div>
            <h1 className="mt-1 text-3xl font-semibold text-white">Demo scenarios</h1>
          </div>
          <div className="flex flex-wrap gap-2 font-mono text-[11px]">
            <Link href="/dashboard" target="_blank" className="rounded-sm border border-tower-line px-3 py-1.5 hover:border-tower-cyan hover:text-tower-cyan">control tower ↗</Link>
            <Link href="/" target="_blank" className="rounded-sm border border-tower-line px-3 py-1.5 hover:border-tower-cyan hover:text-tower-cyan">storefront ↗</Link>
          </div>
        </div>

        <div className="mt-5 grid gap-3 font-mono text-[11px] text-tower-dim sm:grid-cols-4">
          <div className="rounded-sm border border-tower-line bg-tower-panel p-3">
            <div className="uppercase tracking-wider">this tab</div>
            <div className={`mt-1 text-sm ${isEngine ? "text-tower-cyan" : "text-tower-text"}`}>{isEngine ? "running the engine" : "viewer"}</div>
          </div>
          <div className="rounded-sm border border-tower-line bg-tower-panel p-3">
            <div className="uppercase tracking-wider">loop</div>
            <div className="mt-1 text-sm text-tower-text">tick {clock.tick} · {clock.speedMs / 1000}s · {clock.halted ? "halted" : "running"}</div>
          </div>
          <div className="rounded-sm border border-tower-line bg-tower-panel p-3">
            <div className="uppercase tracking-wider">audience URL</div>
            <div className="mt-1 text-sm text-tower-text">{relay ? `http://${host.replace("localhost", "<laptop-ip>")}` : "relay off (public host)"}</div>
          </div>
          <div className="rounded-sm border border-tower-line bg-tower-panel p-3">
            <div className="uppercase tracking-wider">state</div>
            <div className="mt-1 text-sm text-tower-text">{counters.autonomous.toLocaleString("en-IN")} decisions · {openEsc} open</div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {ORDER.map(({ id, n }) => {
            const s = SCENARIOS[id];
            const active = scenario.id === id;
            return (
              <div key={id} className={`flex flex-col rounded-sm border p-4 ${active ? "border-tower-cyan/50 bg-tower-cyan/[0.04]" : "border-tower-line bg-tower-panel"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold text-white">
                    <span className="mr-2 font-mono text-sm text-tower-dim">{n}</span>
                    {s.title}
                  </h2>
                  {active && <span className="font-mono text-[10px] uppercase tracking-wider text-tower-cyan">{id === "normal" && normalLeft > 0 ? `${normalLeft}s left` : "triggered"}</span>}
                </div>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-[#9fb0c0]">{s.blurb}</p>
                {id === "viral" && <p className="mt-2 text-xs text-tower-amber">Ask the room to buy the Aurora ANC Wireless Earbuds on their phones.</p>}
                <button onClick={() => dispatch({ type: "scenario", id })} className="mt-4 self-start rounded-sm bg-tower-cyan px-4 py-2 font-mono text-xs font-semibold uppercase tracking-widest text-black hover:bg-teal-300">
                  Run
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <Toggle label="Injection detection" hint="Disable, then re-run 4b — the margin floor still blocks the ₹99 price." on={settings.injectionDetection} onChange={(v) => dispatch({ type: "setSetting", key: "injectionDetection", value: v })} />
          <Toggle label={`LLM layer (${llm})`} hint="Document reading, clause interpretation, explanations, novel risk. Falls back to templates and regex." on={settings.llmEnabled} onChange={(v) => dispatch({ type: "setSetting", key: "llmEnabled", value: v })} />
          <Toggle label="Auto-explain decisions" hint="LLM explanations for notable decisions; every figure validated against state." on={settings.autoExplain} onChange={(v) => dispatch({ type: "setSetting", key: "autoExplain", value: v })} />
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-tower-line pt-6">
          {!confirmReset ? (
            <button onClick={() => setConfirmReset(true)} className="rounded-sm border border-tower-red/50 px-4 py-2 font-mono text-xs uppercase tracking-widest text-tower-red hover:bg-tower-red/10">
              Reset demo
            </button>
          ) : (
            <>
              <span className="font-mono text-xs text-tower-text">Clear localStorage and re-seed every open tab?</span>
              <button onClick={reset} className="rounded-sm bg-tower-red px-4 py-2 font-mono text-xs font-semibold uppercase tracking-widest text-white">Yes, reset</button>
              <button onClick={() => setConfirmReset(false)} className="font-mono text-xs text-tower-dim">cancel</button>
            </>
          )}
          <button onClick={() => dispatch({ type: "setRunning", running: clock.halted })} className="rounded-sm border border-tower-line px-4 py-2 font-mono text-xs uppercase tracking-widest hover:border-tower-text">
            {clock.halted ? "Resume loop" : "Halt loop"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="rounded-sm border border-tower-line bg-tower-panel p-3 text-left hover:border-tower-dim">
      <div className="flex items-center justify-between">
        <span className="text-sm text-white">{label}</span>
        <span className={`h-4 w-8 rounded-full p-0.5 transition ${on ? "bg-tower-green" : "bg-tower-line"}`}>
          <span className={`block h-3 w-3 rounded-full bg-black transition ${on ? "translate-x-4" : ""}`} />
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-snug text-tower-dim">{hint}</p>
    </button>
  );
}
