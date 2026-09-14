"use client";
import { useMemo, useState } from "react";
import { COURIER_BY_ID, PINCODE_BY_PIN, REGION_LABEL, WAREHOUSES, WAREHOUSE_IDS } from "@/lib/config/network";
import { useApp } from "@/lib/store/store";
import type { Region } from "@/lib/types";
import { Panel, inrc } from "./ui";

// Tile cartogram: one square per state, laid out roughly geographically, grouped by zone.
const TILES: { id: string; name: string; col: number; row: number; region: Region }[] = [
  { id: "JK", name: "Jammu & Kashmir", col: 2, row: 0, region: "north" },
  { id: "PB", name: "Punjab", col: 1, row: 1, region: "north" },
  { id: "HP", name: "Himachal Pradesh", col: 2, row: 1, region: "north" },
  { id: "UK", name: "Uttarakhand", col: 3, row: 1, region: "north" },
  { id: "RJ", name: "Rajasthan", col: 0, row: 2, region: "north" },
  { id: "HR", name: "Haryana", col: 1, row: 2, region: "north" },
  { id: "DL", name: "Delhi", col: 2, row: 2, region: "north" },
  { id: "UP", name: "Uttar Pradesh", col: 3, row: 2, region: "north" },
  { id: "BR", name: "Bihar", col: 4, row: 2, region: "east" },
  { id: "SK", name: "Sikkim", col: 5, row: 2, region: "northeast" },
  { id: "AR", name: "Arunachal Pradesh", col: 7, row: 2, region: "northeast" },
  { id: "GJ", name: "Gujarat", col: 0, row: 3, region: "west" },
  { id: "MP", name: "Madhya Pradesh", col: 1, row: 3, region: "west" },
  { id: "CG", name: "Chhattisgarh", col: 2, row: 3, region: "west" },
  { id: "JH", name: "Jharkhand", col: 3, row: 3, region: "east" },
  { id: "WB", name: "West Bengal", col: 4, row: 3, region: "east" },
  { id: "AS", name: "Assam", col: 6, row: 3, region: "northeast" },
  { id: "NL", name: "Nagaland", col: 7, row: 3, region: "northeast" },
  { id: "MH", name: "Maharashtra", col: 1, row: 4, region: "west" },
  { id: "TG", name: "Telangana", col: 2, row: 4, region: "south" },
  { id: "OD", name: "Odisha", col: 3, row: 4, region: "east" },
  { id: "ML", name: "Meghalaya", col: 6, row: 4, region: "northeast" },
  { id: "MN", name: "Manipur", col: 7, row: 4, region: "northeast" },
  { id: "GA", name: "Goa", col: 0, row: 5, region: "west" },
  { id: "KA", name: "Karnataka", col: 1, row: 5, region: "south" },
  { id: "AP", name: "Andhra Pradesh", col: 2, row: 5, region: "south" },
  { id: "TR", name: "Tripura", col: 6, row: 5, region: "northeast" },
  { id: "MZ", name: "Mizoram", col: 7, row: 5, region: "northeast" },
  { id: "KL", name: "Kerala", col: 1, row: 6, region: "south" },
  { id: "TN", name: "Tamil Nadu", col: 2, row: 6, region: "south" },
];
const STATE_TO_TILE: Record<string, string> = Object.fromEntries(TILES.map((t) => [t.name, t.id]));
STATE_TO_TILE["Chandigarh"] = "PB";
STATE_TO_TILE["Puducherry"] = "TN";
const WH_TILE: Record<string, string> = { "WH-BHW": "MH", "WH-GGN": "HR", "WH-BLR": "KA" };
const REGION_STROKE: Record<Region, string> = { north: "#38bdf8", west: "#a78bfa", south: "#4ade80", east: "#f5a524", northeast: "#f472b6" };

type Metric = "demand" | "sla" | "rto";
const S = 46;
const GAP = 4;

