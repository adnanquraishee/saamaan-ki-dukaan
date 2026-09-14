import { ENVELOPES } from "@/lib/config/envelopes";
import { COURIER_BY_ID } from "@/lib/config/network";
import { courierAnomaly, supplierAnomaly } from "@/lib/ml/anomaly";
import { retrieve } from "@/lib/rag/retrieve";
import type { AppState } from "@/lib/store/state";
import type { Proposal } from "@/lib/types";
import { catalogIndex, coverDays, dailyDemand, inbound, inr, propose } from "./shared";
import type { Agent } from "./types";

const KNOWN_PATTERNS: Record<string, string> = {
  viral: "viral demand spike velocity SOP ration price replenish decay",
  courier_failure: "courier service failure delay ratio SLA de-weight re-route",
  supplier_slip: "supplier delivery slip delay notice expedite bridging PO",
  stockout: "imminent stockout response protect constrained zone rebalance replenish",
};

export const riskAgent: Agent<{ s: AppState }> = {
  id: "risk",
  name: "Risk",
  envelope: ENVELOPES.risk,
  perceive: (s) => ({ s }),
  decide: ({ s }) => {
    const tick = s.clock.tick;
    const cat = catalogIndex(s);
    const out: Proposal[] = [];
    const cooled = (k: string) => (s.cooldowns[k] ?? 0) > tick;

    // --- courier SLA anomaly (delivered + overdue in-transit shipments, last 48h)
    const stats = new Map<string, { sum: number; n: number }>();
    for (const sh of s.shipments) {
      const c = COURIER_BY_ID[sh.courierId];
      const sla = c.slaDays[sh.zone];
      let ratio: number | null = null;
      if (sh.outcome === "delivered" && tick - sh.resolveTick <= 48) ratio = (sh.resolveTick - sh.shippedTick) / 24 / sla;
      else if (sh.outcome === "in_transit" && tick > sh.etaTick) ratio = (tick - sh.shippedTick) / 24 / sla;
      if (ratio === null) continue;
      const st = stats.get(sh.courierId) ?? { sum: 0, n: 0 };
      st.sum += ratio;
      st.n += 1;
      stats.set(sh.courierId, st);
    }
    for (const c of s.couriers) {
      const st = stats.get(c.id);
      const mean = st ? st.sum / st.n : 1;
      const an = courierAnomaly(c.id, mean, st?.n ?? 0);
      const key = `courier:${c.id}`;
      if (an.severity !== "none" && c.weight >= 1 && !cooled(key)) {
        out.push(
          propose("risk", { type: "ADJUST_COURIER_WEIGHT", courierId: c.id, weight: 0.4, reason: `delay ratio ${mean.toFixed(2)}× SLA` }, {
            reasoning: `${c.name}: mean delay ratio ${mean.toFixed(2)}× SLA over ${st?.n} shipments (z ${an.z.toFixed(1)}, isolation-forest bound ${an.bound.toFixed(2)}×). Playbook: de-weight, don't switch off — new shipments shift to alternates within the premium ceiling.`,
            confidence: 0.82,
            citations: retrieve(KNOWN_PATTERNS.courier_failure, { k: 2, sourcePrefix: "sop-courier" }),
            meta: { courierId: c.id, pattern: "courier_failure" },
          }),
        );
      } else if (an.severity === "none" && c.weight < 1 && c.slaHealth <= 1.05 && !cooled(key)) {
        out.push(
          propose("risk", { type: "ADJUST_COURIER_WEIGHT", courierId: c.id, weight: 1, reason: "performance normalised" }, {
            reasoning: `${c.name} delay ratio back to ${mean.toFixed(2)}× SLA. Restore neutral routing weight (SOP step 5).`,
            confidence: 0.8,
            citations: retrieve(KNOWN_PATTERNS.courier_failure, { k: 1, sourcePrefix: "sop-courier" }),
            meta: { courierId: c.id, pattern: "courier_failure" },
          }),
        );
      }
    }

    // --- viral + stockout patterns
    for (const p of s.catalog) {
      const mult = s.forecasts[p.sku]?.velocityMult ?? 1;
      if (mult >= 3 && !cooled(`alert:viral:${p.sku}`)) {
        out.push(
          propose("risk", { type: "RAISE_ALERT", severity: "critical", pattern: "viral", detail: `${p.name} at ${mult.toFixed(1)}× baseline velocity` }, {
            reasoning: `Viral pattern on ${p.name}: ${mult.toFixed(1)}× baseline outside any sale event. Matched playbook: ration with ≤15% price, redistribute, replenish against the decay curve, escalate POs above ceiling.`,
            confidence: 0.88,
            citations: retrieve(KNOWN_PATTERNS.viral, { k: 2, sourcePrefix: "sop-viral" }).concat(retrieve("viral spike serum stockout over-order decay half-life", { k: 1, sourcePrefix: "pm-" })),
            meta: { sku: p.sku, pattern: "viral", cooldown: `alert:viral:${p.sku}` },
          }),
        );
      }
      const daily = dailyDemand(s, p.sku);
      if (daily >= 1 && coverDays(s, p) < 3 && inbound(s, p.sku) === 0 && !cooled(`alert:stockout:${p.sku}`)) {
        out.push(
          propose("risk", { type: "RAISE_ALERT", severity: "warn", pattern: "stockout", detail: `${p.name}: ${coverDays(s, p).toFixed(1)} days network cover, nothing inbound` }, {
            reasoning: `${p.name} will stock out network-wide in ~${coverDays(s, p).toFixed(1)} days with no inbound PO or transfer.`,
            confidence: 0.8,
            citations: retrieve(KNOWN_PATTERNS.stockout, { k: 1, sourcePrefix: "sop-stockout" }),
            meta: { sku: p.sku, pattern: "stockout", cooldown: `alert:stockout:${p.sku}` },
          }),
        );
      }
    }

    // --- supplier slip, from structured intake of supplier emails
    for (const m of s.inbox) {
      if (m.kind !== "supplier_email" || !m.processed || !m.extracted || cooled(`slip:${m.id}`)) continue;
      const ex = m.extracted as { poRef?: string; delayDays?: number };
      const po = s.purchaseOrders.find((x) => x.id === ex.poRef && x.status === "open");
      if (!po || !ex.delayDays) continue;
      const an = supplierAnomaly(ex.delayDays);
      const p = cat[po.sku];
      const cover = coverDays(s, p);
      const daysToEta = (po.etaTick - tick) / 24;
      const citations = retrieve(KNOWN_PATTERNS.supplier_slip, { k: 2, sourcePrefix: "sop-supplier" });
      if (cover < daysToEta) {
        const cost = Math.round(po.value * 0.04);
        out.push(
          propose("risk", { type: "EXPEDITE_PO", poId: po.id, cost, daysSaved: Math.min(ex.delayDays, 5) }, {
            reasoning: `${po.id} slipped ${ex.delayDays} days (z ${an.z.toFixed(1)} vs supplier lead-time history). ${p.name} has ${cover.toFixed(1)} days cover but the PO now lands in ${daysToEta.toFixed(0)} days. Expedite at ${inr(cost)} to recover up to 5 days.`,
            confidence: 0.74,
            costImpact: cost,
            citations,
            meta: { pattern: "supplier_slip", cooldown: `slip:${m.id}`, messageId: m.id },
          }),
        );
      } else {
        out.push(
          propose("risk", { type: "RAISE_ALERT", severity: an.severity === "none" ? "info" : "warn", pattern: "supplier_slip", detail: `${po.id} delayed ${ex.delayDays}d; cover ${cover.toFixed(0)}d is sufficient` }, {
            reasoning: `${po.id} slipped ${ex.delayDays} days; ${p.name} cover (${cover.toFixed(0)}d) outlasts the new ETA (${daysToEta.toFixed(0)}d). Monitor; apply 1%/day delay credit.`,
            confidence: 0.8,
            citations,
            meta: { pattern: "supplier_slip", cooldown: `slip:${m.id}`, messageId: m.id },
          }),
        );
      }
    }

    // --- novel pattern: order concentration from one pincode (no playbook exists)
    const recent = s.orders.filter((o) => tick - o.tick < 6);
    if (recent.length >= 30) {
      const counts = new Map<string, number>();
      for (const o of recent) counts.set(o.pincode, (counts.get(o.pincode) ?? 0) + 1);
      const [pin, n] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
      if (n >= 12 && n / recent.length >= 0.2 && !cooled(`novel:pin:${pin}`)) {
        const citations = retrieve(`abnormal order concentration single pincode ${pin} many orders few hours`, { k: 2, minScore: 0.3 });
        out.push(
          propose("risk", { type: "RAISE_ALERT", severity: "warn", pattern: "novel:pincode_concentration", detail: `${n} of ${recent.length} orders in 6h from pincode ${pin}` }, {
            reasoning: `${n} of the last ${recent.length} orders (${((n / recent.length) * 100).toFixed(0)}%) came from pincode ${pin} in 6 hours. No playbook matches this pattern above the similarity threshold — routed for LLM reasoning and human review rather than acted on.`,
            confidence: 0.5,
            citations,
            meta: { pattern: "novel", novel: citations.length === 0, pincode: pin, count: n, window: recent.length, cooldown: `novel:pin:${pin}` },
          }),
        );
      }
    }
    void ENVELOPES;
    return out;
  },
};
