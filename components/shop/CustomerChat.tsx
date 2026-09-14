"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { respond as answer, type Action, type Card, type Memory, type OrderView, type ProductView } from "@/lib/shop/assistant";
import { useCart } from "@/lib/shop/cart";
import { inr, sendShopCommand, useShop } from "@/lib/shop/useShop";
import { ProductArt } from "./ProductArt";

type Message = { id: string; from: "bot" | "customer"; text: string; cards?: Card[]; actions?: Action[]; source?: "llm" | "rules"; ticket?: string };
const STORE_KEY = "sct:chat:v2";
const uid = () => Math.random().toString(36).slice(2, 10);

const WELCOME: Message = {
  id: "welcome",
  from: "bot",
  text: "Hi! I'm the Saamaan ki Dukaan assistant. I can track your orders (including split parcels), check delivery to your pincode, find products and help with returns.",
  actions: [
    { type: "prompt", label: "Track my order", prompt: "Where is my latest order?" },
    { type: "prompt", label: "Delivery to my pincode", prompt: "When will my cart be delivered?" },
    { type: "prompt", label: "Gifts under ₹1,000", prompt: "Show gifts under 1000" },
    { type: "prompt", label: "Return an item", prompt: "I want to return an item" },
  ],
};

export function CustomerChat() {
  const data = useShop();
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [memory, setMemory] = useState<Memory>({});
  const [unread, setUnread] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "null");
      if (saved?.messages?.length) {
        setMessages(saved.messages);
        setMemory(saved.memory ?? {});
      }
    } catch {
      /* fresh conversation */
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ messages: messages.slice(-40), memory }));
    } catch {
      /* storage unavailable */
    }
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, memory, busy]);

  const ctx = useMemo(
    () => ({ tick: data.tick, catalog: data.catalog, inventory: data.inventory, couriers: data.couriers, orders: data.orders, returns: data.returns, shipments: data.shipments, myOrderIds: cart.myOrders, cart: cart.items, pincode: cart.pincode, customerName: cart.name }),
    [data, cart.myOrders, cart.items, cart.pincode, cart.name],
  );

  async function ask(raw: string) {
    const clean = raw.trim();
    if (!clean || busy) return;
    if (!data.ready) {
      setMessages((m) => [...m, { id: uid(), from: "customer", text: clean }, { id: uid(), from: "bot", text: "The store is still loading live data — give me a second and try again." }]);
      return;
    }
    setInput("");
    const history = messages.slice(-6).map((m) => ({ from: m.from, text: m.text }));
    setMessages((m) => [...m, { id: uid(), from: "customer", text: clean }]);
    setBusy(true);
    const reply = answer(clean, ctx, memory);
    setMemory(reply.memory);
    let replyText = reply.text;
    let source: Message["source"] = "rules";
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      const r = await fetch("/api/customer-chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: clean, draft: reply.text, facts: reply.facts, history }), signal: ctrl.signal });
      clearTimeout(timer);
      const j = await r.json();
      if (j.reply) {
        replyText = j.reply;
        source = j.source;
      }
    } catch {
      /* grounded draft stands */
    }
    let ticket: string | undefined;
    if (reply.escalate) ticket = await raiseTicket(reply.escalate.category, reply.escalate.reason, clean, reply.memory.orderId);
    setMessages((m) => [...m, { id: uid(), from: "bot", text: replyText, cards: reply.cards, actions: reply.actions, source, ticket }]);
    setBusy(false);
    if (!open) setUnread(true);
  }

  async function raiseTicket(category: string, reason: string, message: string, orderId?: string) {
    const ref = `SKD-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    try {
      await sendShopCommand({ type: "supportTicket", ticket: { ref, category, reason, orderId, customerName: cart.name, message } });
    } catch {
      /* ticket reference still shown */
    }
    return ref;
  }

  async function runAction(a: Action) {
    if (a.type === "prompt") return ask(a.prompt);
    if (a.type === "add") {
      cart.add(a.sku);
      const p = data.catalog.find((x) => x.sku === a.sku);
      setMessages((m) => [...m, { id: uid(), from: "bot", text: `Added ${p?.name ?? a.sku} to your cart. You now have ${cart.items.reduce((s, i) => s + i.qty, 0) + 1} item(s).`, actions: [{ type: "link", label: "View cart", href: "/cart" }, { type: "link", label: "Checkout", href: "/checkout" }] }]);
      return;
    }
    if (a.type === "ticket") {
      const ref = await raiseTicket(a.category, "Customer asked for a person", messages.filter((m) => m.from === "customer").slice(-1)[0]?.text ?? "", memory.orderId);
      setMessages((m) => [...m, { id: uid(), from: "bot", text: "I've passed this to our support team with the conversation so far. They'll pick it up shortly.", ticket: ref }]);
    }
  }

  function reset() {
    setMessages([WELCOME]);
    setMemory({});
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end">
      {open && (
        <div className="mb-3 flex h-[min(38rem,78vh)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-shop-sand bg-shop-paper shadow-[0_24px_60px_-12px_rgba(28,25,23,.35)]" role="dialog" aria-label="Customer support chat">
          <div className="flex items-center gap-3 border-b border-shop-sand bg-white px-4 py-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-shop-ink font-serif text-sm text-shop-paper">SD</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">Saamaan ki Dukaan support</div>
              <div className="flex items-center gap-1.5 text-[11px] text-stone-500">
                <span className={`h-1.5 w-1.5 rounded-full ${data.ready ? "bg-emerald-500" : "bg-stone-300"}`} />
                Answers from live orders, stock & delivery data
              </div>
            </div>
            <button onClick={reset} className="rounded-full px-2 py-1 text-[11px] text-stone-500 hover:bg-shop-sand" title="Start a new conversation">
              New chat
            </button>
          </div>

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
            {messages.map((m) => (
              <div key={m.id} className={`flex flex-col ${m.from === "customer" ? "items-end" : "items-start"}`}>
                <div className={`max-w-[88%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${m.from === "customer" ? "rounded-br-md bg-shop-ink text-shop-paper" : "rounded-bl-md bg-white text-stone-800 shadow-sm ring-1 ring-shop-sand"}`}>{m.text}</div>
                {m.ticket && (
                  <div className="mt-1.5 flex max-w-[88%] items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <span className="font-semibold">Ticket {m.ticket}</span>
                    <span className="text-amber-800/80">raised with support</span>
                  </div>
                )}
                {m.cards?.map((c, i) => (
                  <div key={i} className="mt-2 w-full max-w-[92%]">
                    <CardView card={c} onAction={runAction} />
                  </div>
                ))}
                {m.actions?.length ? (
                  <div className="mt-2 flex max-w-[95%] flex-wrap gap-1.5">
                    {m.actions.map((a, i) =>
                      a.type === "link" ? (
                        <Link key={i} href={a.href} onClick={() => setOpen(false)} className="rounded-full border border-shop-sand bg-white px-3 py-1 text-xs font-medium text-shop-ink hover:border-stone-400">
                          {a.label} →
                        </Link>
                      ) : (
                        <button key={i} onClick={() => runAction(a)} disabled={busy} className={`rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-50 ${a.type === "add" ? "border-shop-ink bg-shop-ink text-shop-paper" : a.type === "ticket" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-shop-sand bg-white text-shop-ink hover:border-stone-400"}`}>
                          {a.label}
                        </button>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-1.5 px-2 text-xs text-stone-500">
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400" style={{ animationDelay: `${i * 120}ms` }} />
                  ))}
                </span>
                Checking live store data…
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex items-center gap-2 border-t border-shop-sand bg-white p-3"
          >
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about an order, delivery or product…" maxLength={500} className="min-w-0 flex-1 rounded-full border border-shop-sand bg-shop-paper px-4 py-2.5 text-sm outline-none focus:border-stone-400" aria-label="Message" />
            <button disabled={busy || !input.trim()} className="grid h-10 w-10 place-items-center rounded-full bg-shop-clay text-white transition hover:bg-orange-800 disabled:opacity-40" aria-label="Send">
              ↑
            </button>
          </form>
        </div>
      )}
      <button
        onClick={() => {
          setOpen(!open);
          setUnread(false);
        }}
        className="relative flex items-center gap-2 rounded-full bg-shop-ink px-5 py-3 text-sm font-medium text-shop-paper shadow-lg transition hover:bg-stone-800"
        aria-expanded={open}
      >
        {open ? "Close" : "Need help?"}
        {unread && !open && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-shop-clay ring-2 ring-shop-paper" />}
      </button>
    </div>
  );
}

