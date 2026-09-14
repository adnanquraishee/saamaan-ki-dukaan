"use client";
import Link from "next/link";
import { formatSimTime } from "@/lib/engine/calendar";
import { useApp } from "@/lib/store/store";
import { dispatch } from "@/lib/store/sync";
import { useUi } from "@/lib/store/ui";

export function TowerHeader() {
  const clock = useApp((s) => s.clock);
  const counters = useApp((s) => s.counters);
  const isEngine = useUi((s) => s.isEngine);
  const mode = useUi((s) => s.mode);
  const llm = useUi((s) => s.llm);
  const llmEnabled = useApp((s) => s.settings.llmEnabled);
  const autonomy = counters.autonomous + counters.escalations > 0 ? counters.autonomous / (counters.autonomous + counters.escalations) : 1;
  const halted = clock.halted || !clock.running;
  const speedSec = clock.speedMs / 1000;

  return (
    <header className="border-b border-tower-line bg-[#070c12]">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-sm border border-tower-cyan/40 bg-tower-cyan/10 font-mono text-sm font-bold text-tower-cyan">A</div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-tower-dim">Saamaan ki Dukaan · Control Tower</div>
            <div className="num font-mono text-sm text-tower-text">{formatSimTime(clock.tick)} <span className="text-tower-dim">· tick {clock.tick}</span></div>
          </div>
        </div>

        <div className="flex items-end gap-3">
          <div>
            <div className="num font-mono text-4xl font-semibold leading-none text-white">{counters.autonomous.toLocaleString("en-IN")}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-tower-dim">decisions executed without a human</div>
          </div>
        </div>

        <Stat label="autonomy" value={`${(autonomy * 100).toFixed(2)}%`} />
        <Stat label="loop compute" value={`${clock.lastCycleMs} ms`} />
        <Stat label="escalations" value={String(counters.escalations)} tone={counters.escalations ? "amber" : undefined} />
        <Stat label="injections caught" value={`${counters.injectionsCaught}`} tone={counters.injectionsCaught ? "red" : undefined} />

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <span className={`rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${mode === "remote" ? "bg-tower-violet/15 text-tower-violet" : isEngine ? "bg-tower-cyan/15 text-tower-cyan" : "bg-tower-line text-tower-dim"}`} title="Only one tab runs the agents; others mirror it over BroadcastChannel.">
            {mode === "remote" ? "remote viewer" : isEngine ? "engine · this tab" : "viewer"}
          </span>
          <span className={`rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${llm === "available" && llmEnabled ? "bg-tower-green/10 text-tower-green" : "bg-tower-line text-tower-dim"}`} title="LLM is used only for document reading, clause interpretation, explanations and novel-risk reasoning.">
            llm {llm === "available" ? (llmEnabled ? "on" : "off") : llm === "unknown" ? "…" : "offline · templates"}
          </span>
          <label className="flex items-center gap-2 font-mono text-[11px] text-tower-dim">
            <span className="uppercase tracking-wider">cycle</span>
            <input type="range" min={2} max={30} step={1} value={speedSec} onChange={(e) => dispatch({ type: "setSpeed", speedMs: Number(e.target.value) * 1000 })} className="w-28 accent-teal-400" />
            <span className="num w-8 text-tower-text">{speedSec}s</span>
          </label>
          <button onClick={() => dispatch({ type: "setRunning", running: halted })} className={`rounded-sm px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-widest transition ${halted ? "bg-tower-green text-black hover:bg-green-300" : "bg-tower-red text-white hover:bg-red-500"}`}>
            {halted ? "▶ Resume" : "■ Halt"}
          </button>
          <Link href="/" target="_blank" className="font-mono text-[11px] uppercase tracking-wider text-tower-dim hover:text-tower-text">store ↗</Link>
          <Link href="/demo" className="font-mono text-[11px] uppercase tracking-wider text-tower-dim hover:text-tower-text">demo</Link>
        </div>
      </div>
    </header>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "amber" | "red" }) {
  return (
    <div>
      <div className={`num font-mono text-lg leading-none ${tone === "amber" ? "text-tower-amber" : tone === "red" ? "text-tower-red" : "text-tower-text"}`}>{value}</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-tower-dim">{label}</div>
    </div>
  );
}
