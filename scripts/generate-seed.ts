/**
 * Seed generator. Deterministic (seeded PRNG) — re-running produces byte-identical output.
 *
 * Outputs
 *   data/seed.json            → shipped to the browser (catalogue, initial stock, daily aggregates,
 *                                last 14 days hourly, last 60 days per-SKU daily demand)
 *   data/train/*.csv          → full-resolution training data for scripts/train/train.py (not shipped)
 *
 * Run: npm run seed
 */
import fs from "node:fs";
import path from "node:path";
import {
  CALENDAR,
  COURIERS,
  DOW_FACTOR,
  HISTORY_DAYS,
  HOME_WAREHOUSE,
  HOUR_CURVE,
  PINCODES,
  REGIONS,
  SIM_EPOCH,
  SUPPLIERS,
  WAREHOUSE_IDS,
  isMonsoon,
  rateZone,
  WAREHOUSE_BY_ID,
} from "../lib/config/network";
import { floorPrice } from "../lib/agents/shared";
import { deliveryDays, trueRtoProbability, trueReturnProbability } from "../lib/engine/economics";
import { gamma, mulberry32, normal, pick, poisson, weightedPick } from "../lib/engine/rng";
import type { Category, DailyAggregate, HourlyAggregate, Product, Region, Tier, WarehouseId } from "../lib/types";

const rng = mulberry32(20260914);
const OUT = path.join(process.cwd(), "data");
const TRAIN = path.join(OUT, "train");
fs.mkdirSync(TRAIN, { recursive: true });

// ---------------------------------------------------------------- catalogue
const NAMES: Record<Category, string[]> = {
  apparel: [
    "Everyday Cotton Crew Tee", "Linen Blend Kurta", "Slim Fit Stretch Chinos", "Oversized Graphic Tee", "Printed Maxi Dress",
    "Classic Denim Jacket", "Relaxed Joggers", "Formal Oxford Shirt", "Anarkali Kurti", "Cargo Shorts",
    "Ribbed Knit Polo", "High-Rise Mom Jeans", "Chikankari Kurta Set", "Fleece Zip Hoodie", "Pleated Midi Skirt",
    "Athleisure Track Pants", "Handloom Cotton Saree", "Mandarin Collar Shirt", "Quilted Puffer Vest", "Palazzo Pants",
    "Bomber Jacket", "Checked Flannel Shirt", "Nehru Jacket", "Seamless Sports Bra", "Straight Fit Jeans",
    "Tie-Dye Co-ord Set", "Bamboo Boxer Briefs (3)", "Rayon Printed Kurti", "Crop Cardigan", "Dri-Fit Running Tee",
    "Woven Shacket", "Ethnic Dhoti Pants", "Hooded Windcheater", "Button-Down Linen Shirt", "Wrap Dress",
    "Thermal Base Layer", "Denim Dungarees", "Block Print Nightsuit", "Pathani Suit", "Lounge Shorts",
  ],
  electronics: [
    "Aurora ANC Wireless Earbuds", "10000mAh Slim Power Bank", "Pulse AMOLED Smartwatch", "Boom Mini Bluetooth Speaker", "33W GaN USB-C Charger",
    "Flex Neckband Earphones", "1080p Streaming Webcam", "Silent Wireless Mouse", "Compact Mechanical Keyboard", "Stride Fitness Band",
    "Braided USB-C Cable (2m)", "Magnetic Wireless Charger", "Soundbar 60W", "Smart LED Bulb (2 pack)", "Portable SSD 500GB",
    "Gaming Headset", "Mini Projector", "Car Charger Dual Port", "Tripod Ring Light", "Smart Plug 16A",
    "Laptop Stand Aluminium", "Clip-on Lapel Mic", "4-in-1 USB Hub", "Kids Smartwatch", "Digital Kitchen Scale",
    "Rechargeable Trimmer", "Bluetooth Tracker Tag", "Over-Ear Wireless Headphones", "Action Camera Lite", "Smart Door Sensor",
  ],
  home: [
    "Steel Insulated Water Bottle", "Non-stick Kadai 24cm", "Ceramic Coffee Mugs (4)", "Jaipur Block-Print Bedsheet Set", "Modular Storage Organiser",
    "Terracotta Table Lamp", "Bamboo Cutting Board", "Blackout Curtains (Pair)", "Coir Door Mat", "Pressure Cooker 3L",
    "Glass Storage Jars (6)", "Microfibre Bath Towel Set", "Wall Clock Minimal", "Cast Iron Tawa", "Cotton Dohar",
    "Foldable Laundry Basket", "Memory Foam Pillow", "Ceramic Dinner Set (18)", "Brass Diya Set", "Scented Candle Trio",
    "Spice Box Masala Dabba", "Shoe Rack 4-Tier", "Cushion Covers (5)", "Vacuum Flask 1L", "Kitchen Knife Set",
    "Jute Area Rug", "Wooden Wall Shelf", "Mosquito Net Double", "Air-tight Lunch Box", "Bathroom Caddy Rust-free",
  ],
  personal_care: [
    "Aloe Vera Face Wash", "Beard Growth Oil", "Sunscreen SPF 50 Gel", "Kumkumadi Glow Serum", "Argan Hair Serum",
    "Cocoa Body Lotion", "Tinted Lip Balm", "Onion Hair Oil", "Vitamin C Face Serum", "Charcoal Peel-off Mask",
    "Neem Tulsi Soap (4)", "Rose Water Toner", "Anti-dandruff Shampoo", "Ubtan Face Pack", "Roll-on Deodorant",
    "Coffee Body Scrub", "Hand Cream Duo", "Kajal Smudge-proof", "Herbal Toothpaste", "Hair Removal Cream",
  ],
};

