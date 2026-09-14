import type { Product, Region } from "@/lib/types";
import { inr } from "@/lib/shop/useShop";

export function PriceTag({ p, region, size = "md" }: { p: Product; region: Region; size?: "md" | "lg" }) {
  const price = p.zonePrice[region];
  const off = Math.round((1 - price / p.mrp) * 100);
  const vsList = price - p.basePrice;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className={`num font-semibold ${size === "lg" ? "text-3xl" : "text-lg"}`}>{inr(price)}</span>
      <span className={`num text-stone-400 line-through ${size === "lg" ? "text-base" : "text-xs"}`}>{inr(p.mrp)}</span>
      {off > 0 && <span className={`font-medium text-shop-moss ${size === "lg" ? "text-sm" : "text-xs"}`}>{off}% off</span>}
      {vsList > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">high demand</span>}
      {vsList < 0 && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">price drop</span>}
    </div>
  );
}
