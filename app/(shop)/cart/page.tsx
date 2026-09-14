"use client";
import Link from "next/link";
import { ProductArt } from "@/components/shop/ProductArt";
import { useCart } from "@/lib/shop/cart";
import { inr, promiseFor, regionOf, totalStock, useShop } from "@/lib/shop/useShop";

export default function CartPage() {
  const data = useShop();
  const { items, setQty, pincode } = useCart();
  const region = regionOf(pincode);
  const cat = Object.fromEntries(data.catalog.map((p) => [p.sku, p]));
  const lines = items.filter((i) => cat[i.sku]);
  const subtotal = lines.reduce((a, i) => a + cat[i.sku].zonePrice[region] * i.qty, 0);
  const promise = lines.length ? promiseFor(data, pincode, lines) : null;
  if (!data.ready) return <div className="py-24 text-center text-stone-500">Loading…</div>;
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 font-serif text-4xl tracking-tight">Your cart</h1>
      {!lines.length ? (
        <p className="text-stone-600">
          Nothing here yet. <Link href="/" className="underline underline-offset-4">Browse the shop</Link>.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-shop-sand border-y border-shop-sand">
            {lines.map((i) => {
              const p = cat[i.sku];
              const stock = totalStock(data.inventory, p.sku);
              return (
                <li key={i.sku} className="flex items-center gap-4 py-4">
                  <ProductArt seed={p.imageSeed} category={p.category} className="h-20 w-20 rounded-md" />
                  <div className="flex-1">
                    <div className="font-medium">{p.name}</div>
                    <div className="num text-sm text-stone-600">{inr(p.zonePrice[region])} each</div>
                    {stock < i.qty && <div className="text-xs text-red-700">Only {stock} available</div>}
                  </div>
                  <div className="flex items-center rounded-md border border-shop-sand bg-white">
                    <button className="px-3 py-1" onClick={() => setQty(i.sku, i.qty - 1)}>−</button>
                    <span className="num w-6 text-center">{i.qty}</span>
                    <button className="px-3 py-1" onClick={() => setQty(i.sku, i.qty + 1)}>+</button>
                  </div>
                  <div className="num w-24 text-right font-medium">{inr(p.zonePrice[region] * i.qty)}</div>
                </li>
              );
            })}
          </ul>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
            <div className="text-sm text-stone-600">{promise ? `Arrives in about ${promise.days} days` : "Not deliverable to the selected pincode"}</div>
            <div className="text-right">
              <div className="num text-2xl font-semibold">{inr(subtotal)}</div>
              <Link href="/checkout" className={`mt-3 inline-block rounded-md bg-shop-ink px-6 py-3 font-medium text-shop-paper ${!promise ? "pointer-events-none opacity-40" : ""}`}>
                Checkout
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
