"use client";
import { useMemo, useState } from "react";
import { coverDays, warehouseDaily } from "@/lib/agents/shared";
import { CATEGORY_VOLUME_FACTOR, COURIER_BY_ID, HOME_WAREHOUSE, PINCODE_BY_PIN, REGIONS, REGION_LABEL, SUPPLIER_BY_ID, WAREHOUSES, WAREHOUSE_BY_ID } from "@/lib/config/network";
import { formatSimTime } from "@/lib/engine/calendar";
import type { AppState } from "@/lib/store/state";
import { useApp } from "@/lib/store/store";
import type { Category, WarehouseId } from "@/lib/types";
import { COURIER_COLOR, IndiaMap, MAP, MAP_H, MAP_W, REGION_COLOR, WarehouseMarker, arcPath, cityXY } from "./IndiaMap";
import { WAREHOUSE_LABEL_SIDE } from "./OrderJourneyMap";
import { Panel, inrc } from "./ui";

type StockStatus = "out" | "reorder" | "low" | "overstock" | "ok";
const STATUS: Record<StockStatus, { label: string; cls: string; dot: string }> = {
  out: { label: "Out of stock", cls: "bg-tower-red/15 text-tower-red", dot: "#f0525b" },
  reorder: { label: "Below reorder pt", cls: "bg-tower-amber/15 text-tower-amber", dot: "#f5a524" },
  low: { label: "Low cover", cls: "bg-yellow-400/10 text-yellow-300", dot: "#facc15" },
  overstock: { label: "Overstock", cls: "bg-tower-violet/15 text-tower-violet", dot: "#a78bfa" },
  ok: { label: "Healthy", cls: "bg-tower-green/10 text-tower-green", dot: "#4ade80" },
};
const CATEGORY_LABEL: Record<Category, string> = { apparel: "Apparel", electronics: "Electronics", home: "Home", personal_care: "Personal care" };

interface Row {
  sku: string;
  name: string;
  category: Category;
  onHand: number;
  rop: number | null;
  upTo: number | null;
  cover: number;
  daily: number;
  inbound: number;
  elsewhere: number;
  value: number;
  status: StockStatus;
}

function statusFor(onHand: number, rop: number | null, cover: number): StockStatus {
  if (onHand <= 0) return "out";
  if (rop !== null && onHand < rop) return "reorder";
  if (cover < 7) return "low";
  if (cover > 90) return "overstock";
  return "ok";
}

function summarise(s: AppState, wh: WarehouseId) {
  const w = WAREHOUSE_BY_ID[wh];
  const rows: Row[] = s.catalog.map((p) => {
    const onHand = Math.max(0, s.inventory[p.sku]?.[wh] ?? 0);
    const pol = s.policies[`${p.sku}|${wh}`];
    const inboundPo = s.purchaseOrders.filter((po) => po.status === "open" && po.sku === p.sku && po.warehouseId === wh).reduce((a, po) => a + po.qty, 0);
    const inboundTr = s.transfers.filter((t) => t.sku === p.sku && t.to === wh).reduce((a, t) => a + t.qty, 0);
    const cover = coverDays(s, p, wh);
    const elsewhere = Object.entries(s.inventory[p.sku] ?? {}).reduce((a, [k, v]) => a + (k === wh ? 0 : Math.max(0, v)), 0);
    return { sku: p.sku, name: p.name, category: p.category, onHand, rop: pol?.reorderPoint ?? null, upTo: pol?.orderUpTo ?? null, cover, daily: warehouseDaily(s, p, wh), inbound: inboundPo + inboundTr, elsewhere, value: onHand * p.cost, status: statusFor(onHand, pol?.reorderPoint ?? null, cover) };
  });
  const units = rows.reduce((a, r) => a + r.onHand, 0);
  const daily = rows.reduce((a, r) => a + r.daily, 0);
  const counts = Object.fromEntries((Object.keys(STATUS) as StockStatus[]).map((k) => [k, rows.filter((r) => r.status === k).length])) as Record<StockStatus, number>;
  const dispatched24 = s.shipments.filter((x) => x.warehouseId === wh && s.clock.tick - x.shippedTick <= 24);
  const served = new Set(REGIONS.filter((r) => HOME_WAREHOUSE[r] === wh));
  const crossRegion = dispatched24.filter((x) => !served.has(x.region)).length;
  const coveredElsewhere = s.shipments.filter((x) => served.has(x.region) && x.warehouseId !== wh && s.clock.tick - x.shippedTick <= 24).length;
  const holding = s.catalog.reduce((a, p) => a + Math.max(0, s.inventory[p.sku]?.[wh] ?? 0) * w.holdingCostPerUnitDay * CATEGORY_VOLUME_FACTOR[p.category], 0);
  return {
    rows,
    units,
    value: rows.reduce((a, r) => a + r.value, 0),
    capacityPct: units / w.capacity,
    cover: daily > 0 ? units / daily : 0,
    ranged: rows.filter((r) => r.onHand > 0 || r.inbound > 0).length,
    counts,
    inbound: rows.reduce((a, r) => a + r.inbound, 0),
    dispatched24,
    crossRegion,
    coveredElsewhere,
    holding,
    served,
  };
}

