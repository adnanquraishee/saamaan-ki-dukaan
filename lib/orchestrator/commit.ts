// Execute stage: the ONLY place agent actions mutate state.

import type { Draft } from "immer";
import { catalogIndex, inr } from "@/lib/agents/shared";
import { AGENT_META, ENVELOPES } from "@/lib/config/envelopes";
import { REGION_LABEL, SUPPLIER_BY_ID, WAREHOUSE_BY_ID, rateZone } from "@/lib/config/network";
import { simTime } from "@/lib/engine/calendar";
import { PACKAGING_COST, commissionFor, deliveryDays, trueRtoProbability } from "@/lib/engine/economics";
import { book, nextId, pushCapped } from "@/lib/engine/world";
import type { AppState } from "@/lib/store/state";
import { CAPS } from "@/lib/store/state";
import type { Action, AgentId, Decision, Escalation, Proposal, ProposerId } from "@/lib/types";
import type { ConflictRecord } from "./arbitrate";
import { proposalKey } from "./arbitrate";
import type { GuardOutcome } from "./guardrails";

export interface CycleResult {
  approved: GuardOutcome[];
  blocked: GuardOutcome[];
  conflicts: ConflictRecord[];
  proposalsTotal: number;
}

const core = (id: ProposerId): id is AgentId => !id.startsWith("intake:");

export function logDecision(d: Draft<AppState>, dec: Omit<Decision, "id" | "tick" | "wall">) {
  const full: Decision = { id: nextId(d, "D"), tick: d.clock.tick, wall: Date.now(), explanationSource: "template", ...dec };
  pushCapped(d.decisions, full, CAPS.decisions);
  return full;
}

