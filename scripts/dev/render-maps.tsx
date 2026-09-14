// Dev check: server-render the map views with the warm simulation state and write standalone SVG files.
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteNetwork } from "../../components/dashboard/RouteNetwork";
import { OrderJourneyMap } from "../../components/dashboard/OrderJourneyMap";
import { useApp } from "../../lib/store/store";

const out = process.argv[2] ?? ".";
const warm = JSON.parse(fs.readFileSync("public/warm-state.json", "utf8"));
useApp.setState(warm);
const html = renderToStaticMarkup(<RouteNetwork />);
const svg = html.match(/<svg[\s\S]*?<\/svg>/)![0];
fs.writeFileSync(`${out}/route-network.svg`, svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1000" style="background:#070e15"'));
const order = warm.orders.filter((o: { warehouseId?: string; status: string }) => o.warehouseId && o.status === "shipped").at(-1) ?? warm.orders.at(-1);
const oj = renderToStaticMarkup(<OrderJourneyMap order={order} />).match(/<svg[\s\S]*?<\/svg>/)![0];
fs.writeFileSync(`${out}/order-journey.svg`, oj.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" style="background:#060d14"'));
console.log("order", order.id, order.pincode, order.warehouseId, "html bytes", html.length);