export function WarehouseDashboard() {
  const [selected, setSelected] = useState<WarehouseId>("WH-BHW");
  const tick = useApp((s) => s.clock.tick);
  const all = useMemo(() => {
    const state = useApp.getState();
    return Object.fromEntries(WAREHOUSES.map((w) => [w.id, summarise(state, w.id)])) as Record<WarehouseId, ReturnType<typeof summarise>>;
  }, [tick]);
  const w = WAREHOUSE_BY_ID[selected];
  const d = all[selected];

  return (
    <div className="space-y-4">
      {/* selector */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {WAREHOUSES.map((x) => {
          const sum = all[x.id];
          const active = x.id === selected;
          const alerts = sum.counts.out + sum.counts.reorder;
          return (
            <button key={x.id} onClick={() => setSelected(x.id)} className={`group rounded-lg border p-3 text-left transition ${active ? "border-tower-cyan bg-tower-cyan/[.07] shadow-[0_0_0_1px_rgba(76,225,214,.25)]" : "border-tower-line bg-[#0c151e] hover:border-tower-dim"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rotate-45 border" style={{ borderColor: REGION_COLOR[x.region], background: active ? REGION_COLOR[x.region] : "transparent" }} />
                  <span className={`text-sm font-semibold ${active ? "text-white" : "text-tower-text"}`}>{x.city}</span>
                </span>
                {alerts > 0 && <span className="rounded-full bg-tower-amber/15 px-1.5 py-0.5 font-mono text-[10px] text-tower-amber">{alerts} ⚑</span>}
              </div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-tower-dim">
                {x.id} · {REGION_LABEL[x.region]}
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="num font-mono text-lg text-white">{sum.units.toLocaleString("en-IN")}</span>
                <span className="font-mono text-[10px] text-tower-dim">{Math.round(sum.capacityPct * 100)}% cap</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#16212c]">
                <div className="h-full rounded-full bg-gradient-to-r from-teal-700 to-tower-cyan transition-all duration-700" style={{ width: `${Math.min(100, sum.capacityPct * 100 * 2.5)}%` }} />
              </div>
              <div className="mt-2 flex gap-3 font-mono text-[10px] text-tower-dim">
                <span>{sum.cover.toFixed(0)}d cover</span>
                <span className={sum.counts.out ? "text-tower-red" : ""}>{sum.counts.out} out</span>
                <span>{sum.dispatched24.length} shipped/24h</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* header + KPIs */}
      <div className="rounded-lg border border-tower-line bg-[#0a121a] p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[.2em]" style={{ color: REGION_COLOR[w.region] }}>
              {REGION_LABEL[w.region]} zone · home FC for {Array.from(d.served).map((r) => REGION_LABEL[r]).join(", ") || "—"}
            </div>
            <h2 className="mt-1 text-2xl font-semibold text-white">{w.name}</h2>
          </div>
          <div className="font-mono text-[10px] text-tower-dim">
            capacity {w.capacity.toLocaleString("en-IN")} units · holding ₹{w.holdingCostPerUnitDay}/unit/day
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-tower-line bg-tower-line sm:grid-cols-4 xl:grid-cols-8">
          <Kpi label="On hand" value={d.units.toLocaleString("en-IN")} sub={`${d.ranged} of ${d.rows.length} SKUs stocked`} />
          <Kpi label="Capacity used" value={`${(d.capacityPct * 100).toFixed(1)}%`} sub={`${(w.capacity - d.units).toLocaleString("en-IN")} free`} />
          <Kpi label="Stock value" value={inrc(d.value)} sub="at landed cost" />
          <Kpi label="Days of cover" value={d.cover.toFixed(1)} sub="vs forecast demand served" tone={d.cover < 10 ? "amber" : undefined} />
          <Kpi label="Out of stock" value={String(d.counts.out)} sub={`${d.counts.reorder} below reorder pt`} tone={d.counts.out ? "red" : undefined} />
          <Kpi label="Inbound" value={d.inbound.toLocaleString("en-IN")} sub="units on POs + transfers" />
          <Kpi label="Dispatched · 24h" value={String(d.dispatched24.length)} sub={`${d.crossRegion} to other zones`} />
          <Kpi label="Home orders sourced elsewhere" value={String(d.coveredElsewhere)} sub="last 24h · stock gaps" tone={d.coveredElsewhere ? "amber" : undefined} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <WarehouseMap wh={selected} />
        <div className="grid gap-4">
          <Panel title="Stock health">
            <div className="space-y-2 p-3">
              <div className="flex h-3 overflow-hidden rounded-full bg-[#16212c]">
                {(Object.keys(STATUS) as StockStatus[]).map((k) => (
                  <div key={k} title={`${STATUS[k].label}: ${d.counts[k]}`} style={{ width: `${(d.counts[k] / d.rows.length) * 100}%`, background: STATUS[k].dot }} className="transition-all duration-700" />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] sm:grid-cols-3">
                {(Object.keys(STATUS) as StockStatus[]).map((k) => (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-tower-dim">
                      <span className="h-2 w-2 rounded-full" style={{ background: STATUS[k].dot }} />
                      {STATUS[k].label}
                    </span>
                    <span className="num text-tower-text">{d.counts[k]}</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
          <Panel title="By category">
            <div className="space-y-2.5 p-3">
              {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => {
                const rows = d.rows.filter((r) => r.category === c);
                const units = rows.reduce((a, r) => a + r.onHand, 0);
                const value = rows.reduce((a, r) => a + r.value, 0);
                const out = rows.filter((r) => r.status === "out").length;
                return (
                  <div key={c}>
                    <div className="flex justify-between font-mono text-[11px]">
                      <span className="text-tower-text">{CATEGORY_LABEL[c]}</span>
                      <span className="text-tower-dim">
                        {units.toLocaleString("en-IN")} u · {inrc(value)}
                        {out ? <span className="text-tower-red"> · {out} out</span> : null}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-[#16212c]">
                      <div className="h-full rounded-full bg-tower-cyan/70 transition-all duration-700" style={{ width: `${d.value ? (value / d.value) * 100 : 0}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
          <InboundPanel wh={selected} />
        </div>
      </div>

      <InventoryTable rows={d.rows} city={w.city} />

      <div className="grid gap-4 xl:grid-cols-2">
        <OutboundPanel wh={selected} />
        <ActivityPanel wh={selected} />
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "red" | "amber" }) {
  return (
    <div className="bg-[#0c151e] px-3 py-2.5">
      <div className="font-mono text-[9.5px] uppercase tracking-wider text-tower-dim">{label}</div>
      <div className={`num mt-1 font-mono text-xl ${tone === "red" ? "text-tower-red" : tone === "amber" ? "text-tower-amber" : "text-white"}`}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-tower-dim" title={sub}>{sub}</div>
    </div>
  );
}

function WarehouseMap({ wh }: { wh: WarehouseId }) {
  const shipments = useApp((s) => s.shipments);
  const transfers = useApp((s) => s.transfers);
  const tick = useApp((s) => s.clock.tick);
  const home = MAP.warehouses[wh];
  const served = REGIONS.filter((r) => HOME_WAREHOUSE[r] === wh);
  const recent = shipments.filter((x) => x.warehouseId === wh && tick - x.shippedTick <= 24).slice(-80);
  const dests = recent.map((x) => (x.pincode ? cityXY(x.pincode) : null)).filter(Boolean) as [number, number][];
  const pts = [home, ...dests.slice(-30)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  let vw = Math.max(260, Math.max(...xs) - Math.min(...xs) + 160);
  let vh = Math.max(220, Math.max(...ys) - Math.min(...ys) + 160);
  if (vw / vh < 1.15) vw = vh * 1.15;
  else vh = vw / 1.15;
  const vx = Math.max(-20, Math.min(MAP_W + 20 - vw, (Math.max(...xs) + Math.min(...xs)) / 2 - vw / 2));
  const vy = Math.max(-20, Math.min(MAP_H + 20 - vh, (Math.max(...ys) + Math.min(...ys)) / 2 - vh / 2));
  const zoom = vw / (MAP_W + 24);

  return (
    <Panel title={`Dispatch map · ${WAREHOUSE_BY_ID[wh].city} · last 24h`} right={<span className="font-mono text-[10px] text-tower-cyan">{recent.length} parcels</span>} bodyClass="p-3">
      <div className="overflow-hidden rounded-lg border border-tower-line bg-[radial-gradient(ellipse_at_center,rgba(76,225,214,.07),transparent_60%),#060d14]">
        <IndiaMap idPrefix={`wh-${wh}`} viewBox={[vx, vy, vw, vh]} showLabels={zoom > 0.5} fill={(s) => (served.includes(s.region) ? `${REGION_COLOR[s.region]}22` : null)} className="aspect-[1.15] w-full">
          {transfers
            .filter((t) => t.from === wh || t.to === wh)
            .map((t) => (
              <path key={t.id} d={arcPath(MAP.warehouses[t.from], MAP.warehouses[t.to], 0.35)} fill="none" stroke={t.to === wh ? "#4ade80" : "#f5a524"} strokeWidth={2.2 * zoom} className="flow" pointerEvents="none" />
            ))}
          {recent.map((x) => {
            const to = x.pincode ? cityXY(x.pincode) : null;
            if (!to) return null;
            const d = arcPath(home, to);
            const color = COURIER_COLOR[x.courierId] ?? "#2dd4bf";
            const cross = !served.includes(x.region);
            return (
              <g key={x.id} pointerEvents="none">
                <path d={d} fill="none" stroke={color} strokeOpacity={x.outcome === "in_transit" ? 0.7 : 0.2} strokeWidth={(cross ? 1.3 : 0.9) * zoom} strokeDasharray={cross ? `${4 * zoom} ${3 * zoom}` : undefined} />
                {x.outcome === "in_transit" && (
                  <circle r={2.4 * zoom} fill={color}>
                    <animateMotion dur={`${3 + (x.id.charCodeAt(x.id.length - 1) % 5) * 0.4}s`} repeatCount="indefinite" path={d} />
                  </circle>
                )}
                <circle cx={to[0]} cy={to[1]} r={1.8 * zoom} fill={x.outcome === "rto" ? "#f0525b" : x.outcome === "delivered" ? "#4ade80" : "#e2e8f0"} />
              </g>
            );
          })}
          {WAREHOUSES.map((x) => (
            <WarehouseMarker key={x.id} id={x.id} label={x.city} state={x.id === wh ? "selected" : "unavailable"} scale={zoom} labelSide={WAREHOUSE_LABEL_SIDE[x.id]} />
          ))}
        </IndiaMap>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px] text-tower-dim">
        <span>━ home-zone parcel</span>
        <span>┅ fetched for another zone</span>
        <span className="text-tower-green">━ transfer in</span>
        <span className="text-tower-amber">━ transfer out</span>
        <span>● delivered / in transit / RTO</span>
      </div>
    </Panel>
  );
}

type SortKey = "sku" | "onHand" | "cover" | "value" | "inbound";

function InventoryTable({ rows, city }: { rows: Row[]; city: string }) {
  const [filter, setFilter] = useState<StockStatus | "all">("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "cover", dir: 1 });
  const list = useMemo(() => {
    const f = rows.filter((r) => (filter === "all" || r.status === filter) && (!q || `${r.sku} ${r.name}`.toLowerCase().includes(q.toLowerCase())));
    return f.sort((a, b) => {
      const av = sort.key === "sku" ? a.sku : sort.key === "cover" ? (a.onHand === 0 ? -1 : a.cover) : a[sort.key];
      const bv = sort.key === "sku" ? b.sku : sort.key === "cover" ? (b.onHand === 0 ? -1 : b.cover) : b[sort.key];
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  }, [rows, filter, q, sort]);
  const th = (key: SortKey, label: string, right = true) => (
    <th className={`cursor-pointer select-none px-3 py-2 font-normal hover:text-tower-text ${right ? "text-right" : "text-left"}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === "sku" ? 1 : -1 }))}>
      {label}
      {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <Panel
      title={`Inventory · ${city} · ${list.length} SKUs`}
      right={
        <div className="flex flex-wrap items-center gap-1">
          {(["all", "out", "reorder", "low", "overstock", "ok"] as const).map((k) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${filter === k ? "bg-tower-cyan/15 text-tower-cyan" : "text-tower-dim hover:text-tower-text"}`}>
              {k === "all" ? "all" : STATUS[k].label}
            </button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search sku / product" className="ml-2 w-44 rounded-sm border border-tower-line bg-[#070d13] px-2 py-1 font-mono text-[11px] text-tower-text outline-none focus:border-tower-cyan" />
        </div>
      }
      bodyClass="max-h-[520px] overflow-auto scroll-thin"
    >
      <table className="w-full min-w-[860px] font-mono text-[11px]">
        <thead className="sticky top-0 z-10 bg-[#0b1219] text-[10px] uppercase tracking-wider text-tower-dim">
          <tr>
            {th("sku", "SKU", false)}
            <th className="px-3 py-2 text-left font-normal">Product</th>
            {th("onHand", "On hand")}
            <th className="px-3 py-2 text-right font-normal">Reorder pt</th>
            <th className="px-3 py-2 text-right font-normal">Order-up-to</th>
            {th("cover", "Cover")}
            {th("inbound", "Inbound")}
            <th className="px-3 py-2 text-right font-normal">Other FCs</th>
            {th("value", "Value")}
            <th className="px-3 py-2 text-left font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const ropPct = r.upTo ? Math.min(1, r.onHand / r.upTo) : 0;
            return (
              <tr key={r.sku} className="border-t border-tower-line/60 hover:bg-white/[.02]">
                <td className="px-3 py-1.5 text-tower-dim">{r.sku}</td>
                <td className="max-w-[240px] truncate px-3 py-1.5 text-tower-text" title={r.name}>
                  {r.name}
                  <span className="ml-2 text-[10px] text-[#4b5b6b]">{CATEGORY_LABEL[r.category]}</span>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <div className="num text-white">{r.onHand.toLocaleString("en-IN")}</div>
                  {r.upTo !== null && (
                    <div className="ml-auto mt-0.5 h-[3px] w-16 rounded-full bg-[#16212c]">
                      <div className="h-full rounded-full" style={{ width: `${ropPct * 100}%`, background: STATUS[r.status].dot }} />
                    </div>
                  )}
                </td>
                <td className="num px-3 py-1.5 text-right text-tower-dim">{r.rop ?? "—"}</td>
                <td className="num px-3 py-1.5 text-right text-tower-dim">{r.upTo ?? "—"}</td>
                <td className={`num px-3 py-1.5 text-right ${r.onHand === 0 ? "text-tower-red" : r.cover < 7 ? "text-tower-amber" : "text-tower-text"}`}>{r.onHand === 0 ? "0" : r.cover > 365 ? ">365d" : `${r.cover.toFixed(1)}d`}</td>
                <td className={`num px-3 py-1.5 text-right ${r.inbound ? "text-tower-green" : "text-tower-dim"}`}>{r.inbound ? `+${r.inbound}` : "—"}</td>
                <td className="num px-3 py-1.5 text-right text-tower-dim" title="units available at the other fulfilment centres">
                  {r.elsewhere.toLocaleString("en-IN")}
                </td>
                <td className="num px-3 py-1.5 text-right text-tower-dim">{inrc(r.value)}</td>
                <td className="px-3 py-1.5">
                  <span className={`whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[10px] ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                  {r.status === "out" && r.elsewhere > 0 && <span className="ml-1.5 text-[10px] text-tower-dim">fetched from other FCs</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function InboundPanel({ wh }: { wh: WarehouseId }) {
  const allPos = useApp((s) => s.purchaseOrders);
  const allTransfers = useApp((s) => s.transfers);
  const pos = useMemo(() => allPos.filter((p) => p.status === "open" && p.warehouseId === wh), [allPos, wh]);
  const transfers = useMemo(() => allTransfers.filter((t) => t.to === wh || t.from === wh), [allTransfers, wh]);
  const catalog = useApp((s) => s.catalog);
  const tick = useApp((s) => s.clock.tick);
  const name = (sku: string) => catalog.find((p) => p.sku === sku)?.name ?? sku;
  return (
    <Panel title={`Inbound & transfers · ${pos.length + transfers.length}`} bodyClass="max-h-[230px] overflow-y-auto scroll-thin">
      {!pos.length && !transfers.length && <div className="p-4 text-center font-mono text-xs text-tower-dim">Nothing inbound.</div>}
      <ul className="divide-y divide-tower-line/60 font-mono text-[11px]">
        {transfers.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0">
              <span className={t.to === wh ? "text-tower-green" : "text-tower-amber"}>{t.to === wh ? `← ${WAREHOUSE_BY_ID[t.from].city}` : `→ ${WAREHOUSE_BY_ID[t.to].city}`}</span>
              <span className="ml-2 truncate text-tower-text">{name(t.sku)}</span>
            </span>
            <span className="whitespace-nowrap text-tower-dim">
              {t.qty} u · {Math.max(0, (t.arriveTick - tick) / 24).toFixed(1)}d
            </span>
          </li>
        ))}
        {pos
          .slice()
          .sort((a, b) => a.etaTick - b.etaTick)
          .map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">
                <span className="text-tower-blue">{p.id}</span>
                <span className="ml-2 text-tower-text">{name(p.sku)}</span>
                <span className="ml-2 text-tower-dim">{SUPPLIER_BY_ID[p.supplierId]?.name}</span>
              </span>
              <span className="whitespace-nowrap text-tower-dim">
                {p.qty} u · ETA {Math.max(0, (p.etaTick - tick) / 24).toFixed(1)}d
              </span>
            </li>
          ))}
      </ul>
    </Panel>
  );
}

function OutboundPanel({ wh }: { wh: WarehouseId }) {
  const shipments = useApp((s) => s.shipments);
  const orders = useApp((s) => s.orders);
  const catalog = useApp((s) => s.catalog);
  const recent = shipments.filter((x) => x.warehouseId === wh).slice(-40).reverse();
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const served = REGIONS.filter((r) => HOME_WAREHOUSE[r] === wh);
  return (
    <Panel title="Recent outbound parcels" bodyClass="max-h-[340px] overflow-y-auto scroll-thin">
      {!recent.length && <div className="p-4 text-center font-mono text-xs text-tower-dim">No parcels shipped yet.</div>}
      <ul className="divide-y divide-tower-line/60 font-mono text-[11px]">
        {recent.map((x) => {
          const o = orderById.get(x.orderId);
          const city = x.pincode ? PINCODE_BY_PIN[x.pincode]?.city : REGION_LABEL[x.region];
          const split = (o?.legs?.length ?? 1) > 1;
          const cross = !served.includes(x.region);
          return (
            <li key={x.id} className="px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: COURIER_COLOR[x.courierId] }} />
                  <span className="text-tower-text">{x.orderId}</span>
                  <span className="text-tower-dim">→ {city}</span>
                  {cross && <span className="rounded-sm bg-tower-violet/15 px-1 text-[10px] text-tower-violet">other zone</span>}
                  {split && <span className="rounded-sm bg-tower-amber/15 px-1 text-[10px] text-tower-amber">split parcel</span>}
                </span>
                <span className={x.outcome === "delivered" ? "text-tower-green" : x.outcome === "rto" ? "text-tower-red" : "text-tower-amber"}>{x.outcome.replace("_", " ")}</span>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-tower-dim">
                {COURIER_BY_ID[x.courierId]?.name} · zone {x.zone} · ₹{x.cost} · {x.lines.map((l) => `${l.qty}× ${catalog.find((p) => p.sku === l.sku)?.name ?? l.sku}`).join(", ")}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function ActivityPanel({ wh }: { wh: WarehouseId }) {
  const decisions = useApp((s) => s.decisions);
  const w = WAREHOUSE_BY_ID[wh];
  const mine = decisions.filter((d) => d.summary.includes(w.city) || d.reasoning.includes(w.name) || d.reasoning.includes(wh) || d.summary.includes(wh)).slice(-30).reverse();
  return (
    <Panel title={`Agent activity · ${w.city}`} bodyClass="max-h-[340px] overflow-y-auto scroll-thin">
      {!mine.length && <div className="p-4 text-center font-mono text-xs text-tower-dim">No agent decisions have referenced this centre yet.</div>}
      <ul className="divide-y divide-tower-line/60">
        {mine.map((d) => (
          <li key={d.id} className="px-3 py-2">
            <div className="flex justify-between gap-2 font-mono text-[10px]">
              <span className="uppercase tracking-wider text-tower-cyan">{d.title.split(" · ")[0]}</span>
              <span className="text-tower-dim">{formatSimTime(d.tick)}</span>
            </div>
            <div className="mt-0.5 text-xs text-tower-text">{d.summary}</div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
