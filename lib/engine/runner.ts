"use client";
// Browser engine loop. Tick timing is derived from elapsed wall time against an anchor
// (tick = anchorTick + floor((now - anchorWall) / speedMs)), never from accumulated setInterval calls,
// so a throttled or busy tab does not drift — it re-anchors instead of replaying a backlog.
import { produce } from "immer";
import { demandAgent } from "@/lib/agents/demand";
import { commitCycle } from "@/lib/orchestrator/commit";
import { runGuardrails } from "@/lib/orchestrator/guardrails";
import { decide, ingestUntrusted, planStage } from "@/lib/orchestrator/pipeline";
import type { AppState, LoopStage } from "@/lib/store/state";
import { useApp } from "@/lib/store/store";
import { useUi } from "@/lib/store/ui";
import { runAsyncJobs } from "./async";
import { computeKpis } from "./kpis";
import { advanceWorld } from "./world";

let running = false;
let anchor: { wall: number; tick: number; speed: number } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setStage(stage: LoopStage) {
  const s = useApp.getState();
  useApp.setState({ clock: { ...s.clock, stage } });
}

async function cycle() {
  const speed = useApp.getState().clock.speedMs;
  const pause = Math.min(170, speed / 14);
  let compute = 0;
  const timed = <T,>(fn: () => T): T => {
    const t0 = performance.now();
    const r = fn();
    compute += performance.now() - t0;
    return r;
  };

  setStage("sense");
  timed(() => useApp.setState((s) => produce(s, (d) => { advanceWorld(d); ingestUntrusted(d); })));
  await sleep(pause);

  setStage("twin");
  timed(() => {
    const s = useApp.getState();
    const proposals = demandAgent.decide(demandAgent.perceive(s));
    const outcomes = proposals.map((p) => runGuardrails(s, p));
    useApp.setState(produce(s, (d) => commitCycle(d, { approved: outcomes.filter((o) => o.passed), blocked: outcomes.filter((o) => !o.passed), conflicts: [], proposalsTotal: proposals.length })));
  });
  await sleep(pause);

  setStage("plan");
  const proposals = timed(() => planStage(useApp.getState()));
  await sleep(pause);

  setStage("arbitrate");
  await sleep(pause);
  setStage("simulate");
  const result = timed(() => decide(useApp.getState(), proposals));
  await sleep(pause);

  setStage("execute");
  timed(() =>
    useApp.setState((s: AppState) =>
      produce(s, (d) => {
        commitCycle(d, result);
        d.kpis = computeKpis(d);
        d.clock.lastCycleMs = Math.round(compute);
        d.clock.lastCycleWall = Date.now();
        d.clock.tick += 1;
      }),
    ),
  );
  await sleep(pause);
  setStage("idle");
  void runAsyncJobs();
}

async function step() {
  timer = null;
  if (!running) return;
  const { clock } = useApp.getState();
  const isEngine = useUi.getState().isEngine;
  const now = Date.now();
  if (!isEngine || !clock.running || clock.halted) {
    anchor = null;
    timer = setTimeout(step, 250);
    return;
  }
  if (!anchor || anchor.speed !== clock.speedMs) anchor = { wall: now - clock.speedMs * 0.9, tick: clock.tick, speed: clock.speedMs };
  let target = anchor.tick + Math.floor((now - anchor.wall) / clock.speedMs);
  if (target - clock.tick > 3) {
    // tab was throttled or suspended: re-anchor rather than burst-replaying missed ticks
    anchor = { wall: now, tick: clock.tick, speed: clock.speedMs };
    target = clock.tick + 1;
  }
  if (target > clock.tick) {
    try {
      await cycle();
    } catch (err) {
      console.error("engine cycle failed", err);
      setStage("idle");
    }
  }
  timer = setTimeout(step, 60);
}

export function startEngineLoop() {
  if (running) return;
  running = true;
  timer = setTimeout(step, 100);
}

export function stopEngineLoop() {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
