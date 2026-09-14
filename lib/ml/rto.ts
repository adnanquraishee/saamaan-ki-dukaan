import type { Category, PaymentMode, RtoExplanation, Tier } from "@/lib/types";
import { MODELS } from "./models";

const M = MODELS.rto;

const LABELS: Record<string, string> = {
  cod: "Cash on delivery",
  tier2: "Tier-2 pincode",
  tier3: "Tier-3 pincode",
  log_value: "Order value",
  cat_electronics: "Electronics",
  cat_home: "Home category",
  cat_personal_care: "Personal care",
  "courier_CR-KAVERI": "Kaveri Logistics",
  "courier_CR-NORTHSTAR": "Northstar Couriers",
  "courier_CR-DAKSHIN": "Dakshin Parcel",
  cart_size: "Cart size",
  first_time: "First-time customer",
};

export interface RtoInput {
  paymentMode: PaymentMode;
  tier: Tier;
  value: number;
  category: Category;
  courierId: string;
  cartSize: number;
  firstTime: boolean;
}

function features(x: RtoInput): Record<string, number> {
  return {
    cod: x.paymentMode === "cod" ? 1 : 0,
    tier2: x.tier === "tier2" ? 1 : 0,
    tier3: x.tier === "tier3" ? 1 : 0,
    log_value: Math.log(Math.max(100, x.value)) - M.logValueRef,
    cat_electronics: x.category === "electronics" ? 1 : 0,
    cat_home: x.category === "home" ? 1 : 0,
    cat_personal_care: x.category === "personal_care" ? 1 : 0,
    "courier_CR-KAVERI": x.courierId === "CR-KAVERI" ? 1 : 0,
    "courier_CR-NORTHSTAR": x.courierId === "CR-NORTHSTAR" ? 1 : 0,
    "courier_CR-DAKSHIN": x.courierId === "CR-DAKSHIN" ? 1 : 0,
    cart_size: x.cartSize,
    first_time: x.firstTime ? 1 : 0,
  };
}

/** scoreRto(order) → probability plus the top three features pushing risk up. */
export function scoreRto(x: RtoInput, logitDelta = 0): RtoExplanation {
  const f = features(x);
  let z = M.intercept + logitDelta;
  const contrib: { feature: string; label: string; contribution: number }[] = [];
  for (const name of M.features) {
    const c = (M.weights[name] ?? 0) * f[name];
    z += c;
    if (c !== 0) contrib.push({ feature: name, label: LABELS[name] ?? name, contribution: +c.toFixed(3) });
  }
  contrib.sort((a, b) => b.contribution - a.contribution);
  return { p: 1 / (1 + Math.exp(-z)), top: contrib.filter((c) => c.contribution > 0).slice(0, 3) };
}
