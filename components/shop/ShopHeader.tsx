"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PINCODES, PINCODE_BY_PIN, REGION_LABEL } from "@/lib/config/network";
import { useCart } from "@/lib/shop/cart";
import { useShop } from "@/lib/shop/useShop";

export function ShopHeader() {
  const count = useCart((s) => s.items.reduce((a, i) => a + i.qty, 0));
  const pincode = useCart((s) => s.pincode);
  const setPincode = useCart((s) => s.setPincode);
  const data = useShop();
  const path = usePathname();
  const pin = PINCODE_BY_PIN[pincode];
  const link = (href: string, label: string) => (
    <Link href={href} className={`rounded-full px-3 py-1.5 text-sm transition ${path === href ? "bg-shop-ink text-shop-paper" : "hover:bg-shop-sand"}`}>
      {label}
    </Link>
  );
  return (
    <header className="sticky top-0 z-30 border-b border-shop-sand bg-shop-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="mr-2 flex items-baseline gap-2">
          <span className="font-serif text-2xl font-semibold tracking-tight">Saamaan ki Dukaan</span>
          <span className="hidden text-[11px] uppercase tracking-[0.18em] text-stone-500 sm:inline">goods for everyday</span>
        </Link>
        <nav className="flex items-center gap-1">
          {link("/", "Shop")}
          {link("/orders", "Orders")}
          <Link href="/dashboard/login" className="rounded-full border border-shop-ink px-3 py-1.5 text-sm transition hover:bg-shop-ink hover:text-shop-paper">Control tower</Link>
          <Link href="/cart" className={`rounded-full px-3 py-1.5 text-sm transition ${path === "/cart" ? "bg-shop-ink text-shop-paper" : "hover:bg-shop-sand"}`}>
            Cart{count ? <span className="ml-1.5 rounded-full bg-shop-clay px-1.5 py-0.5 text-[11px] font-semibold text-white">{count}</span> : null}
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-xs text-stone-500 md:flex" title={data.mode === "remote" ? "Connected to the presenter's engine" : "Agents running in this browser"}>
            <span className={`h-1.5 w-1.5 rounded-full ${data.ready ? "bg-emerald-500" : "bg-stone-300"}`} />
            {data.mode === "remote" ? "live · connected" : "live"}
          </span>
          <label className="flex items-center gap-2 rounded-full border border-shop-sand bg-white px-3 py-1.5 text-sm">
            <span className="text-stone-500">Deliver to</span>
            <select value={pincode} onChange={(e) => setPincode(e.target.value)} className="max-w-[9.5rem] bg-transparent font-medium outline-none">
              {PINCODES.map((p) => (
                <option key={p.pin} value={p.pin}>
                  {p.city} {p.pin}
                </option>
              ))}
            </select>
          </label>
          {pin && <span className="hidden text-[11px] uppercase tracking-wider text-stone-400 lg:inline">{REGION_LABEL[pin.region]} zone</span>}
        </div>
      </div>
    </header>
  );
}
