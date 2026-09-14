import { produce } from "immer";
import { runCycleSync } from "../../lib/engine/cycleSync";
import { extractOffline } from "../../lib/engine/offlineExtract";
import { createInitialState, type AppState } from "../../lib/store/state";
let s: AppState = createInitialState();
for (let i = 0; i < Number(process.argv[2] ?? 120); i++) { s = runCycleSync(s); s = produce(s, (d) => extractOffline(d)); }
const shipped = s.orders.filter((o) => o.sourcing);
console.log({ tick: s.clock.tick, shipped: shipped.length, split: shipped.filter((o) => o.sourcing!.split).length, homeOut: shipped.filter((o) => !o.sourcing!.homeHadStock).length, backordered: s.orders.filter((o) => o.status === "backordered").length });
const byWh: Record<string, number> = {};
for (const sh of s.shipments) byWh[sh.warehouseId] = (byWh[sh.warehouseId] ?? 0) + 1;
console.log("shipments by FC", byWh);
const ex = shipped.find((o) => o.sourcing!.split) ?? shipped.find((o) => !o.sourcing!.homeHadStock);
console.log("example", JSON.stringify({ id: ex?.id, region: ex?.region, sourcing: ex?.sourcing, legs: ex?.legs?.map((l) => ({ wh: l.warehouseId, c: l.courierId, lines: l.lines.map((x) => `${x.qty}x${x.sku}`) })) }));
console.log(s.decisions.filter((d) => d.summary.includes("split") || d.summary.includes("away from home")).slice(-3).map((d) => d.summary));
