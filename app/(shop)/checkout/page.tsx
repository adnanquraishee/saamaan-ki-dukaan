"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PINCODES, PINCODE_BY_PIN, REGION_LABEL, WAREHOUSE_BY_ID } from "@/lib/config/network";
import { routeOptions } from "@/lib/ml/routing";
import { scoreRto } from "@/lib/ml/rto";
import { useCart } from "@/lib/shop/cart";
import { inr, promiseFor, sendShopCommand, totalStock, useShop } from "@/lib/shop/useShop";
import type { PaymentMode } from "@/lib/types";

const NUDGE_AT = 0.2;

export default function Checkout() {
  const data = useShop();
  const router = useRouter();
  const { items, pincode, setPincode, name, setName, myOrders, rememberOrder, clear } = useCart();
  const [payment, setPayment] = useState<PaymentMode>("cod");
  const [placing, setPlacing] = useState(false);
  const pin = PINCODE_BY_PIN[pincode];
  const cat = useMemo(() => Object.fromEntries(data.catalog.map((p) => [p.sku, p])), [data.catalog]);
  const lines = items.filter((i) => cat[i.sku]);
  const region = pin?.region ?? "west";
  const value = lines.reduce((a, i) => a + cat[i.sku].zonePrice[region] * i.qty, 0);
  const firstTime = myOrders.length === 0;
  const promise = lines.length && pin ? promiseFor(data, pincode, lines, payment) : null;
  const outOfStock = lines.some((i) => totalStock(data.inventory, i.sku) < i.qty);

  // Exactly what the RTO model consumes: pincode tier, payment mode, order value, cart composition (+ courier, first-time).
  const risk = useMemo(() => {
    if (!pin || !lines.length) return null;
    const order = { lines: lines.map((l) => ({ ...l, price: cat[l.sku].zonePrice[region] })), pincode, region, tier: pin.tier, paymentMode: payment, value, firstTime };
    const courier = routeOptions(order, cat, null, data.couriers).sort((a, b) => a.forward - b.forward)[0]?.courierId ?? "CR-KAVERI";
    const base = { tier: pin.tier, value, category: cat[lines[0].sku].category, courierId: courier, cartSize: lines.reduce((a, l) => a + l.qty, 0), firstTime };
    return { cod: scoreRto({ ...base, paymentMode: "cod" }), prepaid: scoreRto({ ...base, paymentMode: "prepaid" }) };
  }, [pin, lines, cat, region, pincode, payment, value, firstTime, data.couriers]);

  const place = async () => {
    if (!pin || !lines.length || !name.trim()) return;
    setPlacing(true);
    const id = `WEB-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
    await sendShopCommand({ type: "placeOrder", order: { id, customerName: name.trim(), pincode, paymentMode: payment, firstTime, lines: lines.map((l) => ({ sku: l.sku, qty: l.qty })) } });
    rememberOrder(id);
    clear();
    router.push(`/orders?placed=${id}`);
  };

  if (!data.ready) return <div className="py-24 text-center text-stone-500">Loading…</div>;
  if (!lines.length)
    return (
      <p className="py-16 text-center text-stone-600">
        Your cart is empty. <Link href="/" className="underline">Shop</Link>
      </p>
    );

  const nudge = payment === "cod" && risk && risk.cod.p >= NUDGE_AT;

  return (
    <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-[1.3fr_1fr]">
      <div className="space-y-6">
        <h1 className="font-serif text-4xl tracking-tight">Checkout</h1>
        <label className="block">
          <span className="text-sm text-stone-600">Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya" className="mt-1 w-full rounded-md border border-shop-sand bg-white px-3 py-2.5 outline-none focus:border-stone-500" />
        </label>
        <label className="block">
          <span className="text-sm text-stone-600">Delivery pincode</span>
          <select value={pincode} onChange={(e) => setPincode(e.target.value)} className="mt-1 w-full rounded-md border border-shop-sand bg-white px-3 py-2.5 outline-none focus:border-stone-500">
            {PINCODES.map((p) => (
              <option key={p.pin} value={p.pin}>
                {p.pin} — {p.city}, {p.state} ({p.tier})
              </option>
            ))}
          </select>
          {pin && <span className="mt-1 block text-xs text-stone-500">{REGION_LABEL[pin.region]} zone · {pin.tier === "metro" ? "Metro" : pin.tier === "tier2" ? "Tier-2 city" : "Tier-3 town"}</span>}
        </label>

        <fieldset>
          <legend className="text-sm text-stone-600">Payment</legend>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {(["prepaid", "cod"] as const).map((m) => (
              <label key={m} className={`cursor-pointer rounded-lg border p-4 transition ${payment === m ? "border-shop-ink bg-white shadow-sm" : "border-shop-sand hover:border-stone-400"}`}>
                <input type="radio" name="pay" className="sr-only" checked={payment === m} onChange={() => setPayment(m)} />
                <div className="font-medium">{m === "prepaid" ? "Pay now (UPI / card)" : "Cash on delivery"}</div>
                <div className="mt-0.5 text-xs text-stone-500">{m === "prepaid" ? "Simulated — no payment is taken" : "Pay when it arrives"}</div>
              </label>
            ))}
          </div>
        </fieldset>

        {nudge && risk && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
            <div className="font-semibold text-amber-900">Prepaid recommended for this order</div>
            <p className="mt-1 text-amber-900/80">
              Orders like this one are often refused at the door ({Math.round(risk.cod.p * 100)}% return-to-origin risk with cash on delivery vs {Math.round(risk.prepaid.p * 100)}% prepaid). Main reasons:
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {risk.cod.top.map((t) => (
                <li key={t.feature} className="rounded-full bg-white px-2 py-0.5 text-xs text-amber-900 ring-1 ring-amber-200">
                  {t.label}
                </li>
              ))}
            </ul>
            <button onClick={() => setPayment("prepaid")} className="mt-3 rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-white">
              Switch to prepaid
            </button>
          </div>
        )}
      </div>

      <aside className="h-fit space-y-4 rounded-xl border border-shop-sand bg-white p-5">
        <h2 className="font-medium">Order summary</h2>
        <ul className="space-y-2 text-sm">
          {lines.map((l) => (
            <li key={l.sku} className="flex justify-between gap-3">
              <span className="text-stone-600">
                {l.qty} × {cat[l.sku].name}
              </span>
              <span className="num">{inr(cat[l.sku].zonePrice[region] * l.qty)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-shop-sand pt-3 font-semibold">
          <span>Total</span>
          <span className="num">{inr(value)}</span>
        </div>
        <div className="text-sm text-stone-600">{promise ? `Estimated delivery: ${promise.days} day${promise.days > 1 ? "s" : ""}${promise.parcels > 1 ? ` · ships in ${promise.parcels} parcels from ${promise.warehouses.map((w) => WAREHOUSE_BY_ID[w].city).join(" + ")}` : !promise.fromHome ? ` · ships from ${WAREHOUSE_BY_ID[promise.warehouseId].city}` : ""}` : "Not deliverable to this pincode"}</div>
        {firstTime && <div className="text-xs text-stone-500">First order with us — welcome.</div>}
        <button onClick={place} disabled={placing || !name.trim() || !promise || outOfStock} className="w-full rounded-md bg-shop-ink py-3 font-medium text-shop-paper transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300">
          {placing ? "Placing…" : outOfStock ? "Some items went out of stock" : `Place order · ${inr(value)}`}
        </button>
        {!name.trim() && <p className="text-center text-xs text-stone-500">Add your name to place the order.</p>}
      </aside>
    </div>
  );
}
