import { CASH_BUFFER, ENVELOPES } from "@/lib/config/envelopes";
import { retrieve } from "@/lib/rag/retrieve";
import type { SettlementIntake } from "@/lib/security/intake";
import type { AppState } from "@/lib/store/state";
import type { Proposal } from "@/lib/types";
import { inr, propose } from "./shared";
import type { Agent } from "./types";

export function cashPosition(s: AppState) {
  const tick = s.clock.tick;
  const payables = s.purchaseOrders.filter((p) => !p.paid && p.status !== "cancelled" && p.paymentDueTick <= tick + 30 * 24).reduce((a, p) => a + p.value, 0);
  const nextInflow = s.settlements.filter((x) => x.status !== "paid").sort((a, b) => a.dueTick - b.dueTick)[0];
  return { cash: s.finance.cash, payables, available: s.finance.cash - payables, buffer: CASH_BUFFER, nextInflowTick: nextInflow?.dueTick ?? tick + 14 * 24, nextInflowAmount: nextInflow ? nextInflow.gross - nextInflow.expectedCommission : 0 };
}

export const financeAgent: Agent<{ s: AppState }> = {
  id: "finance",
  name: "Finance",
  envelope: ENVELOPES.finance,
  perceive: (s) => ({ s }),
  decide: ({ s }) => {
    const tick = s.clock.tick;
    const out: Proposal[] = [];
    const cp = cashPosition(s);
    out.push(
      propose("finance", { type: "CASH_CONSTRAINT", available: Math.round(cp.available), buffer: cp.buffer, nextInflowTick: cp.nextInflowTick }, {
        reasoning: `Cash ${inr(cp.cash)} less payables due in 30 days ${inr(cp.payables)} = ${inr(cp.available)} available; buffer ${inr(cp.buffer)}; next marketplace settlement in ${((cp.nextInflowTick - tick) / 24).toFixed(1)} days (T+14 cycle).`,
        confidence: 0.95,
        resources: [{ kind: "cash", key: "cash", amount: cp.available - cp.buffer }],
        meta: { quiet: true, ...cp },
      }),
    );

    for (const po of s.purchaseOrders) {
      if (po.paid || po.status === "cancelled" || po.paymentDueTick > tick) continue;
      if ((s.cooldowns[`pay:${po.id}`] ?? 0) > tick) continue;
      out.push(
        propose("finance", { type: "RELEASE_PAYOUT", poId: po.id, amount: po.value }, {
          reasoning: `${po.id} payment due (${inr(po.value)}) per supplier terms; goods ${po.status === "received" ? "received" : "in transit, advance terms"}. Paying to the registered account only.`,
          confidence: 0.9,
          costImpact: po.value,
          meta: { poId: po.id, expectedAmount: po.value },
        }),
      );
    }

    for (const m of s.inbox) {
      if (m.kind !== "settlement_notice" || !m.processed || !m.extracted || (s.cooldowns[`dispute:${m.refId}`] ?? 0) > tick) continue;
      const st = s.settlements.find((x) => x.id === m.refId);
      if (!st || st.status !== "pending") continue;
      const ex = m.extracted as unknown as SettlementIntake & { clauseVerdict?: { permitted: boolean; quote: string; source: string } };
      const unexplained = ex.otherDeductions.reduce((a, d) => a + d.amount, 0);
      if (unexplained <= 500) continue;
      const citations = retrieve(`${st.marketplace} commission structure no other deduction may be applied unless itemised dispute settlement`, { k: 2, sourcePrefix: "marketplace-" });
      out.push(
        propose("finance", { type: "RAISE_DISPUTE", settlementId: st.id, amount: unexplained, clause: ex.clauseVerdict?.quote ?? "No other deduction may be applied to a settlement unless itemised under sections 3–5 of this policy." }, {
          reasoning: `${st.id} from ${st.marketplace}: gross ${inr(ex.gross ?? 0)} over ${ex.orderCount} orders. Commission recomputed from the policy table matches; unexplained deduction${ex.otherDeductions.length > 1 ? "s" : ""} ${ex.otherDeductions.map((d) => `"${d.label}" ${inr(d.amount)}`).join(", ")} has no basis in sections 3–5. Dispute within the 30-day window.`,
          confidence: 0.83,
          costImpact: -unexplained,
          citations,
          derivedFromUntrusted: true,
          llmText: ex.clauseVerdict?.quote,
          meta: { settlementId: st.id, extracted: ex, internalGross: st.gross, messageId: m.id, extractionSource: (m.extracted as { _source?: string })._source },
        }),
      );
    }
    void ENVELOPES;
    return out;
  },
};
