"use client";
import { useApp } from "@/lib/store/store";
import { Panel } from "./ui";
export function AtRiskNow() {
  const orders = useApp((s) => s.orders.filter((o) => ["backordered", "rto", "returned"].includes(o.status)).slice(-6).reverse());
  const escalations = useApp((s) => s.escalations.filter((e) => e.status === "open").slice(-4).reverse());
  const total = orders.length + escalations.length;
  return <Panel title="At risk now" right={<span className={`font-mono text-[10px] ${total ? "text-tower-amber" : "text-tower-green"}`}>{total ? `${total} needs attention` : "clear"}</span>}>{!total ? <div className="p-2 font-mono text-xs text-tower-green">No live service exceptions detected.</div> : <div className="space-y-2">{orders.map((o) => <div key={o.id} className="flex justify-between rounded-sm border border-tower-amber/20 bg-tower-amber/5 px-3 py-2 font-mono text-xs"><span className="text-white">{o.id} <span className="text-tower-dim">· {o.status}</span></span><span className="text-tower-dim">{o.pincode}</span></div>)}{escalations.map((e) => <div key={e.id} className="rounded-sm border border-tower-red/20 bg-tower-red/5 px-3 py-2"><div className="font-mono text-xs text-tower-red">Escalation · {e.agentId}</div><div className="truncate text-xs text-tower-dim">{e.ask || e.breach}</div></div>)}</div>}</Panel>;
}