/** Apply one action to state. Returns a human summary and the number of decisions it represents. */
export function applyAction(d: Draft<AppState>, action: Action, origin: "agent" | "human" = "agent"): { summary: string; count: number } {
  const tick = d.clock.tick;
  const t = simTime(tick);
  const cat = catalogIndex(d as AppState);
  switch (action.type) {
    case "UPDATE_FORECAST":
      d.forecasts = action.forecasts as never;
      return { summary: `Forecasts refreshed for ${Object.keys(action.forecasts).length} SKUs`, count: 1 };
    case "FLAG_DEMAND_SIGNAL":
      return { summary: `${cat[action.sku].name}: ${action.multiplier}× velocity (z ${action.z})`, count: 1 };
    case "SET_PRICE": {
      const p = d.catalog.find((x) => x.sku === action.sku)!;
      for (const z of action.zones) p.zonePrice[z] = action.price;
      p.currentPrice = p.zonePrice.west;
      d.lastPriceChange[action.sku] = tick;
      return { summary: `${p.name}: ${inr(action.prevPrice)} → ${inr(action.price)} in ${action.zones.length === 5 ? "all zones" : action.zones.map((z) => REGION_LABEL[z]).join(", ")}`, count: 1 };
    }
    case "HOLD_PRICE":
      d.holds[`${action.sku}|${action.zone}`] = { sku: action.sku, zone: action.zone, untilTick: action.untilTick, reason: action.reason };
      return { summary: `${cat[action.sku].name}: price held in ${REGION_LABEL[action.zone]}`, count: 1 };
    case "SET_REORDER_POLICY":
      d.policies[`${action.sku}|${action.warehouseId}`] = { reorderPoint: action.reorderPoint, orderUpTo: action.orderUpTo, safetyStock: action.safetyStock, updatedTick: tick };
      return { summary: "", count: 1 };
    case "REPLENISH_NEED":
      d.needs[`${action.sku}|${action.warehouseId}`] = { sku: action.sku, warehouseId: action.warehouseId, qty: action.qty, urgency: action.urgency, tick };
      return { summary: `${cat[action.sku].name} @ ${action.warehouseId}: need ${action.qty}`, count: 1 };
    case "MARK_DEAD_STOCK": {
      const p = d.catalog.find((x) => x.sku === action.sku)!;
      p.deadStock = true;
      return { summary: `${p.name} flagged dead stock (${action.coverDays}d cover)`, count: 1 };
    }
    case "TRANSFER_STOCK": {
      const qty = Math.min(action.qty, d.inventory[action.sku][action.from]);
      d.inventory[action.sku][action.from] -= qty;
      d.transfers.push({ id: nextId(d, "TR"), sku: action.sku, from: action.from, to: action.to, qty, cost: action.cost, arriveTick: tick + 48 });
      d.finance.cash -= action.cost;
      book(d.ledger, t.day, "shipping", action.cost);
      return { summary: `${cat[action.sku].name}: ${qty} units ${WAREHOUSE_BY_ID[action.from].city} → ${WAREHOUSE_BY_ID[action.to].city} (${inr(action.cost)})`, count: 1 };
    }
    case "CREATE_PO": {
      const sup = SUPPLIER_BY_ID[action.supplierId];
      const value = action.qty * action.unitCost;
      const eta = tick + Math.round(action.leadDays * 24);
      d.purchaseOrders.push({ id: nextId(d, "PO"), supplierId: action.supplierId, sku: action.sku, qty: action.qty, unitCost: action.unitCost, value, warehouseId: action.warehouseId, placedTick: tick, etaTick: eta, status: "open", paymentDueTick: sup.paymentTermsDays === 0 ? tick : eta + sup.paymentTermsDays * 24, paid: false, origin });
      for (const k of Object.keys(d.needs)) if (k.startsWith(`${action.sku}|`)) delete d.needs[k];
      return { summary: `PO ${action.qty.toLocaleString("en-IN")} × ${cat[action.sku].name} from ${sup.name} (${inr(value)}, ETA ${action.leadDays}d)`, count: 1 };
    }
    case "ALLOCATE_ORDERS": {
      let n = 0;
      for (const al of action.allocations) {
        if (al.warehouseId) continue;
        const o = d.orders.find((x) => x.id === al.orderId);
        if (!o || (o.status !== "placed" && o.status !== "backordered")) continue;
        if (o.status === "placed") {
          n++;
          o.status = "backordered";
          for (const l of o.lines) {
            const key = `${l.sku}|${t.day}`;
            if (!o.booked) book(d.ledger, t.day, "unitsDemanded", l.qty);
            if (!d.cooldowns[`so:${key}`]) {
              d.cooldowns[`so:${key}`] = tick + 48;
              book(d.ledger, t.day, "stockouts", 1);
            }
          }
          o.booked = true;
        }
      }
      return { summary: n ? `${n} orders backordered — no node can fill` : "", count: n };
    }
    case "ASSIGN_COURIERS": {
      let shipped = 0;
      let expected = 0;
      const mix: Record<string, number> = {};
      const byId = new Map(d.orders.map((o) => [o.id, o]));
      for (const as of action.assignments) {
        const o = byId.get(as.orderId);
        if (!o || (o.status !== "placed" && o.status !== "backordered")) continue;
        if (!o.lines.every((l) => d.inventory[l.sku][as.warehouseId] >= l.qty)) continue; // stock moved since planning
        const courier = d.couriers.find((c) => c.id === as.courierId)!;
        const zone = rateZone(WAREHOUSE_BY_ID[as.warehouseId].region, o.region);
        const days = deliveryDays(courier as never, zone, o.region, t.month, o.u.delay);
        const cartSize = o.lines.reduce((a, l) => a + l.qty, 0);
        const pTrue = trueRtoProbability({ paymentMode: o.paymentMode, tier: o.tier, value: o.value, category: cat[o.lines[0].sku].category, courierId: courier.id, cartSize, firstTime: o.firstTime, month: t.month, region: o.region, ivr: o.rtoMeasure === "ivr_confirm" });
        const willRto = o.u.rto < pTrue;
        const sla = courier.slaDays[zone];
        for (const l of o.lines) {
          d.inventory[l.sku][as.warehouseId] -= l.qty;
          if (!o.booked) book(d.ledger, t.day, "unitsDemanded", l.qty);
          book(d.ledger, t.day, "unitsFilled", l.qty);
          book(d.ledger, t.day, "cogs", cat[l.sku].cost * l.qty);
          book(d.ledger, t.day, "commission", commissionFor(o.channel, cat[l.sku].category, l.price * l.qty));
        }
        o.booked = true;
        book(d.ledger, t.day, "revenue", o.value);
        book(d.ledger, t.day, "shipping", as.cost + PACKAGING_COST);
        d.finance.cash -= as.cost + PACKAGING_COST;
        if (o.paymentMode === "prepaid" && o.channel === "web") d.finance.cash += o.value;
        o.status = "shipped";
        o.warehouseId = as.warehouseId;
        o.courierId = as.courierId;
        o.shipCost = as.cost;
        o.promisedDays = Math.ceil(as.slaDays + 0.5);
        d.shipments.push({ id: nextId(d, "SH"), orderId: o.id, warehouseId: as.warehouseId, courierId: courier.id, zone, cost: as.cost, shippedTick: tick, etaTick: tick + Math.ceil(sla) * 24, resolveTick: tick + Math.round((willRto ? sla + 3 : days) * 24), outcome: "in_transit", willRto, slaBreached: days > sla, lines: o.lines.map((l) => ({ ...l })), value: o.value, channel: o.channel, paymentMode: o.paymentMode, region: o.region, u: { ret: o.u.ret, delay: o.u.delay } });
        shipped++;
        expected += as.expectedCost;
        mix[courier.name] = (mix[courier.name] ?? 0) + 1;
      }
      return { summary: shipped ? `${shipped} orders shipped · avg expected landed ${inr(expected / shipped)} · ${Object.entries(mix).map(([k, v]) => `${k} ${v}`).join(", ")}` : "", count: shipped };
    }
    case "RESOLVE_RETURN": {
      const r = d.returns.find((x) => x.id === action.returnId);
      if (!r || (r.status !== "requested" && r.status !== "escalated")) return { summary: "", count: 0 };
      r.status = "inspecting";
      r.disposition = action.disposition;
      r.resolvedTick = action.skipInspection ? tick : tick + 48;
      return { summary: `${r.id}: ${action.skipInspection ? "refund on pickup" : `${action.disposition} after inspection`} (${inr(action.refund)})`, count: 1 };
    }
    case "RTO_PREVENTION": {
      let n = 0;
      for (const id of action.orderIds) {
        const o = d.orders.find((x) => x.id === id);
        if (o && !o.rtoMeasure) {
          o.rtoMeasure = "ivr_confirm";
          n++;
        }
      }
      d.finance.cash -= n * 4;
      book(d.ledger, t.day, "shipping", n * 4);
      return { summary: n ? `IVR confirmation on ${n} high-risk COD orders` : "", count: n };
    }
    case "FIX_SIZE_GUIDE":
      d.sizeGuideFixed[action.sku] = tick;
      return { summary: `${cat[action.sku].name}: size guide corrected, price held`, count: 1 };
    case "ADJUST_COURIER_WEIGHT": {
      const c = d.couriers.find((x) => x.id === action.courierId)!;
      c.weight = action.weight;
      d.cooldowns[`courier:${c.id}`] = tick + 24;
      return { summary: `${c.name} routing weight → ${action.weight} (${action.reason})`, count: 1 };
    }
    case "EXPEDITE_PO": {
      const po = d.purchaseOrders.find((x) => x.id === action.poId);
      if (po) po.etaTick = Math.max(tick + 24, po.etaTick - action.daysSaved * 24);
      d.finance.cash -= action.cost;
      book(d.ledger, t.day, "shipping", action.cost);
      return { summary: `${action.poId} expedited (${inr(action.cost)}, −${action.daysSaved}d)`, count: 1 };
    }
    case "RAISE_ALERT":
      return { summary: `${action.severity.toUpperCase()} · ${action.detail}`, count: 1 };
    case "RAISE_DISPUTE": {
      const st = d.settlements.find((x) => x.id === action.settlementId);
      if (st) {
        st.status = "disputed";
        st.disputeAmount = action.amount;
        d.finance.disputesOpen += 1;
        d.finance.disputedAmount += action.amount;
      }
      d.cooldowns[`dispute:${action.settlementId}`] = tick + 9999;
      return { summary: `Disputed ${inr(action.amount)} on ${action.settlementId}`, count: 1 };
    }
    case "RELEASE_PAYOUT": {
      const po = d.purchaseOrders.find((x) => x.id === action.poId);
      if (po && !po.paid) {
        po.paid = true;
        d.finance.cash -= action.amount;
      }
      return { summary: `Paid ${inr(action.amount)} for ${action.poId}`, count: 1 };
    }
    case "CASH_CONSTRAINT":
      return { summary: "", count: 0 };
  }
}

