// Customer support assistant: a deterministic, grounded answer engine over live store data.
// Pipeline: normalise (typos, Hinglish) → extract entities (order IDs, products, pincodes, budgets) → classify intent
// (with conversation memory) → look facts up in state → draft a professional reply with cards and next actions.
// An optional server-side LLM may only rephrase the draft; every figure it writes is validated against these facts.

import { COURIER_BY_ID, HOME_WAREHOUSE, PINCODES, PINCODE_BY_PIN, REGION_LABEL, WAREHOUSE_BY_ID } from "@/lib/config/network";
import { deliveryPromise } from "@/lib/ml/routing";
import type { Category, Courier, Order, Pincode, Product, ReturnRequest, Shipment, WarehouseId } from "@/lib/types";

export const RETURN_WINDOW_DAYS = 7;
export const INSPECTION_DAYS = 2; // matches the returns agent: inspected refunds settle 48h after pickup
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const days = (n: number) => (n <= 0 ? "today" : n === 1 ? "tomorrow" : `in about ${n} days`);

export interface AssistantContext {
  tick: number;
  catalog: Product[];
  inventory: Record<string, Record<WarehouseId, number>>;
  couriers: Courier[];
  orders: Order[];
  returns: ReturnRequest[];
  shipments?: Shipment[];
  myOrderIds: string[];
  cart: { sku: string; qty: number }[];
  pincode: string;
  customerName: string;
}

export interface Memory {
  orderId?: string;
  skus?: string[];
  pincode?: string;
  lastIntent?: Intent;
  pendingComplaint?: string; // complaint category awaiting an order ID
  cancelRequested?: string[];
  listed?: string[]; // order IDs shown in the last order list, so "2" can pick one
}

export type Intent =
  | "greeting"
  | "thanks"
  | "goodbye"
  | "order_status"
  | "order_eta"
  | "order_list"
  | "split_explain"
  | "delivery_estimate"
  | "product_search"
  | "stock_check"
  | "price_check"
  | "add_to_cart"
  | "cart_summary"
  | "return_request"
  | "return_status"
  | "refund_status"
  | "return_policy"
  | "exchange"
  | "cancel_order"
  | "address_change"
  | "payment_help"
  | "shipping_policy"
  | "promo"
  | "compare"
  | "ack"
  | "complaint"
  | "human_handoff"
  | "unsafe_request"
  | "out_of_scope"
  | "help"
  | "unknown";

export interface ProductView {
  sku: string;
  name: string;
  category: Category;
  price: number;
  mrp: number;
  inStock: boolean;
  lowStock: boolean;
  deliveryDays: number | null;
  parcels: number;
  imageSeed: number;
}

export interface ParcelView {
  from: string;
  courier: string;
  items: string;
  status: string;
  etaDays: number | null;
}

export interface OrderView {
  id: string;
  status: string;
  statusTone: "info" | "good" | "warn" | "bad";
  value: number;
  placedDaysAgo: number;
  city: string;
  payment: string;
  items: string[];
  parcels: ParcelView[];
  note?: string;
  returnEligible: boolean;
  returnStatus?: string;
  deliveredDaysAgo?: number;
}

export type Card = { kind: "order"; order: OrderView } | { kind: "orders"; orders: OrderView[] } | { kind: "products"; title?: string; items: ProductView[] } | { kind: "cart"; lines: { name: string; qty: number; price: number }[]; total: number; deliveryDays: number | null; parcels: number };

export type Action = { type: "link"; label: string; href: string } | { type: "prompt"; label: string; prompt: string } | { type: "add"; label: string; sku: string } | { type: "ticket"; label: string; category: string };

/** Intents whose replies are hand-written policy/template text; rephrasing adds latency and quota for no gain. */
export const TEMPLATE_INTENTS = new Set<Intent>(["greeting", "thanks", "goodbye", "ack", "promo", "return_policy", "exchange", "payment_help", "shipping_policy", "human_handoff", "unsafe_request", "out_of_scope", "help", "unknown"]);

export interface Reply {
  intent: Intent;
  text: string;
  cards?: Card[];
  actions?: Action[];
  escalate?: { category: string; reason: string };
  facts: Record<string, unknown>;
  memory: Memory;
}

// ------------------------------------------------------------------ normalisation
const TYPOS: Record<string, string> = {
  wher: "where", whre: "where", were: "where", ordr: "order", oder: "order", odr: "order", orde: "order", ordder: "order", orders: "orders",
  trak: "track", trackk: "track", traking: "tracking", stauts: "status", staus: "status", statu: "status",
  delivry: "delivery", delievery: "delivery", delivey: "delivery", devlivery: "delivery", dilivery: "delivery", deliverd: "delivered", recieved: "received", recived: "received", recieve: "receive",
  retrun: "return", retun: "return", reutrn: "return", refnd: "refund", refud: "refund", cancle: "cancel", cancell: "cancel", cancelation: "cancellation",
  parcle: "parcel", pakage: "package", packge: "package", payement: "payment", paymnt: "payment", adress: "address", pincod: "pincode", pin: "pincode",
  pls: "please", plz: "please", u: "you", ur: "your", r: "are", abt: "about", wat: "what", wht: "what",
};
const HINGLISH: [RegExp, string][] = [
  [/\b(kab|kab tak)\s+(aayega|aaega|ayega|aayegi|milega|milegi|pahunchega|aega)\b/g, "when will it arrive"],
  [/\b(kaha|kahan|kidhar)\s+(hai|he)\b/g, "where is"],
  [/\bmera\b|\bmeri\b|\bmere\b/g, "my"],
  [/\b(paisa|paise)\s+(wapas|vapas)\b/g, "refund"],
  [/\b(wapas|vapas|lautana|return karna)\b/g, "return"],
  [/\b(cancel karo|cancel karna|rad karo|band karo)\b/g, "cancel"],
  [/\b(chahiye|chaiye)\b/g, "need"],
  [/\b(kitne ka|kitna|kitne)\b/g, "how much"],
  [/\b(tuta|toota|tuta hua|kharab)\b/g, "damaged"],
  [/\b(nahi mila|nahi aaya|nhi mila)\b/g, "not received"],
  [/\b(dhanyavad|shukriya)\b/g, "thanks"],
];

function normalise(raw: string) {
  let s = raw.toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim();
  for (const [re, rep] of HINGLISH) s = s.replace(re, rep);
  s = s.replace(/\b[a-z]+\b/g, (w) => TYPOS[w] ?? w);
  return s
    .replace(/\bt[\s-]?shirts?\b|\btees?\b/g, "tee")
    .replace(/\bear ?buds|earphones?|tws|airpods\b/g, "earbuds")
    .replace(/\bhead ?phones?\b/g, "headphones")
    .replace(/\bpower ?bank\b/g, "power bank")
    .replace(/\bsmart ?watch(es)?\b/g, "smartwatch")
    .replace(/\bbed ?sheets?\b/g, "bedsheet");
}

