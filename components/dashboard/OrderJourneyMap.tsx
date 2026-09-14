"use client";
import { useMemo } from "react";
import { COURIER_BY_ID, HOME_WAREHOUSE, PINCODE_BY_PIN, REGION_LABEL, WAREHOUSES, WAREHOUSE_BY_ID, WAREHOUSE_IDS } from "@/lib/config/network";
import { useApp } from "@/lib/store/store";
import type { Order, WarehouseId } from "@/lib/types";
import { COURIER_COLOR, IndiaMap, MAP, MAP_H, MAP_W, WarehouseMarker, arcPath, cityXY, stateOf } from "./IndiaMap";

export const WAREHOUSE_STATE: Record<WarehouseId, string> = { "WH-BHW": "Maharashtra", "WH-GGN": "Haryana", "WH-BLR": "Karnataka", "WH-KOL": "West Bengal", "WH-GAU": "Assam" };
export const WAREHOUSE_LABEL_SIDE: Record<WarehouseId, "left" | "right" | "top"> = { "WH-BHW": "left", "WH-GGN": "top", "WH-BLR": "right", "WH-KOL": "left", "WH-GAU": "top" };

/** Crop the map to the points of interest with padding, at a fixed 4:3 aspect. */
function cropTo(points: [number, number][], labelAt?: [number, number]): [number, number, number, number] {
  // reserve room to the right of the customer pin for its label
  if (labelAt) points = [...points, [labelAt[0] + 110, labelAt[1]]];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  let w = Math.max(...xs) - Math.min(...xs) + 170;
  let h = Math.max(...ys) - Math.min(...ys) + 170;
  const aspect = 4 / 3;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  w = Math.max(w, 260);
  h = Math.max(h, 195);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const x = Math.max(-20, Math.min(MAP_W + 20 - w, cx - w / 2));
  const y = Math.max(-20, Math.min(MAP_H + 20 - h, cy - h / 2));
  return [x, y, w, h];
}

