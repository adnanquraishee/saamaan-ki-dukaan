"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AgentLog } from "@/components/dashboard/AgentLog";
import { AtRiskNow } from "@/components/dashboard/AtRiskNow";
import { EscalationQueue } from "@/components/dashboard/EscalationQueue";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { LoopIndicator } from "@/components/dashboard/LoopIndicator";
import { OrderLog } from "@/components/dashboard/OrderLog";
import { PipelineOverview } from "@/components/dashboard/PipelineOverview";
import { ResultsPanel } from "@/components/dashboard/ResultsPanel";
import { SecurityLog } from "@/components/dashboard/SecurityLog";
import { RouteNetwork } from "@/components/dashboard/RouteNetwork";
import { WarehouseDashboard } from "@/components/dashboard/WarehouseDashboard";
import { TowerHeader } from "@/components/dashboard/TowerHeader";
import { isDashboardAuthenticated } from "@/components/dashboard/DashboardAuth";
import { useApp } from "@/lib/store/store";
import { dispatch } from "@/lib/store/sync";
import { useUi } from "@/lib/store/ui";

const NAV = [
  ["overview", "◉", "Command center", "Live health and flow"],
  ["orders", "□", "Orders", "Search and trace orders"],
  ["agents", "✦", "Agent log", "See each agent at work"],
  ["routes", "⌖", "Route network", "Optimize delivery flow"],
  ["warehouses", "▦", "Warehouses", "Inventory per fulfilment centre"],
  ["escalations", "!", "Escalations", "Human actions required"],
  ["security", "⌁", "Injection log", "Blocked untrusted content"],
  ["performance", "↗", "Performance", "Business outcomes"],
] as const;
type Section = (typeof NAV)[number][0];

export default function Dashboard() {
  const router = useRouter(); const [authenticated, setAuthenticated] = useState(false); const [section, setSection] = useState<Section>("overview");
  const hydrated = useUi((s) => s.hydrated); const mode = useUi((s) => s.mode); const syntheticDemand = useApp((s) => s.settings.syntheticDemand);
  useEffect(() => { if (!isDashboardAuthenticated()) router.replace("/dashboard/login"); else setAuthenticated(true); }, [router]);
  if (!authenticated) return <Loading label="checking access…" />;
  if (!hydrated) return <Loading label="connecting to engine…" />;
  if (mode === "remote")
    return (
      <div className="tower grid min-h-screen place-items-center bg-[#060b10] p-6 text-center font-mono text-sm text-tower-dim">
        <div className="max-w-md space-y-4">
          <p>This device is connected as a storefront client of another browser that is running the engine.</p>
          <button onClick={() => { sessionStorage.setItem("sct:presenter", "1"); window.location.reload(); }} className="rounded-md border border-tower-cyan/50 bg-tower-cyan/10 px-4 py-2 text-xs uppercase tracking-wider text-tower-cyan hover:bg-tower-cyan/20">
            Run the control tower on this device
          </button>
        </div>
      </div>
    );
  const current = NAV.find(([id]) => id === section)!;
  return <div className="tower min-h-screen bg-[#060b10] text-tower-text"><TowerHeader /><div className="mx-auto grid min-h-[calc(100vh-88px)] max-w-[1700px] lg:grid-cols-[248px_minmax(0,1fr)]"><aside className="border-b border-tower-line bg-[#09111a] p-3 lg:border-b-0 lg:border-r lg:p-4"><div className="mb-5 px-2 pt-2"><div className="font-mono text-[10px] uppercase tracking-[.22em] text-tower-dim">Operations workspace</div><div className="mt-2 text-sm text-white">Choose a workstream</div></div><nav className="grid gap-1 sm:grid-cols-2 lg:block">{NAV.map(([id, icon, label, help]) => <button key={id} onClick={() => setSection(id)} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition ${section === id ? "bg-tower-cyan/10 text-white shadow-[inset_2px_0_0_#4ce1d6]" : "text-tower-dim hover:bg-white/[.035] hover:text-white"}`}><span className={`grid h-7 w-7 place-items-center rounded-md font-mono text-xs ${section === id ? "bg-tower-cyan text-black" : "bg-[#14202b]"}`}>{icon}</span><span><span className="block text-sm font-medium">{label}</span><span className="mt-0.5 block text-[10px] text-tower-dim">{help}</span></span></button>)}</nav><div className="mt-6 rounded-lg border border-tower-line bg-[#0c151e] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-tower-dim">Data source</div><div className="mt-1 text-xs text-tower-text">{syntheticDemand ? "Simulation is creating demo orders" : "Only storefront orders are shown"}</div><button onClick={() => dispatch({ type: "setSetting", key: "syntheticDemand", value: !syntheticDemand })} className={`mt-3 w-full rounded-md border px-3 py-2 font-mono text-[10px] uppercase tracking-wider ${syntheticDemand ? "border-tower-amber/50 text-tower-amber" : "border-tower-line text-tower-dim"}`}>Demo data {syntheticDemand ? "on" : "off"}</button></div></aside><main className="min-w-0 p-4 sm:p-6"><header className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[.2em] text-tower-cyan">{current[1]} {current[2]}</div><h1 className="mt-2 text-2xl font-semibold text-white">{current[3]}</h1></div>{section === "orders" && <span className="rounded-full border border-tower-cyan/30 bg-tower-cyan/10 px-3 py-1.5 font-mono text-[10px] text-tower-cyan">Click an order to open its agent journey</span>}</header><div key={section} className="dashboard-tab-panel">{section === "overview" && <div className="space-y-4"><KpiStrip /><LoopIndicator /><PipelineOverview /><AtRiskNow /></div>}{section === "orders" && <OrderLog />}{section === "agents" && <AgentLog />}{section === "routes" && <RouteNetwork />}{section === "warehouses" && <WarehouseDashboard />}{section === "escalations" && <EscalationQueue />}{section === "security" && <SecurityLog />}{section === "performance" && <ResultsPanel />}</div></main></div></div>;
}

function Loading({ label }: { label: string }) { return <div className="tower grid min-h-screen place-items-center bg-[#060b10] p-6 text-center font-mono text-sm text-tower-dim">{label}</div>; }
