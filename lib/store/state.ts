import seed from "@/data/seed.json";
import { AGENT_IDS } from "@/lib/config/envelopes";
import { COURIERS, SUPPLIERS } from "@/lib/config/network";
import type {
  AgentId,
  AgentState,
  Courier,
  DailyAggregate,
  Decision,
  EngineLock,
  Escalation,
  ForecastAccuracy,
  ForecastEntry,
  HourlyAggregate,
  InboxMessage,
  KpiSnapshot,
  LedgerDay,
  MarketState,
  Order,
  PolicyLedger,
  Product,
  PurchaseOrder,
  Region,
  ReturnRequest,
  ScenarioState,
  SecurityEvent,
  Settings,
  Settlement,
  ShadowState,
  Shipment,
  Supplier,
  Transfer,
  WarehouseId,
} from "@/lib/types";

export const STATE_VERSION = 6;
export const STORAGE_KEY = `sct:v${STATE_VERSION}`;

export const CAPS = {
  orders: 450,
  shipments: 1600,
  returns: 250,
  decisions: 400,
  escalations: 120,
  security: 120,
  inbox: 60,
  settlements: 40,
  purchaseOrders: 250,
  transfers: 80,
} as const;

export type LoopStage = "idle" | "sense" | "twin" | "plan" | "arbitrate" | "simulate" | "execute";

export interface AppState {
  version: number;
  clock: { tick: number; speedMs: number; running: boolean; stage: LoopStage; lastCycleMs: number; lastCycleWall: number; halted: boolean };
  engine: EngineLock;
  catalog: Product[];
  inventory: Record<string, Record<WarehouseId, number>>;
  orders: Order[];
  shipments: Shipment[];
  returns: ReturnRequest[];
  pendingReturns: { orderId: string; sku: string; qty: number; dueTick: number; refund: number; warehouseId: WarehouseId; shipCost: number }[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  transfers: Transfer[];
  couriers: Courier[];
  decisions: Decision[];
  escalations: Escalation[];
  agents: Record<AgentId, AgentState>;
  history: DailyAggregate[];
  hourly: HourlyAggregate[];
  kpis: KpiSnapshot;
  // --- twin / planning state
  skuDaily: Record<string, number[]>; // completed days (last 60)
  todayUnits: Record<string, number>;
  velocity: Record<string, number[]>; // hourly units, last 24
  forecasts: Record<string, ForecastEntry>;
  policies: Record<string, { reorderPoint: number; orderUpTo: number; safetyStock: number; updatedTick: number }>; // key sku|wh
  needs: Record<string, { sku: string; warehouseId: WarehouseId; qty: number; urgency: "normal" | "urgent"; tick: number }>;
  holds: Record<string, { sku: string; zone: Region; untilTick: number; reason: string }>; // key sku|zone
  sizeGuideFixed: Record<string, number>;
  cooldowns: Record<string, number>; // proposal key → tick until which it is suppressed
  lastPriceChange: Record<string, number>;
  // --- external world
  market: MarketState;
  finance: { cash: number; buffer: number; disputesOpen: number; disputedAmount: number; recovered: number; receivable: number };
  settlements: Settlement[];
  inbox: InboxMessage[];
  security: SecurityEvent[];
  settings: Settings;
  scenario: ScenarioState;
  // --- measurement
  ledger: PolicyLedger;
  shadow: ShadowState;
  accuracy: ForecastAccuracy;
  prevForecast: Record<string, number>; // yesterday's one-day-ahead forecast per SKU
  counters: {
    autonomous: number;
    proposals: number;
    escalations: number;
    blocked: number;
    conflicts: number;
    injectionsCaught: number;
    injectionAttempts: number;
    humanActions: number;
    llmCalls: number;
    llmCached: number;
    llmRejected: number;
    ordersStorefront: number;
    seq: number;
  };
  storefrontOrderIds: string[];
}

const emptyDay = (day: number): LedgerDay => ({ day, revenue: 0, cogs: 0, shipping: 0, rtoCost: 0, returnCost: 0, commission: 0, holding: 0, unitsDemanded: 0, unitsFilled: 0, shipmentsClosed: 0, rtos: 0, stockouts: 0, orders: 0 });
export const newLedgerDay = emptyDay;
const emptyLedger = (): PolicyLedger => {
  const { day: _d, ...totals } = emptyDay(0);
  return { days: [emptyDay(0)], totals };
};

export function createInitialState(): AppState {
  const catalog = (seed.catalog as Product[]).map((p) => ({ ...p, zonePrice: { ...p.zonePrice } }));
  const inventory = JSON.parse(JSON.stringify(seed.inventory)) as AppState["inventory"];
  const agents = Object.fromEntries(
    AGENT_IDS.map((id) => [id, { id, status: "idle", decisions: 0, proposals: 0, escalations: 0, blocked: 0, envelopeUtil: 0 } satisfies AgentState]),
  ) as Record<AgentId, AgentState>;
  return {
    version: STATE_VERSION,
    clock: { tick: 0, speedMs: 4000, running: true, stage: "idle", lastCycleMs: 0, lastCycleWall: 0, halted: false },
    engine: { holderId: "", heartbeat: 0, claimedAt: 0, visible: false },
    catalog,
    inventory,
    orders: [],
    shipments: [],
    returns: [],
    pendingReturns: [],
    suppliers: SUPPLIERS.map((s) => ({ ...s })),
    purchaseOrders: [],
    transfers: [],
    couriers: COURIERS.map((c) => ({ ...c })),
    decisions: [],
    escalations: [],
    agents,
    history: seed.history as DailyAggregate[],
    hourly: seed.hourly as HourlyAggregate[],
    kpis: { contributionMarginPct: 0, fillRate: 1, rtoRate: 0, daysOfCover: 0, settlementGap: 0, revenue7d: 0, ordersToday: 0 },
    skuDaily: JSON.parse(JSON.stringify(seed.skuDaily)),
    todayUnits: Object.fromEntries(catalog.map((p) => [p.sku, 0])),
    velocity: Object.fromEntries(catalog.map((p) => [p.sku, []])),
    forecasts: {},
    policies: {},
    needs: {},
    holds: {},
    sizeGuideFixed: {},
    cooldowns: {},
    lastPriceChange: {},
    market: { viral: null, competitor: {}, poisonedSku: null, eventsSuppressedUntil: 0 },
    finance: { cash: 6000000, buffer: 2000000, disputesOpen: 0, disputedAmount: 0, recovered: 0, receivable: 0 },
    settlements: [],
    inbox: [],
    security: [],
    settings: { injectionDetection: true, llmEnabled: true, fillRateFloor: 0.9, autoExplain: true },
    scenario: { id: null, startedTick: 0, startedWall: 0 },
    ledger: emptyLedger(),
    shadow: { inventory: JSON.parse(JSON.stringify(seed.inventory)), pending: {}, pipeline: [], ledger: emptyLedger(), stockoutKeys: {} },
    accuracy: { model: 0, naive: 0, movingAvg: 0, actual: 0, days: 0 },
    prevForecast: {},
    counters: { autonomous: 0, proposals: 0, escalations: 0, blocked: 0, conflicts: 0, injectionsCaught: 0, injectionAttempts: 0, humanActions: 0, llmCalls: 0, llmCached: 0, llmRejected: 0, ordersStorefront: 0, seq: 0 },
    storefrontOrderIds: [],
  };
}
