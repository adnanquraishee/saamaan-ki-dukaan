// Intake extractors. They read untrusted text and emit STRUCTURED DATA ONLY — typed fields, never free text
// passed onward. They hold no commit permission (empty action space in lib/config/envelopes.ts).
// The parsing is deliberately literal — it reports what the document *claims*. Deciding whether a claim
// is trustworthy is the job of injection detection, envelopes and guardrails, not the parser.

const money = (s: string) => Number(s.replace(/[₹,\s]/g, ""));

export interface ReturnIntake {
  reasonCode: string;
  claimsDamage: boolean;
  sizeRelated: boolean;
  claimedPremiumTier: boolean;
  claimedSkipInspection: boolean;
  claimedUrgentRefund: boolean;
}

export function extractReturn(freeText: string, reasonCode: string): ReturnIntake {
  const t = freeText.toLowerCase();
  return {
    reasonCode,
    claimsDamage: /damag|broken|defect|crack|not working|dead on arrival/.test(t) || reasonCode === "damaged",
    sizeRelated: /size|fit|small|large|tight|loose/.test(t) || reasonCode === "size_fit",
    claimedPremiumTier: /premium|vip|gold tier|priority customer/.test(t),
    claimedSkipInspection: /skip inspection|without inspection|no inspection|skip the inspection/.test(t),
    claimedUrgentRefund: /refund immediately|approve full refund|refund now|urgent refund/.test(t),
  };
}

export interface CompetitorIntake {
  price: number | null;
  source: "rrp_statement" | "price_tag" | "none";
  allPrices: number[];
}

/** Mirrors the legacy scraper: a "recommended retail price" statement wins over the visible price tag. */
export function extractCompetitorPrice(page: string): CompetitorIntake {
  const all = Array.from(page.matchAll(/₹\s?([\d,]+)/g)).map((m) => money(m[1]));
  const rrp = page.match(/recommended\s+(retail\s+)?price[^₹]{0,30}₹\s?([\d,]+)/i);
  if (rrp) return { price: money(rrp[2]), source: "rrp_statement", allPrices: all };
  const tag = page.match(/class=['"]price['"][^>]*>\s*₹\s?([\d,]+)/i);
  if (tag) return { price: money(tag[1]), source: "price_tag", allPrices: all };
  return { price: null, source: "none", allPrices: all };
}

export interface SettlementIntake {
  settlementId: string | null;
  marketplace: string | null;
  orderCount: number | null;
  gross: number | null;
  commission: number | null;
  closingFees: number | null;
  otherDeductions: { label: string; amount: number }[];
  netPayable: number | null;
  embeddedRequests: string[];
}

export function extractSettlementRegex(text: string): SettlementIntake {
  const num = (re: RegExp) => {
    const m = text.match(re);
    return m ? money(m[1]) : null;
  };
  const other: { label: string; amount: number }[] = [];
  for (const m of Array.from(text.matchAll(/^\s*-\s*([A-Za-z][A-Za-z \-/]+?):\s*₹\s?([\d,]+)/gm))) {
    const label = m[1].trim();
    if (!/commission|closing fee/i.test(label)) other.push({ label, amount: money(m[2]) });
  }
  return {
    settlementId: text.match(/Settlement ID:\s*(\S+)/i)?.[1] ?? null,
    marketplace: text.match(/^From:\s*(.+)$/im)?.[1]?.trim() ?? null,
    orderCount: num(/Orders settled:\s*([\d,]+)/i),
    gross: num(/Gross order value:\s*₹\s?([\d,]+)/i),
    commission: num(/Commission:\s*₹\s?([\d,]+)/i),
    closingFees: num(/Closing fees?:\s*₹\s?([\d,]+)/i),
    otherDeductions: other,
    netPayable: num(/Net payable:\s*₹\s?([\d,]+)/i),
    embeddedRequests: /release|confirm receipt|waive|do not dispute/i.test(text) ? ["instruction-like text present"] : [],
  };
}

export interface InvoiceIntake {
  poRef: string | null;
  supplier: string | null;
  amount: number | null;
  delayDays: number | null;
  bankChange: boolean;
  // A naive document reader "helpfully" surfaces what the document asks for. This field exists to show that
  // the orchestrator's output filter rejects it: an intake extractor has no action space.
  suggestedAction: "RELEASE_PAYOUT" | null;
}

export function extractInvoiceRegex(text: string): InvoiceIntake {
  const amount = text.match(/(?:amount|payment|invoice total)[^₹]{0,30}₹\s?([\d,]+)/i);
  return {
    poRef: text.match(/\b(PO-[A-Z0-9]+)\b/)?.[1] ?? null,
    supplier: text.match(/^From:\s*(.+)$/im)?.[1]?.trim() ?? null,
    amount: amount ? money(amount[1]) : null,
    delayDays: (() => {
      const m = text.match(/delay(?:ed)?\s+(?:by\s+)?(\d+)\s+days?/i);
      return m ? Number(m[1]) : null;
    })(),
    bankChange: /(new|updated?|change[ds]?)\s+(remittance|bank|beneficiary)/i.test(text),
    suggestedAction: /release (the )?payment|release payment|pay (immediately|now)/i.test(text) ? "RELEASE_PAYOUT" : null,
  };
}
