// Synchronous full cycle (no stage pauses). Used by the headless harness and as the reference
// implementation of the stage order the browser runner animates.
import { produce, setAutoFreeze } from "immer";
import { demandAgent } from "@/lib/agents/demand";
import { commitCycle } from "@/lib/orchestrator/commit";
import { decide, ingestUntrusted, planStage } from "@/lib/orchestrator/pipeline";
import { runGuardrails } from "@/lib/orchestrator/guardrails";
import type { AppState } from "@/lib/store/state";
import { computeKpis } from "./kpis";
import { advanceWorld } from "./world";

setAutoFreeze(false);

export function senseStage(s: AppState) {
  return produce(s, (d) => {
    advanceWorld(d);
    ingestUntrusted(d);
  });
}

export function twinStage(s: AppState) {
  const proposals = demandAgent.decide(demandAgent.perceive(s));
  const outcomes = proposals.map((p) => runGuardrails(s, p));
  return produce(s, (d) => {
    commitCycle(d, { approved: outcomes.filter((o) => o.passed), blocked: outcomes.filter((o) => !o.passed), conflicts: [], proposalsTotal: proposals.length });
  });
}

export function executeStage(s: AppState, result: ReturnType<typeof decide>, computeMs: number) {
  return produce(s, (d) => {
    commitCycle(d, result);
    d.kpis = computeKpis(d);
    d.clock.lastCycleMs = Math.round(computeMs);
    d.clock.lastCycleWall = Date.now();
    d.clock.tick += 1;
  });
}

export function runCycleSync(s0: AppState) {
  const t0 = performance.now();
  let s = senseStage(s0);
  s = twinStage(s);
  const proposals = planStage(s);
  const result = decide(s, proposals);
  return executeStage(s, result, performance.now() - t0);
}
