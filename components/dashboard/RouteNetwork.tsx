"use client";
import { useMemo, useState } from "react";
import { COURIER_BY_ID, PINCODE_BY_PIN, REGION_LABEL, WAREHOUSES, WAREHOUSE_IDS } from "@/lib/config/network";
import { useApp } from "@/lib/store/store";
import type { Region } from "@/lib/types";
import { COURIER_COLOR, IndiaMap, MAP, REGION_COLOR, WarehouseMarker, arcPath, cityXY, lerpColor, stateOf } from "./IndiaMap";
import { WAREHOUSE_LABEL_SIDE } from "./OrderJourneyMap";
import { Panel, inrc } from "./ui";

type Layer = "routes" | "demand" | "sla" | "rto";
const LAYERS: { id: Layer; label: string; legend: [string, string]; stops: string[] }[] = [
  { id: "routes", label: "Live routes", legend: ["", "active orders"], stops: ["#0f1a25", "#12303a", "#155e63", "#1fb5ad"] },
  { id: "demand", label: "Demand heat", legend: ["low", "units · 24h"], stops: ["#0f1a25", "#115e59", "#14b8a6", "#99f6e4"] },
  { id: "sla", label: "Courier SLA", legend: ["on time", "2× SLA"], stops: ["#14532d", "#4d7c0f", "#b45309", "#b91c1c"] },
  { id: "rto", label: "RTO risk", legend: ["5%", "30%+"], stops: ["#0f2a1d", "#3f6212", "#b45309", "#be123c"] },
];
const LABEL_SIDE = WAREHOUSE_LABEL_SIDE;