export function OrderJourneyMap({ order }: { order: Order }) {
  const inventory = useApp((s) => s.inventory);
  const catalog = useApp((s) => s.catalog);
  const allShipments = useApp((s) => s.shipments);
  const shipments = useMemo(() => allShipments.filter((x) => x.orderId === order.id), [allShipments, order.id]);
  const pin = PINCODE_BY_PIN[order.pincode];
  const dest = cityXY(order.pincode) ?? MAP.cities["New Delhi"];
  const destState = stateOf(order.pincode);
  const home = HOME_WAREHOUSE[order.region];
  const names = Object.fromEntries(catalog.map((p) => [p.sku, p.name]));

  // parcels: explicit legs for split orders, or the single allocation for older / single-parcel orders
  const legs =
    order.legs ??
    (order.warehouseId && order.courierId ? [{ shipmentId: shipments[0]?.id ?? "", warehouseId: order.warehouseId, courierId: order.courierId, lines: order.lines, cost: order.shipCost ?? 0, promisedDays: order.promisedDays ?? 0 }] : []);
  const candidates = WAREHOUSE_IDS.filter((id) => order.lines.every((l) => (inventory[l.sku]?.[id] ?? 0) >= l.qty));
  const homeHadStock = order.sourcing ? order.sourcing.homeHadStock : candidates.includes(home);
  const sources = legs.map((l) => l.warehouseId);
  const focus: WarehouseId[] = sources.length ? Array.from(new Set([...sources, home])) : candidates.length ? candidates : [...WAREHOUSE_IDS];
  const vb = cropTo([dest, ...focus.map((w) => MAP.warehouses[w])], dest);
  const zoom = vb[2] / (MAP_W + 24);
  const bright = [destState ?? "", ...focus.map((w) => WAREHOUSE_STATE[w])].filter(Boolean);
  const rerouted = legs.length > 0 && !sources.includes(home);

  const markerState = (id: WarehouseId) => (sources.includes(id) ? "selected" : !legs.length && candidates.includes(id) ? "available" : "unavailable");
  const markerSub = (id: WarehouseId) => {
    const leg = legs.findIndex((l) => l.warehouseId === id);
    if (leg >= 0) return legs.length > 1 ? `parcel ${leg + 1} of ${legs.length}` : "shipping";
    if (id === home) return homeHadStock ? "home FC" : "home FC · out of stock";
    return candidates.includes(id) ? "in stock" : "no stock";
  };

  return (
    <div className="grid gap-3 border-b border-tower-line p-4 lg:grid-cols-[minmax(0,1fr)_270px]">
      <div className="overflow-hidden rounded-lg border border-tower-line bg-[radial-gradient(ellipse_at_center,rgba(76,225,214,.07),transparent_60%),#060d14]">
        <IndiaMap idPrefix={`oj-${order.id}`} viewBox={vb} showLabels={zoom > 0.45} dimOthers={bright} fill={(s) => (s.name === destState ? "#123b44" : bright.includes(s.name) ? "#10262f" : null)} className="aspect-[4/3] w-full">
          {/* fallback centres that could also fill this order (before allocation) */}
          {!legs.length &&
            candidates.map((w) => (
              <path key={w} d={arcPath(MAP.warehouses[w], dest)} fill="none" stroke="#4ade80" strokeOpacity={0.45} strokeWidth={1.1 * zoom} strokeDasharray={`${4 * zoom} ${5 * zoom}`} pointerEvents="none" />
            ))}

          {/* home FC could not fill: show the lane it would have used, struck through */}
          {legs.length > 0 && !homeHadStock && !sources.includes(home) && (
            <path d={arcPath(MAP.warehouses[home], dest)} fill="none" stroke="#f0525b" strokeOpacity={0.55} strokeWidth={1.2 * zoom} strokeDasharray={`${2 * zoom} ${4 * zoom}`} pointerEvents="none" />
          )}

          {legs.map((leg, i) => {
            const route = arcPath(MAP.warehouses[leg.warehouseId], dest, 0.18 + i * 0.12);
            const color = COURIER_COLOR[leg.courierId] ?? "#4ce1d6";
            const inTransit = shipments.find((x) => x.id === leg.shipmentId)?.outcome === "in_transit" || (!leg.shipmentId && order.status === "shipped");
            return (
              <g key={`${leg.warehouseId}-${i}`} pointerEvents="none">
                <path d={route} fill="none" stroke={color} strokeOpacity={0.22} strokeWidth={7 * zoom} strokeLinecap="round" />
                <path d={route} fill="none" stroke={color} strokeWidth={2 * zoom} strokeLinecap="round" className="flow" style={{ strokeDasharray: `${6 * zoom} ${6 * zoom}` }} />
                {inTransit && (
                  <circle r={4.5 * zoom} fill="#facc15" stroke="#050a0f" strokeWidth={1.2 * zoom}>
                    <animateMotion dur={`${3 + i * 0.7}s`} repeatCount="indefinite" path={route} />
                  </circle>
                )}
              </g>
            );
          })}

          {WAREHOUSES.map((w) => (
            <WarehouseMarker key={w.id} id={w.id} label={w.city} sub={markerSub(w.id)} state={markerState(w.id)} scale={zoom} labelSide={WAREHOUSE_LABEL_SIDE[w.id]} />
          ))}

          {/* customer */}
          <g pointerEvents="none">
            <circle cx={dest[0]} cy={dest[1]} r={10 * zoom} fill="none" stroke="#fb923c" strokeWidth={1.5 * zoom} className="ping" />
            <circle cx={dest[0]} cy={dest[1]} r={4 * zoom} fill="#fb923c" stroke="#050a0f" strokeWidth={1.2 * zoom} />
            <rect x={dest[0] + 9 * zoom} y={dest[1] - 22 * zoom} width={Math.max(70, ((pin?.city.length ?? 6) + 8) * 5.8) * zoom} height={24 * zoom} rx={3 * zoom} fill="#1c0f06e6" stroke="#fb923c88" strokeWidth={zoom} />
            <text x={dest[0] + 15 * zoom} y={dest[1] - 11.5 * zoom} fontSize={9 * zoom} fontFamily="ui-monospace, monospace" fill="#fdba74">
              {(pin?.city ?? order.region).toUpperCase()}
            </text>
            <text x={dest[0] + 15 * zoom} y={dest[1] - 2 * zoom} fontSize={8 * zoom} fontFamily="ui-monospace, monospace" fill="#c7a58a">
              {order.pincode} · {pin?.tier ?? ""}
            </text>
          </g>
        </IndiaMap>
      </div>

      <div className="rounded-lg border border-tower-line bg-[#0b141d] p-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-tower-dim">Journey status</div>
        <div className="mt-2 text-sm font-semibold text-white">
          {legs.length > 1 ? `Split into ${legs.length} parcels` : legs.length ? `${order.status === "delivered" ? "Delivered" : "Shipped"} from ${WAREHOUSE_BY_ID[legs[0].warehouseId].city}` : order.status === "backordered" ? "Backordered" : "Awaiting warehouse allocation"}
        </div>
        <div className="mt-1 text-xs leading-relaxed text-tower-dim">
          To {pin?.city ?? "customer"} ({pin ? REGION_LABEL[pin.region] : order.region} zone) · home FC {WAREHOUSE_BY_ID[home].city}
          {legs.length ? ` · promised in ${order.promisedDays ?? "—"} day(s)` : ""}
        </div>

        {legs.length > 0 && !homeHadStock && (
          <div className="mt-3 rounded-md border border-tower-amber/40 bg-tower-amber/10 p-2 text-[11px] leading-snug text-tower-amber">
            {WAREHOUSE_BY_ID[home].city} FC did not hold every item. {rerouted ? `Fetched from ${Array.from(new Set(sources)).map((w) => WAREHOUSE_BY_ID[w].city).join(" + ")} instead.` : `In-stock items ship locally; the rest is fetched from ${sources.filter((w) => w !== home).map((w) => WAREHOUSE_BY_ID[w].city).join(" + ")}.`}
          </div>
        )}
        {!legs.length && order.status === "backordered" && <div className="mt-3 text-xs text-tower-dim">No combination of centres can fill this order yet; procurement and inventory are handling recovery.</div>}
        {!legs.length && order.status === "placed" && <div className="mt-3 text-xs text-tower-dim">Eligible centres: {candidates.map((id) => WAREHOUSE_BY_ID[id].city).join(", ") || "none — will split across nodes"}.</div>}

        {legs.length > 0 && (
          <ul className="mt-3 space-y-2">
            {legs.map((leg, i) => {
              const sh = shipments.find((x) => x.id === leg.shipmentId);
              return (
                <li key={i} className="rounded-md border border-tower-line bg-[#0e1924] p-2 font-mono text-[10px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-tower-text">
                      <span className="h-2 w-2 rounded-full" style={{ background: COURIER_COLOR[leg.courierId] }} />
                      {legs.length > 1 ? `Parcel ${i + 1} · ` : ""}
                      {WAREHOUSE_BY_ID[leg.warehouseId].city}
                    </span>
                    <span className={sh?.outcome === "delivered" ? "text-tower-green" : sh?.outcome === "rto" ? "text-tower-red" : "text-tower-amber"}>{sh ? sh.outcome.replace("_", " ") : order.status}</span>
                  </div>
                  <div className="mt-1 text-tower-dim">
                    {COURIER_BY_ID[leg.courierId]?.name} · zone {sh?.zone ?? "—"} · ₹{leg.cost} · {leg.promisedDays}d
                  </div>
                  <div className="mt-1 text-[#8b9bab]">{leg.lines.map((l) => `${l.qty}× ${names[l.sku] ?? l.sku}`).join(", ")}</div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-3 space-y-1 border-t border-tower-line pt-3 font-mono text-[10px] text-tower-dim">
          <div><span className="text-tower-cyan">━</span> parcel route · courier colour</div>
          <div><span className="text-tower-red">┅</span> home FC lane (out of stock)</div>
          <div><span className="text-tower-green">┅</span> centre with stock (before allocation)</div>
          <div><span className="text-orange-400">●</span> customer pincode</div>
        </div>
      </div>
    </div>
  );
}
