// Local lexical embedding: hashed unigram+bigram TF-IDF, L2-normalised, 1024 dimensions.
// The same function runs at build time (scripts/embed-corpus.ts) and at query time in the browser,
// so document and query vectors live in one space with no network dependency during a demo.

export const EMBED_DIM = 1024;

const STOP = new Set(
  "a an and are as at be by for from has have if in into is it its of on or per shall that the their this to under was were which will with within without not no any all each may must our we you your than then there these those be been being do does".split(" "),
);

function stem(t: string) {
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/₹\s?([\d,]+)/g, " inr$1 ")
    .replace(/,(?=\d{2,3}\b)/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

function fnv(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function termCounts(text: string): Map<number, number> {
  const toks = tokenize(text);
  const counts = new Map<number, number>();
  const add = (f: string, w: number) => {
    const idx = fnv(f) % EMBED_DIM;
    counts.set(idx, (counts.get(idx) ?? 0) + w);
  };
  for (let i = 0; i < toks.length; i++) {
    add(toks[i], 1);
    if (i + 1 < toks.length) add(`${toks[i]}_${toks[i + 1]}`, 0.6);
  }
  return counts;
}

export interface SparseVec {
  i: number[];
  v: number[];
}

export function embed(text: string, idf: number[]): SparseVec {
  const counts = termCounts(text);
  const entries: [number, number][] = [];
  let norm = 0;
  counts.forEach((c, idx) => {
    const w = (1 + Math.log(c)) * (idf[idx] ?? 1);
    entries.push([idx, w]);
    norm += w * w;
  });
  norm = Math.sqrt(norm) || 1;
  entries.sort((a, b) => a[0] - b[0]);
  return { i: entries.map((e) => e[0]), v: entries.map((e) => +(e[1] / norm).toFixed(4)) };
}

export function cosine(a: SparseVec, b: SparseVec) {
  let i = 0;
  let j = 0;
  let s = 0;
  while (i < a.i.length && j < b.i.length) {
    if (a.i[i] === b.i[j]) {
      s += a.v[i] * b.v[j];
      i++;
      j++;
    } else if (a.i[i] < b.i[j]) i++;
    else j++;
  }
  return s;
}
