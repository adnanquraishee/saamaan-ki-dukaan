// OPTIONAL LAN relay for the live demo. BroadcastChannel only spans tabs of one browser; audience phones on
// the venue network are different browsers. This in-memory relay lets them submit storefront orders to the
// presenter's engine tab and read back a public snapshot (prices, stock, delivery promises, order status).
// No database: state is a process-local object. It is disabled on public hosts (e.g. *.vercel.app) unless
// RELAY_ENABLED=1, because serverless instances do not share memory and strangers must not share an engine.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Relay {
  snapshot: unknown;
  snapshotAt: number;
  engineClient: string | null;
  queue: { id: string; cmd: unknown }[];
}
const g = globalThis as unknown as { __sctRelay?: Relay };
const relay: Relay = (g.__sctRelay ??= { snapshot: null, snapshotAt: 0, engineClient: null, queue: [] });

function enabled(req: Request) {
  if (process.env.RELAY_ENABLED === "1") return true;
  if (process.env.RELAY_ENABLED === "0") return false;
  const host = (req.headers.get("host") ?? "").split(":")[0];
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local") || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

const ALLOWED = new Set(["placeOrder", "requestReturn"]);

export async function GET(req: Request) {
  if (!enabled(req)) return NextResponse.json({ enabled: false });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const alive = Date.now() - relay.snapshotAt < 6000;
  if (kind === "pull") {
    const client = url.searchParams.get("client");
    if (!client || (alive && relay.engineClient && relay.engineClient !== client)) return NextResponse.json({ enabled: true, commands: [] });
    const commands = relay.queue.splice(0, relay.queue.length);
    return NextResponse.json({ enabled: true, commands });
  }
  return NextResponse.json({ enabled: true, alive, engineClient: relay.engineClient, snapshot: alive ? relay.snapshot : null });
}

export async function POST(req: Request) {
  if (!enabled(req)) return NextResponse.json({ enabled: false }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { kind?: string; client?: string; snapshot?: unknown; cmd?: { type?: string }; id?: string } | null;
  if (!body) return NextResponse.json({ ok: false }, { status: 400 });
  if (body.kind === "snapshot" && body.client) {
    const alive = Date.now() - relay.snapshotAt < 6000;
    if (alive && relay.engineClient && relay.engineClient !== body.client) return NextResponse.json({ ok: false, error: "another engine is live" }, { status: 409 });
    relay.engineClient = body.client;
    relay.snapshot = body.snapshot;
    relay.snapshotAt = Date.now();
    return NextResponse.json({ ok: true });
  }
  if (body.kind === "command" && body.cmd && ALLOWED.has(body.cmd.type ?? "") && JSON.stringify(body.cmd).length < 4000) {
    if (relay.queue.length > 500) relay.queue.shift();
    relay.queue.push({ id: String(body.id ?? Date.now()), cmd: body.cmd });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false }, { status: 400 });
}
