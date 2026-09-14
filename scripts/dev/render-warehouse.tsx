// Dev check: server-render the warehouse map + order journey with warm state and write SVGs.
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderJourneyMap } from "../../components/dashboard/OrderJourneyMap";
import { WarehouseDashboard } from "../../components/dashboard/WarehouseDashboard";
import { useApp } from "../../lib/store/store";

const out = process.argv[2] ?? ".";
const warm = JSON.parse(fs.readFileSync("public/warm-state.json", "utf8"));
useApp.setState(warm);
const html = renderToStaticMarkup(<WarehouseDashboard />);
fs.writeFileSync(`${out}/warehouse.html`, html);
const svgs = html.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
fs.writeFileSync(`${out}/warehouse-map.svg`, svgs[0]!.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="780" style="background:#060d14"'));
const split = warm.orders.find((o: { legs?: unknown[] }) => (o.legs?.length ?? 0) > 1) ?? warm.orders.find((o: { sourcing?: { homeHadStock: boolean } }) => o.sourcing && !o.sourcing.homeHadStock);
const oj = renderToStaticMarkup(<OrderJourneyMap order={split} />);
fs.writeFileSync(`${out}/journey.svg`, oj.match(/<svg[\s\S]*?<\/svg>/)![0].replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="675" style="background:#060d14"'));
console.log("rendered", { bytes: html.length, svgs: svgs.length, order: split?.id, legs: split?.legs?.map((l: { warehouseId: string }) => l.warehouseId), sourcing: split?.sourcing, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600) });
