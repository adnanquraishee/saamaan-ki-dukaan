"use client";
import { useApp } from "@/lib/store/store";
import { Panel } from "./ui";

const stages = [
  ["sense", "1", "Sense", "Orders, stock, market"],
  ["twin", "2", "Twin", "Update the world model"],
  ["plan", "3", "Plan", "Forecast and propose"],
  ["arbitrate", "4", "Arbitrate", "Check rules and conflicts"],
  ["simulate", "5", "Simulate", "Test the safest choice"],
  ["execute", "6", "Execute", "Apply approved actions"],
] as const;

export function PipelineOverview() {
  const clock = useApp((s) => s.clock);
  const counters = useApp((s) => s.counters);
  const orders = useApp((s) => s.orders.length);
  const openEscalations = useApp((s) => s.escalations.filter((e) => e.status === "open").length);
  const active = stages.findIndex(([id]) => id === clock.stage);
  return (
    <Panel title="Live operating pipeline" right={<span className="font-mono text-[10px] text-tower-dim">cycle {clock.tick}</span>}>
      <div className="grid gap-2 md:grid-cols-6">
        {stages.map(([id, number, label, hint], index) => {
          const current = id === clock.stage;
          const complete = active >= 0 && index < active;
          return <div key={id} className={`relative rounded-sm border p-3 transition-all duration-500 ${current ? "border-tower-cyan bg-tower-cyan/10 shadow-[0_0_18px_rgba(76,225,214,0.12)]" : complete ? "border-tower-green/40 bg-tower-green/5" : "border-tower-line bg-[#0c151e]"}`}>
            <div className="flex items-center gap-2"><span className={`grid h-5 w-5 place-items-center rounded-full font-mono text-[10px] ${current ? "bg-tower-cyan text-black" : complete ? "bg-tower-green text-black" : "bg-tower-line text-tower-dim"}`}>{number}</span><span className="font-semibold text-white">{label}</span></div>
            <p className="mt-2 text-[11px] leading-snug text-tower-dim">{hint}</p>
            <div className="mt-3 font-mono text-[10px] uppercase tracking-wider">{current ? <span className="text-tower-cyan">working now</span> : complete ? <span className="text-tower-green">complete</span> : <span className="text-tower-dim">waiting</span>}</div>
          </div>;
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-tower-line bg-tower-line sm:grid-cols-4">
        <Stat label="Orders observed" value={orders} />
        <Stat label="Decisions made" value={counters.autonomous} />
        <Stat label="Needs attention" value={openEscalations} alert={openEscalations > 0} />
        <Stat label="Engine" value={clock.halted ? "Paused" : "Running"} />
      </div>
    </Panel>
  );
}

function Stat({ label, value, alert = false }: { label: string; value: string | number; alert?: boolean }) {
  return <div className="bg-tower-panel px-3 py-2"><div className="font-mono text-[10px] uppercase tracking-wider text-tower-dim">{label}</div><div className={`num mt-1 font-mono text-lg ${alert ? "text-tower-amber" : "text-white"}`}>{typeof value === "number" ? value.toLocaleString("en-IN") : value}</div></div>;
}
