import type { Draft } from "immer";
import { dailyDemand, onHand } from "@/lib/agents/shared";
import type { AppState } from "@/lib/store/state";
import type { KpiSnapshot, PolicyLedger } from "@/lib/types";
import { simTime } from "./calendar";

export function summarise(l: PolicyLedger, days = 7) {
  const recent = l.days.slice(-days);
  const sum = (k: keyof (typeof recent)[number]) => recent.reduce((a, d) => a + (d[k] as number), 0);
  const revenue = sum("revenue");
  const costs = sum("cogs") + sum("shipping") + sum("rtoCost") + sum("returnCost") + sum("commission") + sum("holding");
  const contribution = revenue - costs;
  return {
    revenue,
    contribution,
    marginPct: revenue > 0 ? contribution / revenue : 0,
    fillRate: sum("unitsDemanded") > 0 ? sum("unitsFilled") / sum("unitsDemanded") : 1,
    rtoRate: sum("shipmentsClosed") > 0 ? sum("rtos") / sum("shipmentsClosed") : 0,
    stockouts: sum("stockouts"),
    shipping: sum("shipping"),
    rtoCost: sum("rtoCost"),
    returnCost: sum("returnCost"),
    holding: sum("holding"),
    orders: sum("orders"),
  };
}

export function computeKpis(d: Draft<AppState>): KpiSnapshot {
  const s = d as unknown as AppState;
  const sm = summarise(s.ledger);
  let stock = 0;
  let demand = 0;
  for (const p of s.catalog) {
    stock += onHand(s, p.sku);
    demand += dailyDemand(s, p.sku);
  }
  const t = simTime(s.clock.tick);
  const gap = s.settlements.reduce((a, x) => a + (x.status === "pending" || x.status === "disputed" ? x.claimedDeduction ?? 0 : 0), 0);
  return {
    contributionMarginPct: sm.marginPct,
    fillRate: sm.fillRate,
    rtoRate: sm.rtoRate,
    daysOfCover: demand > 0 ? stock / demand : 0,
    settlementGap: gap,
    revenue7d: sm.revenue,
    ordersToday: s.ledger.days.find((x) => x.day === t.day)?.orders ?? 0,
  };
}
