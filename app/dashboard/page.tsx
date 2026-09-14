"use client";
import React, { useEffect, useState } from "react";
import { AgentLog } from "@/components/dashboard/AgentLog";
import { EscalationQueue } from "@/components/dashboard/EscalationQueue";
import { SecurityLog } from "@/components/dashboard/SecurityLog";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { LoopIndicator } from "@/components/dashboard/LoopIndicator";
import { ResultsPanel } from "@/components/dashboard/ResultsPanel";
import { TowerHeader } from "@/components/dashboard/TowerHeader";
import { PipelineOverview } from "@/components/dashboard/PipelineOverview";
import { OrderLog } from "@/components/dashboard/OrderLog";
import { AtRiskNow } from "@/components/dashboard/AtRiskNow";
import { useUi } from "@/lib/store/ui";
import { isDashboardAuthenticated } from "@/components/dashboard/DashboardAuth";
import { useRouter } from "next/navigation";

export default function Dashboard() {
  const router = useRouter();
  const [auth, setAuth] = useState(false);
  const [section, setSection] = useState<"overview" | "orders" | "agents" | "escalations" | "security" | "performance">("overview");
  useEffect(() => { if (!isDashboardAuthenticated()) router.replace("/dashboard/login"); else setAuth(true); }, [router]);
  const hydrated = useUi((s) => s.hydrated);
  const mode = useUi((s) => s.mode);
  if (!auth) return <div className="tower grid min-h-screen place-items-center bg-tower-bg font-mono text-sm text-tower-dim">checking access…</div>;
  return (
    <div className="tower min-h-screen bg-tower-bg text-tower-text">
      {!hydrated ? (
        <div className="grid min-h-screen place-items-center font-mono text-sm text-tower-dim">connecting to engine…</div>
      ) : mode === "remote" ? (
        <div className="grid min-h-screen place-items-center p-6 text-center font-mono text-sm text-tower-dim">
          This device is connected to the presenter&apos;s engine as a storefront client. Open the control tower on the presenter&apos;s machine.
        </div>
      ) : (
        <>
          <TowerHeader />
          <div className="border-b border-tower-line bg-[#0a1118] px-3 py-3"><div className="mx-auto flex max-w-[1500px] flex-wrap gap-2">{([['overview','Overview','Run the operation'],['orders','Orders','Trace every order'],['agents','Agent log','See what each agent is doing'],['escalations','Escalations','Review and act'],['security','Injection log','Audit blocked content'],['performance','Performance','Review outcomes']] as const).map(([id,label,help]) => <button key={id} onClick={() => setSection(id)} className={`rounded-sm border px-4 py-2 text-left transition ${section === id ? "border-tower-cyan bg-tower-cyan/10" : "border-tower-line hover:border-tower-dim"}`}><div className={`font-mono text-xs font-semibold ${section === id ? "text-tower-cyan" : "text-white"}`}>{label}</div><div className="mt-0.5 text-[10px] text-tower-dim">{help}</div></button>)}</div></div>
          <main className="mx-auto flex max-w-[1500px] flex-col gap-4 p-3 sm:p-5"><div key={section} className="dashboard-tab-panel flex flex-col gap-4">
            {section === "overview" && <><KpiStrip /><LoopIndicator /><PipelineOverview /><AtRiskNow /></>}
            {section === "orders" && <><div><h2 className="text-xl font-semibold text-white">Order operations</h2><p className="mt-1 text-sm text-tower-dim">Search an order, select it, and follow its fulfillment state.</p></div><OrderLog /></>}
            {section === "agents" && <><div><h2 className="text-xl font-semibold text-white">Agent log</h2><p className="mt-1 text-sm text-tower-dim">Select an agent to see its current work and recent decisions.</p></div><AgentLog /></>}
            {section === "escalations" && <><div><h2 className="text-xl font-semibold text-white">Escalations</h2><p className="mt-1 text-sm text-tower-dim">Human decisions required. Review the evidence, then authorise or hold at the recommended fallback.</p></div><EscalationQueue /></>}
            {section === "security" && <><div><h2 className="text-xl font-semibold text-white">Injection log</h2><p className="mt-1 text-sm text-tower-dim">Every instruction-shaped input detected on an untrusted surface. All flagged content is blocked before it can become an action.</p></div><SecurityLog /></>}
            {section === "performance" && <><div><h2 className="text-xl font-semibold text-white">Performance</h2><p className="mt-1 text-sm text-tower-dim">Compare live outcomes with the rule-based baseline.</p></div><ResultsPanel /></>}
          </div></main>
        </>
      )}
    </div>
  );
}
