import type { ActionType, AgentId, ProposerId } from "@/lib/types";
export type { IntakeId, ProposerId } from "@/lib/types";

export interface ActionEnvelope {
  actionSpace: ActionType[];
  maxDiscountPct?: number;
  maxIncreasePct?: number;
  minMarginPct?: number; // contribution after expected return cost, as % of price
  poValueCeiling?: number;
  supplierWhitelist?: string[];
  courierPremiumCeilingPct?: number;
  courierWhitelist?: string[];
  refundCeiling?: number;
  skipInspectionMaxValue?: number;
  maxTransferUnits?: number;
  maxTransferCost?: number;
  maxCoverDays?: number;
  expediteCostCeiling?: number;
  payoutCeiling?: number;
  requiresCitation?: ActionType[];
}

export const ENVELOPES: Record<ProposerId, ActionEnvelope> = {
  demand: { actionSpace: ["UPDATE_FORECAST", "FLAG_DEMAND_SIGNAL"] },
  pricing: { actionSpace: ["SET_PRICE"], maxDiscountPct: 30, maxIncreasePct: 15, minMarginPct: 5 },
  inventory: { actionSpace: ["SET_REORDER_POLICY", "REPLENISH_NEED", "HOLD_PRICE", "MARK_DEAD_STOCK"], maxCoverDays: 90 },
  placement: { actionSpace: ["TRANSFER_STOCK"], maxTransferUnits: 600, maxTransferCost: 40000 },
  procurement: {
    actionSpace: ["CREATE_PO"],
    poValueCeiling: 1500000,
    supplierWhitelist: ["SUP-TIRUPUR", "SUP-SURAT", "SUP-NOIDA", "SUP-BADDI", "SUP-SHENZHEN", "SUP-HCMC"],
    requiresCitation: ["CREATE_PO"],
  },
  fulfilment: { actionSpace: ["ALLOCATE_ORDERS"] },
  courier: {
    actionSpace: ["ASSIGN_COURIERS"],
    courierPremiumCeilingPct: 80,
    courierWhitelist: ["CR-VAYU", "CR-KAVERI", "CR-NORTHSTAR", "CR-DAKSHIN"],
    requiresCitation: ["ASSIGN_COURIERS"],
  },
  returns: { actionSpace: ["RESOLVE_RETURN", "RTO_PREVENTION", "FIX_SIZE_GUIDE"], refundCeiling: 10000, skipInspectionMaxValue: 1000 },
  risk: { actionSpace: ["RAISE_ALERT", "ADJUST_COURIER_WEIGHT", "EXPEDITE_PO"], expediteCostCeiling: 25000, requiresCitation: ["ADJUST_COURIER_WEIGHT", "EXPEDITE_PO"] },
  finance: { actionSpace: ["RAISE_DISPUTE", "RELEASE_PAYOUT", "CASH_CONSTRAINT"], payoutCeiling: 2500000, requiresCitation: ["RAISE_DISPUTE"] },
  // Intake extractors read untrusted content. They have NO commit permission: empty action space.
  "intake:returns": { actionSpace: [] },
  "intake:finance": { actionSpace: [] },
  "intake:competitor": { actionSpace: [] },
};

export const CASH_BUFFER = 2000000;
export const FILL_RATE_FLOOR = 0.9;
export const CITATION_THRESHOLD = 0.2;

export const AGENT_META: Record<AgentId, { name: string; method: string; color: string }> = {
  demand: { name: "Demand", method: "Ridge forecast inference + velocity anomaly", color: "#38bdf8" },
  pricing: { name: "Pricing", method: "Elasticity × competitor signal × margin floor", color: "#a78bfa" },
  inventory: { name: "Inventory", method: "Return-adjusted newsvendor", color: "#2dd4bf" },
  placement: { name: "Placement", method: "Demand geography vs holding cost", color: "#4ade80" },
  procurement: { name: "Procurement", method: "Supplier scoring + contract RAG", color: "#f5a524" },
  fulfilment: { name: "Fulfilment", method: "Min-cost node selection w/ SLA", color: "#60a5fa" },
  courier: { name: "Courier", method: "Expected landed cost: rate × SLA × RTO", color: "#f472b6" },
  returns: { name: "Returns", method: "RTO classifier + disposition rules", color: "#fb923c" },
  risk: { name: "Risk", method: "Anomaly detection + SOP retrieval + LLM", color: "#f0525b" },
  finance: { name: "Finance", method: "Reconciliation rules + LLM document reading", color: "#facc15" },
};
export const AGENT_IDS = Object.keys(AGENT_META) as AgentId[];
