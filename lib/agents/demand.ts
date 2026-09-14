import { ENVELOPES } from "@/lib/config/envelopes";
import { simTime } from "@/lib/engine/calendar";
import { velocityAnomaly } from "@/lib/ml/anomaly";
import { festivalOn, forecastNext, hourShare, regionalSplit } from "@/lib/ml/forecast";
import type { AppState } from "@/lib/store/state";
import type { ForecastEntry, Proposal } from "@/lib/types";
import { propose } from "./shared";
import type { Agent } from "./types";

const WINDOW = 6;

export const demandAgent: Agent<{ s: AppState }> = {
  id: "demand",
  name: "Demand",
  envelope: ENVELOPES.demand,
  perceive: (s) => ({ s }),
  decide: ({ s }) => {
    const tick = s.clock.tick;
    const t = simTime(tick);
    const full = tick % 6 === 0 || Object.keys(s.forecasts).length === 0;
    const out: Proposal[] = [];
    const next: Record<string, ForecastEntry> = {};
    let changed = full;
    let expectedWindowShare = 0;
    for (let h = 0; h < WINDOW; h++) expectedWindowShare += hourShare((t.hour - h + 24) % 24);
    // planned sale events carry a known uplift; a surge inside the plan is not an anomaly
    const event = festivalOn(t.dateIso);

    for (const p of s.catalog) {
      const prev = s.forecasts[p.sku];
      let daily = prev?.daily ?? 0;
      let sigma = prev?.sigma ?? 0;
      if (full || !prev) {
        const f = forecastNext(s.skuDaily[p.sku], { dow: t.dow, dateIso: t.dateIso, priceRatio: p.currentPrice / p.price30dMean, category: p.category });
        daily = f.mean;
        sigma = f.sigma;
      }
      const v = s.velocity[p.sku] ?? [];
      const observed = v.slice(-WINDOW).reduce((a, b) => a + b, 0);
      const planned = event ? Math.max(1, event.lift[p.category] ?? event.lift.all ?? 1) : 1;
      const expected = Math.max(0.05, Math.max(daily, (s.skuDaily[p.sku].slice(-28).reduce((a, b) => a + b, 0) / 28) * planned) * expectedWindowShare);
      const an = velocityAnomaly(observed, expected);
      const flagged = an.severity !== "none" && observed >= 12 && an.z >= 4;
      let mult = prev?.velocityMult ?? 1;
      if (flagged) mult = Math.min(15, Math.max(mult, an.ratio));
      else if (mult > 1) mult = Math.max(1, 0.85 * mult + 0.15 * Math.max(1, an.ratio));
      if (mult < 1.15) mult = 1;
      if (Math.abs(mult - (prev?.velocityMult ?? 1)) > 0.05) changed = true;
      next[p.sku] = { daily: +daily.toFixed(3), sigma: +sigma.toFixed(3), byRegion: regionalSplit(p, daily), velocityMult: +mult.toFixed(2), updatedTick: full ? tick : prev?.updatedTick ?? tick };

      if (flagged && (prev?.velocityMult ?? 1) < 2.5) {
        out.push(
          propose("demand", { type: "FLAG_DEMAND_SIGNAL", sku: p.sku, multiplier: +an.ratio.toFixed(1), z: +an.z.toFixed(1) }, {
            reasoning: `${p.name}: ${observed} units in the last ${WINDOW}h against ${expected.toFixed(1)} expected from the ridge forecast (${daily.toFixed(1)}/day × hour-of-day curve). Velocity ratio ${an.ratio.toFixed(1)}× exceeds the isolation-forest inlier bound (${an.bound.toFixed(2)}×); Poisson z = ${an.z.toFixed(1)}. Downstream planners now use ${mult.toFixed(1)}× demand.`,
            confidence: Math.min(0.97, 0.6 + an.z / 40),
            serviceImpact: observed - expected,
            meta: { sku: p.sku, observed, expected, ratio: an.ratio },
          }),
        );
      }
    }
    if (changed) {
      out.unshift(
        propose("demand", { type: "UPDATE_FORECAST", forecasts: next }, {
          reasoning: full ? `Re-forecast ${s.catalog.length} SKUs (ridge, 19 features: lags 1/7/14/28, rolling mean/std, day-of-week, festival × category, price ratio).` : "Velocity multipliers updated from the live order stream.",
          confidence: 0.75,
          meta: { full },
        }),
      );
    }
    return out;
  },
};
