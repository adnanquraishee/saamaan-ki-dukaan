"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ORDER_STATUS, RETURN_STATUS } from "@/components/shop/statusLabel";
import { COURIER_BY_ID, PINCODE_BY_PIN, WAREHOUSE_BY_ID } from "@/lib/config/network";
import { useCart } from "@/lib/shop/cart";
import { inr, useShop } from "@/lib/shop/useShop";
import { useApp } from "@/lib/store/store";

function OrdersInner() {
  const data = useShop();
  const myOrders = useCart((s) => s.myOrders);
  const placed = useSearchParams().get("placed");
  const sfIds = useApp((s) => s.storefrontOrderIds);
  const cat = Object.fromEntries(data.catalog.map((p) => [p.sku, p]));
  const mine = new Set(myOrders);
  // presenter's browser shows every storefront order; audience devices show their own
  const visible = data.orders.filter((o) => o.source === "storefront" && (mine.has(o.id) || (data.mode === "local" && sfIds.includes(o.id)))).sort((a, b) => b.tick - a.tick);
  const pendingPlaced = placed && !visible.some((o) => o.id === placed);

  if (!data.ready) return <div className="py-24 text-center text-stone-500">Loading…</div>;
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 font-serif text-4xl tracking-tight">Orders</h1>
      {pendingPlaced && <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">Order {placed} sent — waiting for the engine to confirm…</div>}
      {!visible.length && !pendingPlaced && (
        <p className="text-stone-600">
          No orders yet. <Link href="/" className="underline underline-offset-4">Start shopping</Link>.
        </p>
      )}
      <ul className="space-y-4">
        {visible.map((o) => {
          const st = ORDER_STATUS[o.status];
          const ret = data.returns.find((r) => r.orderId === o.id);
          return (
            <li key={o.id} className={`rounded-xl border bg-white p-5 ${o.id === placed ? "border-shop-clay" : "border-shop-sand"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{o.id}</div>
                  <div className="text-xs text-stone-500">
                    {o.customerName} · {PINCODE_BY_PIN[o.pincode]?.city} {o.pincode} · {o.paymentMode === "cod" ? "Cash on delivery" : "Prepaid"}
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${st.tone}`}>{st.label}</span>
              </div>
              <ul className="mt-3 space-y-1 text-sm">
                {o.lines.map((l) => (
                  <li key={l.sku} className="flex justify-between">
                    <span className="text-stone-700">
                      {l.qty} × {cat[l.sku]?.name ?? l.sku}
                    </span>
                    <span className="num">{inr(l.price * l.qty)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-shop-sand pt-3 text-xs text-stone-600">
                <span>
                  {o.warehouseId ? `From ${WAREHOUSE_BY_ID[o.warehouseId].city}` : "Choosing a warehouse"}
                  {o.courierId ? ` via ${COURIER_BY_ID[o.courierId].name}` : ""}
                  {o.promisedDays ? ` · arrives in ~${o.promisedDays} days` : ""}
                  {o.rtoMeasure === "ivr_confirm" ? " · you'll get a confirmation call" : ""}
                </span>
                {ret ? (
                  <span className={`rounded-full px-2 py-0.5 font-medium ${RETURN_STATUS[ret.status].tone}`}>{RETURN_STATUS[ret.status].label}</span>
                ) : o.status === "shipped" || o.status === "delivered" ? (
                  <Link href={`/return/${o.id}`} className="font-medium underline underline-offset-4">
                    Request a return
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersInner />
    </Suspense>
  );
}