const STOP = new Set(
  "a an the is are am i me my you your for to of on in at it its this that please can could would will do does did with and or any some what where when how which there have has get show tell want need about from be much price cost stock available delivery deliver order also me buy looking find search show under below above over between cheap cheapest best gift gifts mom mother dad father wife husband friend sister brother someone birthday anniversary him her them kids new good nice".split(" "),
);
function tokens(s: string) {
  return normalise(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t))
    .map((t) => (t.length > 4 && t.endsWith("es") ? t.slice(0, -2) : t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
}
const has = (q: string, re: RegExp) => re.test(q);

const CATEGORY_WORDS: Record<Category, RegExp> = {
  apparel: /\b(cloth|clothes|clothing|apparel|wear|shirt|tee|kurta|kurti|jeans|dress|jacket|hoodie|saree|pants|shorts|fashion|outfit)\b/,
  electronics: /\b(electronic|electronics|gadget|gadgets|earbuds|headphones|speaker|charger|smartwatch|power bank|mouse|keyboard|webcam|cable|tech)\b/,
  home: /\b(home|kitchen|bedsheet|decor|bottle|mug|mugs|lamp|cooker|towel|curtain|pillow|rug|storage|dinner set)\b/,
  personal_care: /\b(personal care|skin|skincare|beauty|face ?wash|serum|lotion|shampoo|hair|beard|sunscreen|soap|deodorant|grooming)\b/,
};
const CATEGORY_NAME: Record<Category, string> = { apparel: "apparel", electronics: "electronics", home: "home & kitchen", personal_care: "personal care" };

function parsePrice(q: string) {
  const num = (s: string, k?: string) => Number(s.replace(/[,\s]/g, "")) * (k ? 1000 : 1);
  const between = q.match(/between\s*(?:rs\.?|₹|inr)?\s*([\d,]+)\s*(k\b)?\s*(?:and|-|to)\s*(?:rs\.?|₹|inr)?\s*([\d,]+)\s*(k\b)?/);
  if (between) return { min: num(between[1], between[2]), max: num(between[3], between[4]) };
  const under = q.match(/(?:under|below|less than|upto|up to|within|max(?:imum)?|budget(?: of| is)?|<)\s*(?:rs\.?|₹|inr)?\s*([\d,]+)\s*(k\b)?/);
  const over = q.match(/(?:above|over|more than|atleast|at least|min(?:imum)?|>)\s*(?:rs\.?|₹|inr)?\s*([\d,]+)\s*(k\b)?/);
  return { min: over ? num(over[1], over[2]) : undefined, max: under ? num(under[1], under[2]) : undefined };
}

function findPincode(q: string): Pincode | null {
  const m = q.match(/\b(\d{6})\b/);
  if (m && PINCODE_BY_PIN[m[1]]) return PINCODE_BY_PIN[m[1]];
  const alias: Record<string, string> = { bangalore: "bengaluru", bombay: "mumbai", calcutta: "kolkata", gurgaon: "gurugram", delhi: "new delhi", madras: "chennai", trivandrum: "thiruvananthapuram", mysore: "mysuru", vizag: "visakhapatnam", pondicherry: "puducherry", cochin: "kochi", baroda: "vadodara", poona: "pune" };
  let t = q;
  for (const [a, b] of Object.entries(alias)) t = t.replace(new RegExp(`\\b${a}\\b`, "g"), b);
  const cities = Array.from(new Set(PINCODES.map((p) => p.city.toLowerCase().replace(/\s*\(.*\)$/, "")))).sort((a, b) => b.length - a.length);
  for (const city of cities) {
    if (city === "new delhi" ? /\bnew delhi\b/.test(t) : new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t)) return PINCODES.find((p) => p.city.toLowerCase() === city) ?? null;
  }
  return null;
}
const unknownPincode = (q: string) => {
  const m = q.match(/\b(\d{6})\b/);
  return m && !PINCODE_BY_PIN[m[1]] ? m[1] : null;
};
const findOrderId = (raw: string) => raw.toUpperCase().match(/\b((?:WEB|ORD)-[A-Z0-9]+)\b/)?.[1] ?? null;

function matchProducts(q: string, catalog: Product[], limit = 4) {
  const skuHit = catalog.find((p) => new RegExp(`\\b${p.sku}\\b`, "i").test(q));
  if (skuHit) return [skuHit];
  const qt = tokens(q);
  if (!qt.length) return [];
  const scored = catalog
    .map((p) => {
      const nt = tokens(p.name);
      let score = 0;
      for (const t of qt) {
        if (nt.includes(t)) score += 2;
        else if (t.length >= 4 && nt.some((n) => n.length >= 4 && (n.startsWith(t) || t.startsWith(n)))) score += 1;
      }
      return { p, score: score / Math.sqrt(nt.length + 1) };
    })
    .filter((x) => x.score >= 0.8)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  return scored.filter((x) => x.score >= scored[0].score * 0.65).slice(0, limit).map((x) => x.p);
}

// ------------------------------------------------------------------ views
const stockOf = (ctx: AssistantContext, sku: string) => Object.values(ctx.inventory[sku] ?? {}).reduce((a, v) => a + Math.max(0, v), 0);

export function productView(ctx: AssistantContext, p: Product, pincode: string): ProductView {
  const pin = PINCODE_BY_PIN[pincode] ?? PINCODE_BY_PIN["400053"];
  const stock = stockOf(ctx, p.sku);
  const cat = Object.fromEntries(ctx.catalog.map((x) => [x.sku, x]));
  const price = p.zonePrice[pin.region];
  const promise = stock > 0 ? deliveryPromise({ lines: [{ sku: p.sku, qty: 1, price }], pincode: pin.pin, region: pin.region, tier: pin.tier, paymentMode: "prepaid", value: price, firstTime: false }, cat, ctx.inventory, ctx.couriers) : null;
  return { sku: p.sku, name: p.name, category: p.category, price, mrp: p.mrp, inStock: stock > 0, lowStock: stock > 0 && stock < 15, deliveryDays: promise?.days ?? null, parcels: promise?.parcels ?? 1, imageSeed: p.imageSeed };
}

const STATUS_TEXT: Record<Order["status"], [string, OrderView["statusTone"]]> = {
  placed: ["Confirmed", "info"],
  allocated: ["Packed", "info"],
  shipped: ["On the way", "info"],
  delivered: ["Delivered", "good"],
  rto: ["Returned to us", "bad"],
  returned: ["Returned", "warn"],
  backordered: ["Awaiting stock", "warn"],
  cancelled: ["Cancelled", "bad"],
};
const RETURN_TEXT: Record<ReturnRequest["status"], string> = {
  requested: "return requested — our team is reviewing it",
  inspecting: "pickup scheduled; the refund is issued after a quick quality check",
  restocked: "refunded",
  liquidated: "refunded",
  refunded: "refunded",
  rejected: "return declined after inspection",
  escalated: "under review by our support team",
};

interface OrderFacts {
  view: OrderView;
  order: Order;
  delivered: boolean;
  ret?: ReturnRequest;
  legs: NonNullable<Order["legs"]>;
}

function orderFacts(ctx: AssistantContext, o: Order): OrderFacts {
  const names = Object.fromEntries(ctx.catalog.map((p) => [p.sku, p.name]));
  const pin = PINCODE_BY_PIN[o.pincode];
  const shipsById = new Map((ctx.shipments ?? []).map((s) => [s.id, s]));
  const orderShips = (ctx.shipments ?? []).filter((s) => s.orderId === o.id);
  const legs = o.legs ?? (o.warehouseId && o.courierId ? [{ shipmentId: orderShips[0]?.id ?? "", warehouseId: o.warehouseId, courierId: o.courierId, lines: o.lines, cost: o.shipCost ?? 0, promisedDays: o.promisedDays ?? 0 }] : []);
  const parcels: ParcelView[] = legs.map((l) => {
    const s = l.shipmentId ? shipsById.get(l.shipmentId) : orderShips[0];
    const eta = s?.outcome === "in_transit" ? Math.max(0, Math.ceil((s.etaTick - ctx.tick) / 24)) : null;
    return {
      from: WAREHOUSE_BY_ID[l.warehouseId].city,
      courier: COURIER_BY_ID[l.courierId]?.name ?? l.courierId,
      items: l.lines.map((x) => `${x.qty}× ${names[x.sku] ?? x.sku}`).join(", "),
      status: s ? (s.outcome === "in_transit" ? (eta === 0 ? "Out for delivery" : "In transit") : s.outcome === "delivered" ? "Delivered" : "Returned to us") : o.status === "delivered" ? "Delivered" : "In transit",
      etaDays: eta,
    };
  });
  const ret = ctx.returns.find((r) => r.orderId === o.id);
  const deliveredAt = orderShips.filter((s) => s.outcome === "delivered").reduce((m, s) => Math.max(m, s.resolveTick), -1);
  const delivered = o.status === "delivered" || o.status === "returned";
  const deliveredDaysAgo = deliveredAt >= 0 ? Math.floor((ctx.tick - deliveredAt) / 24) : undefined;
  const onlyPersonalCare = o.lines.every((l) => ctx.catalog.find((p) => p.sku === l.sku)?.category === "personal_care");
  const withinWindow = deliveredDaysAgo === undefined || deliveredDaysAgo <= RETURN_WINDOW_DAYS;
  let note: string | undefined;
  if (o.status === "backordered") note = "An item is temporarily out of stock across all our warehouses. Your order ships automatically as soon as stock arrives.";
  else if (legs.length > 1) note = `No single warehouse had every item, so we're sending it in ${legs.length} parcels from the nearest warehouses with stock.`;
  else if (o.sourcing && !o.sourcing.homeHadStock && legs[0]) note = `Your nearest warehouse (${WAREHOUSE_BY_ID[o.sourcing.home].city}) was out of stock, so it ships from ${WAREHOUSE_BY_ID[legs[0].warehouseId].city}.`;
  if (o.rtoMeasure === "ivr_confirm" && o.status === "shipped") note = `${note ? `${note} ` : ""}You may receive a short confirmation call before delivery.`;
  const [status, tone] = STATUS_TEXT[o.status];
  const view: OrderView = {
    id: o.id,
    status,
    statusTone: tone,
    value: o.value,
    placedDaysAgo: Math.max(0, Math.floor((ctx.tick - o.tick) / 24)),
    city: pin ? `${pin.city} ${pin.pin}` : o.pincode,
    payment: o.paymentMode === "cod" ? "Cash on delivery" : "Prepaid",
    items: o.lines.map((l) => `${l.qty}× ${names[l.sku] ?? l.sku}`),
    parcels,
    note,
    returnEligible: !ret && delivered && o.status !== "returned" && withinWindow && !onlyPersonalCare,
    returnStatus: ret ? RETURN_TEXT[ret.status] : undefined,
    deliveredDaysAgo,
  };
  return { view, order: o, delivered, ret, legs };
}
export const orderView = (ctx: AssistantContext, o: Order) => orderFacts(ctx, o).view;