function fallbackFor(d: Draft<AppState>, g: GuardOutcome): Escalation["fallback"] {
  const a = g.proposal.action;
  switch (a.type) {
    case "CREATE_PO": {
      const ceiling = ENVELOPES.procurement.poValueCeiling ?? 0;
      const qty = Math.floor(ceiling / a.unitCost / 10) * 10;
      const moq = SUPPLIER_BY_ID[a.supplierId].moq;
      return qty >= moq ? { label: `Place first tranche: ${qty} units (${inr(qty * a.unitCost)}) within ceiling`, action: { ...a, qty } } : { label: "Hold — no tranche clears MOQ within ceiling", action: null };
    }
    case "SET_PRICE":
      return { label: `Keep current price ${inr(a.prevPrice)}`, action: null };
    case "RESOLVE_RETURN":
      return { label: "Inspect before any refund", action: { ...a, disposition: "inspect", skipInspection: false } };
    case "TRANSFER_STOCK":
      return { label: `Transfer half (${Math.floor(a.qty / 2)} units)`, action: { ...a, qty: Math.floor(a.qty / 2), cost: Math.round(a.cost * 0.6) } };
    case "RELEASE_PAYOUT":
      return { label: "Hold payment · verify bank change by letterhead + call-back", action: null };
    case "RAISE_DISPUTE":
      return { label: "Hold · re-extract notice manually", action: null };
    case "RAISE_ALERT":
      return { label: "Monitor only", action: null };
    default:
      void d;
      return { label: "Hold (take no action)", action: null };
  }
}

