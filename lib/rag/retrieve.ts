// Runtime retrieval: brute-force cosine over ~100 chunks. At this corpus size an ANN index or vector
// database adds infrastructure and latency for zero recall benefit — a full scan is sub-millisecond.

import corpus from "@/data/corpus-embeddings.json";
import { CITATION_THRESHOLD } from "@/lib/config/envelopes";
import type { Citation } from "@/lib/types";
import { cosine, embed, type SparseVec } from "./embed";

interface Chunk {
  id: string;
  source: string;
  title: string;
  heading: string;
  text: string;
  vec: SparseVec;
}
const C = corpus as unknown as { idf: number[]; chunks: Chunk[]; embedder: { type: string; dim: number } };
const byId = new Map(C.chunks.map((c) => [c.id, c]));
const cache = new Map<string, Citation[]>();

export const CORPUS_STATS = { chunks: C.chunks.length, documents: new Set(C.chunks.map((c) => c.source)).size, embedder: C.embedder };

export function retrieve(query: string, opts: { k?: number; sourcePrefix?: string; minScore?: number } = {}): Citation[] {
  const key = `${query}|${opts.k ?? 3}|${opts.sourcePrefix ?? ""}|${opts.minScore ?? CITATION_THRESHOLD}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const q = embed(query, C.idf);
  const scored = C.chunks
    .filter((c) => !opts.sourcePrefix || c.source.startsWith(opts.sourcePrefix))
    .map((c) => ({ c, s: cosine(q, c.vec) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, opts.k ?? 3)
    .filter((x) => x.s >= (opts.minScore ?? CITATION_THRESHOLD))
    .map(({ c, s }) => ({
      chunkId: c.id,
      source: c.source,
      title: `${c.title} — ${c.heading}`,
      snippet: c.text.split("\n").slice(1).join(" ").slice(0, 220),
      score: +s.toFixed(3),
    }));
  cache.set(key, scored);
  return scored;
}

export function chunkText(chunkId: string) {
  return byId.get(chunkId)?.text ?? "";
}
