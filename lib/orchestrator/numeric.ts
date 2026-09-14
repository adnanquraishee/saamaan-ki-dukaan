// Numeric validation: every figure in LLM-produced text must be traceable to state.

export function extractFigures(text: string): number[] {
  const out: number[] = [];
  for (const m of Array.from(text.matchAll(/₹\s?([\d,]+(?:\.\d+)?)\s*(lakh|l|cr|crore|k)?\b|(\d[\d,]*(?:\.\d+)?)\s*(%|×|x\b|days?|units?|orders?)?/gi))) {
    if (m[1]) {
      let v = Number(m[1].replace(/,/g, ""));
      const unit = (m[2] ?? "").toLowerCase();
      if (unit === "lakh" || unit === "l") v *= 1e5;
      if (unit === "cr" || unit === "crore") v *= 1e7;
      if (unit === "k") v *= 1e3;
      out.push(v);
    } else if (m[3]) {
      const v = Number(m[3].replace(/,/g, ""));
      if (!Number.isFinite(v)) continue;
      // small bare integers (list markers, section numbers, days of week) carry no claim
      if (!m[4] && v < 10) continue;
      out.push(v);
    }
  }
  return out;
}

export function validateFigures(text: string, allowed: number[]) {
  const figures = extractFigures(text);
  const bad: number[] = [];
  for (const f of figures) {
    const ok = allowed.some((a) => {
      if (a === f) return true;
      const tol = Math.max(1, Math.abs(a) * 0.015);
      if (Math.abs(a - f) <= tol) return true;
      // percentages written as fractions or vice versa
      if (Math.abs(a * 100 - f) <= Math.max(0.6, Math.abs(a * 100) * 0.02)) return true;
      // lakh-rounded rupee amounts
      if (a >= 1e5 && Math.abs(a / 1e5 - f) <= 0.06) return true;
      return false;
    });
    if (!ok) bad.push(f);
  }
  return { ok: bad.length === 0, bad, figures };
}

export function numbersIn(obj: unknown, acc: number[] = []): number[] {
  if (typeof obj === "number" && Number.isFinite(obj)) acc.push(obj);
  else if (typeof obj === "string") extractFigures(obj).forEach((n) => acc.push(n));
  else if (Array.isArray(obj)) obj.forEach((x) => numbersIn(x, acc));
  else if (obj && typeof obj === "object") Object.values(obj).forEach((x) => numbersIn(x, acc));
  return acc;
}
