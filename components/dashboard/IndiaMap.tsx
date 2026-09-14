"use client";
// Shared real-geography India map. Boundaries come from data/india-map.json, built offline by
// scripts/build-india-map.py from district polygons dissolved into states and delivery zones.
import { type ReactNode, useState } from "react";
import india from "@/data/india-map.json";
import { PINCODE_BY_PIN, REGION_LABEL } from "@/lib/config/network";
import type { Region, WarehouseId } from "@/lib/types";

export interface MapState {
  name: string;
  abbr: string;
  region: Region;
  d: string;
  c: [number, number];
  area: number;
}
interface MapData {
  viewBox: number[];
  states: MapState[];
  zones: { region: Region; d: string }[];
  outline: string;
  cities: Record<string, [number, number]>;
  warehouses: Record<WarehouseId, [number, number]>;
}
export const MAP = india as unknown as MapData;
export const MAP_W = MAP.viewBox[2];
export const MAP_H = MAP.viewBox[3];

export const REGION_COLOR: Record<Region, string> = { north: "#38bdf8", west: "#a78bfa", south: "#4ade80", east: "#f5a524", northeast: "#f472b6" };
export const COURIER_COLOR: Record<string, string> = { "CR-VAYU": "#f472b6", "CR-KAVERI": "#2dd4bf", "CR-NORTHSTAR": "#38bdf8", "CR-DAKSHIN": "#facc15" };

export const stateOf = (pincode: string) => {
  const pin = PINCODE_BY_PIN[pincode];
  return pin ? pin.state.replace(/&/g, "and") : null;
};
export const cityXY = (pincode: string): [number, number] | null => {
  const pin = PINCODE_BY_PIN[pincode];
  return pin ? MAP.cities[pin.city] ?? null : null;
};
export const warehouseXY = (id: WarehouseId) => MAP.warehouses[id];

/** Curved great-circle-ish arc between two projected points, bowed to the left of travel. */
export function arcPath([x1, y1]: [number, number], [x2, y2]: [number, number], bendFactor = 0.25) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(90, len * bendFactor);
  return `M${x1.toFixed(1)},${y1.toFixed(1)} Q${((x1 + x2) / 2 - (dy / len) * bend).toFixed(1)},${((y1 + y2) / 2 + (dx / len) * bend).toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
}

export function lerpColor(stops: string[], t: number) {
  const x = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i].match(/\w\w/g)!.map((h) => parseInt(h, 16));
  const b = stops[i + 1].match(/\w\w/g)!.map((h) => parseInt(h, 16));
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
}

export interface IndiaMapProps {
  /** fill per state; return null for the neutral land colour */
  fill?: (s: MapState) => string | null;
  /** extra tooltip lines for a hovered state */
  tooltip?: (s: MapState) => ReactNode;
  /** svg overlay drawn above states and zones */
  children?: ReactNode;
  /** crop to a region of the map (projected coordinates) */
  viewBox?: [number, number, number, number];
  showZones?: boolean;
  showLabels?: boolean;
  dimOthers?: string[]; // state names to keep bright; others are dimmed
  className?: string;
  idPrefix?: string;
}

export function IndiaMap({ fill, tooltip, children, viewBox, showZones = true, showLabels = true, dimOthers, className = "", idPrefix = "im" }: IndiaMapProps) {
  const [hover, setHover] = useState<MapState | null>(null);
  const vb = viewBox ?? [-12, -12, MAP_W + 24, MAP_H + 24];
  const scale = vb[2] / (MAP_W + 24); // keep stroke widths visually constant when zoomed
  const focus = dimOthers ? new Set(dimOthers) : null;
  return (
    <div className={`relative ${className}`}>
      <svg viewBox={vb.join(" ")} className="block h-full w-full" onMouseLeave={() => setHover(null)} role="img" aria-label="Map of India delivery network">
        <defs>
          <pattern id={`${idPrefix}-dots`} width={12 * scale} height={12 * scale} patternUnits="userSpaceOnUse">
            <circle cx={scale} cy={scale} r={0.8 * scale} fill="#17222e" />
          </pattern>
          <filter id={`${idPrefix}-glow`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={2.6 * scale} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={`${idPrefix}-shadow`} x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy={5 * scale} stdDeviation={9 * scale} floodColor="#000" floodOpacity="0.7" />
          </filter>
          <linearGradient id={`${idPrefix}-land`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0f1c29" />
            <stop offset="100%" stopColor="#0a131c" />
          </linearGradient>
        </defs>
        <rect x={vb[0]} y={vb[1]} width={vb[2]} height={vb[3]} fill={`url(#${idPrefix}-dots)`} />
        <path d={MAP.outline} fill={`url(#${idPrefix}-land)`} stroke="#29445a" strokeWidth={1.4 * scale} filter={`url(#${idPrefix}-shadow)`} />
        {MAP.states.map((s) => {
          const f = fill?.(s) ?? null;
          const dim = focus && !focus.has(s.name);
          const active = hover?.name === s.name;
          return (
            <path
              key={s.name}
              d={s.d}
              fill={f ?? "#0f1a25"}
              fillOpacity={dim ? 0.35 : 1}
              stroke={active ? "#e2e8f0" : "#050a0f"}
              strokeWidth={(active ? 1.4 : 0.6) * scale}
              strokeLinejoin="round"
              style={{ transition: "fill 700ms ease, fill-opacity 400ms ease" }}
              onMouseEnter={() => setHover(s)}
            />
          );
        })}
        {showZones &&
          MAP.zones.map((z) => (
            <path key={z.region} d={z.d} fill="none" stroke={REGION_COLOR[z.region]} strokeOpacity={focus ? 0.35 : 0.7} strokeWidth={1.2 * scale} strokeLinejoin="round" filter={`url(#${idPrefix}-glow)`} pointerEvents="none" />
          ))}
        {showLabels &&
          MAP.states
            .filter((s) => s.area > 2.5)
            .map((s) => (
              <text key={s.abbr} x={s.c[0]} y={s.c[1]} fontSize={8.5 * scale} fontFamily="ui-monospace, monospace" textAnchor="middle" fill="#e2e8f0" opacity={0.38} pointerEvents="none">
                {s.abbr}
              </text>
            ))}
        {children}
      </svg>
      {hover && tooltip && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 min-w-[160px] rounded-md border border-tower-line bg-[#060a0fee] px-3 py-2 font-mono text-[11px] shadow-xl backdrop-blur">
          <div className="text-white">{hover.name}</div>
          <div style={{ color: REGION_COLOR[hover.region] }}>{REGION_LABEL[hover.region]} zone</div>
          <div className="mt-1 space-y-0.5 text-tower-text">{tooltip(hover)}</div>
        </div>
      )}
    </div>
  );
}

