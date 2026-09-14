// Thin, stateless proxy to the Anthropic API. The key never leaves the server.
// Structured output is enforced with a strict schema; responses are validated again with Zod,
// retried once on parse failure, and cached in-process so identical prompts don't spend quota twice.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { buildPrompt } from "@/lib/llm/prompts";
import { TASKS, type TaskName } from "@/lib/llm/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const cache = new Map<string, unknown>();
const hits: number[] = [];
const RATE_PER_MIN = Number(process.env.LLM_RATE_PER_MIN || 20);

let client: Anthropic | null = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic();
  return client;
}

export async function GET() {
  return NextResponse.json({ available: !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY), model: process.env.GEMINI_API_KEY ? GEMINI_MODEL : MODEL, provider: process.env.GEMINI_API_KEY ? "gemini" : "anthropic" });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { task?: string; input?: Record<string, unknown> } | null;
  if (!body?.task || !(body.task in TASKS)) return NextResponse.json({ ok: false, error: "unknown task" }, { status: 400 });
  const task = body.task as TaskName;
  if (process.env.GEMINI_API_KEY) return geminiPost(task, body.input ?? {});
  const anthropic = getClient();
  if (!anthropic) return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });

  const { system, user } = buildPrompt(task, body.input ?? {});
  const key = JSON.stringify([task, system, user]);
  if (cache.has(key)) return NextResponse.json({ ok: true, data: cache.get(key), cached: true, model: MODEL });

  const now = Date.now();
  while (hits.length && now - hits[0] > 60_000) hits.shift();
  if (hits.length >= RATE_PER_MIN) return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429 });
  hits.push(now);

  const schema = TASKS[task];
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await anthropic.messages.parse({
        model: MODEL,
        max_tokens: 2048,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: zodOutputFormat(schema), effort: "low" },
      });
      if (res.stop_reason === "refusal") return NextResponse.json({ ok: false, error: "refusal" }, { status: 422 });
      const parsed = schema.safeParse(res.parsed_output);
      if (!parsed.success) {
        lastError = "schema validation failed";
        continue; // retry once
      }
      cache.set(key, parsed.data);
      if (cache.size > 500) cache.delete(cache.keys().next().value as string);
      return NextResponse.json({ ok: true, data: parsed.data, cached: false, model: MODEL });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return NextResponse.json({ ok: false, error: "upstream rate limited" }, { status: 429 });
      if (err instanceof Anthropic.AuthenticationError) return NextResponse.json({ ok: false, error: "invalid API key" }, { status: 503 });
      if (err instanceof Anthropic.BadRequestError) return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return NextResponse.json({ ok: false, error: `failed after retry: ${lastError}` }, { status: 502 });
}

async function geminiPost(task: TaskName, input: Record<string, unknown>) {
  const { system, user } = buildPrompt(task, input);
  const key = JSON.stringify(["gemini", task, system, user]);
  if (cache.has(key)) return NextResponse.json({ ok: true, data: cache.get(key), cached: true, model: GEMINI_MODEL });
  const now = Date.now();
  while (hits.length && now - hits[0] > 60_000) hits.shift();
  if (hits.length >= RATE_PER_MIN) return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429 });
  hits.push(now);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY!)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { temperature: 0.1, responseMimeType: "application/json" } }),
    });
    if (!response.ok) return NextResponse.json({ ok: false, error: "Gemini request failed" }, { status: response.status === 429 ? 429 : 502 });
    const json = await response.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    const parsed = TASKS[task].safeParse(JSON.parse(text));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Gemini response failed schema validation" }, { status: 502 });
    cache.set(key, parsed.data);
    return NextResponse.json({ ok: true, data: parsed.data, cached: false, model: GEMINI_MODEL });
  } catch { return NextResponse.json({ ok: false, error: "Gemini response could not be parsed" }, { status: 502 }); }
}
