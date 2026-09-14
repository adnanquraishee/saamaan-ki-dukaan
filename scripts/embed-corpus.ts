/**
 * Build-time corpus embedding.
 *   1. chunk each /corpus/*.md into ~400-token windows with 60-token overlap (≈ 300 / 45 words)
 *   2. compute IDF over all chunks, embed every chunk (lib/rag/embed.ts)
 *   3. write data/corpus-embeddings.json  { embedder, idf, chunks: [{id, source, title, heading, text, vec}] }
 *
 * Run: npm run embed
 */
import fs from "node:fs";
import path from "node:path";
import { EMBED_DIM, embed, termCounts } from "../lib/rag/embed";

const DIR = path.join(process.cwd(), "corpus");
const CHUNK_WORDS = 300; // ≈ 400 tokens
const OVERLAP_WORDS = 45; // ≈ 60 tokens

interface RawChunk { id: string; source: string; title: string; heading: string; text: string }
const raw: RawChunk[] = [];

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".md")).sort()) {
  const source = file.replace(/\.md$/, "");
  const md = fs.readFileSync(path.join(DIR, file), "utf8");
  const title = (md.match(/^#\s+(.+)$/m)?.[1] ?? source).trim();
  // 1. split on "## " section boundaries; merge tiny sections forward so every chunk carries context
  const sections: { heading: string; body: string }[] = [];
  for (const part of md.split(/\n(?=##\s)/)) {
    const heading = part.match(/^##\s+(.+)/)?.[1]?.trim() ?? "Overview";
    const body = part.replace(/^#{1,2}\s+.+\n?/, "").trim();
    const prev = sections[sections.length - 1];
    if (prev && prev.body.split(/\s+/).length < 40) {
      prev.body += `\n## ${heading}\n${body}`;
    } else sections.push({ heading, body });
  }
  // 2. window long sections at ~400 tokens with 60-token overlap
  let n = 0;
  for (const sec of sections) {
    const words = sec.body.split(/(?<=\s)/);
    let start = 0;
    while (start < words.length) {
      const end = Math.min(words.length, start + CHUNK_WORDS);
      const text = words.slice(start, end).join("").trim();
      if (text.length > 30) raw.push({ id: `${source}#${n++}`, source, title, heading: sec.heading, text: `${title} — ${sec.heading}\n${text}` });
      if (end === words.length) break;
      start = end - OVERLAP_WORDS;
    }
  }
}

const df = new Array(EMBED_DIM).fill(0);
for (const c of raw) termCounts(c.text).forEach((_, idx) => (df[idx] += 1));
const idf = df.map((d) => +Math.log((raw.length + 1) / (d + 1) + 1).toFixed(4));

const chunks = raw.map((c) => ({ ...c, vec: embed(c.text, idf) }));
const out = { embedder: { type: "hashed-tfidf", dim: EMBED_DIM, chunkWords: CHUNK_WORDS, overlapWords: OVERLAP_WORDS }, idf, chunks };
fs.writeFileSync(path.join(process.cwd(), "data", "corpus-embeddings.json"), JSON.stringify(out));
console.log(`embedded ${chunks.length} chunks from ${new Set(chunks.map((c) => c.source)).size} documents`);
