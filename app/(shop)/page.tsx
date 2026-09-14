"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ProductArt } from "@/components/shop/ProductArt";
import { PriceTag } from "@/components/shop/PriceTag";
import { StockBadge } from "@/components/shop/StockBadge";
import { useCart } from "@/lib/shop/cart";
import { promiseFor, regionOf, totalStock, useShop } from "@/lib/shop/useShop";
import type { Category } from "@/lib/types";

const CATS: { id: Category | "all"; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "apparel", label: "Apparel" },
  { id: "electronics", label: "Electronics" },
  { id: "home", label: "Home" },
  { id: "personal_care", label: "Personal care" },
];

export default function Catalogue() {
  const data = useShop();
  const pincode = useCart((s) => s.pincode);
  const add = useCart((s) => s.add);
  const [cat, setCat] = useState<Category | "all">("all");
  const [q, setQ] = useState("");
  const region = regionOf(pincode);
  const items = useMemo(
    () => data.catalog.filter((p) => (cat === "all" || p.category === cat) && (!q || p.name.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => Number(data.hot.has(b.sku)) - Number(data.hot.has(a.sku))),
    [data.catalog, data.hot, cat, q],
  );

  if (!data.ready) return <div className="py-24 text-center text-stone-500">Opening the shop…</div>;

  return (
    <div>
      <section className="kapde-hero relative -mx-4 mb-16 min-h-[calc(100vh-5rem)] overflow-hidden px-5 py-12 sm:-mx-6 sm:px-10 lg:px-16">
        <div className="hero-word hero-word-top">SAAMAAN</div><div className="hero-word hero-word-bottom">KI DUKAAN</div>
        <div className="hero-copy relative z-10 max-w-sm"><p className="mb-5 text-xs uppercase tracking-[0.28em] text-shop-clay">A living wardrobe · 2026</p><h1 className="font-serif text-4xl leading-[0.95] tracking-tight sm:text-6xl">Objects with a point of view.</h1><p className="mt-5 max-w-xs text-sm leading-relaxed text-stone-600">Clothes, home goods and useful things, selected, priced and delivered by a live network of agents.</p><a href="#catalogue" className="mt-7 inline-flex rounded-full bg-shop-ink px-5 py-3 text-sm text-shop-paper transition hover:-translate-y-1">Explore the collection ↓</a></div>
        <div className="hero-object float-3d"><div className="hero-ring" /><div className="hero-product"><ProductArt seed={17} category="apparel" className="h-full w-full" /></div></div>
        <div className="hero-note hidden sm:block">LIVE INVENTORY<br /><b>{region.toUpperCase()} ZONE</b></div><div className="hero-scroll">SCROLL TO SHOP ↓</div>
      </section>

      <div id="catalogue" className="mb-6 flex scroll-mt-24 flex-wrap items-center gap-2">
        <div className="mr-auto"><p className="text-xs uppercase tracking-[0.2em] text-shop-clay">The collection</p><p className="mt-1 text-sm text-stone-500">Live prices · live stock · {region} delivery</p></div>
        {CATS.map((c) => (
          <button key={c.id} onClick={() => setCat(c.id)} className={`rounded-full border px-3.5 py-1.5 text-sm transition ${cat === c.id ? "border-shop-ink bg-shop-ink text-shop-paper" : "border-shop-sand bg-white hover:border-stone-400"}`}>
            {c.label}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="ml-auto w-full rounded-full border border-shop-sand bg-white px-4 py-1.5 text-sm outline-none focus:border-stone-400 sm:w-56" />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((p) => {
          const stock = totalStock(data.inventory, p.sku);
          const promise = stock > 0 ? promiseFor(data, pincode, [{ sku: p.sku, qty: 1 }]) : null;
          return (
            <article key={p.sku} className="card-3d group flex flex-col rounded-xl p-1">
              <Link href={`/product/${p.sku}`} className="relative block overflow-hidden rounded-lg bg-white">
                <ProductArt seed={p.imageSeed} category={p.category} className="aspect-square w-full transition duration-300 group-hover:scale-[1.03]" />
                {data.hot.has(p.sku) && <span className="absolute left-2 top-2 rounded-full bg-shop-ink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">Trending</span>}
              </Link>
              <div className="mt-3 flex flex-1 flex-col gap-1">
                <Link href={`/product/${p.sku}`} className="line-clamp-2 text-sm font-medium leading-snug hover:underline">
                  {p.name}
                </Link>
                <PriceTag p={p} region={region} />
                <StockBadge stock={stock} days={promise?.days ?? null} />
                <button
                  disabled={stock <= 0 || !promise}
                  onClick={() => add(p.sku)}
                  className="mt-2 rounded-md border border-shop-ink px-3 py-1.5 text-sm font-medium transition hover:bg-shop-ink hover:text-shop-paper disabled:cursor-not-allowed disabled:border-stone-200 disabled:text-stone-400 disabled:hover:bg-transparent"
                >
                  {stock <= 0 ? "Sold out" : "Add to cart"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