function ramp(t: number, metric: Metric) {
  const x = Math.max(0, Math.min(1, t));
  if (metric === "demand") return `rgba(45,212,191,${0.08 + x * 0.85})`;
  // green → amber → red
  const r = x < 0.5 ? Math.round(74 + (245 - 74) * (x / 0.5)) : Math.round(245 + (240 - 245) * ((x - 0.5) / 0.5));
  const g = x < 0.5 ? Math.round(222 + (165 - 222) * (x / 0.5)) : Math.round(165 + (82 - 165) * ((x - 0.5) / 0.5));
  const b = x < 0.5 ? Math.round(128 + (36 - 128) * (x / 0.5)) : Math.round(36 + (91 - 36) * ((x - 0.5) / 0.5));
  return `rgba(${r},${g},${b},${0.25 + x * 0.6})`;
}

export function ZoneMap() {
  const [metric, setMetric] = useState<Metric>("demand");
  const orders = useApp((s) => s.orders);
  const shipments = useApp((s) => s.shipments);
  const tick = useApp((s) => s.clock.tick);
  const inventory = useApp((s) => s.inventory);
  const transfers = useApp((s) => s.transfers);
  const cash = useApp((s) => s.finance.cash);
  const couriers = useApp((s) => s.couriers);

  const data = useMemo(() => {
    const demand: Record<string, number> = {};
    const rtoSum: Record<string, { s: number; n: number }> = {};
    for (const o of orders) {
      if (tick - o.tick > 24) continue;
      const st = STATE_TO_TILE[PINCODE_BY_PIN[o.pincode]?.state ?? ""];
      if (!st) continue;
      demand[st] = (demand[st] ?? 0) + o.lines.reduce((a, l) => a + l.qty, 0);
      const r = (rtoSum[st] ??= { s: 0, n: 0 });
      r.s += o.rto?.p ?? 0;
      r.n += 1;
    }
    const sla: Partial<Record<Region, { s: number; n: number }>> = {};
    for (const sh of shipments) {
      const region = sh.region;
      const slaDays = COURIER_BY_ID[sh.courierId].slaDays[sh.zone];
      let ratio: number | null = null;
      if (sh.outcome === "delivered" && tick - sh.resolveTick < 72) ratio = (sh.resolveTick - sh.shippedTick) / 24 / slaDays;
      else if (sh.outcome === "in_transit") ratio = Math.max(1, (tick - sh.shippedTick) / 24 / slaDays) * 0.5 + 0.5 * couriers.find((c) => c.id === sh.courierId)!.slaHealth;
      if (ratio === null) continue;
      const x = (sla[region] ??= { s: 0, n: 0 });
      x.s += ratio;
      x.n += 1;
    }
    const maxDemand = Math.max(1, ...Object.values(demand));
    return { demand, maxDemand, rto: rtoSum, sla };
  }, [orders, shipments, tick, couriers]);

  const whStock = WAREHOUSE_IDS.map((w) => ({ w, units: Object.values(inventory).reduce((a, r) => a + Math.max(0, r[w]), 0) }));
  const cols = 8;
  const rows = 7;

  return (
    <Panel
      title="India network · zones"
      right={
        <div className="flex gap-1">
          {(["demand", "sla", "rto"] as Metric[]).map((m) => (
            <button key={m} onClick={() => setMetric(m)} className={`rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${metric === m ? "bg-tower-cyan/15 text-tower-cyan" : "text-tower-dim hover:text-tower-text"}`}>
              {m === "demand" ? "demand heat" : m === "sla" ? "courier SLA" : "RTO risk"}
            </button>
          ))}
        </div>
      }
      bodyClass="p-3"
    >
      <div className="grid gap-3 lg:grid-cols-[1fr_190px]">
        <svg viewBox={`0 0 ${cols * (S + GAP)} ${rows * (S + GAP)}`} className="mx-auto w-full max-w-[440px]">
          {TILES.map((t) => {
            let v = 0;
            let label = "";
            if (metric === "demand") {
              const d = data.demand[t.id] ?? 0;
              v = d / data.maxDemand;
              label = d ? String(d) : "";
            } else if (metric === "rto") {
              const r = data.rto[t.id];
              const p = r ? r.s / r.n : 0;
              v = r ? (p - 0.05) / 0.25 : 0;
              label = r ? `${Math.round(p * 100)}%` : "";
            } else {
              const r = data.sla[t.region];
              const ratio = r ? r.s / r.n : 1;
              v = (ratio - 0.9) / 0.8;
              label = r ? `${ratio.toFixed(2)}×` : "";
            }
            const wh = Object.entries(WH_TILE).find(([, tile]) => tile === t.id)?.[0];
            const x = t.col * (S + GAP);
            const y = t.row * (S + GAP);
            return (
              <g key={t.id}>
                <title>{`${t.name} · ${REGION_LABEL[t.region]}${label ? ` · ${label}` : ""}`}</title>
                <rect x={x} y={y} width={S} height={S} rx={3} fill={metric === "demand" && !label ? "#0f1822" : ramp(v, metric)} stroke={REGION_STROKE[t.region]} strokeOpacity={0.35} />
                <text x={x + 5} y={y + 13} fontSize="9" fontFamily="ui-monospace" fill="#c9d6e2" opacity=".8">{t.id}</text>
                {label && <text x={x + S - 5} y={y + S - 6} fontSize="10" fontFamily="ui-monospace" textAnchor="end" fill="#fff">{label}</text>}
                {wh && (
                  <g>
                    <rect x={x + 4} y={y + 18} width={10} height={10} fill="#060a0f" stroke="#2dd4bf" strokeWidth="1.5" transform={`rotate(45 ${x + 9} ${y + 23})`} />
                  </g>
                )}
              </g>
            );
          })}
        </svg>
        <div className="space-y-3 font-mono text-[11px]">
          <div className="space-y-1.5">
            {(Object.keys(REGION_STROKE) as Region[]).map((r) => (
              <div key={r} className="flex items-center gap-2 text-tower-dim">
                <span className="h-2 w-2 rounded-sm" style={{ boxShadow: `inset 0 0 0 1.5px ${REGION_STROKE[r]}` }} />
                {REGION_LABEL[r]}
              </div>
            ))}
            <div className="flex items-center gap-2 text-tower-dim">
              <span className="h-2 w-2 rotate-45 border border-tower-cyan" /> fulfilment centre
            </div>
          </div>
          <div className="space-y-2 border-t border-tower-line pt-3">
            {whStock.map(({ w, units }) => {
              const wh = WAREHOUSES.find((x) => x.id === w)!;
              const inbound = transfers.filter((t) => t.to === w).reduce((a, t) => a + t.qty, 0);
              return (
                <div key={w}>
                  <div className="flex justify-between text-tower-text">
                    <span>{wh.city}</span>
                    <span className="num">{units.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-[#16212c]">
                    <div className="h-full rounded-full bg-tower-cyan/60" style={{ width: `${Math.min(100, (units / wh.capacity) * 100 * 3)}%` }} />
                  </div>
                  {inbound > 0 && <div className="mt-0.5 text-[10px] text-tower-green">+{inbound} in transfer</div>}
                </div>
              );
            })}
          </div>
          <div className="border-t border-tower-line pt-3">
            <div className="text-tower-dim">cash position</div>
            <div className="num text-base text-tower-text">{inrc(cash)}</div>
          </div>
          <div className="border-t border-tower-line pt-3 text-tower-dim">
            {couriers.filter((c) => c.weight < 1 || c.slaHealth > 1.2).map((c) => (
              <div key={c.id} className="text-tower-amber">
                {c.name}: {c.slaHealth > 1.2 ? `SLA ${c.slaHealth.toFixed(1)}×` : "ok"} {c.weight < 1 ? `· weight ${c.weight}` : ""}
              </div>
            ))}
            {!couriers.some((c) => c.weight < 1 || c.slaHealth > 1.2) && <span>carriers nominal</span>}
          </div>
        </div>
      </div>
    </Panel>
  );
}
