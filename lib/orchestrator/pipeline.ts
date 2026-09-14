import type { Draft } from "immer";
import { PLANNING_AGENTS } from "@/lib/agents";
import { propose } from "@/lib/agents/shared";
import { nextId, pushCapped } from "@/lib/engine/world";
import { detectInjection } from "@/lib/security/injection";
import type { AppState } from "@/lib/store/state";
import { CAPS } from "@/lib/store/state";
import type { InjectionHit, Proposal, SecurityEvent } from "@/lib/types";
import { arbitrate } from "./arbitrate";
import type { CycleResult } from "./commit";
import { runGuardrails } from "./guardrails";

function securityEvent(d: Draft<AppState>, surface: SecurityEvent["surface"], refId: string, hits: InjectionHit[], note: string) {
  d.counters.injectionsCaught += 1;
  pushCapped(d.security, { id: nextId(d, "SEC"), tick: d.clock.tick, wall: Date.now(), surface, refId, hits, blocked: true, note }, CAPS.security);
}

/** Sense-stage scan of every untrusted surface. Detection is one layer; guardrails hold without it. */
export function ingestUntrusted(d: Draft<AppState>) {
  const on = d.settings.injectionDetection;
  for (const r of d.returns) {
    if (r.status !== "requested" || r.injection !== undefined) continue;
    r.injection = on ? detectInjection(r.freeText) : [];
    if (r.injection.length) securityEvent(d, "return_request", r.id, r.injection, `Instruction-shaped text in return note (${r.injection.map((h) => h.label).join(", ")})`);
  }
  for (const q of Object.values(d.market.competitor)) {
    if (q.hits !== undefined) continue;
    q.hits = on ? detectInjection(q.page) : [];
    if (q.hits.length) securityEvent(d, "competitor_page", q.sku, q.hits, `Hidden / directive text on scraped competitor page for ${q.sku}`);
  }
  for (const m of d.inbox) {
    if (m.injection !== undefined) continue;
    m.injection = on ? detectInjection(m.body) : [];
    if (m.injection.length) securityEvent(d, m.kind === "invoice" ? "invoice" : m.kind === "supplier_email" ? "supplier_email" : "settlement_notice", m.id, m.injection, `Instruction-shaped text in ${m.kind.replace("_", " ")} from ${m.from}`);
  }
}

/** Intake extractors surface what documents *request*. They have no action space, so the output filter rejects these. */
export function intakeProposals(s: AppState): Proposal[] {
  const out: Proposal[] = [];
  for (const m of s.inbox) {
    if (m.kind !== "invoice" || !m.processed || !m.extracted || (s.cooldowns[`intake:${m.id}`] ?? 0) > s.clock.tick) continue;
    const ex = m.extracted as { suggestedAction?: string | null; poRef?: string | null; amount?: number | null };
    if (ex.suggestedAction !== "RELEASE_PAYOUT" || !ex.poRef) continue;
    out.push(
      propose("intake:finance", { type: "RELEASE_PAYOUT", poId: ex.poRef, amount: ex.amount ?? 0 }, {
        reasoning: `Invoice reader extracted a request from ${m.from}: release ${ex.amount ? `₹${ex.amount.toLocaleString("en-IN")}` : "payment"} for ${ex.poRef} to a new remittance account.`,
        confidence: 0.4,
        derivedFromUntrusted: true,
        tainted: (m.injection?.length ?? 0) > 0,
        meta: { cooldown: `intake:${m.id}`, body: m.body, hits: m.injection ?? [], messageId: m.id },
      }),
    );
  }
  return out;
}

export function planStage(s: AppState): Proposal[] {
  return [...PLANNING_AGENTS.flatMap((a) => a.decide(a.perceive(s))), ...intakeProposals(s)];
}

export function decide(s: AppState, proposals: Proposal[]): CycleResult {
  const { survivors, conflicts } = arbitrate(s, proposals);
  const outcomes = survivors.map((p) => runGuardrails(s, p));
  return {
    approved: outcomes.filter((o) => o.passed),
    blocked: outcomes.filter((o) => !o.passed || (o.proposal.action.type === "RAISE_ALERT" && o.proposal.meta?.novel)),
    conflicts,
    proposalsTotal: proposals.length,
  };
}
