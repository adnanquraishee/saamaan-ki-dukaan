// Strict output schemas for every LLM task. Validated server-side (SDK structured output) AND
// client-side before anything reaches state.
import * as z from "zod/v4";

export const SettlementExtraction = z.object({
  settlementId: z.string().nullable(),
  marketplace: z.string().nullable(),
  orderCount: z.number().nullable(),
  gross: z.number().nullable(),
  commission: z.number().nullable(),
  closingFees: z.number().nullable(),
  otherDeductions: z.array(z.object({ label: z.string(), amount: z.number() })),
  netPayable: z.number().nullable(),
  embeddedRequests: z.array(z.string()),
});

export const SupplierDocExtraction = z.object({
  poRef: z.string().nullable(),
  supplier: z.string().nullable(),
  amount: z.number().nullable(),
  delayDays: z.number().nullable(),
  bankChange: z.boolean(),
  requestedActions: z.array(z.enum(["RELEASE_PAYOUT", "CHANGE_BANK_DETAILS", "NONE"])),
});

export const ClauseInterpretation = z.object({
  permitted: z.boolean(),
  quote: z.string(),
  reasoning: z.string(),
});

export const DecisionExplanation = z.object({
  explanation: z.string(),
});

export const NovelRiskAssessment = z.object({
  assessment: z.string(),
  likelyCause: z.string(),
  recommendedAction: z.enum(["monitor", "throttle_cod", "hold_orders", "escalate"]),
  confidence: z.number(),
});

export const TASKS = {
  extract_settlement: SettlementExtraction,
  extract_supplier_doc: SupplierDocExtraction,
  interpret_clause: ClauseInterpretation,
  explain_decision: DecisionExplanation,
  novel_risk: NovelRiskAssessment,
} as const;

export type TaskName = keyof typeof TASKS;
export type TaskOutput<T extends TaskName> = z.infer<(typeof TASKS)[T]>;
