"use client";
import { useMemo } from "react";
import { summarise } from "@/lib/engine/kpis";
import { useApp } from "@/lib/store/store";
import { inrc, pct } from "./ui";

export function KpiStrip() {
  const kpis = useApp((s) => s.kpis);
  const shadow = useApp((s) => s.shadow.ledger);
  const disputed = useApp((s) => s.finance.disputedAmount);
  const sh = useMemo(() => summarise(shadow), [shadow]);
  const tiles = [
    { label: "Contribution margin", value: pct(kpis.contributionMarginPct), base: pct(sh.marginPct), better: kpis.contributionMarginPct >= sh.marginPct, hint: "7-day, after shipping, RTO, returns, commission, holding" },
    { label: "Fill rate", value: pct(kpis.fillRate), base: pct(sh.fillRate), better: kpis.fillRate >= sh.fillRate - 0.001, hint: "units shipped ÷ units demanded" },
    { label: "RTO rate", value: pct(kpis.rtoRate), base: pct(sh.rtoRate), better: kpis.rtoRate <= sh.rtoRate, hint: "returned-to-origin ÷ closed shipments" },
    { label: "Days of cover", value: kpis.daysOfCover.toFixed(1), base: null, better: kpis.daysOfCover > 10, hint: "network on-hand ÷ forecast daily demand" },
    { label: "Settlement gap", value: inrc(kpis.settlementGap), base: disputed ? `${inrc(disputed)} disputed` : null, better: kpis.settlementGap === 0, hint: "unexplained marketplace deductions outstanding" },
    { label: "Revenue · 7d", value: inrc(kpis.revenue7d), base: inrc(sh.revenue), better: kpis.revenue7d >= sh.revenue, hint: "net of RTO and refunds" },
  ];
  return (
    <div className="grid grid-cols-2 gap-px border-b border-tower-line bg-tower-line sm:grid-cols-3 xl:grid-cols-6">
      {tiles.map((t) => (
        <div key={t.label} className="bg-tower-panel px-4 py-3" title={t.hint}>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-tower-dim">{t.label}</div>
          <div className="num mt-1 font-mono text-2xl text-white">{t.value}</div>
          {t.base && (
            <div className="num mt-0.5 font-mono text-[11px] text-tower-dim">
              <span className={t.better ? "text-tower-green" : "text-tower-amber"}>{t.better ? "▲" : "▼"}</span> rule-based: {t.base}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
