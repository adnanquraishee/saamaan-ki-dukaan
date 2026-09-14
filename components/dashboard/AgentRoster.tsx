"use client";
import { AGENT_IDS, AGENT_META } from "@/lib/config/envelopes";
import { useApp } from "@/lib/store/store";
import { Panel } from "./ui";

export function AgentRoster() {
  const agents = useApp((s) => s.agents);
  const tick = useApp((s) => s.clock.tick);
  return (
    <Panel title="Agent roster" right={<span className="font-mono text-[10px] text-tower-dim">envelope use</span>} bodyClass="divide-y divide-tower-line/70">
      {AGENT_IDS.map((id) => {
        const a = agents[id];
        const meta = AGENT_META[id];
        const util = Math.min(1.2, a.envelopeUtil);
        const hot = util >= 0.85;
        const status = a.status === "blocked" && tick - (a.lastTick ?? 0) <= 2 ? "blocked" : a.status === "halted" ? "halted" : tick - (a.lastTick ?? -99) <= 1 ? "active" : "idle";
        return (
          <div key={id} className="grid grid-cols-[1fr_auto] gap-x-3 px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${status === "active" ? "bg-tower-green" : status === "blocked" ? "bg-tower-red" : status === "halted" ? "bg-tower-amber" : "bg-[#2a3847]"}`} />
                <span className="font-mono text-xs font-semibold" style={{ color: meta.color }}>{meta.name}</span>
                <span className="truncate font-mono text-[10px] text-tower-dim">{meta.method}</span>
              </div>
              <div className="mt-0.5 truncate pl-3.5 text-[11px] text-[#7f8fa0]" title={a.lastAction}>{a.lastAction ?? "—"}</div>
            </div>
            <div className="flex flex-col items-end justify-center gap-1">
              <span className="num font-mono text-xs text-tower-text">{a.decisions.toLocaleString("en-IN")}{a.escalations ? <span className="text-tower-amber"> · {a.escalations}⚑</span> : null}</span>
              <div className="h-1 w-24 overflow-hidden rounded-full bg-[#16212c]" title={`${Math.round(util * 100)}% of envelope`}>
                <div className={`h-full rounded-full transition-all duration-500 ${util >= 1 ? "bg-tower-red" : hot ? "bg-tower-amber" : "bg-tower-cyan/70"}`} style={{ width: `${Math.min(100, util * 100)}%` }} />
              </div>
            </div>
          </div>
        );
      })}
    </Panel>
  );
}
