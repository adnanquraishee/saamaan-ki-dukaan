// Pattern classifier over all ingested untrusted text. It flags instruction-shaped language in fields
// that should only contain data. It is one layer: guardrails downstream must hold even when it misses.

import type { InjectionHit } from "@/lib/types";

const PATTERNS: { id: string; label: string; re: RegExp }[] = [
  { id: "role_marker", label: "Role / system marker", re: /\b(system|admin|assistant|developer)\s*(note|message|prompt|override|instruction|notice)s?\b/gi },
  { id: "ignore_prior", label: "Override of prior instructions", re: /\b(ignore|disregard|forget)\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions|rules|terms|policies)/gi },
  { id: "authority_claim", label: "Unverifiable authority claim", re: /\b(verified|confirmed|approved)\s+(premium|vip|gold|priority)(\s+tier|\s+customer)?\b|\b(premium|vip)\s+tier\b|\bapproved by (support|management|admin)\b/gi },
  { id: "imperative_money", label: "Imperative to move money", re: /\b(approve|authori[sz]e|release|issue|process)\b[^.\n]{0,40}\b(full\s+)?(refund|payment|payout)\b[^.\n]{0,20}(immediately|now|today|urgently)?/gi },
  { id: "skip_control", label: "Request to skip a control", re: /\b(skip|bypass|waive|without)\s+(the\s+)?(inspection|pickup|verification|review|approval|checks?)\b|\bdo not (flag|escalate|inspect|verify)\b/gi },
  { id: "bank_change", label: "Remittance / bank detail change", re: /\b(update[ds]?|change[ds]?|new)\s+(remittance|bank|beneficiary)\s+(account|details)\b/gi },
  { id: "price_directive", label: "Price directive in scraped content", re: /\brecommended\s+(retail\s+)?price\s+(for\s+this\s+item\s+)?(is|=|:)\s*₹\s?\d[\d,]*/gi },
  { id: "hidden_text", label: "Hidden text styling", re: /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(px)?\b|color\s*:\s*#?fff(fff)?\s*;?\s*background\s*:\s*#?fff/gi },
  { id: "persona", label: "Model persona manipulation", re: /\b(you are now|act as|as an ai|pretend to be)\b/gi },
];

export function detectInjection(text: string): InjectionHit[] {
  const hits: InjectionHit[] = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text))) {
      const span: [number, number] = [m.index, m.index + m[0].length];
      hits.push({ pattern: p.id, label: p.label, span, excerpt: text.slice(Math.max(0, span[0] - 20), Math.min(text.length, span[1] + 20)) });
      if (m[0].length === 0) p.re.lastIndex++;
    }
  }
  return hits.sort((a, b) => a.span[0] - b.span[0]);
}

/** Wraps untrusted content for any LLM prompt. The content is never placed in a system prompt. */
export function isolate(label: string, content: string) {
  const safe = content.replace(/<\/?untrusted[^>]*>/gi, "[tag removed]");
  return `<untrusted source="${label}">\n${safe}\n</untrusted>`;
}
