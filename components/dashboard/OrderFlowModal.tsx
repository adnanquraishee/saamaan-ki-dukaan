"use client";
import { useEffect } from "react";
import type { Order } from "@/lib/types";
import { OrderAgentFlow3D } from "./OrderAgentFlow3D";
import { OrderJourneyMap } from "./OrderJourneyMap";
export function OrderFlowModal({ order, onClose }: { order: Order; onClose: () => void }) {
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]);
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-[#03070b]/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Order workflow for ${order.id}`} onMouseDown={onClose}><div className="order-flow-modal max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-xl border border-tower-cyan/30 bg-[#081019] shadow-[0_30px_100px_rgba(0,0,0,.65)]" onMouseDown={(event) => event.stopPropagation()}><div className="sticky top-0 z-30 flex items-center justify-between border-b border-tower-line bg-[#081019]/95 px-4 py-3 backdrop-blur"><div><div className="font-mono text-[10px] uppercase tracking-[.2em] text-tower-cyan">Order intelligence</div><div className="mt-1 text-sm font-semibold text-white">{order.id} · {order.customerName}</div></div><button onClick={onClose} className="rounded-full border border-tower-line px-3 py-1.5 font-mono text-xs text-tower-text transition hover:border-tower-cyan hover:text-tower-cyan">Close ×</button></div><OrderJourneyMap order={order} /><OrderAgentFlow3D order={order} /></div></div>;
}