const CAT_SPEC: Record<Category, { code: string; price: [number, number]; costRatio: [number, number]; ret: number; elas: [number, number]; weight: [number, number]; baseDaily: number }> = {
  apparel: { code: "APP", price: [499, 2999], costRatio: [0.36, 0.46], ret: 0.3, elas: [-2.4, -1.6], weight: [0.2, 0.9], baseDaily: 7.2 },
  electronics: { code: "ELE", price: [899, 7999], costRatio: [0.56, 0.68], ret: 0.12, elas: [-1.8, -1.2], weight: [0.1, 1.2], baseDaily: 5.2 },
  home: { code: "HOM", price: [299, 3499], costRatio: [0.42, 0.55], ret: 0.08, elas: [-1.5, -1.0], weight: [0.5, 5.5], baseDaily: 5.6 },
  personal_care: { code: "PC", price: [149, 999], costRatio: [0.3, 0.44], ret: 0.04, elas: [-1.0, -0.6], weight: [0.08, 0.5], baseDaily: 9.5 },
};

const u = (a: number, b: number) => a + (b - a) * rng();
const SIM_SCALE = 0.4;
const snap99 = (x: number) => Math.max(149, Math.round(x / 50) * 50 - 1);
const BASE_SHARE: Record<Region, number> = { north: 0.3, west: 0.29, south: 0.27, east: 0.11, northeast: 0.03 };

