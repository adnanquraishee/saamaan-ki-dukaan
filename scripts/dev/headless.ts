import { produce } from "immer";
import { runCycleSync } from "../../lib/engine/cycleSync";
import { applyCommand } from "../../lib/engine/commands";
import { summarise } from "../../lib/engine/kpis";
import { extractOffline } from "../../lib/engine/offlineExtract";
import { createInitialState, type AppState } from "../../lib/store/state";

const TICKS = Number(process.argv[2] ?? 120);
const scen = process.argv[3];
let s: AppState = createInitialState();
const times: number[] = [];
for (let i = 0; i < TICKS; i++) {
  if (scen && i === Number(process.argv[4] ?? 30)) s = produce(s, (d) => void applyCommand(d, { type: "scenario", id: scen as never }));
  const t0 = performance.now();
  s = runCycleSync(s);
  s = produce(s, (d) => extractOffline(d));
  times.push(performance.now() - t0);
}
const sm = summarise(s.ledger, 30);
const sh = summarise(s.shadow.ledger, 30);
const kinds: Record<string, number> = {};
for (const d of s.decisions) kinds[`${d.kind}:${d.title.split(" · ")[0]}`] = (kinds[`${d.kind}:${d.title.split(" · ")[0]}`] ?? 0) + 1;
console.log(`ticks=${s.clock.tick} avgCycle=${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)}ms max=${Math.max(...times).toFixed(0)}ms stateKB=${(JSON.stringify(s).length / 1024).toFixed(0)}`);
console.log("counters", s.counters);
console.log("kpis", s.kpis);
console.log("actual ", { rev: Math.round(sm.revenue), margin: sm.marginPct.toFixed(3), fill: sm.fillRate.toFixed(3), rto: sm.rtoRate.toFixed(3), stockouts: sm.stockouts });
console.log("shadow ", { rev: Math.round(sh.revenue), margin: sh.marginPct.toFixed(3), fill: sh.fillRate.toFixed(3), rto: sh.rtoRate.toFixed(3), stockouts: sh.stockouts });
console.log("accuracy", s.accuracy.days ? { model: (s.accuracy.model / s.accuracy.actual).toFixed(3), naive: (s.accuracy.naive / s.accuracy.actual).toFixed(3), ma: (s.accuracy.movingAvg / s.accuracy.actual).toFixed(3) } : "n/a");
console.log("decision kinds", kinds);
console.log("escalations", s.escalations.map((e) => `${e.agentId}: ${e.breach.slice(0, 110)}`));
console.log("conflicts", s.decisions.filter((d) => d.kind === "conflict").slice(-6).map((d) => `${d.title} → ${d.summary.slice(0, 140)}`));
console.log("POs", s.purchaseOrders.length, "transfers", s.transfers.length, "cash", Math.round(s.finance.cash), "orders", s.orders.length, "returns", s.returns.length, "security", s.security.length);
if (scen) {
  const sc = s.decisions.filter((d) => d.scenario || d.kind !== "commit" || d.title.includes("Demand ·") || d.title.includes("Pricing ·") || d.title.includes("Placement") || d.title.includes("Procurement ·") || d.title.includes("Risk"));
  console.log("\n--- scenario stream");
  for (const d of sc.slice(-40)) console.log(`t${d.tick} [${d.kind}] ${d.title} :: ${d.summary.slice(0, 150)}`);
}
