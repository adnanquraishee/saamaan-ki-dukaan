import { runCycleSync } from "../../lib/engine/cycleSync";
import { createInitialState, type AppState } from "../../lib/store/state";
let s: AppState = createInitialState();
const sku = process.argv[2] ?? "APP-005";
const seen = new Set<string>();
for (let i = 0; i < 480; i++) {
  s = runCycleSync(s);
  for (const d of s.decisions) if (!seen.has(d.id)) { seen.add(d.id); if (d.summary.includes(s.catalog.find((p) => p.sku === sku)!.name) && !d.title.includes("batch")) console.log(`t${d.tick} ${d.kind} ${d.title} :: ${d.summary} || ${d.reasoning.slice(0, 260)}`); }
}