const catalog: Product[] = [];
for (const cat of Object.keys(NAMES) as Category[]) {
  const spec = CAT_SPEC[cat];
  NAMES[cat].forEach((name, i) => {
    const sku = `${spec.code}-${String(i + 1).padStart(3, "0")}`;
    // log-uniform price inside the category band
    let price = snap99(Math.exp(u(Math.log(spec.price[0]), Math.log(spec.price[1]))));
    if (sku === "ELE-001") price = 2499;
    if (sku === "APP-003") price = 1299;
    if (sku === "HOM-004") price = 1499;
    const cost = Math.round(price * u(spec.costRatio[0], spec.costRatio[1]));
    const sizingIssue = cat === "apparel" && (sku === "APP-003" || rng() < 0.25);
    let returnRate = spec.ret * u(0.7, 1.3) * (sizingIssue ? 1.3 : 1);
    if (sku === "APP-003") returnRate = 0.42;
    const shares: Record<Region, number> = { north: 0, west: 0, south: 0, east: 0, northeast: 0 };
    let tot = 0;
    for (const r of REGIONS) {
      shares[r] = BASE_SHARE[r] * Math.exp(0.35 * normal(rng));
      tot += shares[r];
    }
    for (const r of REGIONS) shares[r] = +(shares[r] / tot).toFixed(4);
    const w = +u(spec.weight[0], spec.weight[1]).toFixed(2);
    const dimsBase = cat === "home" ? [40, 30, 20] : cat === "electronics" ? [18, 12, 8] : cat === "apparel" ? [30, 24, 4] : [14, 8, 6];
    const suppliers = SUPPLIERS.filter((s) => s.categories.includes(cat)).map((s) => s.id);
    // SIM_SCALE keeps simulated volume (~300 orders/day) small enough to hold full order lifecycles in localStorage
    let baseDaily = +(SIM_SCALE * spec.baseDaily * Math.exp(0.6 * normal(rng)) * Math.pow(price / ((spec.price[0] + spec.price[1]) / 2), -0.35)).toFixed(2);
    if (sku === "ELE-001") baseDaily = 6;
    if (sku === "APP-003") baseDaily = 5;
    if (sku === "HOM-004") baseDaily = 4;
    const band = price >= Math.sqrt(spec.price[0] * spec.price[1]) ? "hi" : "lo";
    catalog.push({
      sku,
      name,
      category: cat,
      cluster: `${cat}_${band}`,
      cost,
      mrp: Math.round((price * u(1.2, 1.6)) / 10) * 10 - 1,
      basePrice: price,
      currentPrice: price,
      zonePrice: Object.fromEntries(REGIONS.map((r) => [r, price])) as Record<Region, number>,
      price30dMean: price,
      weight: w,
      dims: { l: Math.round(dimsBase[0] * u(0.7, 1.2)), w: Math.round(dimsBase[1] * u(0.7, 1.2)), h: Math.round(dimsBase[2] * u(0.7, 1.3)) },
      imageSeed: Math.floor(rng() * 1e6),
      elasticity: +u(spec.elas[0], spec.elas[1]).toFixed(3),
      returnRate: +returnRate.toFixed(3),
      sizingIssue,
      baseDaily: Math.max(0.4, baseDaily),
      regionShare: shares,
      supplierIds: suppliers,
    });
  });
}

// Every list price must clear the margin floor with room for a normal promotion (≥18% headroom).
// Low-value bulky items that cannot are repriced upward, as a merchandiser would.
for (const p of catalog) {
  for (let i = 0; i < 12 && floorPrice(p) > p.basePrice * 0.82; i++) {
    const next = snap99(p.basePrice * 1.12);
    p.basePrice = p.currentPrice = p.price30dMean = next;
    p.mrp = Math.max(p.mrp, Math.round((next * 1.3) / 10) * 10 - 1);
    for (const r of REGIONS) p.zonePrice[r] = next;
  }
}

// ---------------------------------------------------------------- calendar helpers
const epoch = new Date(`${SIM_EPOCH}T00:00:00Z`);
const dayDate = (d: number) => new Date(epoch.getTime() + (d - HISTORY_DAYS) * 86400000); // d in [0, HISTORY_DAYS)
const iso = (dt: Date) => dt.toISOString().slice(0, 10);
function eventOn(dateIso: string) {
  return CALENDAR.find((e) => dateIso >= e.start && dateIso <= e.end);
}

const VIRAL_SKU = "PC-004"; // Kumkumadi Glow Serum went viral on short-video platforms
const VIRAL_START = "2026-02-10";

// ---------------------------------------------------------------- demand history
const skuDailyRows: string[] = ["date,sku,category,cluster,units,price,base_price,festival,promo,dow,month,t,event"];
const skuSeries: Record<string, number[]> = {};
const skuPrices: Record<string, number[]> = {};
const daily: DailyAggregate[] = [];
const catUnitsByDay: Record<Category, number>[] = [];
const returnsByDay = new Array(HISTORY_DAYS + 30).fill(0);

