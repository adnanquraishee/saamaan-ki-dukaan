// Guardrail chain. Every surviving proposal passes through all layers; any failure blocks commit.
// Order matters only for which failure is reported as the headline — all layers are always evaluated,
// so the decision log shows defence in depth (e.g. margin floor AND envelope both catching a ₹99 price).

import { catalogIndex, floorPrice, inr, unitEconomics } from "@/lib/agents/shared";
import { CITATION_THRESHOLD, ENVELOPES } from "@/lib/config/envelopes";
import { COURIER_BY_ID } from "@/lib/config/network";
import { chunkText } from "@/lib/rag/retrieve";
import type { AppState } from "@/lib/store/state";
import type { GuardrailResult, Proposal } from "@/lib/types";
import { validateFigures } from "./numeric";
import { simulationGate } from "./simulate";

const SKIP = new Set(["UPDATE_FORECAST", "SET_REORDER_POLICY", "CASH_CONSTRAINT"]);

export interface GuardOutcome {
  proposal: Proposal;
  results: GuardrailResult[];
  passed: boolean;
  headline?: GuardrailResult;
  util: number; // envelope utilisation (0..1+)
}

export function runGuardrails(s: AppState, p: Proposal): GuardOutcome {
  const env = ENVELOPES[p.agentId];
  const a = p.action;
  const results: GuardrailResult[] = [];
  let util = 0;
  const add = (id: string, label: string, passed: boolean, detail: string) => results.push({ id, label, passed, detail });

  // 1. Output filter — the action must be inside the proposer's declared action space.
  const inSpace = env.actionSpace.includes(a.type);
  add("action_space", "Output filter", inSpace, inSpace ? `${a.type} ∈ ${p.agentId} action space` : `${p.agentId} proposed ${a.type}, which is outside its action space [${env.actionSpace.join(", ") || "none — extraction only"}]. Category violation.`);
  if (SKIP.has(a.type) && inSpace) return { proposal: p, results, passed: true, util };

  // 2. Taint — derived from untrusted content that injection detection flagged.
  if (p.derivedFromUntrusted) {
    add("taint", "Untrusted-content taint", !p.tainted, p.tainted ? "Decision depends on content flagged by the injection detector." : "Untrusted input scanned; no instruction-shaped content detected.");
  }

  const cat = catalogIndex(s);

  // 3. Margin floor — absolute, cannot be configured off.
  if (a.type === "SET_PRICE") {
    const prod = cat[a.sku];
    const floor = floorPrice(prod);
    const ue = unitEconomics(prod, a.price);
    const ok = a.price >= floor;
    add("margin_floor", "Margin floor", ok, `${ok ? "Clears" : "Breaches"} floor ${inr(floor)} (contribution after expected returns ≥ ${ENVELOPES.pricing.minMarginPct}% of price). At ${inr(a.price)}: contribution ${inr(ue.contribution)}/unit (${(ue.marginPct * 100).toFixed(1)}%), expected return cost ${inr(ue.expectedReturnCost)}.`);
  }

  // 4. Action envelope
  switch (a.type) {
    case "SET_PRICE": {
      const prod = cat[a.sku];
      const changePct = ((a.price - prod.basePrice) / prod.basePrice) * 100;
      const limit = changePct < 0 ? env.maxDiscountPct ?? 0 : env.maxIncreasePct ?? 0;
      util = Math.abs(changePct) / Math.max(1, limit);
      const ok = Math.abs(changePct) <= limit + 0.01 && a.price <= prod.mrp;
      add("envelope", "Action envelope", ok, `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}% vs list ${inr(prod.basePrice)}; envelope ${changePct < 0 ? `max discount ${env.maxDiscountPct}%` : `max increase ${env.maxIncreasePct}%`}${a.price > prod.mrp ? "; exceeds MRP" : ""}.`);
      break;
    }
    case "CREATE_PO": {
      const value = a.qty * a.unitCost;
      util = value / (env.poValueCeiling ?? 1);
      const white = env.supplierWhitelist?.includes(a.supplierId) ?? false;
      add("envelope", "Action envelope", value <= (env.poValueCeiling ?? 0) && white, `PO ${inr(value)} vs ceiling ${inr(env.poValueCeiling ?? 0)}; supplier ${a.supplierId} ${white ? "whitelisted" : "NOT whitelisted"}.`);
      break;
    }
    case "TRANSFER_STOCK":
      util = Math.max(a.qty / (env.maxTransferUnits ?? 1), a.cost / (env.maxTransferCost ?? 1));
      add("envelope", "Action envelope", a.qty <= (env.maxTransferUnits ?? 0) && a.cost <= (env.maxTransferCost ?? 0), `${a.qty} units (max ${env.maxTransferUnits}), ${inr(a.cost)} (max ${inr(env.maxTransferCost ?? 0)}).`);
      break;
    case "ASSIGN_COURIERS": {
      const bad = a.assignments.flatMap((x): string[] => (x.legs?.length ? x.legs.map((l) => l.courierId) : [x.courierId])).filter((id) => !env.courierWhitelist?.includes(id));
      add("envelope", "Action envelope", bad.length === 0, bad.length ? `${bad.length} assignments to non-whitelisted carriers.` : `${a.assignments.length} assignments, all whitelisted carriers within ${env.courierPremiumCeilingPct}% premium ceiling.`);
      util = 0.3;
      break;
    }
    case "RESOLVE_RETURN": {
      const overCeiling = a.refund > (env.refundCeiling ?? 0);
      const skipTooLarge = a.skipInspection && a.refund > (env.skipInspectionMaxValue ?? 0);
      util = Math.max(a.refund / (env.refundCeiling ?? 1), a.skipInspection ? a.refund / (env.skipInspectionMaxValue ?? 1) : 0);
      add("envelope", "Action envelope", !overCeiling && !skipTooLarge, skipTooLarge ? `Refund without inspection of ${inr(a.refund)} exceeds the ${inr(env.skipInspectionMaxValue ?? 0)} no-inspection limit.` : overCeiling ? `Refund ${inr(a.refund)} exceeds ceiling ${inr(env.refundCeiling ?? 0)}.` : `Refund ${inr(a.refund)}${a.skipInspection ? " without inspection" : " after inspection"} within envelope.`);
      break;
    }
    case "EXPEDITE_PO":
      util = a.cost / (env.expediteCostCeiling ?? 1);
      add("envelope", "Action envelope", a.cost <= (env.expediteCostCeiling ?? 0), `Expedite ${inr(a.cost)} vs ceiling ${inr(env.expediteCostCeiling ?? 0)}.`);
      break;
    case "RELEASE_PAYOUT":
      if (env.payoutCeiling !== undefined) {
        util = a.amount / env.payoutCeiling;
        add("envelope", "Action envelope", a.amount <= env.payoutCeiling, `Payout ${inr(a.amount)} vs ceiling ${inr(env.payoutCeiling)}.`);
      }
      break;
    default:
      break;
  }

  // 5. Grounding — contract-based decisions require a retrieved citation above threshold.
  if (env.requiresCitation?.includes(a.type) || (p.agentId === "finance" && a.type === "RAISE_DISPUTE")) {
    const best = Math.max(0, ...(p.citations ?? []).map((c) => c.score));
    const ok = best >= CITATION_THRESHOLD;
    add("grounding", "Grounding", ok, ok ? `${p.citations!.length} citation(s); best similarity ${best.toFixed(2)} ≥ ${CITATION_THRESHOLD}.` : `No retrieved clause above similarity ${CITATION_THRESHOLD} — refusing to act from parametric memory.`);
  }

  // 6. Numeric validation — figures must match state / the grounded document.
  if (a.type === "ASSIGN_COURIERS" && p.citations?.length) {
    const mismatches: string[] = [];
    for (const c of new Set(a.assignments.flatMap((x) => (x.legs?.length ? x.legs.map((l) => l.courierId) : [x.courierId])))) {
      const courier = COURIER_BY_ID[c];
      const doc = p.citations.find((x) => x.source === courier.contractDoc);
      if (!doc) continue;
      const text = chunkText(doc.chunkId);
      const live = s.couriers.find((x) => x.id === c)!;
      if (!text.includes(`₹${live.rateCard.A.first500g}`) || !text.includes(`₹${live.rateCard.C.first500g}`)) mismatches.push(courier.name);
    }
    add("numeric", "Numeric validation", mismatches.length === 0, mismatches.length ? `Rate used for ${mismatches.join(", ")} does not match the retrieved rate card.` : "Rates used in cost estimates match the retrieved rate cards.");
  }
  if (a.type === "RAISE_DISPUTE") {
    const ex = p.meta?.extracted as { gross?: number | null; netPayable?: number | null; otherDeductions?: { amount: number }[] } | undefined;
    const st = s.settlements.find((x) => x.id === a.settlementId);
    const grossOk = !!st && ex?.gross === st.gross;
    const amountOk = !!st && a.amount === (st.claimedDeduction ?? 0);
    const expectedNet = st ? st.gross - st.expectedCommission - a.amount : 0;
    const netOk = !!st && ex?.netPayable !== null && ex?.netPayable !== undefined && Math.abs(ex.netPayable - expectedNet) < 1;
    let llmOk = true;
    let llmBad: number[] = [];
    if (p.llmText && st) {
      const v = validateFigures(p.llmText, [st.gross, st.expectedCommission, st.claimedDeduction ?? 0, a.amount, 3, 4, 5, 30]);
      llmOk = v.ok;
      llmBad = v.bad;
    }
    add("numeric", "Numeric validation", grossOk && amountOk && netOk && llmOk, !grossOk ? `Extracted gross ${inr(ex?.gross ?? 0)} ≠ internal order records ${inr(st?.gross ?? 0)}.` : !amountOk ? `Dispute amount ${inr(a.amount)} ≠ deduction on record.` : !netOk ? `Notice net payable ${inr(ex?.netPayable ?? 0)} ≠ reconciled net ${inr(expectedNet)}.` : !llmOk ? `LLM clause text cites figures not in state: ${llmBad.join(", ")}.` : `Gross ${inr(st!.gross)}, deduction ${inr(a.amount)}, and net payable ${inr(expectedNet)} reconcile to order records.`);
  }
  if (a.type === "RELEASE_PAYOUT") {
    const po = s.purchaseOrders.find((x) => x.id === a.poId);
    const ok = !!po && Math.abs(po.value - a.amount) < 1 && !po.paid;
    add("numeric", "Numeric validation", ok, ok ? `Amount matches ${a.poId} value.` : po ? `Requested ${inr(a.amount)} ≠ ${a.poId} value ${inr(po.value)}${po.paid ? " (already paid)" : ""}.` : `${a.poId} not found in purchase orders.`);
  }

  // 7. Simulation gate — consequential actions projected on a cloned state.
  const consequential = (a.type === "SET_PRICE" && a.price < a.prevPrice * 0.9) || a.type === "TRANSFER_STOCK";
  if (consequential) {
    const sim = simulationGate(s, a);
    if (sim) {
      const floor = s.settings.fillRateFloor;
      const ok = !(sim.withAction < floor && sim.withAction < sim.without - 0.01);
      add("simulation", "Simulation gate", ok, `Projected 10-day fill rate ${(sim.withAction * 100).toFixed(1)}% with action vs ${(sim.without * 100).toFixed(1)}% without (floor ${(floor * 100).toFixed(0)}%).`);
    }
  }

  const failed = results.filter((r) => !r.passed);
  const order = ["action_space", "taint", "margin_floor", "envelope", "grounding", "numeric", "simulation"];
  failed.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
  return { proposal: p, results, passed: failed.length === 0, headline: failed[0], util };
}