function itemsPhrase(o: Order, ctx: AssistantContext) {
  const names = Object.fromEntries(ctx.catalog.map((p) => [p.sku, p.name]));
  const first = o.lines[0];
  const n = o.lines.reduce((a, l) => a + l.qty, 0);
  return o.lines.length === 1 ? `${first.qty > 1 ? `${first.qty}× ` : ""}${names[first.sku] ?? first.sku}` : `${names[first.sku] ?? first.sku} and ${plural(n - first.qty, "more item")}`;
}

function statusSentence(ctx: AssistantContext, f: OrderFacts, focusEta = false) {
  const { order: o, view: v } = f;
  const what = itemsPhrase(o, ctx);
  switch (o.status) {
    case "placed":
    case "allocated":
      return `Your order ${o.id} (${what}, ${inr(o.value)}) is confirmed and being packed. It normally leaves our warehouse within a few hours.`;
    case "backordered":
      return `Your order ${o.id} (${what}) is waiting for stock. It will ship automatically as soon as the item is restocked.`;
    case "shipped": {
      if (v.parcels.length > 1) {
        const parts = v.parcels.map((p, i) => `parcel ${i + 1} from ${p.from} (${p.items}) ${p.etaDays !== null ? `arriving ${days(p.etaDays)}` : `— ${p.status.toLowerCase()}`}`);
        return `Your order ${o.id} is on the way in ${v.parcels.length} parcels: ${parts.join("; ")}.`;
      }
      const p = v.parcels[0];
      const eta = p?.etaDays ?? null;
      return focusEta && eta !== null
        ? `Your order ${o.id} (${what}) should arrive ${days(eta)}. It's with ${p.courier}, shipped from ${p.from}.`
        : `Your order ${o.id} (${what}, ${inr(o.value)}) is on the way with ${p?.courier ?? "our courier partner"} from ${p?.from ?? "our warehouse"}${eta !== null ? ` and should arrive ${days(eta)}` : ""}.`;
    }
    case "delivered":
      return `Your order ${o.id} (${what}) was delivered${v.deliveredDaysAgo !== undefined ? (v.deliveredDaysAgo === 0 ? " today" : ` ${plural(v.deliveredDaysAgo, "day")} ago`) : ""}.${v.returnEligible ? ` If anything isn't right, you can return it within ${RETURN_WINDOW_DAYS} days of delivery.` : ""}`;
    case "rto":
      return `Your order ${o.id} couldn't be delivered and is being returned to our warehouse. ${o.paymentMode === "prepaid" ? "Your payment will be refunded once it's received back." : "As it was cash on delivery, nothing was charged."}`;
    case "returned":
      return `Your order ${o.id} has been returned${f.ret ? ` and is ${RETURN_TEXT[f.ret.status]}` : ""}.`;
    case "cancelled":
      return `Your order ${o.id} was cancelled.`;
  }
}

