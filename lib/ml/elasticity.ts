import { MODELS } from "./models";

/** Fitted log-log slope for a category/price-band cluster, clamped to a sane range. */
export function elasticityFor(cluster: string) {
  const e = MODELS.elasticity[cluster]?.slope ?? -1.2;
  return Math.max(-3, Math.min(-0.3, e));
}

export function demandMultiplier(cluster: string, newPrice: number, refPrice: number) {
  return Math.pow(newPrice / refPrice, elasticityFor(cluster));
}
