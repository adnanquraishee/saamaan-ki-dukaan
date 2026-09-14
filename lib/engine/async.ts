"use client";
// Post-cycle asynchronous work, run only by the engine tab:
//   - document extraction (LLM with Zod-validated structured output, regex fallback)
//   - contract clause interpretation for disputes (LLM, deterministic fallback)
//   - plain-language explanations for notable decisions (LLM, numeric validation before display)
//   - reasoning over novel risk patterns (LLM, advisory, attached to the escalation)
// None of these ever commit an action. Their outputs feed agents on the next cycle and pass guardrails.
import { produce } from "immer";
import { callLlm, llmStats, llmStatus } from "@/lib/llm/client";
import { numbersIn, validateFigures } from "@/lib/orchestrator/numeric";
import { chunkText, retrieve } from "@/lib/rag/retrieve";
import { extractInvoiceRegex, extractSettlementRegex } from "@/lib/security/intake";
import type { AppState } from "@/lib/store/state";
import { useApp } from "@/lib/store/store";
import { useUi } from "@/lib/store/ui";
import type { Decision } from "@/lib/types";
import { logDecision } from "@/lib/orchestrator/commit";

let busy = false;
const explained = new Set<string>();

const set = (fn: (d: import("immer").Draft<AppState>) => void) => useApp.setState((s) => produce(s, fn));

function llmOn() {
  return useApp.getState().settings.llmEnabled && llmStatus() !== "unavailable";
}

async function extractMessages() {
  const s = useApp.getState();
  const todo = s.inbox.filter((m) => !m.processed && !m.pending).slice(0, 3);
  for (const m of todo) {
    set((d) => {
      const x = d.inbox.find((y) => y.id === m.id);
      if (x) x.pending = true;
    });
    let extracted: Record<string, unknown>;
    if (m.kind === "settlement_notice") {
      const llm = llmOn() ? await callLlm("extract_settlement", { text: m.body }, { priority: true }) : null;
      const ex = llm ?? extractSettlementRegex(m.body);
      extracted = { ...ex, _source: llm ? "llm" : "regex" };
      const unexplained = ex.otherDeductions.reduce((a, x) => a + x.amount, 0);
      if (unexplained > 500) {
        const cite = retrieve(`${ex.marketplace ?? ""} commission structure no other deduction may be applied unless itemised`, { k: 1, sourcePrefix: "marketplace-" })[0];
        const clause = cite ? chunkText(cite.chunkId) : "";
        const verdict = llmOn() && clause ? await callLlm("interpret_clause", { question: `May the seller dispute a deduction labelled "${ex.otherDeductions.map((x) => x.label).join(", ")}" that is not commission or a closing fee?`, clause, source: cite?.source }) : null;
        extracted.clauseVerdict = verdict
          ? { permitted: verdict.permitted, quote: verdict.quote, source: cite?.source, by: "llm" }
          : { permitted: /no other deduction may be applied/i.test(clause), quote: "No other deduction may be applied to a settlement unless itemised under sections 3–5 of this policy.", source: cite?.source, by: "rule" };
      }
    } else {
      const llm = llmOn() ? await callLlm("extract_supplier_doc", { text: m.body }, { priority: true }) : null;
      if (llm) {
        extracted = { poRef: llm.poRef, supplier: llm.supplier, amount: llm.amount, delayDays: llm.delayDays, bankChange: llm.bankChange, suggestedAction: llm.requestedActions.includes("RELEASE_PAYOUT") ? "RELEASE_PAYOUT" : null, _source: "llm" };
      } else extracted = { ...extractInvoiceRegex(m.body), _source: "regex" };
    }
    set((d) => {
      const x = d.inbox.find((y) => y.id === m.id);
      if (!x) return;
      x.pending = false;
      x.processed = true;
      x.extracted = extracted;
      if (x.kind === "settlement_notice") {
        const st = d.settlements.find((y) => y.id === x.refId);
        const other = (extracted.otherDeductions as { amount: number }[]) ?? [];
        if (st && st.status === "pending" && !other.length) {
          st.status = "reconciled";
          d.agents.finance.decisions += 1;
          d.counters.autonomous += 1;
        }
      }
    });
  }
}

