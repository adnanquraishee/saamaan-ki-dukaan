import { ShopHeader } from "@/components/shop/ShopHeader";
import { CustomerChat } from "@/components/shop/CustomerChat";
import { Live3DBackground } from "@/components/shop/Live3DBackground";

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-transparent text-shop-ink">
      <Live3DBackground />
      <ShopHeader />
      <main className="relative z-10 mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6">{children}</main>
      <footer className="relative z-10 border-t border-shop-sand bg-shop-paper/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-stone-500 sm:px-6">
          <span>Saamaan ki Dukaan · a demo store. Prices, stock and delivery promises are set live by autonomous agents.</span>
          <a href="/dashboard" className="underline decoration-stone-300 underline-offset-4 hover:text-shop-ink">Control tower →</a>
        </div>
      </footer>
      <CustomerChat />
    </div>
  );
}
