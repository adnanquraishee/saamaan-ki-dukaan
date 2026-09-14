import { MODELS } from "./models";

const A = MODELS.anomaly;

export type Severity = "none" | "warn" | "critical";

export function zScore(value: number, mean: number, std: number) {
  return std > 0 ? (value - mean) / std : 0;
}

/** Velocity: ratio of observed to expected units, with a Poisson z-score on the counts. */
export function velocityAnomaly(observed: number, expected: number) {
  const ratio = expected > 0 ? observed / expected : 0;
  const z = expected > 0 ? (observed - expected) / Math.sqrt(expected) : 0;
  const bound = A.velocityRatio.isolationForest?.high ?? A.velocityRatio.p99;
  let severity: Severity = "none";
  if (ratio > bound && z > A.zScore.warn) severity = ratio > A.velocityRatio.p999 * 1.5 && z > A.zScore.critical ? "critical" : "warn";
  return { ratio, z, bound, severity };
}

export function courierAnomaly(courierId: string, delayRatio: number, n: number) {
  const s = A.courierSlaRatio[courierId];
  if (!s || n < 8) return { z: 0, bound: 0, severity: "none" as Severity };
  const z = zScore(delayRatio, s.mean, s.std / Math.sqrt(n)); // z on the mean of n shipments
  const bound = s.isolationForest?.high ?? s.p99;
  let severity: Severity = "none";
  if (delayRatio > s.p95 && z > A.zScore.warn) severity = delayRatio > bound ? "critical" : "warn";
  return { z, bound, severity };
}

export function supplierAnomaly(deviationDays: number) {
  const s = A.supplierLeadDeviation;
  const z = zScore(deviationDays, s.mean, s.std);
  const bound = s.isolationForest?.high ?? s.p99;
  const severity: Severity = deviationDays > bound ? (z > A.zScore.critical ? "critical" : "warn") : "none";
  return { z, bound, severity };
}
