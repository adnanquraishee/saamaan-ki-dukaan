// Return-adjusted newsvendor. Deterministic arithmetic — never delegated to the LLM.

export function inverseNormal(p: number) {
  // Acklam's rational approximation
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

export interface NewsvendorInput {
  dailyMean: number;
  dailySigma: number;
  leadDays: number;
  reviewDays: number;
  price: number;
  unitCost: number;
  holdingPerUnitDay: number;
  returnRate: number;
  restockFraction: number;
  coverDaysAfterReorder: number;
}

export function newsvendor(x: NewsvendorInput) {
  const exposure = x.leadDays + x.reviewDays;
  // Underage: lost contribution + goodwill. Overage: holding over the exposure window + 1.5%/month obsolescence.
  const cu = Math.max(1, x.price - x.unitCost) * 1.25;
  const co = x.holdingPerUnitDay * exposure + x.unitCost * 0.015 * (exposure / 30) + x.unitCost * 0.02;
  const criticalRatio = Math.min(0.99, Math.max(0.85, cu / (cu + co)));
  const z = inverseNormal(criticalRatio);
  // Restockable returns within the window flow back into sellable stock, so net demand is lower.
  const returnAdj = 1 - x.returnRate * x.restockFraction * Math.min(1, Math.max(0, (exposure - 7) / 14));
  const lead = x.dailyMean * exposure * returnAdj;
  const safetyStock = z * x.dailySigma * Math.sqrt(exposure);
  const reorderPoint = lead + safetyStock;
  const orderUpTo = reorderPoint + x.dailyMean * returnAdj * x.coverDaysAfterReorder;
  return {
    criticalRatio: +criticalRatio.toFixed(3),
    z: +z.toFixed(2),
    returnAdj: +returnAdj.toFixed(3),
    safetyStock: Math.ceil(safetyStock),
    reorderPoint: Math.ceil(reorderPoint),
    orderUpTo: Math.ceil(orderUpTo),
  };
}
