import { ENVELOPES } from "@/lib/config/envelopes";
import { COURIER_BY_ID, HOME_WAREHOUSE, MARKETPLACES, REGIONS, SUPPLIER_BY_ID, WAREHOUSE_IDS } from "@/lib/config/network";
import { PACKAGING_COST, RESTOCK_FRACTION, chargeableSlabs } from "@/lib/engine/economics";
import { warehouseShare } from "@/lib/ml/forecast";
import type { AppState } from "@/lib/store/state";
import type { Action, AgentId, Citation, Product, Proposal, ProposerId, Region, ResourceClaim, WarehouseId } from "@/lib/types";

let pseq = 0;
export function propose(
  agentId: ProposerId,
  action: Action,
  o: { reasoning: string; confidence?: number; costImpact?: number; serviceImpact?: number; citations?: Citation[]; resources?: ResourceClaim[]; meta?: Record<string, unknown>; tainted?: boolean; derivedFromUntrusted?: boolean; llmText?: string },
): Proposal {
  pseq = (pseq + 1) % 1e9;
  return {
    id: `P${pseq}`,
    agentId,
    action,
    reasoning: o.reasoning,
    confidence: o.confidence ?? 0.8,
    costImpact: Math.round(o.costImpact ?? 0),
    serviceImpact: +(o.serviceImpact ?? 0).toFixed(2),
    citations: o.citations,
    resources: o.resources,
    meta: o.meta,
    tainted: o.tainted,
    derivedFromUntrusted: o.derivedFromUntrusted,
    llmText: o.llmText,
  };
}

/** Shared commercial score used to rank otherwise-valid proposals. Higher is better. */
export function businessScore(p: Proposal) {
  const service = p.serviceImpact * 10;
  const cost = p.costImpact / 1000;
  const confidence = p.confidence * 100;
  return +(confidence + service - cost).toFixed(2);
}

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

export function catalogIndex(s: AppState) {
  return Object.fromEntries(s.catalog.map((p) => [p.sku, p])) as Record<string, Product>;
}

/** Network daily demand the planners should use: model forecast × live velocity multiplier. */
export function dailyDemand(s: AppState, sku: string) {
  const f = s.forecasts[sku];
  if (f) return Math.max(0.05, f.daily * Math.max(1, f.velocityMult));
  const series = s.skuDaily[sku] ?? [];
  return Math.max(0.05, series.slice(-28).reduce((a, b) => a + b, 0) / 28);
}

export function warehouseDaily(s: AppState, p: Product, wh: WarehouseId) {
  return dailyDemand(s, p.sku) * warehouseShare(p, wh);
}

export function onHand(s: AppState, sku: string, wh?: WarehouseId) {
  const inv = s.inventory[sku];
  if (!inv) return 0;
  return wh ? inv[wh] : WAREHOUSE_IDS.reduce((a, w) => a + inv[w], 0);
}

export function inbound(s: AppState, sku: string, wh?: WarehouseId) {
  let q = 0;
  for (const po of s.purchaseOrders) if (po.status === "open" && po.sku === sku && (!wh || po.warehouseId === wh)) q += po.qty;
  for (const t of s.transfers) if (t.sku === sku && (!wh || t.to === wh)) q += t.qty;
  return q;
}

export function coverDays(s: AppState, p: Product, wh?: WarehouseId) {
  const demand = wh ? warehouseDaily(s, p, wh) : dailyDemand(s, p.sku);
  return onHand(s, p.sku, wh) / Math.max(0.05, demand);
}

export function regionsServedBy(wh: WarehouseId): Region[] {
  return REGIONS.filter((r) => HOME_WAREHOUSE[r] === wh);
}

export function fastestLeadDays(p: Product) {
  return Math.min(...p.supplierIds.map((id) => (SUPPLIER_BY_ID[id].leadDaysMin + SUPPLIER_BY_ID[id].leadDaysMax) / 2));
}

// ------------------------------------------------------------------ unit economics & margin floor
const KAVERI = COURIER_BY_ID["CR-KAVERI"];
const EXPECTED_RTO = 0.12;
const MARKETPLACE_SHARE = 0.4;

export function unitEconomics(p: Product, price: number) {
  const slabs = chargeableSlabs(p, 1);
  const baseShip = KAVERI.rateCard.B.first500g + KAVERI.rateCard.B.addl500g * (slabs - 1);
  const codFee = 0.55 * Math.max(KAVERI.codFeeMin, (KAVERI.codFeePct / 100) * price);
  const ship = baseShip + codFee + PACKAGING_COST;
  const mp = MARKETPLACES[0];
  const commission = MARKETPLACE_SHARE * ((mp.commissionPct[p.category] / 100) * price + mp.fixedFee);
  const r = p.returnRate;
  const expectedReturnCost = r * (0.8 * baseShip + (1 - RESTOCK_FRACTION[p.category]) * 0.8 * p.cost);
  const expectedRtoCost = EXPECTED_RTO * 1.1 * baseShip;
  const contribution = (1 - r) * (price - p.cost - commission) - ship - expectedReturnCost - expectedRtoCost;
  return { ship: Math.round(ship), commission: Math.round(commission), expectedReturnCost: Math.round(expectedReturnCost), expectedRtoCost: Math.round(expectedRtoCost), contribution: Math.round(contribution), marginPct: contribution / price };
}

/** Lowest price whose contribution margin, inclusive of expected return cost, clears the floor. */
export function floorPrice(p: Product) {
  const floorPct = (ENVELOPES.pricing.minMarginPct ?? 5) / 100;
  let lo = 1;
  let hi = p.mrp * 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (unitEconomics(p, mid).contribution >= floorPct * mid) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi);
}

export function priceKey(sku: string) {
  return `price:${sku}`;
}

export function agentIsCore(id: ProposerId): id is AgentId {
  return !id.startsWith("intake:");
}