export function RouteNetwork() {
  const [layer, setLayer] = useState<Layer>("routes");
  const orders = useApp((s) => s.orders);
  const shipments = useApp((s) => s.shipments);
  const couriers = useApp((s) => s.couriers);
  const transfers = useApp((s) => s.transfers);
  const inventory = useApp((s) => s.inventory);
  const tick = useApp((s) => s.clock.tick);
  const L = LAYERS.find((x) => x.id === layer)!;

  const data = useMemo(() => {
    const byState: Record<string, { active: number; units24: number; orders24: number; rtoSum: number }> = {};
    const bump = (st: string) => (byState[st] ??= { active: 0, units24: 0, orders24: 0, rtoSum: 0 });
    const waiting: { id: string; xy: [number, number]; backordered: boolean; storefront: string | null }[] = [];
    const pulses = new Map<string, { xy: [number, number]; n: number; storefront: string | null }>();
    for (const o of orders) {
      const st = stateOf(o.pincode);
      const xy = cityXY(o.pincode);
      if (!st || !xy) continue;
      const rec = bump(st);
      if (o.status === "placed" || o.status === "backordered" || o.status === "shipped") rec.active += 1;
      if (tick - o.tick <= 24) {
        rec.units24 += o.lines.reduce((a, l) => a + l.qty, 0);
        rec.orders24 += 1;
        rec.rtoSum += o.rto?.p ?? 0;
      }
      if ((o.status === "placed" || o.status === "backordered") && waiting.length < 60) waiting.push({ id: o.id, xy, backordered: o.status === "backordered", storefront: o.source === "storefront" ? o.customerName : null });
      if (tick - o.tick <= 1) {
        const city = PINCODE_BY_PIN[o.pincode].city;
        const p = pulses.get(city) ?? { xy, n: 0, storefront: null };
        p.n += 1;
        if (o.source === "storefront") p.storefront = o.customerName;
        pulses.set(city, p);
      }
    }
    const sla: Partial<Record<Region, { s: number; n: number }>> = {};
    const live: { id: string; d: string; color: string; fresh: boolean; dur: number }[] = [];
    let dispatchCost = 0;
    const inTransit = shipments.filter((s) => s.outcome === "in_transit");
    for (const sh of shipments) {
      const slaDays = COURIER_BY_ID[sh.courierId].slaDays[sh.zone];
      const ratio = sh.outcome === "delivered" && tick - sh.resolveTick < 72 ? (sh.resolveTick - sh.shippedTick) / 24 / slaDays : sh.outcome === "in_transit" && tick > sh.etaTick ? (tick - sh.shippedTick) / 24 / slaDays : null;
      if (ratio !== null) {
        const x = (sla[sh.region] ??= { s: 0, n: 0 });
        x.s += ratio;
        x.n += 1;
      }
    }
    // newest in-transit shipments first, capped for legibility
    for (const sh of inTransit.slice(-90).reverse()) {
      dispatchCost += sh.cost;
      const to = sh.pincode ? cityXY(sh.pincode) : null;
      if (!to || live.length >= 55) continue;
      const d = arcPath(MAP.warehouses[sh.warehouseId], to);
      const length = Math.hypot(to[0] - MAP.warehouses[sh.warehouseId][0], to[1] - MAP.warehouses[sh.warehouseId][1]);
      live.push({ id: sh.id, d, color: COURIER_COLOR[sh.courierId] ?? "#2dd4bf", fresh: tick - sh.shippedTick <= 1, dur: 2.5 + length / 90 });
    }
    const maxActive = Math.max(1, ...Object.values(byState).map((x) => x.active));
    const maxUnits = Math.max(1, ...Object.values(byState).map((x) => x.units24));
    const zone: Record<Region, number> = { north: 0, west: 0, south: 0, east: 0, northeast: 0 };
    for (const s of MAP.states) zone[s.region] += byState[s.name]?.units24 ?? 0;
    return { byState, waiting, pulses, sla, live, maxActive, maxUnits, zone, inTransitCount: inTransit.length, dispatchCost };
  }, [orders, shipments, tick]);

  const stateValue = (name: string, region: Region) => {
    const r = data.byState[name];
    if (layer === "routes") return r?.active ? { t: 0.15 + 0.85 * Math.sqrt(r.active / data.maxActive), text: `${r.active} active orders` } : null;
    if (layer === "demand") return r?.units24 ? { t: Math.sqrt(r.units24 / data.maxUnits), text: `${r.units24} units in 24h` } : null;
    if (layer === "rto") {
      if (!r?.orders24) return null;
      const p = r.rtoSum / r.orders24;
      return { t: (p - 0.05) / 0.25, text: `${Math.round(p * 100)}% avg RTO risk` };
    }
    const z = data.sla[region];
    if (!z || z.n < 3) return { t: 0.04, text: "carriers on time" };
    const ratio = z.s / z.n;
    return { t: (ratio - 0.8) / 1.2, text: `${ratio.toFixed(2)}× SLA across zone` };
  };

  const units = (w: (typeof WAREHOUSE_IDS)[number]) => Object.values(inventory).reduce((a, r) => a + Math.max(0, r[w]), 0);
  const delivered = shipments.filter((s) => s.outcome === "delivered").length;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_290px]">
      <Panel
        title="India route network"
        right={
          <div className="flex flex-wrap items-center gap-1">
            {LAYERS.map((x) => (
              <button key={x.id} onClick={() => setLayer(x.id)} className={`rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition ${layer === x.id ? "bg-tower-cyan/15 text-tower-cyan" : "text-tower-dim hover:text-tower-text"}`}>
                {x.label}
              </button>
            ))}
          </div>
        }
        bodyClass="p-3"
      >
        <div className="relative overflow-hidden rounded-lg border border-tower-line bg-[radial-gradient(ellipse_at_40%_35%,rgba(76,225,214,.08),transparent_55%),#070e15]">
          <IndiaMap
            idPrefix="rn"
            className="mx-auto max-h-[720px] max-w-[760px]"
            fill={(s) => {
              const v = stateValue(s.name, s.region);
              return v ? lerpColor(L.stops, v.t) : null;
            }}
            tooltip={(s) => {
              const r = data.byState[s.name];
              return (
                <>
                  <div>{stateValue(s.name, s.region)?.text ?? "no orders"}</div>
                  <div className="text-tower-dim">{r?.orders24 ?? 0} orders · 24h</div>
                </>
              );
            }}
          >
            {/* inter-warehouse stock transfers */}
            {transfers.map((t) => (
              <path key={t.id} d={arcPath(MAP.warehouses[t.from], MAP.warehouses[t.to], 0.35)} fill="none" stroke="#4ade80" strokeWidth={2.2} className="flow" pointerEvents="none" />
            ))}

            {/* in-transit shipments: warehouse → exact customer city, with a moving parcel */}
            <g pointerEvents="none">
              {data.live.map((a) => (
                <g key={a.id}>
                  <path d={a.d} fill="none" stroke={a.color} strokeOpacity={a.fresh ? 0.85 : 0.28} strokeWidth={a.fresh ? 1.3 : 0.8} pathLength={1} className={a.fresh ? "arc" : undefined} />
                  <circle r={a.fresh ? 2.4 : 1.6} fill={a.color}>
                    <animateMotion dur={`${a.dur}s`} repeatCount="indefinite" path={a.d} />
                  </circle>
                </g>
              ))}
            </g>

            {/* orders waiting for allocation / stock */}
            <g pointerEvents="none">
              {data.waiting.map((w) => (
                <circle key={w.id} cx={w.xy[0]} cy={w.xy[1]} r={w.backordered ? 3 : 2.2} fill={w.backordered ? "#f5a524" : "#94a3b8"} fillOpacity={0.9} stroke="#050a0f" strokeWidth={0.8} />
              ))}
            </g>

            {/* new orders this cycle */}
            <g pointerEvents="none">
              {Array.from(data.pulses.entries()).map(([city, p]) => (
                <g key={`${city}-${tick}`}>
                  <circle cx={p.xy[0]} cy={p.xy[1]} r={Math.min(8, 2.5 + p.n)} fill="none" stroke={p.storefront ? "#fb923c" : "#e2e8f0"} strokeWidth={1.3} className="ping" />
                  {p.storefront && (
                    <g>
                      <circle cx={p.xy[0]} cy={p.xy[1]} r={3.4} fill="#fb923c" />
                      <rect x={p.xy[0] + 7} y={p.xy[1] - 17} width={Math.max(60, (p.storefront.length + city.length) * 5.6 + 18)} height={14} rx={3} fill="#1c0f06e6" stroke="#fb923c88" />
                      <text x={p.xy[0] + 12} y={p.xy[1] - 7} fontSize="9" fontFamily="ui-monospace, monospace" fill="#fdba74">
                        {p.storefront} · {city}
                      </text>
                    </g>
                  )}
                </g>
              ))}
            </g>

            {WAREHOUSES.map((w) => (
              <WarehouseMarker key={w.id} id={w.id} label={w.city} sub={`${units(w.id).toLocaleString("en-IN")} units`} labelSide={LABEL_SIDE[w.id]} />
            ))}
          </IndiaMap>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-tower-line/70 bg-[#060b10]/80 px-3 py-2 font-mono text-[10px] text-tower-dim">
            <div className="flex items-center gap-2">
              {L.legend[0] && <span>{L.legend[0]}</span>}
              <span className="h-2 w-28 rounded-full" style={{ background: `linear-gradient(90deg, ${L.stops.join(",")})` }} />
              <span>{L.legend[1]}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {Object.entries(COURIER_COLOR).map(([id, c]) => (
                <span key={id} className="flex items-center gap-1.5">
                  <span className="h-[3px] w-4 rounded-full" style={{ background: c }} />
                  {COURIER_BY_ID[id].name.split(" ")[0]}
                </span>
              ))}
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-400" /> awaiting allocation</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-tower-amber" /> backordered</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-orange-400" /> storefront order</span>
              <span className="flex items-center gap-1.5"><span className="h-[3px] w-4 rounded-full bg-tower-green" /> stock transfer</span>
            </div>
          </div>
        </div>
      </Panel>

      <div className="space-y-3">
        <RouteStat label="Shipments in transit" value={data.inTransitCount.toLocaleString("en-IN")} hint="Warehouse → customer city, drawn live on the map" />
        <RouteStat label="Dispatch cost" value={inrc(data.dispatchCost)} hint="Forward charges on the latest in-transit shipments" />
        <RouteStat label="Delivered" value={delivered.toLocaleString("en-IN")} hint="Closed as delivered in the shipment window" />
        <Panel title="Zones · units in 24h">
          <div className="space-y-2 p-3 font-mono text-[11px]">
            {(Object.keys(REGION_COLOR) as Region[]).map((r) => {
              const max = Math.max(1, ...Object.values(data.zone));
              return (
                <div key={r}>
                  <div className="flex justify-between">
                    <span className="flex items-center gap-2 text-tower-text">
                      <span className="h-[3px] w-4 rounded-full" style={{ background: REGION_COLOR[r], boxShadow: `0 0 6px ${REGION_COLOR[r]}` }} />
                      {REGION_LABEL[r]}
                    </span>
                    <span className="num text-tower-dim">{data.zone[r]}</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-[#16212c]">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(data.zone[r] / max) * 100}%`, background: REGION_COLOR[r] }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel title="Courier health">
          <div className="space-y-2 p-3">
            {couriers.map((c) => (
              <div key={c.id} className="flex items-center justify-between font-mono text-[10px]">
                <span className="flex items-center gap-2 text-tower-text">
                  <span className="h-2 w-2 rounded-full" style={{ background: COURIER_COLOR[c.id] }} />
                  {c.name}
                </span>
                <span className={c.slaHealth <= 1.05 ? "text-tower-green" : "text-tower-amber"}>
                  {c.slaHealth.toFixed(2)}× SLA{c.weight < 1 ? ` · w${c.weight}` : ""}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function RouteStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-tower-line bg-[#0c151e] p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-tower-dim">{label}</div>
      <div className="mt-1 font-mono text-2xl text-white">{value}</div>
      <div className="mt-1 text-[10px] text-tower-dim">{hint}</div>
    </div>
  );
}
