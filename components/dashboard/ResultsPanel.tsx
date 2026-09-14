"use client";
import { useMemo } from "react";
import { summarise } from "@/lib/engine/kpis";
import { MODELS } from "@/lib/ml/models";
import { CORPUS_STATS } from "@/lib/rag/retrieve";
import { useApp } from "@/lib/store/store";
import { Panel, inrc, pct } from "./ui";

export function ResultsPanel() {
  const ledger = useApp((s) => s.ledger);
  const shadowLedger = useApp((s) => s.shadow.ledger);
  const acc = useApp((s) => s.accuracy);
  const c = useApp((s) => s.counters);
  const a = useMemo(() => summarise(ledger, 30), [ledger]);
  const b = useMemo(() => summarise(shadowLedger, 30), [shadowLedger]);
  const m = MODELS.forecast.metrics;
  const live = acc.actual > 0;
  const rows: { metric: string; ours: string; base: string; baseLabel: string; good: boolean | null }[] = [
    { metric: "Forecast WAPE · holdout", ours: pct(m.ridge_exported.wape), base: `${pct(m.naive_lag1.wape)} / ${pct(m.moving_avg_7.wape)}`, baseLabel: "naive / 7-day MA", good: m.ridge_exported.wape < m.moving_avg_7.wape },
    { metric: "Forecast WAPE · live", ours: live ? pct(acc.model / acc.actual) : "—", base: live ? `${pct(acc.naive / acc.actual)} / ${pct(acc.movingAvg / acc.actual)}` : "after 1 sim day", baseLabel: "naive / 7-day MA", good: live ? acc.model < acc.movingAvg : null },
    { metric: "Contribution margin", ours: pct(a.marginPct), base: pct(b.marginPct), baseLabel: "rule-based policy", good: a.marginPct >= b.marginPct },
    { metric: "Contribution ₹", ours: inrc(a.contribution), base: inrc(b.contribution), baseLabel: "rule-based policy", good: a.contribution >= b.contribution },
    { metric: "RTO rate", ours: pct(a.rtoRate), base: pct(b.rtoRate), baseLabel: "untreated", good: a.rtoRate <= b.rtoRate },
    { metric: "Stockout incidents", ours: String(a.stockouts), base: String(b.stockouts), baseLabel: "fixed reorder point", good: a.stockouts <= b.stockouts },
    { metric: "Fill rate", ours: pct(a.fillRate), base: pct(b.fillRate), baseLabel: "fixed reorder point", good: a.fillRate >= b.fillRate - 0.001 },
    { metric: "Decisions executed autonomously", ours: c.autonomous.toLocaleString("en-IN"), base: "—", baseLabel: "", good: null },
    { metric: "Escalation rate", ours: pct(c.escalations / Math.max(1, c.autonomous + c.escalations), 2), base: "—", baseLabel: "", good: null },
    { metric: "Injection attempts caught", ours: `${c.injectionsCaught} flagged`, base: `${c.injectionAttempts} known attempts`, baseLabel: "", good: null },
  ];
  return (
    <Panel title="Results vs baselines · computed, not asserted" right={<span className="font-mono text-[10px] text-tower-dim">shadow policy on identical demand</span>} bodyClass="overflow-x-auto scroll-thin">
      <table className="w-full font-mono text-[11px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-tower-dim">
            <th className="px-3 py-2 font-normal">metric</th>
            <th className="px-3 py-2 text-right font-normal">agents</th>
            <th className="px-3 py-2 text-right font-normal">baseline</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.metric} className="border-t border-tower-line/60">
              <td className="px-3 py-1.5 text-[#aebdcc]">
                {r.metric}
                {r.baseLabel && <div className="text-[10px] text-[#3f4d5c]">vs {r.baseLabel}</div>}
              </td>
              <td className={`num whitespace-nowrap px-3 py-1.5 text-right ${r.good === null ? "text-tower-text" : r.good ? "text-tower-green" : "text-tower-amber"}`}>{r.ours}</td>
              <td className="num whitespace-nowrap px-3 py-1.5 text-right text-tower-dim">{r.base}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-tower-line px-3 py-2 font-mono text-[10px] leading-relaxed text-tower-dim">
        RTO classifier AUC {MODELS.rto.metrics.auc} · elasticity from Poisson log-log with event fixed effects · RAG over {CORPUS_STATS.documents} docs / {CORPUS_STATS.chunks} chunks, brute-force cosine · LLM calls {c.llmCalls} (cached {c.llmCached}, rejected by numeric validation {c.llmRejected})
      </div>
    </Panel>
  );
}
