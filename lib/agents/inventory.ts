import { ENVELOPES } from "@/lib/config/envelopes";
import { CATEGORY_VOLUME_FACTOR, REGION_LABEL, SUPPLIER_BY_ID, WAREHOUSE_BY_ID, WAREHOUSE_IDS } from "@/lib/config/network";
import { RESTOCK_FRACTION } from "@/lib/engine/economics";
import { sigmaFor, warehouseShare } from "@/lib/ml/forecast";
import { newsvendor } from "@/lib/ml/safetyStock";
import type { AppState } from "@/lib/store/state";
import type { Product, Proposal } from "@/lib/types";
import { coverDays, dailyDemand, inbound, onHand, propose, regionsServedBy } from "./shared";
import type { Agent } from "./types";

export const inventoryAgent: Agent<{ s: AppState; skus: Product[] }> = {
  id: "inventory",
  name: "Inventory",
  envelope: ENVELOPES.inventory,
  perceive: (s) => {
    const tick = s.clock.tick;
    const set = new Map<string, Product>();
    for (let i = 0; i < 20; i++) {
      const p = s.catalog[(tick * 20 + i) % s.catalog.length];
      set.set(p.sku, p);
    }
    for (const p of s.catalog) {
      if ((s.forecasts[p.sku]?.velocityMult ?? 1) >= 2 || s.scenario.sku === p.sku) set.set(p.sku, p);
    }
    return { s, skus: Array.from(set.values()) };
  },
  decide: ({ s, skus }) => {
    const tick = s.clock.tick;
    const out: Proposal[] = [];
    for (const p of skus) {
      const network = dailyDemand(s, p.sku);
      const mult = s.forecasts[p.sku]?.velocityMult ?? 1;
      const lead = Math.min(...p.supplierIds.map((id) => (SUPPLIER_BY_ID[id].leadDaysMin + SUPPLIER_BY_ID[id].leadDaysMax) / 2 + (s.suppliers.find((x) => x.id === id)?.leadDrift ?? 0)));
      const covers = Object.fromEntries(WAREHOUSE_IDS.map((w) => [w, coverDays(s, p, w)]));
      // Inventory owns WHEN and HOW MUCH at network level; Placement owns WHERE (transfers rebalance nodes).
      const network_ = { rop: 0, upTo: 0, worstDeficit: -Infinity, wh: WAREHOUSE_IDS[0] as (typeof WAREHOUSE_IDS)[number] };
      for (const wh of WAREHOUSE_IDS) {
        const share = warehouseShare(p, wh);
        const daily = network * share;
        if (daily < 0.05) continue;
        const nv = newsvendor({
          dailyMean: daily,
          dailySigma: sigmaFor(network / Math.max(1, mult)) * Math.sqrt(share) * mult,
          leadDays: lead,
          reviewDays: 1,
          price: p.currentPrice,
          unitCost: p.cost,
          holdingPerUnitDay: WAREHOUSE_BY_ID[wh].holdingCostPerUnitDay * CATEGORY_VOLUME_FACTOR[p.category],
          returnRate: p.returnRate,
          restockFraction: RESTOCK_FRACTION[p.category],
          coverDaysAfterReorder: 14,
        });
        const key = `${p.sku}|${wh}`;
        const prev = s.policies[key];
        if (!prev || Math.abs(prev.reorderPoint - nv.reorderPoint) / Math.max(1, prev.reorderPoint) > 0.1) {
          out.push(
            propose("inventory", { type: "SET_REORDER_POLICY", sku: p.sku, warehouseId: wh, reorderPoint: nv.reorderPoint, orderUpTo: nv.orderUpTo, safetyStock: nv.safetyStock }, {
              reasoning: `Newsvendor at ${wh}: critical ratio ${nv.criticalRatio} → z ${nv.z}; lead ${lead.toFixed(0)}d + 1d review; return-adjusted demand ×${nv.returnAdj}. ROP ${nv.reorderPoint}, SS ${nv.safetyStock}, order-up-to ${nv.orderUpTo}.`,
              confidence: 0.8,
              meta: { quiet: true },
            }),
          );
        }
        network_.rop += nv.reorderPoint;
        network_.upTo += nv.orderUpTo;
        const deficit = nv.orderUpTo - onHand(s, p.sku, wh) - inbound(s, p.sku, wh);
        if (deficit > network_.worstDeficit) {
          network_.worstDeficit = deficit;
          network_.wh = wh;
        }
        // Protect constrained zones from promotions (SOP stockout, step 1)
        const surplusElsewhere = WAREHOUSE_IDS.some((w) => w !== wh && covers[w] > 30);
        if (covers[wh] < 12 && daily >= 0.4 && surplusElsewhere) {
          for (const zone of regionsServedBy(wh)) {
            const hk = `${p.sku}|${zone}`;
            if (s.holds[hk]) continue;
            out.push(
              propose("inventory", { type: "HOLD_PRICE", sku: p.sku, zone, untilTick: tick + 72, reason: `${covers[wh].toFixed(1)} days cover at ${wh}` }, {
                reasoning: `Imminent stockout in ${REGION_LABEL[zone]}: ${WAREHOUSE_BY_ID[wh].name} holds ${onHand(s, p.sku, wh)} units = ${covers[wh].toFixed(1)} days of cover. A discount here would pull demand forward into a node that cannot serve it. Hold price in ${REGION_LABEL[zone]} for 72h.`,
                confidence: 0.86,
                serviceImpact: daily * 3,
                resources: [{ kind: "price", key: `${p.sku}|${zone}`, direction: "hold" }],
                meta: { sku: p.sku, zone, wh, cover: covers[wh] },
              }),
            );
          }
        }
      }
      const position = onHand(s, p.sku) + inbound(s, p.sku);
      const needKey = `${p.sku}|${network_.wh}`;
      if (network_.rop > 0 && position < network_.rop && !Object.keys(s.needs).some((k) => k.startsWith(`${p.sku}|`))) {
        const qty = Math.max(1, Math.ceil(network_.upTo - position));
        const urgent = coverDays(s, p) < lead;
        out.push(
          propose("inventory", { type: "REPLENISH_NEED", sku: p.sku, warehouseId: network_.wh, qty, urgency: urgent ? "urgent" : "normal" }, {
            reasoning: `${p.name}: network position ${position} (on hand ${onHand(s, p.sku)} + inbound ${inbound(s, p.sku)}) is below the summed reorder point ${Math.round(network_.rop)}. Need ${qty} units to reach order-up-to ${Math.round(network_.upTo)}, receiving at ${network_.wh} (largest deficit)${urgent ? `; network cover ${coverDays(s, p).toFixed(1)}d is shorter than lead time ${lead.toFixed(0)}d — urgent` : ""}.`,
            confidence: 0.85,
            serviceImpact: qty / Math.max(0.1, network),
            meta: { sku: p.sku, wh: network_.wh, key: needKey },
          }),
        );
      }
      const netCover = coverDays(s, p);
      if (netCover > (ENVELOPES.inventory.maxCoverDays ?? 90) && !p.deadStock) {
        out.push(
          propose("inventory", { type: "MARK_DEAD_STOCK", sku: p.sku, coverDays: Math.round(netCover) }, {
            reasoning: `${Math.round(netCover)} days of network cover exceeds the ${ENVELOPES.inventory.maxCoverDays}-day bound. Flag as dead stock: stop replenishment, eligible for clearance.`,
            confidence: 0.9,
          }),
        );
      }
    }
    return out;
  },
};
