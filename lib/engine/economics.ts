// Ground-truth physics of the simulated world. The simulator uses these to decide outcomes;
// the agents only ever see the *trained model* approximations exported in data/models.json.

import { COURIER_BY_ID, isMonsoon, rateZone, MARKETPLACES } from "@/lib/config/network";
import type { Category, Courier, PaymentMode, Product, RateZone, Region, Tier } from "@/lib/types";

export const PACKAGING_COST = 15;
export const RTO_HANDLING = 30;
export const IVR_COST = 4;
export const IVR_LOGIT_DELTA = -0.55;
export const GOODWILL_PER_STOCKOUT_UNIT = 0.25; // fraction of price lost as goodwill on a stockout

export const RESTOCK_FRACTION: Record<Category, number> = {
  apparel: 0.85,
  electronics: 0.6,
  home: 0.7,
  personal_care: 0.2,
};

export function chargeableSlabs(p: Pick<Product, "weight" | "dims">, qty = 1) {
  const vol = (p.dims.l * p.dims.w * p.dims.h) / 5000;
  const kg = Math.max(p.weight, vol) * qty;
  return Math.max(1, Math.ceil(kg / 0.5));
}

export function forwardCost(courier: Courier, zone: RateZone, slabs: number, paymentMode: PaymentMode, value: number) {
  const r = courier.rateCard[zone];
  let c = r.first500g + r.addl500g * (slabs - 1);
  if (paymentMode === "cod") c += Math.max((courier.codFeePct / 100) * value, courier.codFeeMin);
  return Math.round(c);
}

export function rtoCost(courier: Courier, zone: RateZone, slabs: number) {
  const r = courier.rateCard[zone];
  const fwd = r.first500g + r.addl500g * (slabs - 1);
  return Math.round((fwd * courier.rtoChargePct) / 100 + RTO_HANDLING);
}

const COURIER_RTO_EFFECT: Record<string, number> = {
  "CR-VAYU": -0.4,
  "CR-KAVERI": 0.35,
  "CR-NORTHSTAR": 0.1,
  "CR-DAKSHIN": 0.0,
};

export interface RtoTruthInput {
  paymentMode: PaymentMode;
  tier: Tier;
  value: number;
  category: Category;
  courierId: string;
  cartSize: number;
  firstTime: boolean;
  month: number;
  region: Region;
  ivr?: boolean;
}

export function trueRtoLogit(x: RtoTruthInput) {
  const cod = x.paymentMode === "cod" ? 1 : 0;
  let l = -3.6;
  l += 1.1 * cod;
  l += x.tier === "tier2" ? 0.35 : x.tier === "tier3" ? 0.75 : 0;
  l += x.tier === "tier3" && cod ? 0.2 : 0;
  l += 0.2 * Math.log(Math.max(100, x.value) / 1000);
  l += COURIER_RTO_EFFECT[x.courierId] ?? 0;
  if (x.courierId === "CR-DAKSHIN" && x.region !== "south" && x.region !== "west") l += 0.35;
  l += x.category === "apparel" ? 0.2 : x.category === "electronics" ? 0.1 : 0;
  l += x.firstTime ? 0.35 : 0;
  l -= 0.06 * Math.max(0, x.cartSize - 1);
  l += isMonsoon(x.month) ? 0.12 : 0;
  if (x.ivr) l += IVR_LOGIT_DELTA;
  return l;
}

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
export const trueRtoProbability = (x: RtoTruthInput) => sigmoid(trueRtoLogit(x));

export function trueReturnProbability(p: Product, pricePaid: number, sizeGuideFixed: boolean) {
  let r = p.returnRate;
  if (p.category === "apparel" && pricePaid < p.basePrice * 0.88) r *= 1.2; // impulse buys at discount return more
  if (p.sizingIssue && sizeGuideFixed) r *= 0.68;
  return Math.min(0.75, r);
}

export function deliveryDays(courier: Courier, zone: RateZone, region: Region, month: number, uDelay: number) {
  const base = courier.slaDays[zone] * (courier.regionStrength[region] ?? 1);
  const monsoon = isMonsoon(month) ? 1.18 : 1;
  const noise = Math.exp((uDelay - 0.5) * 0.7); // ~ lognormal-ish spread
  return Math.max(0.5, base * courier.slaHealth * monsoon * noise);
}

export function commissionFor(channel: "web" | "marketplace", category: Category, value: number) {
  if (channel === "web") return 0;
  const mp = MARKETPLACES[0];
  return Math.round((mp.commissionPct[category] / 100) * value + mp.fixedFee);
}

export function zoneFor(whRegion: Region, customerRegion: Region) {
  return rateZone(whRegion, customerRegion);
}

export function courierById(id: string) {
  return COURIER_BY_ID[id];
}
