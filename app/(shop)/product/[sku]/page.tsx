"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ProductArt } from "@/components/shop/ProductArt";
import { PriceTag } from "@/components/shop/PriceTag";
import { StockBadge } from "@/components/shop/StockBadge";
import { PINCODE_BY_PIN, REGION_LABEL, WAREHOUSE_BY_ID } from "@/lib/config/network";
import { useCart } from "@/lib/shop/cart";
import { promiseFor, regionOf, totalStock, useShop } from "@/lib/shop/useShop";
import { useApp } from "@/lib/store/store";

export default function ProductPage() {
  const { sku } = useParams<{ sku: string }>();
  const data = useShop();
  const pincode = useCart((s) => s.pincode);
  const add = useCart((s) => s.add);
  const [added, setAdded] = useState(false);
  const decisions = useApp((s) => s.decisions);
  const p = data.catalog.find((x) => x.sku === sku);
  if (!data.ready) return <div className="py-24 text-center text-stone-500">Loading…</div>;
  if (!p) return <div className="py-24 text-center">Not found. <Link href="/" className="underline">Back to shop</Link></div>;
  const region = regionOf(pincode);
  const stock = totalStock(data.inventory, p.sku);
  const promise = stock > 0 ? promiseFor(data, pincode, [{ sku: p.sku, qty: 1 }]) : null;
  const lastPrice = [...decisions].reverse().find((d) => d.title.startsWith("Pricing · set price") && d.summary.startsWith(p.name));
  const pin = PINCODE_BY_PIN[pincode];

  return (
    <div className="grid gap-10 md:grid-cols-2">
      <div className="overflow-hidden rounded-xl bg-white">
        <ProductArt seed={p.imageSeed} category={p.category} className="aspect-square w-full" />
      </div>
      <div className="flex flex-col gap-5">
        <div>
          <Link href="/" className="text-xs uppercase tracking-[0.18em] text-stone-500 hover:text-shop-ink">
            ← {p.category.replace("_", " ")}
          </Link>
          <h1 className="mt-2 font-serif text-4xl leading-tight tracking-tight">{p.name}</h1>
          <p className="mt-1 text-xs text-stone-500">SKU {p.sku}</p>
        </div>
        <PriceTag p={p} region={region} size="lg" />
        <p className="text-xs text-stone-500">
          Price for the {REGION_LABEL[region]} zone. Inclusive of all taxes.
        </p>
        <div className="rounded-lg border border-shop-sand bg-white p-4 text-sm">
          <StockBadge stock={stock} days={promise?.days ?? null} />
          {promise && pin && (
            <p className="mt-1 text-xs text-stone-500">
              Ships from {WAREHOUSE_BY_ID[promise.warehouseId].city} to {pin.city} ({pin.pin}). Promise updates as stock moves between warehouses.
            </p>
          )}
        </div>
        <button
          disabled={stock <= 0 || !promise}
          onClick={() => {
            add(p.sku);
            setAdded(true);
          }}
          className="rounded-md bg-shop-ink px-5 py-3 font-medium text-shop-paper transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {stock <= 0 ? "Sold out" : added ? "Added — add another" : "Add to cart"}
        </button>
        {added && (
          <Link href="/cart" className="text-center text-sm underline underline-offset-4">
            Go to cart
          </Link>
        )}
        {lastPrice && data.mode === "local" && (
          <div className="rounded-lg border border-dashed border-stone-300 p-4 text-xs leading-relaxed text-stone-600">
            <div className="mb-1 font-semibold uppercase tracking-wider text-stone-500">Why this price</div>
            {lastPrice.explanation ?? lastPrice.reasoning}
          </div>
        )}
        <dl className="grid grid-cols-2 gap-3 border-t border-shop-sand pt-5 text-xs text-stone-600">
          <div>
            <dt className="text-stone-400">Weight</dt>
            <dd>{p.weight} kg</dd>
          </div>
          <div>
            <dt className="text-stone-400">Dimensions</dt>
            <dd>
              {p.dims.l} × {p.dims.w} × {p.dims.h} cm
            </dd>
          </div>
          <div>
            <dt className="text-stone-400">Returns</dt>
            <dd>{p.category === "personal_care" ? "Only if defective" : "7-day returns"}</dd>
          </div>
          <div>
            <dt className="text-stone-400">Sizing</dt>
            <dd>{p.category === "apparel" ? "True to size chart" : "—"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