function notable(dec: Decision) {
  if (explained.has(dec.id) || dec.explanationSource === "llm") return false;
  if (dec.kind === "conflict" || dec.kind === "block" || dec.kind === "escalate") return true;
  return dec.kind === "commit" && /set price|create po|transfer stock|raise dispute|flag demand/.test(dec.title);
}

async function explainDecisions() {
  const s = useApp.getState();
  if (!s.settings.autoExplain || !llmOn()) return;
  const candidates = s.decisions.slice(-40).filter(notable).slice(-2);
  for (const dec of candidates) {
    explained.add(dec.id);
    const facts = { title: dec.title, outcome: dec.summary, reasoning: dec.reasoning, guardrails: dec.guardrails?.filter((g) => !g.passed).map((g) => `${g.label}: ${g.detail}`) };
    const out = await callLlm("explain_decision", { facts });
    if (!out) continue;
    const allowed = numbersIn(facts);
    const check = validateFigures(out.explanation, allowed);
    set((d) => {
      const x = d.decisions.find((y) => y.id === dec.id);
      d.counters.llmCalls = llmStats.calls;
      d.counters.llmCached = llmStats.cached;
      if (!x) return;
      if (check.ok) {
        x.explanation = out.explanation;
        x.explanationSource = "llm";
      } else {
        d.counters.llmRejected += 1;
        logDecision(d, { agentId: "security", kind: "security", title: "Numeric validation · LLM explanation rejected", summary: `Explanation for "${dec.title}" cited ${check.bad.join(", ")} — not present in state. Template explanation kept.`, reasoning: out.explanation });
      }
    });
  }
}

async function assessNovel() {
  const s = useApp.getState();
  const open = s.escalations.filter((e) => e.status === "open" && e.proposal.meta?.novel && !e.proposal.meta?.assessment);
  for (const e of open.slice(0, 1)) {
    const anomaly = { pattern: (e.proposal.action as { pattern?: string }).pattern, detail: (e.proposal.action as { detail?: string }).detail, ...e.proposal.meta };
    const recent = s.orders.filter((o) => o.pincode === e.proposal.meta?.pincode).slice(-12);
    const context = { orders: recent.length, avgValue: recent.length ? Math.round(recent.reduce((a, o) => a + o.value, 0) / recent.length) : 0, codShare: recent.length ? recent.filter((o) => o.paymentMode === "cod").length / recent.length : 0, storefront: recent.filter((o) => o.source === "storefront").length, distinctSkus: new Set(recent.flatMap((o) => o.lines.map((l) => l.sku))).size };
    const out = llmOn() ? await callLlm("novel_risk", { anomaly, context }, { priority: true }) : null;
    const assessment = out
      ? { ...out, by: "llm" }
      : {
          assessment: `${context.orders} recent orders from one pincode, ${Math.round(context.codShare * 100)}% COD, ${context.storefront} via storefront, ${context.distinctSkus} distinct SKUs.`,
          likelyCause: context.storefront > context.orders / 2 ? "Coordinated purchase from a single location (e.g. a live audience or office group buy)." : "Possible reseller or bot activity.",
          recommendedAction: context.codShare > 0.6 ? "throttle_cod" : "monitor",
          confidence: 0.5,
          by: "rule",
        };
    set((d) => {
      const x = d.escalations.find((y) => y.id === e.id);
      if (x) x.proposal.meta = { ...x.proposal.meta, assessment };
    });
  }
}

export async function runAsyncJobs() {
  if (busy || !useUi.getState().isEngine) return;
  busy = true;
  try {
    await extractMessages();
    await assessNovel();
    await explainDecisions();
  } catch (err) {
    console.warn("async jobs", err);
  } finally {
    busy = false;
  }
}
