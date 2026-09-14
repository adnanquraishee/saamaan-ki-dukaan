"use client";
import { useApp } from "@/lib/store/store";

const STAGES = [
  { id: "sense", label: "Sense", sub: "orders · shipments · feeds" },
  { id: "twin", label: "Twin", sub: "forecast · velocity" },
  { id: "plan", label: "Plan", sub: "10 agents propose" },
  { id: "arbitrate", label: "Arbitrate", sub: "resolve conflicts" },
  { id: "simulate", label: "Simulate", sub: "guardrails · cloned state" },
  { id: "execute", label: "Execute", sub: "commit · escalate" },
] as const;

export function LoopIndicator() {
  const stage = useApp((s) => s.clock.stage);
  const halted = useApp((s) => s.clock.halted || !s.clock.running);
  const idx = STAGES.findIndex((s) => s.id === stage);
  return (
    <div className="flex items-stretch overflow-x-auto border-b border-tower-line bg-[#080d13] px-2 scroll-thin">
      {STAGES.map((s, i) => {
        const active = i === idx && !halted;
        const done = idx > i && !halted;
        return (
          <div key={s.id} className="flex min-w-[140px] flex-1 items-center">
            <div className={`flex flex-1 items-center gap-2.5 px-3 py-2 transition-colors duration-150 ${active ? "bg-tower-cyan/10" : ""}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full transition ${active ? "animate-pulseRing bg-tower-cyan" : done ? "bg-tower-cyan/40" : "bg-tower-line"}`} />
              <div>
                <div className={`font-mono text-[11px] uppercase tracking-[0.16em] ${active ? "text-tower-cyan" : "text-tower-dim"}`}>{s.label}</div>
                <div className="font-mono text-[10px] text-[#3d4b5a]">{s.sub}</div>
              </div>
            </div>
            {i < STAGES.length - 1 && <span className="px-1 font-mono text-tower-line">→</span>}
          </div>
        );
      })}
      {halted && <div className="flex items-center px-4 font-mono text-xs uppercase tracking-widest text-tower-red">halted</div>}
    </div>
  );
}
