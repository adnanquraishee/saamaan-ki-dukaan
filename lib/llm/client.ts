"use client";
// Browser-side LLM client: session cache, in-flight de-duplication, token bucket, and Zod validation
// of every response before the caller may use it.
import { TASKS, type TaskName, type TaskOutput } from "./schemas";

type Status = "unknown" | "available" | "unavailable";
let status: Status = "unknown";
const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
const BUCKET = 6;
const REFILL_PER_MS = 6 / 60_000; // 6 calls/minute sustained
let tokens = BUCKET;
let lastRefill = Date.now();

export const llmStats = { calls: 0, cached: 0, failures: 0, rejected: 0 };

export function llmStatus() {
  return status;
}

export async function probeLlm() {
  try {
    const r = await fetch("/api/agent", { method: "GET" });
    const j = await r.json();
    status = j.available ? "available" : "unavailable";
  } catch {
    status = "unavailable";
  }
  return status;
}

function take() {
  const now = Date.now();
  tokens = Math.min(BUCKET, tokens + (now - lastRefill) * REFILL_PER_MS);
  lastRefill = now;
  if (tokens < 1) return false;
  tokens -= 1;
  return true;
}

/** Returns validated output, or null when unavailable / rate-limited / invalid (callers fall back). */
export async function callLlm<T extends TaskName>(task: T, input: Record<string, unknown>, opts: { priority?: boolean } = {}): Promise<TaskOutput<T> | null> {
  if (status === "unavailable") return null;
  const key = `${task}:${JSON.stringify(input)}`;
  if (cache.has(key)) {
    llmStats.cached++;
    return cache.get(key) as TaskOutput<T>;
  }
  if (inflight.has(key)) return inflight.get(key) as Promise<TaskOutput<T> | null>;
  if (!opts.priority && !take()) return null;
  const p = (async () => {
    try {
      llmStats.calls++;
      const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, input }) });
      if (res.status === 503) {
        status = "unavailable";
        return null;
      }
      const j = await res.json();
      if (!j.ok) {
        llmStats.failures++;
        return null;
      }
      status = "available";
      const parsed = TASKS[task].safeParse(j.data);
      if (!parsed.success) {
        llmStats.rejected++;
        return null;
      }
      cache.set(key, parsed.data);
      return parsed.data as TaskOutput<T>;
    } catch {
      llmStats.failures++;
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
