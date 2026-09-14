import { ENVELOPES } from "@/lib/config/envelopes";
import { CATEGORY_VOLUME_FACTOR, WAREHOUSE_BY_ID } from "@/lib/config/network";
import { retrieve } from "@/lib/rag/retrieve";
import type { AppState } from "@/lib/store/state";
import type { Product, Proposal, Supplier, WarehouseId } from "@/lib/types";
import { catalogIndex, dailyDemand, inr, propose, unitEconomics } from "./shared";
import type { Agent } from "./types";

function breakDiscount(s: Supplier, qty: number) {
  return s.priceBreaks.filter((b) => qty >= b.qty).reduce((m, b) => Math.max(m, b.discountPct), 0) / 100;
}

interface Need { sku: string; qty: number; urgent: boolean; wh: WarehouseId }

export const procurementAgent: Agent<{ s: AppState; needs: Need[] }> = {
  id: "procurement",
  name: "Procurement",
  envelope: ENVELOPES.procurement,
  perceive: (s) => {
    const bySku = new Map<string, Need & { whQty: number }>();
    for (const n of Object.values(s.needs)) {
      const cur = bySku.get(n.sku);
      if (!cur) bySku.set(n.sku, { sku: n.sku, qty: n.qty, urgent: n.urgency === "urgent", wh: n.warehouseId, whQty: n.qty });
      else {
        cur.qty += n.qty;
        cur.urgent ||= n.urgency === "urgent";
        if (n.qty > cur.whQty) {
          cur.wh = n.warehouseId;
          cur.whQty = n.qty;
        }
      }
    }
    return { s, needs: Array.from(bySku.values()) };
  },
  decide: ({ s, needs }) => {
    const tick = s.clock.tick;
    const cat = catalogIndex(s);
    const out: Proposal[] = [];
    for (const need of needs) {
      const p: Product = cat[need.sku];
      if (!p || p.deadStock) continue;
      if ((s.cooldowns[`po:${p.sku}`] ?? 0) > tick) continue;
      if (s.purchaseOrders.some((po) => po.sku === p.sku && po.status === "open" && tick - po.placedTick < 24)) continue;
      const daily = dailyDemand(s, p.sku);
      const margin = Math.max(1, unitEconomics(p, p.currentPrice).contribution);
      const scored = p.supplierIds
        .map((id) => s.suppliers.find((x) => x.id === id)!)
        .map((sup) => {
          const qty = Math.max(need.qty, sup.moq);
          const lead = (sup.leadDaysMin + sup.leadDaysMax) / 2 + sup.leadDrift;
          const unit = p.cost * (1 - breakDiscount(sup, qty)) * (sup.domestic ? 1 : 1.12);
          const leadPenalty = need.urgent ? lead * daily * margin * 0.35 : lead * daily * p.cost * 0.01;
          const reliabilityPenalty = (1 - sup.reliability) * qty * p.cost * 0.1;
          return { sup, qty, lead, unit, total: unit * qty + leadPenalty + reliabilityPenalty };
        })
        .sort((a, b) => a.total - b.total);
      const best = scored[0];
      if (!best) continue;
      const sup = best.sup;
      // price-break analysis: stretch to the next break if the discount beats the carrying cost
      let qty = best.qty;
      let rationale = `need ${need.qty} → MOQ-adjusted ${qty}`;
      const holding = WAREHOUSE_BY_ID[need.wh].holdingCostPerUnitDay * CATEGORY_VOLUME_FACTOR[p.category];
      for (const b of sup.priceBreaks) {
        if (b.qty <= qty) continue;
        const extra = b.qty - qty;
        const daysToSell = b.qty / Math.max(0.1, daily);
        if (daysToSell > 120) continue;
        const carrying = extra * holding * (daysToSell / 2) + extra * p.cost * 0.015 * (daysToSell / 30);
        const savings = b.qty * p.cost * (breakDiscount(sup, b.qty) - breakDiscount(sup, qty));
        // optional stretch stays inside the PO ceiling unless demand is running hot (then Finance arbitrates)
        const hot = (s.forecasts[p.sku]?.velocityMult ?? 1) >= 2;
        if (!hot && b.qty * p.cost * (1 - breakDiscount(sup, b.qty)) > (ENVELOPES.procurement.poValueCeiling ?? 0)) continue;
        if (savings > carrying) {
          rationale = `price break: ${b.qty} units at −${b.discountPct}% saves ${inr(savings)} vs ${inr(carrying)} carrying cost (sells through in ~${daysToSell.toFixed(0)} days at ${daily.toFixed(0)}/day)`;
          qty = b.qty;
        }
      }
      const unitCost = Math.round(p.cost * (1 - breakDiscount(sup, qty)) * (sup.domestic ? 1 : 1.12));
      const value = unitCost * qty;
      const citations = retrieve(`${sup.name} minimum order quantity price breaks payment terms lead time`, { k: 2, sourcePrefix: "supplier-" });
      out.push(
        propose("procurement", { type: "CREATE_PO", supplierId: sup.id, sku: p.sku, qty, unitCost, warehouseId: need.wh, leadDays: Math.round(best.lead) }, {
          reasoning: `${p.name}: ${sup.name} scores best (landed ${inr(best.unit)}/unit, lead ${best.lead.toFixed(0)}d, reliability ${(sup.reliability * 100).toFixed(0)}%) among ${scored.length} whitelisted suppliers. ${rationale}. PO value ${inr(value)}; payment ${sup.paymentTermsDays === 0 ? "in advance" : `net ${sup.paymentTermsDays}`}.`,
          confidence: 0.8,
          costImpact: value,
          serviceImpact: qty / Math.max(0.1, daily),
          citations,
          resources: [{ kind: "cash", key: "cash", amount: value }, { kind: "capacity", key: need.wh, amount: qty }],
          meta: { sku: p.sku, needQty: Math.max(need.qty, sup.moq), unitCostAtNeed: Math.round(p.cost * (1 - breakDiscount(sup, Math.max(need.qty, sup.moq))) * (sup.domestic ? 1 : 1.12)), urgent: need.urgent, value, paymentTermsDays: sup.paymentTermsDays },
        }),
      );
    }
    return out;
  },
};
