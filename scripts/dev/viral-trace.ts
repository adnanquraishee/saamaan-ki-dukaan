import { produce } from "immer";
import { procurementAgent } from "../../lib/agents/procurement";
import { applyCommand } from "../../lib/engine/commands";
import { runCycleSync } from "../../lib/engine/cycleSync";
import { extractOffline } from "../../lib/engine/offlineExtract";
import { createInitialState, type AppState } from "../../lib/store/state";
let s: AppState = createInitialState();
for (let i = 0; i < 46; i++) {
  if (i === 30) s = produce(s, (d) => void applyCommand(d, { type: "scenario", id: "viral" }));
  s = runCycleSync(s);
  s = produce(s, (d) => extractOffline(d));
  if (i >= 40) {
    const needs = Object.entries(s.needs).filter(([k]) => k.startsWith("ELE-001"));
    const props = procurementAgent.decide(procurementAgent.perceive(s)).filter((p) => (p.action as any).sku === "ELE-001");
    const pos = s.purchaseOrders.filter((p) => p.sku === "ELE-001").map((p) => `${p.id} ${p.qty} ${p.status}`);
    const esc = s.escalations.filter((e) => e.key === "po:ELE-001").map((e) => e.status);
    const dec = s.decisions.filter((d) => d.tick === s.clock.tick - 1 && (d.summary + d.title).includes("Aurora")).map((d) => `${d.kind}:${d.title}`);
    console.log(`t${s.clock.tick - 1}`, { needs: needs.map(([k, v]) => `${k} ${v.qty}`), props: props.map((p) => `${(p.action as any).qty}@${(p.action as any).unitCost}`), pos, esc, cooldown: s.cooldowns["po:ELE-001"], dec });
  }
}
