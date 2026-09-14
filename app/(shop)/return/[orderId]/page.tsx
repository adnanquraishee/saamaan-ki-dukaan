"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { RETURN_STATUS } from "@/components/shop/statusLabel";
import { POISONED_RETURN_TEXT } from "@/lib/engine/text";
import { useCart } from "@/lib/shop/cart";
import { inr, sendShopCommand, useShop } from "@/lib/shop/useShop";

const REASONS = [
  { id: "size_fit", label: "Size or fit" },
  { id: "damaged", label: "Arrived damaged / defective" },
  { id: "not_as_described", label: "Not as described" },
  { id: "changed_mind", label: "Changed my mind" },
];

export default function ReturnPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const data = useShop();
  const rememberReturn = useCart((s) => s.rememberReturn);
  const order = data.orders.find((o) => o.id === orderId);
  const [sku, setSku] = useState<string>("");
  const [reason, setReason] = useState("size_fit");
  const [text, setText] = useState("");
  const [poison, setPoison] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const existing = data.returns.find((r) => r.orderId === orderId);
  const cat = Object.fromEntries(data.catalog.map((p) => [p.sku, p]));

  if (!data.ready) return <div className="py-24 text-center text-stone-500">Loading…</div>;
  if (!order) return <p className="py-16 text-center text-stone-600">Order not found. <Link className="underline" href="/orders">Your orders</Link></p>;
  const line = order.lines.find((l) => l.sku === sku) ?? order.lines[0];

  const submit = async () => {
    const id = `RET-WEB-${Date.now().toString(36).toUpperCase()}`;
    await sendShopCommand({ type: "requestReturn", ret: { id, orderId: order.id, sku: line.sku, qty: line.qty, reasonCode: reason, freeText: text, demoPoison: poison } });
    rememberReturn(id);
    setSent(id);
  };

  const status = existing ? RETURN_STATUS[existing.status] : null;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/orders" className="text-xs uppercase tracking-[0.18em] text-stone-500 hover:text-shop-ink">← Orders</Link>
      <h1 className="mb-2 mt-2 font-serif text-4xl tracking-tight">Return an item</h1>
      <p className="mb-6 text-sm text-stone-600">Order {order.id} · {inr(order.value)}</p>

      {existing ? (
        <div className="rounded-xl border border-shop-sand bg-white p-5">
          <div className="flex items-center justify-between">
            <span className="font-medium">{existing.id}</span>
            {status && <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.tone}`}>{status.label}</span>}
          </div>
          <p className="mt-3 rounded-md bg-stone-50 p-3 text-sm text-stone-700">&ldquo;{existing.freeText}&rdquo;</p>
          {existing.status === "escalated" && <p className="mt-3 text-sm text-amber-800">Our team is reviewing this request before any refund is issued.</p>}
          {existing.status === "requested" && <p className="mt-3 text-sm text-stone-500">The returns agent will review this within a cycle.</p>}
        </div>
      ) : (
        <div className="space-y-5 rounded-xl border border-shop-sand bg-white p-5">
          {order.lines.length > 1 && (
            <label className="block text-sm">
              <span className="text-stone-600">Item</span>
              <select value={line.sku} onChange={(e) => setSku(e.target.value)} className="mt-1 w-full rounded-md border border-shop-sand px-3 py-2">
                {order.lines.map((l) => (
                  <option key={l.sku} value={l.sku}>
                    {cat[l.sku]?.name ?? l.sku}
                  </option>
                ))}
              </select>
            </label>
          )}
          <fieldset>
            <legend className="text-sm text-stone-600">Reason</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {REASONS.map((r) => (
                <label key={r.id} className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${reason === r.id ? "border-shop-ink" : "border-shop-sand"}`}>
                  <input type="radio" className="sr-only" checked={reason === r.id} onChange={() => setReason(r.id)} />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm">
            <span className="text-stone-600">Tell us more</span>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setPoison(e.target.value === POISONED_RETURN_TEXT);
              }}
              rows={4}
              className="mt-1 w-full rounded-md border border-shop-sand px-3 py-2 outline-none focus:border-stone-500"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setReason("damaged");
                setText(POISONED_RETURN_TEXT);
                setPoison(true);
              }}
              className="rounded-md border border-dashed border-red-300 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
              title="Demo: pre-fills a prompt-injection attempt"
            >
              Demo · load poisoned note
            </button>
            <button onClick={submit} disabled={!text.trim() || !!sent} className="rounded-md bg-shop-ink px-5 py-2.5 font-medium text-shop-paper disabled:bg-stone-300">
              {sent ? "Submitted" : "Submit return"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