export function commitCycle(d: Draft<AppState>, r: CycleResult) {
  const tick = d.clock.tick;
  const scenario = d.scenario.id ?? undefined;
  d.counters.proposals += r.proposalsTotal;

  // conflicts first, so the stream reads cause → effect
  for (const c of r.conflicts) {
    d.counters.conflicts += 1;
    logDecision(d, { agentId: "orchestrator", kind: "conflict", title: c.title, summary: c.resolution, reasoning: c.reasoning, details: { ...c.details, kind: c.kind, agents: c.agents }, scenario: c.scenario ?? scenario });
    if (c.kind === "procurement_vs_finance" && c.resolution.startsWith("Deferred") && c.details?.sku) d.cooldowns[`po:${c.details.sku}`] = tick + 24;
  }

  // order: prevention before shipping so IVR applies to this tick's shipments
  const prio = (g: GuardOutcome) => (g.proposal.action.type === "UPDATE_FORECAST" ? 0 : g.proposal.action.type === "RTO_PREVENTION" ? 1 : g.proposal.action.type === "TRANSFER_STOCK" ? 2 : 3);
  const approved = r.approved.slice().sort((a, b) => prio(a) - prio(b));
  const quiet: Record<string, { n: number; agent: ProposerId }> = {};

  for (const g of approved) {
    const p = g.proposal;
    const res = applyAction(d, p.action);
    if (core(p.agentId)) {
      const st = d.agents[p.agentId];
      st.decisions += res.count;
      st.proposals += 1;
      st.status = "active";
      st.lastTick = tick;
      if (res.summary) st.lastAction = res.summary;
      st.envelopeUtil = Math.max(st.envelopeUtil * 0.98, g.util);
    }
    d.counters.autonomous += res.count;
    const cd = p.meta?.cooldown as string | undefined;
    if (cd) d.cooldowns[cd] = tick + 48;
    if (p.action.type === "SET_PRICE") d.cooldowns[`price:${p.action.sku}`] = tick + 12;

    const t = p.action.type;
    const scenarioSku = !!d.scenario.id && p.meta?.sku === d.scenario.sku;
    if (!(scenarioSku && t === "REPLENISH_NEED") && (t === "SET_REORDER_POLICY" || t === "REPLENISH_NEED" || t === "RELEASE_PAYOUT" || (t === "RESOLVE_RETURN" && !p.meta?.hits) || p.meta?.quiet)) {
      if (res.count) quiet[t] = { n: (quiet[t]?.n ?? 0) + res.count, agent: p.agentId };
      continue;
    }
    if (!res.summary) continue;
    if (t === "UPDATE_FORECAST" && !p.meta?.full) continue;
    const kind = "commit" as const;
    logDecision(d, {
      agentId: p.agentId,
      kind,
      title: `${core(p.agentId) ? AGENT_META[p.agentId].name : p.agentId} · ${humanType(t)}`,
      summary: res.summary,
      reasoning: p.reasoning,
      citations: p.citations,
      guardrails: t === "ASSIGN_COURIERS" || t === "UPDATE_FORECAST" ? undefined : g.results,
      count: res.count,
      costImpact: p.costImpact,
      scenario: scenario && p.meta?.sku === d.scenario.sku ? scenario : undefined,
      details: t === "ASSIGN_COURIERS" ? { disagreements: p.meta?.disagreements } : undefined,
    });
  }
  const QUIET_LABEL: Record<string, string> = { SET_REORDER_POLICY: "reorder policies recalculated (newsvendor)", REPLENISH_NEED: "replenishment needs raised", RELEASE_PAYOUT: "supplier payments released on terms", RESOLVE_RETURN: "returns dispositioned", RTO_PREVENTION: "COD orders sent to IVR confirmation" };
  for (const [t, q] of Object.entries(quiet)) {
    logDecision(d, { agentId: q.agent, kind: "commit", title: `${core(q.agent) ? AGENT_META[q.agent].name : q.agent} · batch`, summary: `${q.n} ${QUIET_LABEL[t] ?? t}`, reasoning: "Routine decisions inside envelope; aggregated to keep the stream readable.", count: q.n });
  }

  for (const g of r.blocked) escalate(d, g);

  for (const id of Object.keys(d.agents) as AgentId[]) {
    const st = d.agents[id];
    if (d.clock.halted) st.status = "halted";
    else if (st.lastTick !== tick && st.status === "active") st.status = "idle";
    st.envelopeUtil *= 0.995;
  }
  // prune cooldowns
  if (tick % 24 === 0) for (const [k, v] of Object.entries(d.cooldowns)) if (v < tick) delete d.cooldowns[k];
}

