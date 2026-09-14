/**
 * Pre-warms the simulation for WARM_DAYS so the control tower opens with closed shipments, returns,
 * settlements and a populated ledger instead of empty KPIs. Written to public/warm-state.json and
 * loaded on first visit and on "Reset demo".
 *
 * Run: npm run warm
 */
import fs from "node:fs";
import path from "node:path";
import { produce } from "immer";
import { applyCommand } from "../lib/engine/commands";
import { runCycleSync } from "../lib/engine/cycleSync";
import { extractOffline } from "../lib/engine/offlineExtract";
import { createInitialState, type AppState } from "../lib/store/state";

const WARM_DAYS = 7;
let s: AppState = createInitialState();
const t0 = Date.now();
for (let i = 0; i < WARM_DAYS * 24; i++) {
  s = runCycleSync(s);
  s = produce(s, (d) => extractOffline(d));
}
// start the live demo with an empty escalation queue: anything open during warm-up is held at its fallback
for (const e of s.escalations.filter((x) => x.status === "open")) s = produce(s, (d) => void applyCommand(d, { type: "resolveEscalation", id: e.id, decision: "hold" }));
s = produce(s, (d) => {
  d.decisions = d.decisions.filter((x) => x.kind !== "human").slice(-120);
  d.scenario = { id: null, startedTick: 0, startedWall: 0 };
  d.clock.stage = "idle";
  d.engine = { holderId: "", heartbeat: 0, claimedAt: 0, visible: false };
  d.counters.humanActions = 0;
  for (const a of Object.values(d.agents)) a.status = "idle";
});
const out = path.join(process.cwd(), "public", "warm-state.json");
fs.writeFileSync(out, JSON.stringify(s));
console.log(`warmed ${WARM_DAYS} days (tick ${s.clock.tick}) in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${(fs.statSync(out).size / 1024).toFixed(0)} KB · autonomous ${s.counters.autonomous}, rto ${(s.kpis.rtoRate * 100).toFixed(1)}%, margin ${(s.kpis.contributionMarginPct * 100).toFixed(1)}%`);
