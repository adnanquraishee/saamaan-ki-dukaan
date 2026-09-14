"use client";
import { useMemo, useState } from "react";
import { formatSimTime } from "@/lib/engine/calendar";
import { useApp } from "@/lib/store/store";
import type { Decision } from "@/lib/types";
import { AgentChip, Panel, inrc } from "./ui";

const KIND_STYLE: Record<Decision["kind"], string> = {
  commit: "text-tower-green",
  conflict: "text-tower-amber",
  block: "text-tower-red",
  escalate: "text-tower-amber",
  human: "text-white",
  security: "text-tower-red",
  info: "text-tower-blue",
};
const FILTERS = [
  { id: "all", label: "all" },
  { id: "conflict", label: "conflicts" },
  { id: "block", label: "blocked" },
  { id: "human", label: "human" },
] as const;

export function DecisionStream() {
  const decisions = useApp((s) => s.decisions);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => {
    const f = decisions.filter((d) => filter === "all" || d.kind === filter || (filter === "block" && (d.kind === "escalate" || d.kind === "security")) || (filter === "human" && d.kind === "info"));
    return f.slice(-150).reverse();
  }, [decisions, filter]);

  return (
    <Panel
      title="Decision stream"
      right={
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={`rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${filter === f.id ? "bg-tower-cyan/15 text-tower-cyan" : "text-tower-dim hover:text-tower-text"}`}>
              {f.label}
            </button>
          ))}
        </div>
      }
      bodyClass="overflow-y-auto scroll-thin"
    >
      <ul className="divide-y divide-tower-line/60">
        {list.map((d) => {
          const expanded = open === d.id;
          return (
            <li key={d.id} className="animate-slideIn">
              <button onClick={() => setOpen(expanded ? null : d.id)} className="grid w-full grid-cols-[62px_1fr] gap-3 px-3 py-2 text-left hover:bg-white/[0.02]">
                <span className="num pt-0.5 font-mono text-[10px] leading-tight text-tower-dim">{formatSimTime(d.tick).split(" · ")[1]}<br />t{d.tick}</span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <AgentChip id={d.agentId} />
                    <span className={`font-mono text-[10px] uppercase tracking-wider ${KIND_STYLE[d.kind]}`}>{d.kind}</span>
                    {d.count && d.count > 1 ? <span className="font-mono text-[10px] text-tower-dim">×{d.count}</span> : null}
                    {d.scenario && <span className="rounded-sm bg-tower-violet/15 px-1.5 font-mono text-[10px] text-tower-violet">{d.scenario}</span>}
                    {d.explanationSource === "llm" && <span className="rounded-sm bg-tower-green/10 px-1.5 font-mono text-[10px] text-tower-green">llm · validated</span>}
                    {d.citations?.length ? <span className="font-mono text-[10px] text-tower-blue">{d.citations.length} cite</span> : null}
                  </span>
                  <span className="mt-1 block text-[13px] leading-snug text-tower-text">{d.title.replace(/^[^·]+· /, "")}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-[#8b9bab]">{d.summary}</span>
                </span>
              </button>
              {expanded && (
                <div className="space-y-3 border-t border-tower-line/60 bg-black/20 px-3 py-3 pl-[86px] text-xs">
                  {d.explanation && (
                    <div>
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-tower-green">Explanation · LLM, every figure checked against state</div>
                      <p className="leading-relaxed text-tower-text">{d.explanation}</p>
                    </div>
                  )}
                  <div>
                    <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-tower-dim">Reasoning · deterministic</div>
                    <p className="leading-relaxed text-[#aebdcc]">{d.reasoning}</p>
                  </div>
                  {d.costImpact ? <div className="font-mono text-[11px] text-tower-dim">cost impact {inrc(d.costImpact)}</div> : null}
                  {d.guardrails?.length ? (
                    <div>
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-tower-dim">Guardrails</div>
                      <ul className="space-y-1">
                        {d.guardrails.map((g) => (
                          <li key={g.id} className="flex gap-2">
                            <span className={`font-mono ${g.passed ? "text-tower-green" : "text-tower-red"}`}>{g.passed ? "✓" : "✕"}</span>
                            <span>
                              <span className="font-mono text-[11px] text-tower-text">{g.label}</span> <span className="text-[#8b9bab]">{g.detail}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {d.citations?.length ? (
                    <div>
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-tower-dim">Retrieved citations</div>
                      <ul className="space-y-1.5">
                        {d.citations.map((c) => (
                          <li key={c.chunkId} className="rounded-sm border border-tower-line bg-tower-panel2 p-2">
                            <div className="flex justify-between gap-2 font-mono text-[10px]">
                              <span className="text-tower-blue">{c.title}</span>
                              <span className="text-tower-dim">sim {c.score.toFixed(2)}</span>
                            </div>
                            <div className="mt-1 text-[11px] leading-snug text-[#8b9bab]">{c.snippet}…</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
        {!list.length && <li className="p-6 text-center font-mono text-xs text-tower-dim">Waiting for the first cycle…</li>}
      </ul>
    </Panel>
  );
}