for (const p of catalog) {
  skuSeries[p.sku] = [];
  skuPrices[p.sku] = [];
}

for (let d = 0; d < HISTORY_DAYS; d++) {
  const dt = dayDate(d);
  const dateIso = iso(dt);
  const dow = dt.getUTCDay();
  const month = dt.getUTCMonth() + 1;
  const ev = eventOn(dateIso);
  const trend = 0.72 + 0.28 * (d / (HISTORY_DAYS - 1));
  let orders = 0;
  let units = 0;
  let revenue = 0;
  const byCat: Record<Category, number> = { apparel: 0, electronics: 0, home: 0, personal_care: 0 };
  for (const p of catalog) {
    let price = p.basePrice;
    let promo = 0;
    let lift = 1;
    if (ev) {
      lift = ev.lift[p.category] ?? ev.lift.all ?? 1;
      price = Math.round(p.basePrice * (1 - (ev.discountPct / 100) * u(0.6, 1.25)));
      promo = 1;
    } else if (rng() < 0.05) {
      price = Math.round(p.basePrice * u(0.85, 0.93));
      promo = 1;
    }
    let viral = 1;
    if (p.sku === VIRAL_SKU) {
      const vd = (dt.getTime() - new Date(`${VIRAL_START}T00:00:00Z`).getTime()) / 86400000;
      if (vd >= 0 && vd < 3) viral = 10;
      else if (vd >= 3) viral = 1 + 9 * Math.exp(-(vd - 3) / 3);
    }
    // Festival lift is partly *explained* by discount (elasticity) and partly pure intent.
    const priceEffect = Math.pow(price / p.basePrice, p.elasticity);
    // intent normalised by the *nominal* event discount, so realised price variation still moves demand
    const intent = ev ? lift / Math.pow(1 - ev.discountPct / 100, p.elasticity) : 1;
    const noise = gamma(rng, 6) / 6;
    const lambda = p.baseDaily * trend * DOW_FACTOR[dow] * intent * priceEffect * viral * noise;
    const q = poisson(rng, lambda);
    skuSeries[p.sku].push(q);
    skuPrices[p.sku].push(price);
    skuDailyRows.push(`${dateIso},${p.sku},${p.category},${p.cluster},${q},${price},${p.basePrice},${ev ? 1 : 0},${promo},${dow},${month},${d},${ev ? `${ev.name.replace(/ /g, "_")}_${ev.start.slice(0, 4)}` : "none"}`);
    units += q;
    revenue += q * price;
    byCat[p.category] += q;
    // returns with 5-20 day lag
    const retP = trueReturnProbability(p, price, false);
    const nRet = poisson(rng, q * retP);
    if (nRet) returnsByDay[d + 5 + Math.floor(rng() * 16)] += nRet;
  }
  orders = Math.round(units / 1.32);
  const codShare = Math.min(0.68, Math.max(0.44, 0.55 + 0.04 * normal(rng)));
  daily.push({ date: dateIso, orders, units, revenue: Math.round(revenue), returns: 0, rto: 0, codShare: +codShare.toFixed(3), byCategory: byCat, festival: ev?.name });
  catUnitsByDay.push(byCat);
}
for (let d = 0; d < HISTORY_DAYS; d++) daily[d].returns = returnsByDay[d];