/** Fulfilment-centre marker with glow, drawn in map coordinates. */
export function WarehouseMarker({ id, label, sub, state = "normal", scale = 1, labelSide = "right" }: { id: WarehouseId; label: string; sub?: string; state?: "normal" | "selected" | "available" | "unavailable"; scale?: number; labelSide?: "left" | "right" | "top" }) {
  const [x, y] = MAP.warehouses[id];
  const color = state === "selected" ? "#4ce1d6" : state === "available" ? "#4ade80" : state === "unavailable" ? "#475569" : "#2dd4bf";
  const s = scale;
  const w = 88 * s;
  const lx = labelSide === "left" ? x - 14 * s - w : labelSide === "top" ? x - w / 2 : x + 14 * s;
  const ly = labelSide === "top" ? y - 36 * s : y - 12 * s;
  return (
    <g pointerEvents="none">
      <circle cx={x} cy={y} r={24 * s} fill={color} fillOpacity={state === "unavailable" ? 0.05 : 0.14} />
      {state !== "unavailable" && <circle cx={x} cy={y} r={9 * s} fill="none" stroke={color} strokeWidth={1.2 * s} className="ping" />}
      <rect x={x - 6 * s} y={y - 6 * s} width={12 * s} height={12 * s} fill="#050a0f" stroke={color} strokeWidth={2 * s} transform={`rotate(45 ${x} ${y})`} />
      <circle cx={x} cy={y} r={2.3 * s} fill={color} />
      <rect x={lx} y={ly} width={w} height={(sub ? 25 : 15) * s} rx={3 * s} fill="#050a0fe6" stroke={`${color}55`} strokeWidth={s} />
      <text x={lx + 6 * s} y={ly + 10.5 * s} fontSize={9 * s} fontFamily="ui-monospace, monospace" fill={color}>
        {label.toUpperCase()}
      </text>
      {sub && (
        <text x={lx + 6 * s} y={ly + 20.5 * s} fontSize={8.3 * s} fontFamily="ui-monospace, monospace" fill="#9fb0c0">
          {sub}
        </text>
      )}
    </g>
  );
}
