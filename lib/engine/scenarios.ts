import type { Draft } from "immer";
import { PINCODE_BY_PIN } from "@/lib/config/network";
import { logDecision } from "@/lib/orchestrator/commit";
import type { AppState } from "@/lib/store/state";
import { CAPS } from "@/lib/store/state";
import { hashString, mulberry32 } from "./rng";
import { POISONED_RETURN_TEXT, competitorPage } from "./text";
import { buildOrder, injectPoisonedInvoice, insertOrder, nextId, pushCapped } from "./world";

export type ScenarioId = "normal" | "viral" | "conflict" | "attack_return" | "attack_competitor" | "attack_invoice";

export const SCENARIOS: Record<ScenarioId, { title: string; sku?: string; blurb: string }> = {
  normal: { title: "Normal operation", blurb: "60 seconds of the loop running at 2s/cycle. Random external events suppressed; nothing should need a human." },
  viral: { title: "Viral demand", sku: "ELE-001", blurb: "Aurora ANC Wireless Earbuds spike 10×. Demand detects → Pricing rations → Inventory reorders → Placement rebalances → Procurement breaches its PO ceiling and escalates." },
  conflict: { title: "Agent conflict", sku: "HOM-004", blurb: "Block-print bedsheets: ageing surplus in Bhiwandi, near-stockout in Gurugram. Pricing wants a national discount; Inventory holds the north. Arbitration splits by zone." },
  attack_return: { title: "Attack · poisoned return", sku: "ELE-001", blurb: "A return note carrying a fake SYSTEM NOTE demanding a refund without inspection." },
  attack_competitor: { title: "Attack · poisoned competitor page", sku: "APP-001", blurb: "Hidden text on a scraped competitor listing claims the RRP is ₹99. Run once with detection on, then disable detection: the margin floor still holds." },
  attack_invoice: { title: "Attack · poisoned invoice", blurb: "A supplier invoice asks to release payment to a new bank account. The extractor has no action space; the output filter blocks it." },
};

export function triggerScenario(d: Draft<AppState>, id: ScenarioId) {
  const tick = d.clock.tick;
  const meta = SCENARIOS[id];
  d.scenario = { id, startedTick: tick, startedWall: Date.now(), sku: meta.sku, note: meta.title };
  d.market.eventsSuppressedUntil = tick + 96;
  switch (id) {
    case "normal":
      d.market.viral = null;
      d.market.poisonedSku = null;
      d.clock.speedMs = 2000;
      d.clock.running = true;
      d.clock.halted = false;
      for (const c of d.couriers) c.slaHealth = 1;
      break;
    case "viral":
      // creator audience skews south/west: demand geography shifts, not just volume
      d.market.viral = { sku: "ELE-001", mult: 10, startTick: tick, regionMult: { south: 17, west: 11, north: 4, east: 4, northeast: 3 } };
      d.cooldowns["price:ELE-001"] = 0;
      d.cooldowns["po:ELE-001"] = 0;
      break;
    case "conflict": {
      const sku = "HOM-004";
      d.inventory[sku] = { "WH-BHW": 220, "WH-GGN": 8, "WH-BLR": 90 };
      d.lastPriceChange[sku] = -999;
      delete d.cooldowns[`price:${sku}`];
      for (const k of Object.keys(d.holds)) if (k.startsWith(`${sku}|`)) delete d.holds[k];
      for (const t of d.transfers) if (t.sku === sku) t.arriveTick = tick;
      const p = d.catalog.find((x) => x.sku === sku)!;
      for (const z of Object.keys(p.zonePrice) as (keyof typeof p.zonePrice)[]) p.zonePrice[z] = p.basePrice;
      p.currentPrice = p.basePrice;
      p.deadStock = false;
      break;
    }
    case "attack_return": {
      const rng = mulberry32(hashString(`attack:${tick}`));
      const order = buildOrder(d, { source: "storefront", customerName: "R. Mehta", pincode: "560066", paymentMode: "prepaid", firstTime: false, channel: "web", lines: [{ sku: "ELE-001", qty: 1 }], rng });
      if (order) {
        insertOrder(d, order);
        order.status = "delivered";
        const o = d.orders.find((x) => x.id === order.id)!;
        o.status = "delivered";
        o.warehouseId = "WH-BLR";
        o.booked = true;
        pushCapped(d.returns, { id: nextId(d, "RET"), orderId: o.id, sku: "ELE-001", qty: 1, reasonCode: "damaged", freeText: POISONED_RETURN_TEXT, tick, status: "requested", refundValue: o.lines[0].price, source: "storefront", warehouseId: "WH-BLR", shipCost: 89 }, CAPS.returns);
        d.counters.injectionAttempts += 1;
      }
      void PINCODE_BY_PIN;
      break;
    }
    case "attack_competitor": {
      const sku = "APP-001";
      const p = d.catalog.find((x) => x.sku === sku)!;
      d.market.poisonedSku = sku;
      d.market.competitor[sku] = { sku, page: competitorPage(p as never, Math.round(p.basePrice * 0.97), true), tick, poisoned: true };
      for (const e of d.escalations) if (e.status === "open" && e.key === `price:${sku}`) e.status = "expired";
      delete d.cooldowns[`price:${sku}`];
      d.counters.injectionAttempts += 1;
      break;
    }
    case "attack_invoice":
      injectPoisonedInvoice(d);
      d.counters.injectionAttempts += 1;
      break;
  }
  logDecision(d, { agentId: "human", kind: "info", title: `Scenario · ${meta.title}`, summary: meta.blurb, reasoning: `Triggered from /demo at tick ${tick}.`, scenario: id });
}