// ---------------------------------------------------------------- RTO training orders
const TIER_COD: Record<Tier, number> = { metro: 0.42, tier2: 0.58, tier3: 0.7 };
const LEGACY_ROUTING = { ids: ["CR-KAVERI", "CR-NORTHSTAR", "CR-DAKSHIN", "CR-VAYU"], w: [0.4, 0.25, 0.2, 0.15] };
const rtoRows: string[] = ["payment_mode,tier,order_value,category,courier_id,cart_size,first_time,month,region,rto"];
const monthRto: Record<number, { n: number; r: number }> = {};
const catWeights = catalog.map((p) => p.baseDaily);
for (let i = 0; i < 60000; i++) {
  const region = weightedPick(rng, REGIONS, REGIONS.map((r) => BASE_SHARE[r]));
  const pins = PINCODES.filter((p) => p.region === region);
  const pin = pick(rng, pins);
  const cartSize = weightedPick(rng, [1, 2, 3, 4], [0.68, 0.2, 0.08, 0.04]);
  let value = 0;
  let category: Category = "apparel";
  for (let k = 0; k < cartSize; k++) {
    const p = weightedPick(rng, catalog, catWeights);
    if (k === 0) category = p.category;
    value += Math.round(p.basePrice * u(0.8, 1));
  }
  const paymentMode = rng() < TIER_COD[pin.tier] ? "cod" : "prepaid";
  const courierId = weightedPick(rng, LEGACY_ROUTING.ids, LEGACY_ROUTING.w);
  const firstTime = rng() < 0.35;
  const month = 1 + Math.floor(rng() * 12);
  const pr = trueRtoProbability({ paymentMode, tier: pin.tier, value, category, courierId, cartSize, firstTime, month, region });
  const rto = rng() < pr ? 1 : 0;
  rtoRows.push(`${paymentMode},${pin.tier},${value},${category},${courierId},${cartSize},${firstTime ? 1 : 0},${month},${region},${rto}`);
  monthRto[month] ??= { n: 0, r: 0 };
  monthRto[month].n++;
  monthRto[month].r += rto;
}
for (const row of daily) {
  const m = Number(row.date.slice(5, 7));
  row.rto = Math.round(row.orders * row.codShare * 0 + row.orders * (monthRto[m].r / monthRto[m].n));
}

// ---------------------------------------------------------------- courier SLA + supplier lead samples
const slaRows: string[] = ["courier_id,zone,month,sla_days,actual_days,ratio"];
for (const c of COURIERS) {
  for (let i = 0; i < 2500; i++) {
    const whRegion = pick(rng, ["west", "north", "south"] as Region[]);
    const region = weightedPick(rng, REGIONS, REGIONS.map((r) => BASE_SHARE[r]));
    const zone = rateZone(whRegion, region);
    const month = 1 + Math.floor(rng() * 12);
    const actual = deliveryDays(c, zone, region, month, rng());
    slaRows.push(`${c.id},${zone},${month},${c.slaDays[zone]},${actual.toFixed(2)},${(actual / c.slaDays[zone]).toFixed(3)}`);
  }
}
const leadRows: string[] = ["supplier_id,promised_days,actual_days,deviation"];
for (const s of SUPPLIERS) {
  for (let i = 0; i < 300; i++) {
    const promised = Math.round((s.leadDaysMin + s.leadDaysMax) / 2);
    const slip = rng() > s.reliability ? Math.abs(normal(rng)) * (s.domestic ? 4 : 9) : normal(rng) * 1.2;
    const actual = Math.max(s.leadDaysMin - 2, promised + slip);
    leadRows.push(`${s.id},${promised},${actual.toFixed(1)},${(actual - promised).toFixed(2)}`);
  }
}

// ---------------------------------------------------------------- hourly (last 14 days, network level)
const hourly: HourlyAggregate[] = [];
const hourlyRows: string[] = ["ts,hour,dow,orders,units"];
const hcSum = HOUR_CURVE.reduce((a, b) => a + b, 0);
for (let d = HISTORY_DAYS - 14; d < HISTORY_DAYS; d++) {
  const agg = daily[d];
  const dow = dayDate(d).getUTCDay();
  for (let h = 0; h < 24; h++) {
    const share = HOUR_CURVE[h] / hcSum;
    const o = poisson(rng, agg.orders * share);
    const un = Math.round(o * 1.32);
    const ts = `${agg.date}T${String(h).padStart(2, "0")}:00`;
    hourly.push({ ts, orders: o, units: un });
    hourlyRows.push(`${ts},${h},${dow},${o},${un}`);
  }
}

