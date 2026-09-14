import { ENVELOPES } from "@/lib/config/envelopes";
import { IVR_COST } from "@/lib/engine/economics";
import { elasticityFor } from "@/lib/ml/elasticity";
import { extractReturn } from "@/lib/security/intake";
import type { AppState } from "@/lib/store/state";
import type { Order, Product, Proposal, ReturnRequest } from "@/lib/types";
import { catalogIndex, dailyDemand, inr, propose, unitEconomics } from "./shared";
import type { Agent } from "./types";

export function sizingEconomics(s: AppState, p: Product) {
  const q0 = dailyDemand(s, p.sku);
  const e = elasticityFor(p.cluster);
  const unit = (price: number, r: number) => {
    const ue = unitEconomics({ ...p, returnRate: r }, price);
    return ue.contribution;
  };
  const discountPrice = Math.round(p.basePrice * 0.9);
  const qDisc = q0 * Math.pow(0.9, e);
  const rDisc = Math.min(0.75, p.returnRate * 1.2);
  const rFix = p.returnRate * 0.68;
  return {
    discount: { price: discountPrice, units: qDisc, returnRate: rDisc, perDay: qDisc * unit(discountPrice, rDisc) },
    fix: { price: p.currentPrice, units: q0, returnRate: rFix, perDay: q0 * unit(p.currentPrice, rFix) },
    current: { perDay: q0 * unit(p.currentPrice, p.returnRate) },
  };
}

export const returnsAgent: Agent<{ s: AppState; requests: ReturnRequest[]; codRisk: Order[]; sizing: Product[] }> = {
  id: "returns",
  name: "Returns",
  envelope: ENVELOPES.returns,
  perceive: (s) => ({
    s,
    requests: s.returns.filter((r) => r.status === "requested").slice(0, 30),
    codRisk: s.orders.filter((o) => o.status === "placed" && o.paymentMode === "cod" && !o.rtoMeasure && (o.rto?.p ?? 0) > 0.22),
    // reviewed in the same merchandising slot as Pricing's round-robin, so both agents see the SKU together
    sizing: Array.from({ length: 10 }, (_, i) => s.catalog[(s.clock.tick * 10 + i) % s.catalog.length]).filter((p) => p.sizingIssue && p.returnRate >= 0.3 && !s.sizeGuideFixed[p.sku]),
  }),
  decide: ({ s, requests, codRisk, sizing }) => {
    const cat = catalogIndex(s);
    const out: Proposal[] = [];
    const orderById = new Map(s.orders.map((o) => [o.id, o]));
    for (const r of requests) {
      if ((s.cooldowns[`ret:${r.id}`] ?? 0) > s.clock.tick) continue;
      const p = cat[r.sku];
      const intake = extractReturn(r.freeText, r.reasonCode);
      const flagged = (r.injection?.length ?? 0) > 0;
      const value = r.refundValue;
      const order = orderById.get(r.orderId);
      let disposition: "restock" | "inspect" | "liquidate" | "reject" = "inspect";
      let skip = false;
      let why = "";
      if (intake.claimedPremiumTier || intake.claimedSkipInspection) {
        // Premium fast lane: the policy trusts the tier the request *claims*. This is exactly the path a
        // poisoned note targets — detection, taint tracking and the skip-inspection envelope must stop it.
        disposition = "restock";
        skip = true;
        why = `Request asserts ${intake.claimedPremiumTier ? "premium tier" : "no-inspection handling"}; premium fast lane refunds ${inr(value)} without inspection.`;
      } else if (p.category === "personal_care") {
        disposition = "liquidate";
        why = "Personal care cannot be resold once opened; liquidate after inspection.";
      } else if (intake.sizeRelated && p.category === "apparel" && value < 1000 && !intake.claimsDamage) {
        disposition = "restock";
        skip = true;
        why = `Size/fit return on apparel under ₹1,000 with no flags: refund on pickup scan and restock (${(0.85 * 100).toFixed(0)}% restockable).`;
      } else if (intake.claimsDamage) {
        why = "Damage claimed — inspect before refund.";
      } else {
        why = value >= 1000 ? `Value ${inr(value)} ≥ ₹1,000 — inspect before refund.` : "Standard inspection.";
      }
      out.push(
        propose("returns", { type: "RESOLVE_RETURN", returnId: r.id, disposition, refund: value, skipInspection: skip }, {
          reasoning: `${r.id} (${p.name}, ${r.reasonCode.replace("_", " ")}): ${why}${order ? ` Order value ${inr(order.value)}, ${order.paymentMode.toUpperCase()}.` : ""}`,
          confidence: skip ? 0.7 : 0.85,
          costImpact: skip ? value : value * 0.5,
          derivedFromUntrusted: true,
          tainted: flagged,
          meta: { returnId: r.id, intake, sku: r.sku, freeText: r.freeText, hits: r.injection ?? [] },
        }),
      );
    }
    if (codRisk.length) {
      const cat = catalogIndex(s);
      const avoided = codRisk.reduce((a, o) => a + (o.rto!.p - 1 / (1 + Math.exp(-(Math.log(o.rto!.p / (1 - o.rto!.p)) - 0.55)))) * (90 + o.lines.reduce((m, l) => m + (l.price - cat[l.sku].cost) * l.qty, 0)), 0);
      out.push(
        propose("returns", { type: "RTO_PREVENTION", orderIds: codRisk.map((o) => o.id), measure: "ivr_confirm" }, {
          reasoning: `${codRisk.length} COD orders score above 22% RTO risk (classifier: ${codRisk[0].rto!.top.map((t) => t.label).join(", ")}). IVR confirmation (${inr(IVR_COST)} each) lowers refusal odds; expected RTO cost + lost margin avoided ≈ ${inr(avoided)} vs ${inr(codRisk.length * IVR_COST)} spend.`,
          confidence: 0.76,
          costImpact: codRisk.length * IVR_COST - avoided,
          meta: { quiet: true },
        }),
      );
    }
    for (const p of sizing) {
      const econ = sizingEconomics(s, p);
      out.push(
        propose("returns", { type: "FIX_SIZE_GUIDE", sku: p.sku, expectedReturnDrop: 0.32 }, {
          reasoning: `${p.name} returns ${(p.returnRate * 100).toFixed(0)}% — reason codes are dominated by size/fit, a listing problem not a demand problem. Correcting the size guide cuts returns ~32% at the current price: contribution ${inr(econ.fix.perDay)}/day vs ${inr(econ.current.perDay)}/day today.`,
          confidence: 0.8,
          costImpact: -(econ.fix.perDay - econ.current.perDay),
          resources: [{ kind: "price", key: `${p.sku}|*`, direction: "hold" }],
          meta: { sku: p.sku, econ },
        }),
      );
    }
    return out;
  },
};