export function escalate(d: Draft<AppState>, g: GuardOutcome) {
  const p = g.proposal;
  const tick = d.clock.tick;
  const key = proposalKey(p) ?? `${p.action.type}:${p.id}`;
  if (d.escalations.some((e) => e.status === "open" && e.key === key)) return;
  const failed = g.results.filter((x) => !x.passed);
  const novel = p.action.type === "RAISE_ALERT" && !!p.meta?.novel;
  d.counters.escalations += 1;
  if (!novel) d.counters.blocked += 1;
  if (core(p.agentId)) {
    d.agents[p.agentId].escalations += 1;
    if (!novel) d.agents[p.agentId].blocked += 1;
    d.agents[p.agentId].status = "blocked";
    d.agents[p.agentId].lastTick = tick;
    d.agents[p.agentId].envelopeUtil = Math.max(d.agents[p.agentId].envelopeUtil, g.util);
  }
  const hits = (p.meta?.hits as { span: [number, number] }[] | undefined) ?? [];
  const freeText = (p.meta?.freeText as string | undefined) ?? (p.meta?.page as string | undefined) ?? (p.meta?.body as string | undefined);
  const esc: Escalation = {
    id: nextId(d, "ESC"),
    key,
    tick,
    wall: Date.now(),
    agentId: p.agentId,
    status: "open",
    breach: novel ? "Novel pattern — no playbook above similarity threshold" : `${g.headline?.label}: ${g.headline?.detail}`,
    ask: askFor(p),
    proposal: p,
    fallback: fallbackFor(d, g),
    guardrails: g.results,
    highlight: freeText ? { text: freeText, spans: hits.map((h) => h.span) } : undefined,
  };
  pushCapped(d.escalations, esc, CAPS.escalations);
  if (p.action.type === "RESOLVE_RETURN") {
    const r = d.returns.find((x) => x.id === (p.action as { returnId: string }).returnId);
    if (r) r.status = "escalated";
  }
  logDecision(d, {
    agentId: p.agentId,
    kind: novel ? "escalate" : "block",
    title: novel ? `Risk · novel pattern escalated` : `Blocked · ${humanType(p.action.type)} (${failed.map((f) => f.label).join(" + ")})`,
    summary: esc.ask,
    reasoning: p.reasoning,
    guardrails: g.results,
    citations: p.citations,
    scenario: d.scenario.id ?? undefined,
    details: { escalationId: esc.id },
  });
}

function askFor(p: Proposal) {
  const a = p.action;
  switch (a.type) {
    case "CREATE_PO":
      return `Approve PO of ${a.qty.toLocaleString("en-IN")} units (${inr(a.qty * a.unitCost)}) from ${SUPPLIER_BY_ID[a.supplierId].name}?`;
    case "SET_PRICE":
      return `Approve price ${inr(a.price)} (from ${inr(a.prevPrice)}) for ${a.sku}?`;
    case "RESOLVE_RETURN":
      return `Approve ${a.skipInspection ? "refund without inspection" : "refund"} of ${inr(a.refund)} on ${a.returnId}?`;
    case "RELEASE_PAYOUT":
      return `Release ${inr(a.amount)} for ${a.poId} as the document requests?`;
    case "TRANSFER_STOCK":
      return `Approve transfer of ${a.qty} units ${a.from} → ${a.to}?`;
    case "RAISE_DISPUTE":
      return `Raise dispute of ${inr(a.amount)} on ${a.settlementId}?`;
    case "RAISE_ALERT":
      return `Review: ${a.detail}`;
    default:
      return `Approve ${humanType(a.type)}?`;
  }
}

export function humanType(t: string) {
  return t.toLowerCase().replace(/_/g, " ");
}