// ---------------------------------------------------------------- initial inventory
const inventory: Record<string, Record<WarehouseId, number>> = {};
const AGEING = new Set(["HOM-012", "APP-018", "ELE-017", "HOM-026", "APP-036", "PC-015"]);
for (const p of catalog) {
  const recent = skuSeries[p.sku].slice(-28);
  const avg = Math.max(0.5, recent.reduce((a, b) => a + b, 0) / recent.length);
  const coverDays = AGEING.has(p.sku) ? u(110, 150) : u(26, 40);
  const total = Math.round(avg * coverDays);
  const whShare = Object.fromEntries(WAREHOUSE_IDS.map((w) => [w, 0])) as Record<WarehouseId, number>;
  for (const r of REGIONS) whShare[HOME_WAREHOUSE[r]] += p.regionShare[r];
  inventory[p.sku] = Object.fromEntries(WAREHOUSE_IDS.map((w) => [w, Math.round(total * whShare[w])])) as Record<WarehouseId, number>;
}
// Regional FCs (Kolkata, Guwahati) stock the full range, thinly: every SKU gets at least a few units there,
// topped up from the largest node, so local orders ship locally and only the shortfall is fetched elsewhere.
const REGIONAL_MIN: Partial<Record<WarehouseId, number>> = { "WH-KOL": 6, "WH-GAU": 3 };
for (const p of catalog) {
  for (const [wh, min] of Object.entries(REGIONAL_MIN) as [WarehouseId, number][]) {
    const gap = Math.max(0, min - inventory[p.sku][wh]);
    if (!gap) continue;
    const donor = WAREHOUSE_IDS.filter((w) => !(w in REGIONAL_MIN)).sort((a, b) => inventory[p.sku][b] - inventory[p.sku][a])[0];
    const moved = Math.min(gap, Math.max(0, inventory[p.sku][donor] - 1));
    inventory[p.sku][donor] -= moved;
    inventory[p.sku][wh] += moved;
  }
}
// hero SKU for the viral scenario starts comfortably stocked but not deep
inventory["ELE-001"] = { "WH-BHW": 70, "WH-GGN": 62, "WH-BLR": 60, "WH-KOL": 18, "WH-GAU": 4 };

// price 30-day mean
for (const p of catalog) {
  const last = skuPrices[p.sku].slice(-30);
  p.price30dMean = Math.round(last.reduce((a, b) => a + b, 0) / last.length);
}

// ---------------------------------------------------------------- write
const seed = {
  version: 1,
  generatedAt: "deterministic",
  simEpoch: SIM_EPOCH,
  historyDays: HISTORY_DAYS,
  viralHistory: { sku: VIRAL_SKU, start: VIRAL_START },
  catalog,
  inventory,
  history: daily,
  hourly,
  skuDaily: Object.fromEntries(catalog.map((p) => [p.sku, skuSeries[p.sku].slice(-60)])),
  warehouseCapacity: Object.fromEntries(WAREHOUSE_IDS.map((w) => [w, WAREHOUSE_BY_ID[w].capacity])),
};
fs.writeFileSync(path.join(OUT, "seed.json"), JSON.stringify(seed));
fs.writeFileSync(path.join(TRAIN, "sku_daily.csv"), skuDailyRows.join("\n"));
fs.writeFileSync(path.join(TRAIN, "orders_rto.csv"), rtoRows.join("\n"));
fs.writeFileSync(path.join(TRAIN, "courier_sla.csv"), slaRows.join("\n"));
fs.writeFileSync(path.join(TRAIN, "supplier_lead.csv"), leadRows.join("\n"));
fs.writeFileSync(path.join(TRAIN, "hourly.csv"), hourlyRows.join("\n"));

const totalUnits = daily.slice(-30).reduce((a, b) => a + b.units, 0) / 30;
const rtoRate = rtoRows.slice(1).reduce((a, r) => a + Number(r.at(-1)), 0) / (rtoRows.length - 1);
console.log(`catalog=${catalog.length} days=${daily.length} avgUnits/day(30d)=${totalUnits.toFixed(0)} trainingRtoRate=${(rtoRate * 100).toFixed(1)}%`);
console.log(`seed.json ${(fs.statSync(path.join(OUT, "seed.json")).size / 1024).toFixed(0)} KB`);
