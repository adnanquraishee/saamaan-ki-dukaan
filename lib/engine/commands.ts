import type { Draft } from "immer";
import { PINCODE_BY_PIN } from "@/lib/config/network";
import { applyAction, logDecision } from "@/lib/orchestrator/commit";
import { AGENT_META } from "@/lib/config/envelopes";
import type { AppState } from "@/lib/store/state";
import { CAPS, createInitialState } from "@/lib/store/state";
import type { AgentId, PaymentMode, Settings } from "@/lib/types";
import { hashString, mulberry32 } from "./rng";
import { triggerScenario, type ScenarioId } from "./scenarios";
import { buildOrder, insertOrder, pushCapped } from "./world";

export type Command =
  | { type: "placeOrder"; order: { id: string; customerName: string; pincode: string; paymentMode: PaymentMode; firstTime: boolean; lines: { sku: string; qty: number }[] } }
  | { type: "requestReturn"; ret: { id: string; orderId: string; sku: string; qty: number; reasonCode: string; freeText: string; demoPoison?: boolean } }
  | { type: "setSpeed"; speedMs: number }
  | { type: "setRunning"; running: boolean }
  | { type: "scenario"; id: ScenarioId }
  | { type: "resolveEscalation"; id: string; decision: "authorise" | "hold" }
  | { type: "setSetting"; key: keyof Settings; value: boolean | number }
  | { type: "reset" }
  | { type: "supportTicket"; ticket: { ref: string; category: string; reason: string; orderId?: string; customerName?: string; message: string } };

export const REMOTE_ALLOWED: Command["type"][] = ["placeOrder", "requestReturn", "supportTicket"];

export function applyCommand(d: Draft<AppState>, cmd: Command): boolean {
  switch (cmd.type) {
    case "placeOrder": {
      if (d.orders.some((o) => o.id === cmd.order.id)) return true; // idempotent
      if (!PINCODE_BY_PIN[cmd.order.pincode]) return false;
      const order = buildOrder(d, { ...cmd.order, source: "storefront", channel: "web", rng: mulberry32(hashString(cmd.order.id)) });
      if (!order) return false;
      insertOrder(d, order);
      logDecision(d, { agentId: "human", kind: "info", title: "Storefront · order placed", summary: `${order.customerName} · ${order.lines.map((l) => `${l.qty}× ${l.sku}`).join(", ")} · ₹${order.value.toLocaleString("en-IN")} · ${order.paymentMode.toUpperCase()} · ${PINCODE_BY_PIN[order.pincode].city}`, reasoning: `RTO risk at checkout ${(order.rto!.p * 100).toFixed(0)}% (${order.rto!.top.map((t) => t.label).join(", ") || "low-risk profile"}).`, details: { orderId: order.id } });
      return true;
    }
    case "requestReturn": {
      if (d.returns.some((r) => r.id === cmd.ret.id)) return true;
      const o = d.orders.find((x) => x.id === cmd.ret.orderId);
      if (!o) return false;
      const line = o.lines.find((l) => l.sku === cmd.ret.sku) ?? o.lines[0];
      const qty = Math.max(1, Math.min(line.qty, cmd.ret.qty));
      pushCapped(d.returns, { id: cmd.ret.id, orderId: o.id, sku: line.sku, qty, reasonCode: cmd.ret.reasonCode, freeText: cmd.ret.freeText.slice(0, 600), tick: d.clock.tick, status: "requested", refundValue: line.price * qty, source: "storefront", warehouseId: o.warehouseId ?? "WH-BHW", shipCost: o.shipCost ?? 60 }, CAPS.returns);
      if (cmd.ret.demoPoison) d.counters.injectionAttempts += 1;
      return true;
    }
    case "setSpeed":
      d.clock.speedMs = Math.max(1000, Math.min(30000, Math.round(cmd.speedMs)));
      return true;
    case "setRunning":
      d.clock.running = cmd.running;
      d.clock.halted = !cmd.running;
      for (const a of Object.values(d.agents)) a.status = cmd.running ? "idle" : "halted";
      logDecision(d, { agentId: "human", kind: "human", title: cmd.running ? "Operator · loop resumed" : "Operator · HALT", summary: cmd.running ? "Autonomous loop resumed." : "All agents halted. Storefront orders queue until resume.", reasoning: "Manual control." });
      return true;
    case "scenario":
      triggerScenario(d, cmd.id);
      return true;
    case "resolveEscalation": {
      const e = d.escalations.find((x) => x.id === cmd.id);
      if (!e || e.status !== "open") return false;
      d.counters.humanActions += 1;
      const name = e.agentId.startsWith("intake:") ? e.agentId : AGENT_META[e.agentId as AgentId].name;
      if (cmd.decision === "authorise") {
        const res = e.proposal.action.type === "RAISE_ALERT" ? { summary: "Acknowledged", count: 0 } : applyAction(d, e.proposal.action, "human");
        e.status = "authorised";
        d.cooldowns[e.key] = d.clock.tick + 48;
        logDecision(d, { agentId: "human", kind: "human", title: `Operator authorised · ${name}`, summary: res.summary || e.ask, reasoning: `Override of: ${e.breach}` });
      } else {
        const fb = e.fallback?.action;
        const res = fb ? applyAction(d, fb, "human") : { summary: e.fallback?.label ?? "Held", count: 0 };
        e.status = "held";
        d.cooldowns[e.key] = d.clock.tick + (e.proposal.action.type === "RESOLVE_RETURN" || e.proposal.action.type === "RELEASE_PAYOUT" ? 99999 : 72);
        if (e.proposal.action.type === "SET_PRICE") d.cooldowns[`price:${e.proposal.action.sku}`] = d.clock.tick + 72;
        logDecision(d, { agentId: "human", kind: "human", title: `Operator held at fallback · ${name}`, summary: res.summary || e.fallback?.label || "Held", reasoning: `Declined: ${e.ask}` });
      }
      e.resolvedTick = d.clock.tick;
      return true;
    }
    case "setSetting":
      (d.settings as unknown as Record<string, unknown>)[cmd.key] = cmd.value;
      logDecision(d, { agentId: "human", kind: "human", title: "Operator · setting changed", summary: `${cmd.key} → ${String(cmd.value)}`, reasoning: cmd.key === "injectionDetection" && !cmd.value ? "Injection detection disabled to demonstrate that downstream guardrails still hold." : "Manual control." });
      return true;
    case "supportTicket": {
      const t = cmd.ticket;
      if (d.decisions.some((x) => x.details?.ticketRef === t.ref)) return true;
      // customer text is untrusted: stored as data in the ticket, never acted upon
      logDecision(d, { agentId: "human", kind: "escalate", title: `Support · ticket ${t.ref}`, summary: `${t.category.replace(/_/g, " ")}${t.orderId ? ` · ${t.orderId}` : ""}${t.customerName ? ` · ${t.customerName.slice(0, 40)}` : ""}`, reasoning: `${t.reason.slice(0, 200)} — customer wrote: “${t.message.slice(0, 300)}”`, details: { ticketRef: t.ref, category: t.category, orderId: t.orderId } });
      return true;
    }
    case "reset": {
      const fresh = createInitialState();
      const lock = d.engine;
      Object.assign(d, fresh);
      d.engine = lock;
      return true;
    }
  }
}
