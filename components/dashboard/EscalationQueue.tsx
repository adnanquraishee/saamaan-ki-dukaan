"use client";
import { formatSimTime } from "@/lib/engine/calendar";
import { useApp } from "@/lib/store/store";
import { dispatch } from "@/lib/store/sync";
import type { Escalation } from "@/lib/types";
import { AgentChip, Panel } from "./ui";

function Highlight({ h }: { h: NonNullable<Escalation["highlight"]> }) {
  const spans = [...h.spans].sort((a, b) => a[0] - b[0]);
  const parts: { t: string; hit: boolean }[] = [];
  let i = 0;
  for (const [a, b] of spans) {
    if (a < i) continue;
    if (a > i) parts.push({ t: h.text.slice(i, a), hit: false });
    parts.push({ t: h.text.slice(a, b), hit: true });
    i = b;
  }
  if (i < h.text.length) parts.push({ t: h.text.slice(i), hit: false });
  const text = h.text.length > 600 ? null : parts;
  return (
    <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-sm border border-tower-line bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-[#9fb0c0] scroll-thin">
      {text
        ? text.map((p, k) =>
            p.hit ? (
              <mark key={k} className="rounded-[2px] bg-tower-red/25 px-0.5 text-[#ffb4b8] underline decoration-tower-red decoration-wavy underline-offset-2">
                {p.t}
              </mark>
            ) : (
              <span key={k}>{p.t}</span>
            ),
          )
        : h.text.slice(0, 600)}
      {!spans.length && <div className="mt-1 text-[10px] text-tower-amber">injection detection disabled — no spans flagged; downstream guardrails blocked this</div>}
    </div>
  );
}

export function EscalationQueue() {
  const escalations = useApp((s) => s.escalations);
  const open = escalations.filter((e) => e.status === "open").reverse();
  const recent = escalations.filter((e) => e.status !== "open").slice(-4).reverse();
  return (
    <Panel title={`Escalation queue · ${open.length} open`} bodyClass="overflow-y-auto scroll-thin p-2 space-y-2">
      {!open.length && <div className="p-4 text-center font-mono text-xs text-tower-dim">Nothing needs a human.</div>}
      {open.map((e) => {
        const assessment = e.proposal.meta?.assessment as { assessment: string; likelyCause: string; recommendedAction: string; confidence: number; by: string } | undefined;
        const failed = e.guardrails.filter((g) => !g.passed);
        return (
          <article key={e.id} className="animate-slideIn rounded-sm border border-tower-amber/30 bg-tower-amber/[0.04] p-3">
            <div className="flex items-center justify-between gap-2">
              <AgentChip id={e.agentId} />
              <span className="font-mono text-[10px] text-tower-dim">{e.id} · {formatSimTime(e.tick)}</span>
            </div>
            <p className="mt-2 text-[13px] font-medium leading-snug text-white">{e.ask}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {failed.map((g) => (
                <span key={g.id} className="rounded-sm bg-tower-red/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-tower-red" title={g.detail}>
                  ✕ {g.label}
                </span>
              ))}
              {!failed.length && <span className="rounded-sm bg-tower-amber/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-tower-amber">novel pattern</span>}
            </div>
            <p className="mt-2 text-xs leading-snug text-[#9fb0c0]">{e.breach}</p>
            {e.highlight && <div className="mt-2"><Highlight h={e.highlight} /></div>}
            {assessment && (
              <div className="mt-2 rounded-sm border border-tower-line bg-black/20 p-2 text-xs">
                <div className="font-mono text-[10px] uppercase tracking-wider text-tower-green">{assessment.by === "llm" ? "LLM assessment · advisory" : "Rule-based assessment"}</div>
                <p className="mt-1 text-tower-text">{assessment.assessment}</p>
                <p className="mt-1 text-[#9fb0c0]">Likely: {assessment.likelyCause} · suggests <b>{assessment.recommendedAction.replace("_", " ")}</b></p>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => dispatch({ type: "resolveEscalation", id: e.id, decision: "authorise" })} className="rounded-sm border border-tower-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-tower-text hover:border-tower-amber hover:text-tower-amber">
                Authorise
              </button>
              <button onClick={() => dispatch({ type: "resolveEscalation", id: e.id, decision: "hold" })} className="rounded-sm bg-tower-cyan/15 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-tower-cyan hover:bg-tower-cyan/25" title={e.fallback?.label}>
                Hold · {e.fallback?.label ?? "fallback"}
              </button>
            </div>
          </article>
        );
      })}
      {recent.length > 0 && (
        <div className="px-1 pt-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-tower-dim">Resolved</div>
          {recent.map((e) => (
            <div key={e.id} className="flex justify-between gap-2 border-t border-tower-line/60 py-1.5 font-mono text-[10px] text-tower-dim">
              <span className="truncate">{e.ask}</span>
              <span className={e.status === "authorised" ? "text-tower-amber" : "text-tower-cyan"}>{e.status}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
