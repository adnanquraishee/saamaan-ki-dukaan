import { ENVELOPES } from "@/lib/config/envelopes";
import { CATEGORY_VOLUME_FACTOR, COURIER_BY_ID, HOME_WAREHOUSE, WAREHOUSE_BY_ID, WAREHOUSE_IDS, rateZone } from "@/lib/config/network";
import { chargeableSlabs } from "@/lib/engine/economics";

const KAVERI = COURIER_BY_ID["CR-KAVERI"];
import type { AppState } from "@/lib/store/state";
import type { Product, Proposal, WarehouseId } from "@/lib/types";
import { dailyDemand, inbound, inr, onHand, propose, unitEconomics, warehouseDaily } from "./shared";
import type { Agent } from "./types";

export const placementAgent: Agent<{ s: AppState; skus: Product[] }> = {
  id: "placement",
  name: "Placement",
  envelope: ENVELOPES.placement,
  perceive: (s) => {
    const tick = s.clock.tick;
    if (tick % 3 !== 0) return { s, skus: s.catalog.filter((p) => (s.forecasts[p.sku]?.velocityMult ?? 1) >= 2.5 || s.scenario.sku === p.sku) };
    const set = new Map<string, Product>();
    for (let i = 0; i < 40; i++) {
      const p = s.catalog[((tick / 3) * 40 + i) % s.catalog.length];
      set.set(p.sku, p);
    }
    for (const p of s.catalog) if ((s.forecasts[p.sku]?.velocityMult ?? 1) >= 2.5 || s.scenario.sku === p.sku) set.set(p.sku, p);
    return { s, skus: Array.from(set.values()) };
  },
  decide: ({ s, skus }) => {
    const out: Proposal[] = [];
    for (const p of skus) {
      if (s.transfers.some((t) => t.sku === p.sku)) continue;
      const hotSku = (s.forecasts[p.sku]?.velocityMult ?? 1) >= 2.5;
      // For hot SKUs use observed order geography (last 12h) — a spike rarely keeps the historical regional mix.
      const observed: Record<WarehouseId, number> = { "WH-BHW": 1, "WH-GGN": 1, "WH-BLR": 1 };
      if (hotSku) {
        for (const o of s.orders) {
          if (s.clock.tick - o.tick > 12) continue;
          for (const l of o.lines) if (l.sku === p.sku) observed[HOME_WAREHOUSE[o.region]] += l.qty;
        }
      }
      const obsTotal = observed["WH-BHW"] + observed["WH-GGN"] + observed["WH-BLR"];
      const cov = Object.fromEntries(
        WAREHOUSE_IDS.map((w) => {
          const daily = hotSku ? dailyDemand(s, p.sku) * (observed[w] / obsTotal) : warehouseDaily(s, p, w);
          return [w, { cover: onHand(s, p.sku, w) / Math.max(0.05, daily), daily }];
        }),
      ) as Record<WarehouseId, { cover: number; daily: number }>;
      const dst = WAREHOUSE_IDS.filter((w) => cov[w].daily >= 0.3).sort((a, b) => cov[a].cover - cov[b].cover)[0];
      const src = WAREHOUSE_IDS.slice().sort((a, b) => cov[b].cover - cov[a].cover)[0];
      if (!dst || !src || dst === src) continue;
      const hot = hotSku;
      let qty: number;
      if (hot) {
        // viral: rebalance cover towards the regions driving the spike (equalise days of cover)
        if (!(cov[src].cover > 2 * cov[dst].cover && cov[src].cover > 5)) continue;
        const a = onHand(s, p.sku, src);
        const b = onHand(s, p.sku, dst) + inbound(s, p.sku, dst);
        qty = Math.floor((a * cov[dst].daily - b * cov[src].daily) / (cov[src].daily + cov[dst].daily));
        qty = Math.min(qty, a - Math.ceil(3 * cov[src].daily));
      } else {
        if (cov[dst].cover >= 10 || cov[src].cover <= 30) continue;
        const give = onHand(s, p.sku, src) - Math.ceil(21 * cov[src].daily);
        const take = Math.ceil(21 * cov[dst].daily) - onHand(s, p.sku, dst) - inbound(s, p.sku, dst);
        qty = Math.floor(Math.min(give, take));
      }
      if (qty < 10) continue;
      const cost = Math.round(1500 + qty * 6 * CATEGORY_VOLUME_FACTOR[p.category]);
      // Without a transfer, the destination region is still served cross-zone from the source node.
      // The transfer's value is the rate-card difference between that cross-zone shipment and a home-zone one
      // (plus, for hot SKUs, the faster delivery promise on units that would otherwise wait for replenishment).
      const slabs = chargeableSlabs(p, 1);
      const rate = (z: "A" | "B" | "C") => KAVERI.rateCard[z].first500g + KAVERI.rateCard[z].addl500g * (slabs - 1);
      const crossZone = rateZone(WAREHOUSE_BY_ID[src].region, WAREHOUSE_BY_ID[dst].region) as "A" | "B" | "C";
      const zoneSaving = Math.max(0, rate(crossZone) - rate("A"));
      const shortUnits = Math.max(0, cov[dst].daily * 10 - onHand(s, p.sku, dst) - inbound(s, p.sku, dst));
      const benefit = qty * zoneSaving + (hot ? Math.min(qty, shortUnits) * Math.max(0, unitEconomics(p, p.currentPrice).contribution) * 0.3 : 0);
      if (benefit <= cost) continue;
      out.push(
        propose("placement", { type: "TRANSFER_STOCK", sku: p.sku, from: src, to: dst, qty, cost }, {
          reasoning: `${hot ? "Viral rebalance — " : ""}${p.name}: ${WAREHOUSE_BY_ID[dst].name} has ${cov[dst].cover.toFixed(1)} days of cover for its regional demand (${cov[dst].daily.toFixed(1)}/day) while ${WAREHOUSE_BY_ID[src].name} holds ${cov[src].cover.toFixed(0)} days. Move ${qty} units (${inr(cost)}) — ${hot ? "equalises days of cover across nodes" : "source keeps 21 days"}; saves ${inr(zoneSaving)}/unit vs ${crossZone === "A" ? "same-zone" : `zone-${crossZone}`} shipping${hot ? `, and puts ${Math.round(Math.min(qty, shortUnits))} units where the spike is` : ""}.`,
          confidence: 0.78,
          costImpact: cost - benefit,
          serviceImpact: Math.min(qty, shortUnits),
          resources: [{ kind: "stock", key: `${p.sku}|${src}`, amount: qty }, { kind: "capacity", key: dst, amount: qty }],
          meta: { sku: p.sku, benefit: Math.round(benefit) },
        }),
      );
    }
    return out;
  },
};
