import type { ReactNode } from "react";
import { AGENT_META } from "@/lib/config/envelopes";
import type { ProposerId } from "@/lib/types";

export function Panel({ title, right, children, className = "", bodyClass = "" }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`flex min-h-0 flex-col rounded-md border border-tower-line bg-tower-panel ${className}`}>
      <header className="flex items-center justify-between gap-2 border-b border-tower-line px-3 py-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-tower-dim">{title}</h2>
        {right}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function agentColor(id: ProposerId | string) {
  if (id in AGENT_META) return AGENT_META[id as keyof typeof AGENT_META].color;
  if (id === "human") return "#e2e8f0";
  if (id === "orchestrator") return "#f5a524";
  return "#f0525b";
}

export function agentName(id: ProposerId | string) {
  if (id in AGENT_META) return AGENT_META[id as keyof typeof AGENT_META].name;
  if (id === "intake:finance") return "Invoice reader";
  if (id === "intake:returns") return "Returns intake";
  if (id === "intake:competitor") return "Competitor intake";
  if (id === "orchestrator") return "Orchestrator";
  if (id === "human") return "Operator";
  return "Security";
}

export function AgentChip({ id }: { id: string }) {
  const c = agentColor(id);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider" style={{ color: c, background: `${c}14`, boxShadow: `inset 0 0 0 1px ${c}33` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {agentName(id)}
    </span>
  );
}

export const inrc = (n: number) => {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)}k`;
  return `${sign}₹${Math.round(a)}`;
};
export const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