function CardView({ card, onAction }: { card: Card; onAction: (a: Action) => void }) {
  if (card.kind === "order") return <OrderCard o={card.order} />;
  if (card.kind === "orders") return <div className="space-y-2">{card.orders.map((o) => <OrderCard key={o.id} o={o} compact />)}</div>;
  if (card.kind === "products")
    return (
      <div className="rounded-xl bg-white p-2 ring-1 ring-shop-sand">
        {card.title && <div className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-500">{card.title}</div>}
        <div className="space-y-1.5">
          {card.items.map((p) => (
            <ProductRow key={p.sku} p={p} onAction={onAction} />
          ))}
        </div>
      </div>
    );
  return (
    <div className="rounded-xl bg-white p-3 text-xs ring-1 ring-shop-sand">
      {card.lines.map((l, i) => (
        <div key={i} className="flex justify-between gap-2 py-0.5">
          <span className="truncate text-stone-700">
            {l.qty} × {l.name}
          </span>
          <span className="num">{inr(l.price * l.qty)}</span>
        </div>
      ))}
      <div className="mt-1.5 flex justify-between border-t border-shop-sand pt-1.5 font-semibold">
        <span>Total</span>
        <span className="num">{inr(card.total)}</span>
      </div>
      {card.deliveryDays && (
        <div className="mt-1 text-stone-500">
          Arrives in ~{card.deliveryDays} days{card.parcels > 1 ? ` · ${card.parcels} parcels` : ""}
        </div>
      )}
    </div>
  );
}

const TONE: Record<OrderView["statusTone"], string> = { info: "bg-sky-100 text-sky-800", good: "bg-emerald-100 text-emerald-800", warn: "bg-amber-100 text-amber-800", bad: "bg-red-100 text-red-800" };

function OrderCard({ o, compact }: { o: OrderView; compact?: boolean }) {
  return (
    <div className="rounded-xl bg-white p-3 text-xs ring-1 ring-shop-sand">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-stone-900">{o.id}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${TONE[o.statusTone]}`}>{o.status}</span>
      </div>
      <div className="mt-0.5 text-stone-500">
        {inr(o.value)} · {o.payment} · to {o.city}
      </div>
      {!compact && <div className="mt-1.5 text-stone-700">{o.items.join(", ")}</div>}
      {!compact && o.parcels.length > 0 && (
        <ol className="mt-2 space-y-1.5 border-l-2 border-shop-sand pl-3">
          {o.parcels.map((p, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-shop-clay ring-2 ring-white" />
              <div className="font-medium text-stone-800">
                {o.parcels.length > 1 ? `Parcel ${i + 1}: ` : ""}
                {p.status}
                {p.etaDays !== null ? ` · ${p.etaDays === 0 ? "today" : `~${p.etaDays} day${p.etaDays > 1 ? "s" : ""}`}` : ""}
              </div>
              <div className="text-stone-500">
                From {p.from} via {p.courier}
                {o.parcels.length > 1 ? ` · ${p.items}` : ""}
              </div>
            </li>
          ))}
        </ol>
      )}
      {!compact && o.note && <div className="mt-2 rounded-md bg-shop-paper px-2 py-1.5 text-stone-600">{o.note}</div>}
      {o.returnStatus && <div className="mt-1.5 text-stone-600">Return: {o.returnStatus}</div>}
      {compact && (
        <div className="mt-1 flex gap-3">
          <span className="text-stone-500">{o.items.length} item(s)</span>
          {o.returnEligible && (
            <Link href={`/return/${o.id}`} className="font-medium underline underline-offset-2">
              Return
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function ProductRow({ p, onAction }: { p: ProductView; onAction: (a: Action) => void }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg p-1 hover:bg-shop-paper">
      <Link href={`/product/${p.sku}`} className="shrink-0 overflow-hidden rounded-md">
        <ProductArt seed={p.imageSeed} category={p.category} className="h-12 w-12" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/product/${p.sku}`} className="block truncate text-[12.5px] font-medium text-stone-900 hover:underline">
          {p.name}
        </Link>
        <div className="flex items-baseline gap-1.5 text-xs">
          <span className="num font-semibold">{inr(p.price)}</span>
          {p.mrp > p.price && <span className="num text-[10.5px] text-stone-400 line-through">{inr(p.mrp)}</span>}
        </div>
        <div className={`text-[10.5px] ${p.inStock ? "text-stone-500" : "text-red-700"}`}>
          {!p.inStock ? "Out of stock" : `${p.lowStock ? "Few left · " : ""}${p.deliveryDays ? `~${p.deliveryDays} days${p.parcels > 1 ? ` · ${p.parcels} parcels` : ""}` : "Not deliverable here"}`}
        </div>
      </div>
      {p.inStock && (
        <button onClick={() => onAction({ type: "add", label: "Add", sku: p.sku })} className="shrink-0 rounded-full border border-shop-ink px-2.5 py-1 text-[11px] font-medium hover:bg-shop-ink hover:text-shop-paper">
          Add
        </button>
      )}
    </div>
  );
}
