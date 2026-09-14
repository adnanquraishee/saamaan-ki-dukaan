import type { Draft } from "immer";
import { extractInvoiceRegex, extractSettlementRegex } from "@/lib/security/intake";
import type { AppState } from "@/lib/store/state";

/** Deterministic document extraction used when the LLM layer is off or unavailable (and at build time). */
export function extractOffline(d: Draft<AppState>) {
  for (const m of d.inbox) {
    if (m.processed || m.pending) continue;
    if (m.kind === "settlement_notice") {
      const ex = extractSettlementRegex(m.body);
      const unexplained = ex.otherDeductions.reduce((a, x) => a + x.amount, 0);
      m.extracted = { ...ex, _source: "regex", ...(unexplained > 500 ? { clauseVerdict: { permitted: true, quote: "No other deduction may be applied to a settlement unless itemised under sections 3–5 of this policy.", by: "rule" } } : {}) } as never;
      if (!ex.otherDeductions.length) {
        const st = d.settlements.find((x) => x.id === m.refId);
        if (st && st.status === "pending") st.status = "reconciled";
      }
    } else {
      m.extracted = { ...extractInvoiceRegex(m.body), _source: "regex" } as never;
    }
    m.processed = true;
  }
}