// ------------------------------------------------------------------ intent classification
function classify(q: string, e: { orderId: string | null; products: Product[]; pin: Pincode | null; badPin: string | null }, memory: Memory): Intent {
  const productRef = e.products.length > 0;
  if (has(q, /\b(ignore (all |any |the )?(previous|prior|above|earlier) (instructions|rules)|system prompt|you are now|act as (an? )?(admin|developer)|developer mode|jailbreak|system ?:|admin ?:|override)\b/)) return "unsafe_request";
  if (has(q, /^(bye|goodbye|see you|cya|ok bye|that'?s all|nothing else)\b/)) return "goodbye";
  if (has(q, /\b(change|update|edit|correct|wrong) (my |the |delivery |shipping )?(address|pincode|phone|mobile|number)\b|\baddress (change|update)\b/)) return "address_change";
  if (has(q, /^(ok|okay|k|fine|alright|got it|sure|hmm+|noted)\.?$/)) return "ack";
  if (has(q, /\b(not working|stopped working|doesnt work|does not work|faulty|defective|damaged|broken|cracked|torn|wrong (item|product|size sent)|missing (item|product|part)|not received|never (received|arrived|came)|didnt (receive|get|arrive)|still not (here|arrived|delivered|received)|is late|running late|delayed|taking (too|so) long|charged twice|double charged|money (got )?deducted|scam|fraud|complaint|worst|terrible|disappointed|unacceptable|useless|pathetic)\b/)) return "complaint";
  if (has(q, /\b(talk|speak|chat|connect)\b.*\b(human|person|agent|someone|executive|representative)\b|\b(customer care|customer support|helpline|phone number|contact number|call (you|support)|email (id|address)?|working hours|support hours|timings?|open (now|today)|when are you open)\b/)) return "human_handoff";
  if (has(q, /\b(compare|comparison|difference between|vs|versus|better)\b/) && e.products.length >= 2) return "compare";
  if (has(q, /\b(coupon|promo ?code|discount code|voucher|offer code|any offers?|discounts?)\b/)) return "promo";
  if (has(q, /\bexchange\b|\b(different|another|bigger|smaller|other) size\b/)) return "exchange";
  if (has(q, /\b(return|refund) policy\b|\bhow (do|can) (i )?return\b|\breturn (window|period|days)\b|\bhow many days (to|for) return\b|\bcan i return\b(?!.*\b(web|ord)-)/) && !e.orderId) return "return_policy";
  if (has(q, /\bcancel/)) return "cancel_order";
  if (has(q, /\b(want|need|get|request|give me) (a |my )?refund\b/)) return "return_request";
  if (has(q, /\brefund\b/)) return "refund_status";
  if (has(q, /\breturn\b/)) return has(q, /\b(status|update|where|progress|track)\b/) ? "return_status" : "return_request";
  if (has(q, /\b(two|2|multiple|many|separate|different|several) (parcels|packages|boxes|shipments)|\bsplit\b|\bseparately\b|\bwhy.*(parcels|packages|warehouses?)\b/)) return "split_explain";
  if (has(q, /\b(add|put|include)\b.*\b(cart|bag|basket)\b|\badd (it|this|that|them|one|two)\b|\bi(ll| will) (take|buy) (it|this|that)\b/)) return "add_to_cart";
  if (has(q, /\b(my|the|in) (cart|bag|basket)\b|\bcart\b/) && !has(q, /\b(deliver|delivery|ship|arrive)\b/)) return "cart_summary";
  if (has(q, /\b(shipping|delivery) (charges?|fees?|costs?|price)\b|\bfree (delivery|shipping)\b|\b(charges?|fees?) (for|on) (delivery|shipping)\b/)) return "shipping_policy";
  if (has(q, /\b(cod|cash on delivery|upi|credit card|debit card|card|pay|payment|emi|wallet|net ?banking)\b/)) return "payment_help";
  const orderish = has(q, /\b(track|tracking|where is|wheres|status|order|parcel|package|shipment|dispatched|shipped|arrive|arriving|eta|when will)\b/);
  if (has(q, /\b(where is|wheres|track|status of)\b.*\bmy\b.*\border\b|\bmy\b.*\border\b.*\b(where|status|when|arrive)\b/)) return has(q, /\b(when|arrive|eta)\b/) ? "order_eta" : "order_status";
  if (has(q, /\b(my orders|all (my )?orders|order history|past orders|previous orders|list (my )?orders)\b/)) return "order_list";
  if (e.orderId && !productRef) return has(q, /\b(when|arrive|eta|how long)\b/) ? "order_eta" : "order_status";
  if (orderish && (e.orderId || has(q, /\b(my|latest|last|recent|it)\b/)) && !has(q, /\b(deliver|delivery) to\b/) && !(productRef && !e.orderId)) {
    return has(q, /\b(when|arrive|eta|how long|how many days)\b/) ? "order_eta" : "order_status";
  }
  if (has(q, /\b(deliver|delivery|ship|shipping|reach|how long|how many days|when (will|can) i get)\b/) || ((e.pin || e.badPin) && (productRef || memory.skus?.length))) return "delivery_estimate";
  if (has(q, /\b(in stock|available|availability|out of stock|sold out)\b/) && (productRef || memory.skus?.length)) return e.products.length > 1 ? "product_search" : "stock_check";
  if (has(q, /\b(do you have|have you got|do you sell|do you carry)\b/) && productRef) return e.products.length === 1 ? "stock_check" : "product_search";
  if (has(q, /\b(price|cost|how much|rate|mrp)\b/) && (productRef || memory.skus?.length)) return "price_check";
  if (e.products.length === 1 && /^[a-z]{2,3}-\d{3}$/i.test(q.trim())) return "stock_check";
  if (has(q, /\b(find|looking for|search|show|recommend|suggest|gift|need|want|buy|under|below|above|between|cheap|cheapest|best|trending|popular)\b/) || productRef || Object.values(CATEGORY_WORDS).some((re) => re.test(q))) return "product_search";
  if (has(q, /^(hi|hii+|hello|hey|namaste|good (morning|afternoon|evening)|yo)\b/)) return "greeting";
  if (has(q, /\b(thanks|thank you|thx|ty|great|awesome|perfect|cool|ok thanks)\b/)) return "thanks";
  if (has(q, /\b(help|support|assist|what can you do)\b/)) return "help";
  if (has(q, /\b(weather|cricket|match|news|movie|song|joke|politics|stock market|bitcoin|recipe|homework|capital of|who is|who won)\b/)) return "out_of_scope";
  if (memory.pendingComplaint && e.orderId) return "complaint";
  return "unknown";
}

// ------------------------------------------------------------------ main
export function answer(message: string, ctx: AssistantContext, memory: Memory = {}): Reply {
  const q = normalise(message);
  const orderId = findOrderId(message);
  const products = matchProducts(message, ctx.catalog);
  const pinHit = findPincode(q);
  const badPin = unknownPincode(q);
  const intent = classify(q, { orderId, products, pin: pinHit, badPin }, memory);
  const mine = ctx.orders.filter((o) => ctx.myOrderIds.includes(o.id)).sort((a, b) => b.tick - a.tick);
  const pincode = pinHit?.pin ?? (intent === "delivery_estimate" ? memory.pincode : undefined) ?? ctx.pincode;
  const pin = PINCODE_BY_PIN[pincode];
  const first = ctx.customerName.trim().split(" ")[0] ?? "";
  // a numbered list is only selectable in the turn right after it was shown
  const mem: Memory = { ...memory, lastIntent: intent, pincode: pinHit?.pin ?? memory.pincode, pendingComplaint: intent === "complaint" ? memory.pendingComplaint : undefined, listed: undefined };
  const facts: Record<string, unknown> = { intent };
  const done = (r: Omit<Reply, "facts" | "memory" | "intent"> & { memory?: Memory; facts?: Record<string, unknown> }): Reply => ({ intent, ...r, facts: { ...facts, ...(r.facts ?? {}) }, memory: r.memory ?? mem });

  const denied = (id: string) =>
    done({ text: `I couldn't find order ${id} among the orders placed from this device. For your privacy I can only discuss orders placed here — please double-check the ID on your confirmation.`, actions: mine.length ? [{ type: "prompt", label: "Show my orders", prompt: "Show my orders" }] : [], facts: { denied: id } });

  /** Pick the order the customer most plausibly means, using the ID, a product they named, the status that fits the question, then recency. */
  const pickOrder = (prefer?: (o: Order) => boolean): { order?: Order; ambiguous?: Order[]; denied?: string } => {
    if (orderId) {
      const o = mine.find((x) => x.id === orderId);
      return o ? { order: o } : { denied: orderId };
    }
    if (products.length) {
      const skus = new Set(products.map((p) => p.sku));
      const withProduct = mine.filter((o) => o.lines.some((l) => skus.has(l.sku)));
      const relevant = prefer ? withProduct.filter(prefer) : withProduct;
      if (relevant.length) return { order: relevant[0] };
      if (withProduct.length) return { order: withProduct[0] };
    }
    if (memory.orderId) {
      const o = mine.find((x) => x.id === memory.orderId);
      if (o && (!prefer || prefer(o))) return { order: o };
    }
    const pool = prefer ? mine.filter(prefer) : mine;
    if (pool.length === 1) return { order: pool[0] };
    if (pool.length > 1) return has(q, /\b(latest|last|recent|newest)\b/) ? { order: pool[0] } : { ambiguous: pool };
    return {};
  };
  const listCard = (orders: Order[]): Card => {
    mem.listed = orders.slice(0, 4).map((o) => o.id);
    return { kind: "orders", orders: orders.slice(0, 4).map((o) => orderView(ctx, o)) };
  };
  const noOrders = () =>
    done({ text: "I don't see any orders placed from this device yet. If you ordered on another phone or browser, please check there — for your privacy I can only access orders placed on this device. Anything placed here, I can track in real time.", actions: [{ type: "link", label: "Start shopping", href: "/" }, { type: "ticket", label: "Contact support", category: "order_lookup" }] });

  switch (intent) {
    case "unsafe_request":
      return done({ text: "I'm not able to change orders, refunds or policies based on instructions in chat — every request goes through our standard checks. I'd be glad to help you track an order, check delivery, or start a return.", actions: [{ type: "prompt", label: "Track my order", prompt: "Where is my latest order?" }, { type: "link", label: "My orders", href: "/orders" }] });

    case "greeting":
      return done({ text: `Hello${first ? ` ${first}` : ""}, welcome to Saamaan ki Dukaan. I can track your orders, check delivery times to your pincode, help you find products, and take care of returns. How can I help today?`, actions: starterActions(mine.length > 0) });

    case "thanks":
      return done({ text: "You're welcome! Is there anything else I can help you with?", actions: starterActions(mine.length > 0).slice(0, 3) });

    case "goodbye":
      return done({ text: `Thank you for shopping with us${first ? `, ${first}` : ""}. Have a great day!` });

    case "out_of_scope":
      return done({ text: "I'm afraid I can only help with Saamaan ki Dukaan — orders, deliveries, products, payments and returns. Is there something along those lines I can do for you?", actions: starterActions(mine.length > 0).slice(0, 3) });

    case "help":
    case "unknown":
      return done({
        text: intent === "help" ? "Here's what I can help with: tracking orders (including split parcels), delivery estimates for any pincode, finding products within a budget, payments, and returns or refunds. What would you like to do?" : "Sorry, I didn't quite catch that. I can help with order tracking, delivery times, products, payments and returns — could you rephrase, or pick one of these?",
        actions: [...starterActions(mine.length > 0), { type: "ticket", label: "Contact support", category: "general" }],
      });

    case "human_handoff":
      return done({ text: "I'm available around the clock, and our support team handles requests through tickets so everything stays tied to your order. I can raise one right now — just tap below, or tell me what it's about (and the order ID, if you have it) and I'll include the details.", actions: [{ type: "ticket", label: "Raise a support ticket", category: "general" }, ...(mine.length ? [{ type: "prompt" as const, label: "It's about an order", prompt: "Show my orders" }] : [])] });

    case "promo":
      return done({ text: "We don't use coupon codes. Every price on the site already includes our current discount, shown as the percentage off MRP on each product. Prices can change with demand, so the price you see at checkout is the one you pay.", actions: [{ type: "prompt", label: "Show popular deals", prompt: "Show trending products" }] });

    case "order_list": {
      if (!mine.length) return noOrders();
      facts.orders = mine.slice(0, 5).map((o) => ({ id: o.id, status: o.status, value: o.value }));
      return done({ text: `You have ${plural(mine.length, "order")} with us${mine.length > 5 ? " — here are the five most recent" : ""}. Ask me about any of them by its ID, or reply with its number in the list.`, cards: [{ kind: "orders", orders: mine.slice(0, 5).map((o) => orderView(ctx, o)) }], memory: { ...mem, listed: mine.slice(0, 5).map((o) => o.id) } });
    }

    case "order_status":
    case "order_eta": {
      if (!mine.length && !orderId) return noOrders();
      const active = (o: Order) => ["placed", "allocated", "shipped", "backordered"].includes(o.status);
      const r = pickOrder(mine.some(active) ? active : undefined);
      if (r.denied) return denied(r.denied);
      if (!r.order) {
        const pool = r.ambiguous ?? mine;
        return done({ text: `You have ${plural(pool.length, intent === "order_eta" ? "order" : "active order")}. Which one would you like me to check?`, cards: [listCard(pool)] });
      }
      const f = orderFacts(ctx, r.order);
      facts.order = { id: f.view.id, status: f.view.status, value: f.view.value, parcels: f.view.parcels, note: f.view.note, returnStatus: f.view.returnStatus };
      let text = statusSentence(ctx, f, intent === "order_eta");
      if (f.view.note && f.view.parcels.length <= 1 && r.order.status !== "backordered") text += ` ${f.view.note}`;
      const others = mine.filter((o) => o.id !== r.order!.id && active(o)).length;
      const actions: Action[] = [];
      if (f.view.returnEligible) actions.push({ type: "link", label: "Return an item", href: `/return/${f.view.id}` });
      if (f.legs.length > 1) actions.push({ type: "prompt", label: "Why multiple parcels?", prompt: `Why is ${f.view.id} coming in multiple parcels?` });
      if (others) actions.push({ type: "prompt", label: `My other ${plural(others, "order")}`, prompt: "Show my orders" });
      if (r.order.status === "rto" || r.order.status === "backordered") actions.push({ type: "ticket", label: "Contact support", category: "order_issue" });
      return done({ text, cards: [{ kind: "order", order: f.view }], actions, memory: { ...mem, orderId: f.view.id } });
    }

    case "split_explain": {
      const r = pickOrder((o) => (o.legs?.length ?? 0) > 1);
      if (r.denied) return denied(r.denied);
      const o = r.order ?? mine.find((x) => (x.legs?.length ?? 0) > 1);
      if (!o || !o.legs || o.legs.length < 2) {
        return done({ text: `Sometimes an order arrives in more than one parcel. We always ship first from the warehouse nearest to you; if it doesn't have every item (or enough units), the rest comes from the next-nearest warehouse that does, so you aren't kept waiting. ${o ? `Your order ${o.id} is shipping in a single parcel.` : ""}`.trim() });
      }
      const f = orderFacts(ctx, o);
      const home = WAREHOUSE_BY_ID[HOME_WAREHOUSE[o.region]].city;
      const parts = f.view.parcels.map((p) => `${p.from} is sending ${p.items}${p.etaDays !== null ? ` (arriving ${days(p.etaDays)})` : ""}`);
      facts.order = { id: o.id, parcels: f.view.parcels, home };
      return done({ text: `Your order ${o.id} comes in ${f.legs.length} parcels because our ${home} warehouse, which is nearest to you, didn't have enough stock of everything. Rather than delay the whole order, ${parts.join(", and ")}. There's no extra charge for the additional parcel.`, cards: [{ kind: "order", order: f.view }], memory: { ...mem, orderId: o.id } });
    }

    case "delivery_estimate": {
      if (badPin) return done({ text: `I'm sorry, pincode ${badPin} isn't in our delivery network yet. If you share a nearby city or pincode, I'll check that instead.`, facts: { badPin } });
      if (!pin) return done({ text: "Sure — which pincode or city should I check delivery for?" });
      const skus = products.length ? products.map((p) => p.sku) : memory.skus?.length ? memory.skus : ctx.cart.map((c) => c.sku);
      if (!skus.length) return done({ text: `Yes, we deliver to ${pin.city} (${pin.pin}). Delivery time depends on the product and where it's stocked — tell me what you'd like and I'll give you an exact estimate.`, facts: { pincode: pin.pin }, memory: { ...mem, pincode: pin.pin } });
      const cat = Object.fromEntries(ctx.catalog.map((p) => [p.sku, p]));
      const views = skus.slice(0, 4).map((s) => productView(ctx, cat[s], pin.pin));
      facts.products = views.map((v) => ({ name: v.name, price: v.price, deliveryDays: v.deliveryDays, inStock: v.inStock, parcels: v.parcels }));
      const line = (v: ProductView) => (!v.inStock ? `${v.name} is currently out of stock` : v.deliveryDays ? `${v.name} can be delivered ${days(v.deliveryDays)}${v.parcels > 1 ? ` (in ${v.parcels} parcels)` : ""}` : `${v.name} can't be delivered there right now`);
      const text = views.length === 1 ? `${line(views[0])} to ${pin.city} (${pin.pin}).` : `For delivery to ${pin.city} (${pin.pin}): ${views.map(line).join("; ")}.`;
      return done({ text, cards: [{ kind: "products", items: views }], memory: { ...mem, skus, pincode: pin.pin } });
    }

    case "stock_check":
    case "price_check": {
      const list = products.length ? products : (memory.skus ?? []).map((s) => ctx.catalog.find((p) => p.sku === s)!).filter(Boolean);
      if (!list.length) return done({ text: "Which product would you like me to check? You can type its name, for example “Aurora earbuds”." });
      const views = list.map((p) => productView(ctx, p, pincode));
      facts.products = views.map((v) => ({ name: v.name, price: v.price, mrp: v.mrp, inStock: v.inStock, lowStock: v.lowStock, deliveryDays: v.deliveryDays }));
      if (!products.length && views.length > 1) {
        const line = (x: ProductView) => (intent === "price_check" ? `${x.name} is ${inr(x.price)}` : `${x.name} is ${x.inStock ? `in stock${x.lowStock ? " (few left)" : ""}` : "out of stock"}`);
        return done({ text: `${views.map(line).join("; ")}.`, cards: [{ kind: "products", items: views }], memory: { ...mem, skus: views.map((x) => x.sku) } });
      }
      const v = views[0];
      const off = v.mrp > v.price ? Math.round((1 - v.price / v.mrp) * 100) : 0;
      const where = pin ? ` to ${pin.city}` : "";
      const text =
        intent === "price_check"
          ? `${v.name} is ${inr(v.price)}${off ? ` — ${off}% off the MRP of ${inr(v.mrp)}` : ""}.${v.inStock ? (v.deliveryDays ? ` It's in stock and can be delivered${where} ${days(v.deliveryDays)}.` : "") : " It's out of stock at the moment."}`
          : v.inStock
            ? `Yes, ${v.name} is in stock${v.lowStock ? " — only a few units are left" : ""}. It's ${inr(v.price)}${v.deliveryDays ? ` and can be delivered${where} ${days(v.deliveryDays)}` : ""}.`
            : `${v.name} is out of stock across our warehouses right now. It's replenished automatically, so please check back soon.`;
      return done({ text: views.length > 1 ? `${text} I've also listed a few close matches.` : text, cards: [{ kind: "products", items: views }], actions: v.inStock ? [{ type: "add", label: "Add to cart", sku: v.sku }] : [], memory: { ...mem, skus: views.map((x) => x.sku) } });
    }

    case "product_search": {
      const { min, max } = parsePrice(q);
      const category = (Object.keys(CATEGORY_WORDS) as Category[]).find((c) => CATEGORY_WORDS[c].test(q));
      const gift = has(q, /\bgifts?\b/);
      const region = pin?.region ?? "west";
      if (!products.length && !category && min === undefined && max === undefined && !gift && !has(q, /\b(trending|popular|best ?sellers?|deals?)\b/))
        return done({ text: "Happy to help you find something. What are you looking for? For example, “earbuds under ₹3,000” or “a kurta for a gift”.", actions: [{ type: "prompt", label: "Gifts under ₹1,000", prompt: "Show gifts under 1000" }, { type: "prompt", label: "Electronics under ₹3,000", prompt: "Electronics under 3000" }, { type: "prompt", label: "Popular right now", prompt: "Show trending products" }] });
      let pool = products.length ? products : ctx.catalog.filter((p) => !category || p.category === category);
      if (gift && !products.length && !category) pool = ctx.catalog.filter((p) => p.category !== "personal_care" || p.zonePrice[region] >= 400);
      const forMen = has(q, /\b(brother|dad|father|husband|boyfriend|him|son|uncle|men|mens|male|guy)\b/);
      const forWomen = has(q, /\b(sister|mom|mother|wife|girlfriend|her|daughter|aunt|women|womens|female|lady)\b/);
      const womens = /skirt|dress|saree|kurti|anarkali|palazzo|sports bra|mom jeans|kajal|lip/i;
      const mens = /beard|trimmer|boxer|pathani|dhoti|nehru/i;
      if (forMen && !forWomen) pool = pool.filter((p) => !womens.test(p.name));
      if (forWomen && !forMen) pool = pool.filter((p) => !mens.test(p.name));
      const inStock = pool.filter((p) => stockOf(ctx, p.sku) > 0);
      const inBudget = inStock.filter((p) => (min === undefined || p.zonePrice[region] >= min) && (max === undefined || p.zonePrice[region] <= max));
      const sortFn = has(q, /\b(cheap|cheapest|lowest|budget|affordable)\b/) ? (a: Product, b: Product) => a.zonePrice[region] - b.zonePrice[region] : products.length ? () => 0 : (a: Product, b: Product) => b.baseDaily - a.baseDaily;
      const label = products.length ? tokens(message).slice(0, 2).join(" ") || "matches" : category ? CATEGORY_NAME[category] : gift ? "gift ideas" : "popular picks";
      facts.filters = { category: category ?? null, min: min ?? null, max: max ?? null };
      if (!inBudget.length) {
        const nearest = inStock.slice().sort((a, b) => Math.abs(a.zonePrice[region] - (max ?? min ?? 0)) - Math.abs(b.zonePrice[region] - (max ?? min ?? 0))).slice(0, 3);
        if (!nearest.length) return done({ text: `I'm sorry, I couldn't find any ${label} in stock right now.` });
        const views = nearest.map((p) => productView(ctx, p, pincode));
        facts.products = views.map((v) => ({ name: v.name, price: v.price }));
        return done({ text: `I couldn't find any ${label}${max !== undefined ? ` under ${inr(max)}` : ""}${min !== undefined ? ` above ${inr(min)}` : ""} in stock right now. Here are the closest options:`, cards: [{ kind: "products", title: "Closest matches", items: views }], memory: { ...mem, skus: views.map((v) => v.sku) } });
      }
      const views = inBudget.sort(sortFn).slice(0, 4).map((p) => productView(ctx, p, pincode));
      facts.products = views.map((v) => ({ name: v.name, price: v.price, deliveryDays: v.deliveryDays }));
      const budget = max !== undefined && min !== undefined ? ` between ${inr(min)} and ${inr(max)}` : max !== undefined ? ` under ${inr(max)}` : min !== undefined ? ` above ${inr(min)}` : "";
      const title = `${label.charAt(0).toUpperCase()}${label.slice(1)}${budget}`;
      return done({ text: `Here ${views.length === 1 ? "is an option" : `are ${views.length} options`}${budget} that ${views.length === 1 ? "is" : "are"} in stock${pin ? ` and deliverable to ${pin.city}` : ""}. Tap Add to put ${views.length === 1 ? "it" : "one"} in your cart.`, cards: [{ kind: "products", title, items: views }], memory: { ...mem, skus: views.map((v) => v.sku) } });
    }

    case "add_to_cart": {
      const target = products[0] ?? (memory.skus?.[0] ? ctx.catalog.find((p) => p.sku === memory.skus![0]) : undefined);
      if (!target) return done({ text: "Which product would you like to add? Just tell me its name." });
      const v = productView(ctx, target, pincode);
      facts.product = { name: v.name, price: v.price, inStock: v.inStock };
      if (!v.inStock) return done({ text: `I'm sorry, ${v.name} is out of stock right now, so I can't add it to your cart.` });
      return done({ text: `Please confirm and I'll add ${v.name} (${inr(v.price)}) to your cart.`, actions: [{ type: "add", label: "Add to cart", sku: v.sku }, { type: "link", label: "View cart", href: "/cart" }], cards: [{ kind: "products", items: [v] }], memory: { ...mem, skus: [v.sku] } });
    }

    case "cart_summary": {
      if (!ctx.cart.length) return done({ text: "Your cart is empty at the moment. Would you like some suggestions?", actions: [{ type: "prompt", label: "Popular right now", prompt: "Show trending products" }] });
      const cat = Object.fromEntries(ctx.catalog.map((p) => [p.sku, p]));
      const cartPin = PINCODE_BY_PIN[ctx.pincode] ?? pin;
      const region = cartPin?.region ?? "west";
      const valid = ctx.cart.filter((c) => cat[c.sku]);
      const lines = valid.map((c) => ({ name: cat[c.sku].name, qty: c.qty, price: cat[c.sku].zonePrice[region] }));
      const total = lines.reduce((a, l) => a + l.price * l.qty, 0);
      const promise = cartPin ? deliveryPromise({ lines: valid.map((c) => ({ ...c, price: cat[c.sku].zonePrice[region] })), pincode: cartPin.pin, region, tier: cartPin.tier, paymentMode: "prepaid", value: total, firstTime: false }, cat, ctx.inventory, ctx.couriers) : null;
      const units = lines.reduce((a, l) => a + l.qty, 0);
      facts.cart = { lines, total, deliveryDays: promise?.days ?? null, parcels: promise?.parcels ?? 1 };
      return done({ text: `You have ${plural(units, "item")} in your cart, totalling ${inr(total)}.${promise && cartPin ? ` Delivered to ${cartPin.city}, it would arrive ${days(promise.days)}${promise.parcels > 1 ? ` in ${promise.parcels} parcels` : ""}.` : ""}`, cards: [{ kind: "cart", lines, total, deliveryDays: promise?.days ?? null, parcels: promise?.parcels ?? 1 }], actions: [{ type: "link", label: "Checkout", href: "/checkout" }, { type: "link", label: "View cart", href: "/cart" }] });
    }

    case "return_policy":
      return done({ text: `You can return most items within ${RETURN_WINDOW_DAYS} days of delivery, free of charge. Personal-care products can be returned only if they're defective. We arrange the pickup, and your refund is issued after a quick quality check — size or fit returns on clothing under ${inr(1000)} are refunded as soon as the item is picked up.`, facts: { windowDays: RETURN_WINDOW_DAYS }, actions: mine.length ? [{ type: "prompt", label: "Return an item", prompt: "I want to return an item" }] : [] });

    case "exchange":
      return done({ text: `We don't offer direct exchanges yet, but it's quick to do: return the item (free pickup within ${RETURN_WINDOW_DAYS} days of delivery) and place a new order for the size you need. Size or fit returns on clothing under ${inr(1000)} are refunded as soon as the item is picked up, so you're not out of pocket for long.`, actions: [{ type: "prompt", label: "Return an item", prompt: "I want to return an item" }] });

    case "return_request": {
      if (!mine.length && !orderId) return noOrders();
      const r = pickOrder((o) => orderFacts(ctx, o).view.returnEligible);
      if (r.denied) return denied(r.denied);
      if (!r.order) {
        const eligible = mine.filter((o) => orderFacts(ctx, o).view.returnEligible);
        if (r.ambiguous?.length) return done({ text: "Which order would you like to return an item from?", cards: [listCard(r.ambiguous)] });
        return done({ text: `I checked your orders and none are eligible for a return right now. Items can be returned within ${RETURN_WINDOW_DAYS} days of delivery — orders still on the way become eligible once delivered.${eligible.length ? "" : ""}`, cards: mine.length ? [listCard(mine)] : undefined, facts: { windowDays: RETURN_WINDOW_DAYS } });
      }
      const f = orderFacts(ctx, r.order);
      facts.order = { id: f.view.id, status: f.view.status, returnEligible: f.view.returnEligible, returnStatus: f.view.returnStatus };
      if (f.ret) return done({ text: `A return is already in progress for order ${f.view.id}: ${RETURN_TEXT[f.ret.status]}.`, cards: [{ kind: "order", order: f.view }], memory: { ...mem, orderId: f.view.id } });
      if (!f.view.returnEligible) {
        const s = r.order.status;
        const text = s === "placed" || s === "allocated" || s === "backordered" ? `Order ${f.view.id} hasn't shipped yet, so there's nothing to return. If you've changed your mind, I can request a cancellation instead.` : s === "shipped" ? `Order ${f.view.id} is still on the way. Once it's delivered, you'll have ${RETURN_WINDOW_DAYS} days to return it.` : `Order ${f.view.id} isn't eligible for a return — ${r.order.lines.every((l) => ctx.catalog.find((p) => p.sku === l.sku)?.category === "personal_care") ? "personal-care items can only be returned if defective" : `the ${RETURN_WINDOW_DAYS}-day return window has passed`}.`;
        return done({ text, cards: [{ kind: "order", order: f.view }], actions: s === "placed" || s === "allocated" ? [{ type: "prompt", label: "Cancel this order", prompt: `Cancel ${f.view.id}` }] : [], memory: { ...mem, orderId: f.view.id } });
      }
      return done({ text: `Order ${f.view.id} is eligible for a return. On the next screen, choose the item and the reason — we'll schedule a free pickup, and your refund will follow after a quick quality check.`, cards: [{ kind: "order", order: f.view }], actions: [{ type: "link", label: "Start the return", href: `/return/${f.view.id}` }], memory: { ...mem, orderId: f.view.id } });
    }

    case "return_status":
    case "refund_status": {
      if (!mine.length && !orderId) return noOrders();
      const r = pickOrder((o) => !!ctx.returns.find((x) => x.orderId === o.id) || o.status === "rto");
      if (r.denied) return denied(r.denied);
      const withReturns = mine.filter((o) => ctx.returns.some((x) => x.orderId === o.id) || o.status === "rto");
      const o = r.order ?? (withReturns.length === 1 ? withReturns[0] : undefined);
      if (!o) {
        if (withReturns.length > 1) return done({ text: `You have ${plural(withReturns.length, "return")} in progress. Which order should I check?`, cards: [listCard(withReturns)] });
        return done({ text: `I don't see any returns or refunds in progress on your orders. Refunds are issued after the returned item is picked up and passes a quick quality check — usually within ${INSPECTION_DAYS} days of pickup.`, actions: [{ type: "prompt", label: "Return an item", prompt: "I want to return an item" }] });
      }
      const f = orderFacts(ctx, o);
      facts.order = { id: o.id, returnStatus: f.view.returnStatus, status: o.status, value: o.value };
      let text: string;
      if (f.ret) {
        const refundable = f.ret.refundValue;
        text = ["restocked", "liquidated", "refunded"].includes(f.ret.status)
          ? `Your refund of ${inr(refundable)} for order ${o.id} has been issued${o.paymentMode === "prepaid" ? " to your original payment method" : ""}.`
          : f.ret.status === "rejected"
            ? `The return for order ${o.id} was declined after inspection. If you believe this is a mistake, I can raise it with our support team.`
            : f.ret.status === "escalated"
              ? `The return for order ${o.id} is being reviewed by our support team before the refund of ${inr(refundable)} is processed. You'll hear back shortly.`
              : `The return for order ${o.id} is in progress: ${RETURN_TEXT[f.ret.status]}. Your refund of ${inr(refundable)} usually follows within ${INSPECTION_DAYS} days of pickup.`;
      } else text = statusSentence(ctx, f);
      return done({ text, cards: [{ kind: "order", order: f.view }], actions: f.ret?.status === "rejected" ? [{ type: "ticket", label: "Contact support", category: "return_dispute" }] : [], memory: { ...mem, orderId: o.id } });
    }

    case "cancel_order": {
      if (!mine.length && !orderId) return noOrders();
      const cancellable = (o: Order) => ["placed", "allocated", "backordered"].includes(o.status);
      const r = pickOrder(cancellable);
      if (r.denied) return denied(r.denied);
      if (!r.order) {
        if (r.ambiguous?.length) return done({ text: "Which order would you like to cancel?", cards: [listCard(r.ambiguous)] });
        return done({ text: "None of your orders can be cancelled at this stage — they've already shipped or been delivered. You can return delivered items within 7 days instead.", cards: mine.length ? [listCard(mine)] : undefined, actions: [{ type: "prompt", label: "Return an item", prompt: "I want to return an item" }] });
      }
      const o = r.order;
      if (memory.cancelRequested?.includes(o.id)) return done({ text: `A cancellation request for order ${o.id} is already with our team — there's no need to submit it again. They'll confirm shortly.`, cards: [{ kind: "order", order: orderView(ctx, o) }], memory: { ...mem, orderId: o.id } });
      if (!cancellable(o)) return done({ text: `Order ${o.id} has already ${o.status === "shipped" ? "shipped" : "been delivered"}, so it can no longer be cancelled. ${o.status === "shipped" ? `Once it arrives, you can return it within ${RETURN_WINDOW_DAYS} days.` : `You can return it within ${RETURN_WINDOW_DAYS} days of delivery.`}`, cards: [{ kind: "order", order: orderView(ctx, o) }], memory: { ...mem, orderId: o.id } });
      facts.order = { id: o.id, status: o.status, value: o.value };
      return done({ text: `I've submitted a cancellation request for order ${o.id} (${itemsPhrase(o, ctx)}, ${inr(o.value)}). Our team will confirm it shortly${o.paymentMode === "prepaid" ? ", and any payment will be refunded to your original payment method" : ""}.`, cards: [{ kind: "order", order: orderView(ctx, o) }], escalate: { category: "cancellation", reason: `Cancellation requested for ${o.id} (${o.status})` }, memory: { ...mem, orderId: o.id, cancelRequested: [...(memory.cancelRequested ?? []), o.id] } });
    }

    case "address_change": {
      const r = pickOrder((o) => ["placed", "allocated", "backordered"].includes(o.status));
      if (r.denied) return denied(r.denied);
      const o = r.order;
      if (o && o.status === "shipped") return done({ text: `Order ${o.id} has already shipped, so its delivery address can't be changed. If it can't be delivered, it comes back to us and ${o.paymentMode === "prepaid" ? "your payment is refunded" : "nothing is charged"}.`, cards: [{ kind: "order", order: orderView(ctx, o) }], memory: { ...mem, orderId: o.id } });
      return done({
        text: o ? `Address changes need to be verified by our support team. I've raised a request for order ${o.id} — they'll contact you to confirm the new address before it ships.` : "For new orders, you can set the delivery pincode at checkout. To change the address on an existing order, tell me the order ID and I'll raise it with our support team.",
        cards: o ? [{ kind: "order", order: orderView(ctx, o) }] : undefined,
        escalate: o ? { category: "address_change", reason: `Address change requested for ${o.id}` } : undefined,
        memory: o ? { ...mem, orderId: o.id } : mem,
      });
    }

    case "payment_help":
      if (badPin) return done({ text: `I'm sorry, pincode ${badPin} isn't in our delivery network yet, so we can't take orders — prepaid or cash on delivery — for it at the moment.`, facts: { badPin } });
      return done({ text: `${pinHit ? `Yes — ${pinHit.city} (${pinHit.pin}) is in our delivery network, and cash on delivery is available there. ` : ""}We accept UPI, debit and credit cards, and cash on delivery on every pincode we serve, with no extra fee added at checkout. Prepaid orders are confirmed instantly; for some cash-on-delivery orders we may call to confirm before dispatch.`, actions: [{ type: "link", label: "Go to checkout", href: "/checkout" }] });

    case "ack":
      return done({ text: "Great. Let me know if there's anything else I can help with.", actions: starterActions(mine.length > 0).slice(0, 3) });

    case "compare": {
      const views = products.slice(0, 3).map((p) => productView(ctx, p, pincode));
      facts.products = views.map((v) => ({ name: v.name, price: v.price, mrp: v.mrp, deliveryDays: v.deliveryDays, inStock: v.inStock }));
      const line = (v: ProductView) => `${v.name}: ${inr(v.price)}${v.mrp > v.price ? ` (${Math.round((1 - v.price / v.mrp) * 100)}% off)` : ""}, ${v.inStock ? (v.deliveryDays ? `delivered ${days(v.deliveryDays)}` : "in stock") : "out of stock"}`;
      const cheapest = views.filter((v) => v.inStock).sort((a, b) => a.price - b.price)[0];
      return done({ text: `Here's how they compare${pin ? ` for delivery to ${pin.city}` : ""} — ${views.map(line).join("; ")}.${cheapest && views.length > 1 ? ` ${cheapest.name} is the more affordable choice.` : ""}`, cards: [{ kind: "products", title: "Comparison", items: views }], memory: { ...mem, skus: views.map((v) => v.sku) } });
    }

    case "shipping_policy":
      return done({ text: "Delivery is free on every order. Delivery time depends on your pincode and which of our five warehouses has the item — metro cities are usually reached in 1–3 days. If one warehouse doesn't have everything, part of your order may come in a separate parcel, at no extra cost.", facts: { warehouses: 5 }, actions: [{ type: "prompt", label: "Check delivery for my cart", prompt: "When will my cart be delivered?" }] });

    case "complaint": {
      const category = /damaged|broken|cracked|torn|defective|faulty|not working|stopped working|doesnt work|does not work/.test(q) ? "damaged_or_defective" : /wrong (item|product|size sent)/.test(q) ? "wrong_item" : /missing (item|product|part)/.test(q) ? "missing_item" : /is late|running late|delayed|taking (too|so) long|still not (here|arrived)/.test(q) ? "delayed" : /not received|never (received|arrived|came)|didnt (receive|get|arrive)|still not/.test(q) ? "not_received" : /charged|deducted|refund/.test(q) ? "payment_issue" : orderId && memory.pendingComplaint ? memory.pendingComplaint : "complaint";
      const label: Record<string, string> = { damaged_or_defective: "the damaged or faulty item", wrong_item: "receiving the wrong item", missing_item: "the missing item", not_received: "your order not arriving", delayed: "the delay", payment_issue: "the payment issue", complaint: "your experience" };
      if (category === "complaint" && !orderId)
        return done({ text: "I'm sorry we've let you down. Could you tell me a little more about what went wrong — and the order ID, if it's about an order? I can also pass this straight to our support team.", actions: [{ type: "ticket", label: "Raise a support ticket", category: "complaint" }, ...(mine.length ? [{ type: "prompt" as const, label: "Show my orders", prompt: "Show my orders" }] : [])], memory: { ...mem, pendingComplaint: "complaint" } });
      const relevant = (o: Order) => (category === "delayed" ? ["placed", "allocated", "shipped", "backordered"].includes(o.status) : category === "not_received" ? ["shipped", "delivered"].includes(o.status) : category === "payment_issue" ? true : ["delivered", "returned"].includes(o.status));
      const r = pickOrder(relevant);
      if (r.denied) return denied(r.denied);
      if (!r.order) {
        if ((r.ambiguous?.length ?? 0) > 0 || mine.some(relevant)) return done({ text: `I'm really sorry about ${label[category]}. Which order is this about? Once you tell me, I'll raise it with our support team straight away.`, cards: [listCard(r.ambiguous ?? mine.filter(relevant))], memory: { ...mem, pendingComplaint: category } });
        return done({ text: `I'm really sorry about ${label[category]}. I've raised this with our support team, who will contact you shortly.${mine.length ? "" : " If you have your order ID, please share it so they can resolve it faster."}`, escalate: { category, reason: label[category] }, memory: { ...mem, pendingComplaint: undefined } });
      }
      const f = orderFacts(ctx, r.order);
      facts.order = { id: f.view.id, status: f.view.status, value: f.view.value };
      const eta = f.view.parcels.map((p) => p.etaDays).filter((d): d is number => d !== null);
      if ((category === "not_received" || category === "delayed") && ["placed", "allocated", "backordered"].includes(r.order.status))
        return done({ text: r.order.status === "backordered" ? `I'm sorry for the wait. Order ${f.view.id} is waiting for an item to be restocked and will ship automatically as soon as it arrives. I've flagged it to our team so they can keep you posted.` : `Order ${f.view.id} was placed recently and is being packed now, so it isn't delayed. It normally leaves our warehouse within a few hours.`, cards: [{ kind: "order", order: f.view }], escalate: r.order.status === "backordered" ? { category: "delayed", reason: `Backordered order chased by customer · ${f.view.id}` } : undefined, memory: { ...mem, orderId: f.view.id, pendingComplaint: undefined } });
      if ((category === "not_received" || category === "delayed") && r.order.status === "shipped" && eta.length && Math.max(...eta) > 0)
        return done({ text: `I understand the wait is frustrating. Order ${f.view.id} is still on its way and is due ${days(Math.max(...eta))}, so it isn't late yet. If it hasn't arrived by then, message me and I'll escalate it immediately.`, cards: [{ kind: "order", order: f.view }], actions: [{ type: "ticket", label: "Escalate anyway", category }], memory: { ...mem, orderId: f.view.id, pendingComplaint: undefined } });
      if ((category === "damaged_or_defective" || category === "wrong_item" || category === "missing_item") && !f.delivered)
        return done({ text: `Order ${f.view.id} hasn't been delivered yet${eta.length ? ` — it's due ${days(Math.max(...eta))}` : ""}, so I think you may mean a different order. Could you share the order ID of the item that has the problem?`, cards: [{ kind: "order", order: f.view }], actions: mine.filter(relevant).length ? [{ type: "prompt", label: "Show my orders", prompt: "Show my orders" }] : [], memory: { ...mem, pendingComplaint: category } });
      if (category === "not_received" && f.delivered) {
        const courier = f.view.parcels[0]?.courier ?? "the courier";
        return done({ text: `Our records show order ${f.view.id} as delivered${f.view.deliveredDaysAgo !== undefined ? ` ${f.view.deliveredDaysAgo === 0 ? "today" : `${plural(f.view.deliveredDaysAgo, "day")} ago`}` : ""} by ${courier}. I'm sorry it hasn't reached you — I've raised a ticket so our team can investigate with ${courier} and get back to you. It's also worth checking with neighbours or building security in case it was handed over there.`, cards: [{ kind: "order", order: f.view }], escalate: { category, reason: `Marked delivered but customer reports not received · ${f.view.id}` }, memory: { ...mem, orderId: f.view.id, pendingComplaint: undefined } });
      }
      const canReturn = f.view.returnEligible && (category === "damaged_or_defective" || category === "wrong_item");
      return done({ text: `I'm really sorry about ${label[category]} on order ${f.view.id}. I've raised a support ticket with your order details, and our team will be in touch shortly.${canReturn ? " You can also start a return now so the pickup isn't delayed — defective items are always refunded after inspection." : ""}`, cards: [{ kind: "order", order: f.view }], actions: canReturn ? [{ type: "link", label: "Start a return", href: `/return/${f.view.id}` }] : [], escalate: { category, reason: `${label[category]} · ${f.view.id} (${f.view.status})` }, memory: { ...mem, orderId: f.view.id, pendingComplaint: undefined } });
    }
  }
}

/** Handles messages that contain two requests, e.g. "track WEB-123 and tell me the price of the power bank". */
export function respond(message: string, ctx: AssistantContext, memory: Memory = {}): Reply {
  const pickN = message.trim().match(/^(?:#|no\.?\s*|number\s*|option\s*)?([1-5])(?:st|nd|rd|th)?(?:\s+one)?$/i);
  if (pickN && memory.listed?.[Number(pickN[1]) - 1]) {
    const id = memory.listed[Number(pickN[1]) - 1];
    const verb: Partial<Record<Intent, string>> = { cancel_order: "cancel", return_request: "return", return_status: "return status of", refund_status: "refund status of", complaint: "not received", address_change: "change address for", split_explain: "why multiple parcels" };
    const pending = memory.pendingComplaint;
    const base = memory.lastIntent === "complaint" && pending ? ({ damaged_or_defective: "damaged", wrong_item: "wrong item", missing_item: "missing item", not_received: "not received", delayed: "is late", payment_issue: "charged twice", complaint: "complaint" } as Record<string, string>)[pending] : verb[memory.lastIntent ?? "order_status"];
    return answer(`${base ?? "status of"} ${id}`, ctx, memory);
  }
  const parts = message.split(/\s+(?:and also|also|and then|plus|,\s*and)\s+|\s+and\s+(?=(?:whether|if|what|when|where|how|is|are|can|could|do|does|tell|show|check|track)\b)/i).filter((p) => p.trim().length > 2);
  if (parts.length < 2) return answer(message, ctx, memory);
  let mem = memory;
  const replies = parts.slice(0, 2).map((p) => {
    const r = answer(p, ctx, mem);
    mem = r.memory;
    return r;
  });
  if (replies.some((r) => r.intent === "unknown")) return answer(message, ctx, memory);
  return {
    intent: replies[0].intent,
    text: replies.map((r) => r.text).join(" "),
    cards: replies.flatMap((r) => r.cards ?? []),
    actions: replies.flatMap((r) => r.actions ?? []).slice(0, 4),
    escalate: replies.find((r) => r.escalate)?.escalate,
    facts: Object.assign({}, ...replies.map((r) => r.facts)),
    memory: mem,
  };
}

function starterActions(hasOrders: boolean): Action[] {
  return [
    ...(hasOrders ? [{ type: "prompt" as const, label: "Track my order", prompt: "Where is my latest order?" }] : []),
    { type: "prompt", label: "Delivery to my pincode", prompt: "When will my cart be delivered?" },
    { type: "prompt", label: "Gifts under ₹1,000", prompt: "Show gifts under 1000" },
    { type: "prompt", label: "Return an item", prompt: "I want to return an item" },
  ];
}
