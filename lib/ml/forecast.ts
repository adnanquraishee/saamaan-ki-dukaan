import { CALENDAR, HOME_WAREHOUSE, REGIONS } from "@/lib/config/network";
import type { Category, Product, Region, WarehouseId } from "@/lib/types";
import { MODELS } from "./models";

const F = MODELS.forecast;
const idx = Object.fromEntries(F.features.map((f, i) => [f, i]));

export interface DayContext {
  dow: number; // 0 = Sunday
  dateIso: string;
  priceRatio: number; // current price / 30-day mean
  category: Category;
}

function mean(a: number[]) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}
function std(a: number[]) {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1));
}

export function festivalOn(dateIso: string) {
  return CALENDAR.find((e) => dateIso >= e.start && dateIso <= e.end) ?? null;
}

/** One-step daily forecast. `series` ends with the most recent complete day. */
export function forecastNext(series: number[], ctx: DayContext) {
  const n = series.length;
  const at = (lag: number) => series[n - lag] ?? mean(series.slice(-28));
  const last28 = series.slice(-28);
  const scale = mean(last28) + 0.5;
  const x = new Array(F.features.length).fill(0);
  x[idx.lag1] = at(1) / scale;
  x[idx.lag7] = at(7) / scale;
  x[idx.lag14] = at(14) / scale;
  x[idx.lag28] = at(28) / scale;
  x[idx.roll7] = mean(series.slice(-7)) / scale;
  x[idx.roll7std] = std(series.slice(-7)) / scale;
  if (ctx.dow >= 1) x[idx[`dow_${ctx.dow}`]] = 1;
  const fest = festivalOn(ctx.dateIso);
  if (fest) {
    x[idx.festival] = 1;
    x[idx.promo] = 1;
    x[idx[`fest_${ctx.category}`]] = 1;
  }
  x[idx.log_price_ratio] = Math.log(Math.max(0.2, ctx.priceRatio));
  let y = F.intercept;
  for (let i = 0; i < x.length; i++) y += F.coef[i] * x[i];
  const mu = Math.max(0, y * scale);
  return { mean: mu, sigma: sigmaFor(mu) };
}

export function sigmaFor(mu: number) {
  return F.sigma.a * Math.pow(Math.max(0.3, mu), F.sigma.b);
}

/** Recursive multi-day forecast; returns per-day means and horizon sigma (independent errors). */
export function forecastHorizon(series: number[], startDateIso: string, horizon: number, ctx: Omit<DayContext, "dow" | "dateIso">) {
  const s = series.slice();
  const daily: number[] = [];
  let var_ = 0;
  const start = new Date(`${startDateIso}T00:00:00Z`);
  for (let h = 0; h < horizon; h++) {
    const d = new Date(start.getTime() + h * 86400000);
    const f = forecastNext(s, { ...ctx, dow: d.getUTCDay(), dateIso: d.toISOString().slice(0, 10) });
    daily.push(f.mean);
    var_ += f.sigma ** 2;
    s.push(f.mean);
  }
  return { daily, total: daily.reduce((a, b) => a + b, 0), sigma: Math.sqrt(var_) };
}

export function regionalSplit(p: Product, daily: number): Record<Region, number> {
  return Object.fromEntries(REGIONS.map((r) => [r, daily * p.regionShare[r]])) as Record<Region, number>;
}

export function warehouseShare(p: Product, wh: WarehouseId) {
  return REGIONS.reduce((s, r) => s + (HOME_WAREHOUSE[r] === wh ? p.regionShare[r] : 0), 0);
}

/** forecast(sku, warehouse, horizon) — daily units expected to be served by a warehouse. */
export function forecastForWarehouse(p: Product, series: number[], wh: WarehouseId, startDateIso: string, horizon: number) {
  const f = forecastHorizon(series, startDateIso, horizon, { priceRatio: p.currentPrice / p.price30dMean, category: p.category });
  const share = warehouseShare(p, wh);
  return { total: f.total * share, sigma: f.sigma * Math.sqrt(share), daily: f.daily.map((d) => d * share) };
}

export function hourShare(hour: number) {
  const c = F.hourCurve;
  const total = c.reduce((a, b) => a + b, 0) || 1;
  return (c[hour] ?? 1 / 24) / total;
}
