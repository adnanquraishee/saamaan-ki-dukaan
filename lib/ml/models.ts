import raw from "@/data/models.json";

export interface ModelsExport {
  version: number;
  forecast: {
    features: string[];
    coef: number[];
    intercept: number;
    sigma: { a: number; b: number };
    relErrorQuantiles: Record<string, number>;
    hourCurve: number[];
    holdoutDays: number;
    metrics: Record<string, Record<string, number>>;
  };
  elasticity: Record<string, { slope: number; intercept: number; n: number; trueMean: number }>;
  rto: {
    features: string[];
    weights: Record<string, number>;
    intercept: number;
    logValueRef: number;
    reference: string;
    metrics: Record<string, number>;
  };
  anomaly: {
    velocityRatio: AnomalyStats;
    courierSlaRatio: Record<string, AnomalyStats>;
    supplierLeadDeviation: AnomalyStats;
    zScore: { warn: number; critical: number };
  };
}
export interface AnomalyStats {
  mean: number;
  std: number;
  p95: number;
  p99: number;
  p999: number;
  isolationForest: { low: number; high: number } | null;
}

export const MODELS = raw as unknown as ModelsExport;
