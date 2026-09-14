import { ENVELOPES } from "@/lib/config/envelopes";
import { REGIONS } from "@/lib/config/network";
import { extractCompetitorPrice } from "@/lib/security/intake";
import { elasticityFor } from "@/lib/ml/elasticity";
import type { AppState } from "@/lib/store/state";
import type { Product, Proposal, Region } from "@/lib/types";
import { coverDays, dailyDemand, floorPrice, inr, propose, unitEconomics } from "./shared";
import type { Agent } from "./types";

const round99 = (x: number) => Math.max(9, Math.round(x / 10) * 10 - 1);

function contributionPerDay(s: AppState, p: Product, price: number) {
  const q = dailyDemand(s, p.sku) * Math.pow(price / p.currentPrice, elasticityFor(p.cluster));
  return q * unitEconomics(p, price).contribution;
}

export const pricingAgent: Agent<{ s: AppState; candidates: Product[] }> = {
  id: "pricing",
  name: "Pricing",
  envelope: ENVELOPES.pricing,
  perceive: (s) => {
    const tick = s.clock.tick;
    const set = new Map<string, Product>();
    const n = s.catalog.length;
    for (let i = 0; i < 10; i++) {
      const p = s.catalog[(tick * 10 + i) % n];
      set.set(p.sku, p);
    }
    for (const p of s.catalog) {
      if ((s.forecasts[p.sku]?.velocityMult ?? 1) >= 2.5) set.set(p.sku, p);
      const q = s.market.competitor[p.sku];
      if (q && tick - q.tick <= 1) set.set(p.sku, p);
      if (s.scenario.sku === p.sku && s.scenario.id) set.set(p.sku, p);
    }
    return { s, candidates: Array.from(set.values()) };
  },
  decide: ({ s, candidates }) => {
    const tick = s.clock.tick;
    const out: Proposal[] = [];
    for (const p of candidates) {
      const key = `price:${p.sku}`;
      if ((s.cooldowns[key] ?? 0) > tick) continue;
      const since = tick - (s.lastPriceChange[p.sku] ?? -999);
      const mult = s.forecasts[p.sku]?.velocityMult ?? 1;
      const cover = coverDays(s, p);
      const econNow = unitEconomics(p, p.currentPrice);
      const mk = (price: number, reason: "ageing" | "viral" | "competitor" | "sell_through" | "restore", zones: Region[], reasoning: string, extra: Partial<Proposal> = {}) => {
        const delta = contributionPerDay(s, p, price) - contributionPerDay(s, p, p.currentPrice);
        out.push(
          propose("pricing", { type: "SET_PRICE", sku: p.sku, zones, price, prevPrice: p.currentPrice, reason }, {
            reasoning,
            confidence: 0.72,
            costImpact: -delta,
            serviceImpact: reason === "viral" ? cover * 0.1 : 0,
            resources: zones.map((z) => ({ kind: "price" as const, key: `${p.sku}|${z}`, direction: price < p.currentPrice ? ("down" as const) : ("up" as const) })),
            meta: { sku: p.sku, cover: +cover.toFixed(1), elasticity: elasticityFor(p.cluster) },
            ...extra,
          }),
        );
      };

      // 1. viral: ration gently while replenishment is in flight
      if (mult >= 2.5 && cover < 21 && p.currentPrice < p.basePrice * 1.1) {
        const price = Math.min(p.mrp, round99(p.basePrice * 1.12));
        mk(price, "viral", REGIONS, `Velocity ${mult.toFixed(1)}× baseline with only ${cover.toFixed(1)} days of network cover. Raise ${inr(p.currentPrice)} → ${inr(price)} (+12%, within the +15% envelope and below MRP ${inr(p.mrp)}) to slow depletion; elasticity ${elasticityFor(p.cluster).toFixed(2)} implies ~${((1 - Math.pow(1.12, elasticityFor(p.cluster))) * 100).toFixed(0)}% fewer units while stock is rebuilt.`);
        continue;
      }
      // 2. competitor signal (untrusted scraped page, parsed by the competitor intake extractor)
      const quote = s.market.competitor[p.sku];
      if (quote && tick - quote.tick <= 1) {
        const intake = extractCompetitorPrice(quote.page);
        if (intake.price && intake.price < p.currentPrice * 0.92 && cover > 12) {
          const hits = (quote as { hits?: unknown[] }).hits ?? [];
          mk(
            intake.price,
            "competitor",
            REGIONS,
            `Competitor listing parsed at ${inr(intake.price)} (${intake.source === "rrp_statement" ? "recommended-retail-price statement on page" : "price tag"}) vs our ${inr(p.currentPrice)}. Cover ${cover.toFixed(0)} days allows matching to defend conversion.`,
            { derivedFromUntrusted: true, tainted: hits.length > 0, meta: { sku: p.sku, competitorPrice: intake.price, intakeSource: intake.source, hits } },
          );
          continue;
        }
      }
      if (since < 48) continue;
      // 3. ageing stock: clear surplus with a national discount
      if (cover > 60 && mult < 1.5 && p.currentPrice >= p.basePrice * 0.97) {
        const disc = cover > 100 ? 0.2 : 0.12;
        // discretionary cuts are margin-aware; the guardrail floor is enforced independently of this check
        const price = Math.max(round99(p.basePrice * (1 - disc)), round99(floorPrice(p) + 10));
        if (price >= p.currentPrice * 0.97) continue;
        // economic test: extra contribution + holding cost released by faster sell-through must beat today
        const q0 = dailyDemand(s, p.sku);
        const q1 = q0 * Math.pow(price / p.currentPrice, elasticityFor(p.cluster));
        const holdingReleased = (q1 - q0) * 0.35 * Math.min(cover, 120);
        if (contributionPerDay(s, p, price) + holdingReleased <= contributionPerDay(s, p, p.currentPrice)) continue;
        mk(price, "ageing", REGIONS, `${cover.toFixed(0)} days of network cover (ageing). Discount ${((1 - price / p.basePrice) * 100).toFixed(0)}% nationally: ${inr(p.currentPrice)} → ${inr(price)}. Holding cost saved outweighs ${inr(econNow.contribution - unitEconomics(p, price).contribution)}/unit contribution given elasticity ${elasticityFor(p.cluster).toFixed(2)}.`);
        continue;
      }
      // 4. weak net sell-through (returns eat gross sales)
      if (p.sizingIssue && p.returnRate >= 0.3 && !s.sizeGuideFixed[p.sku] && p.currentPrice >= p.basePrice && since >= 72 && round99(p.basePrice * 0.9) >= floorPrice(p)) {
        const price = round99(p.basePrice * 0.9);
        mk(price, "sell_through", REGIONS, `Net sell-through after returns is ${((1 - p.returnRate) * 100).toFixed(0)}% of gross for ${p.name}. A 10% cut (${inr(p.currentPrice)} → ${inr(price)}) lifts gross volume ~${((Math.pow(0.9, elasticityFor(p.cluster)) - 1) * 100).toFixed(0)}% by elasticity.`);
        continue;
      }
      // 5. restore when the reason has passed
      const anyZoneOff = REGIONS.some((z) => p.zonePrice[z] !== p.basePrice);
      if (anyZoneOff && since >= 72 && mult < 1.5 && cover >= 15 && cover <= 55 && !(quote && tick - quote.tick <= 1)) {
        mk(p.basePrice, "restore", REGIONS, `Conditions behind the last change have cleared (cover ${cover.toFixed(0)} days, velocity ${mult.toFixed(1)}×). Restore list price ${inr(p.basePrice)}.`);
      }
    }
    return out;
  },
};
