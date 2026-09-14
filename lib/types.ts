// Core domain types shared by the seed generator, simulation engine, agents and UI.

export type Category = "apparel" | "electronics" | "home" | "personal_care";
export type Region = "north" | "west" | "south" | "east" | "northeast";
export type Tier = "metro" | "tier2" | "tier3";
export type RateZone = "A" | "B" | "C" | "D";
export type PaymentMode = "cod" | "prepaid";
export type Channel = "web" | "marketplace";
export type WarehouseId = "WH-BHW" | "WH-GGN" | "WH-BLR" | "WH-KOL" | "WH-GAU";
export type AgentId =
  | "demand"
  | "pricing"
  | "inventory"
  | "placement"
  | "procurement"
  | "fulfilment"
  | "courier"
  | "returns"
  | "risk"
  | "finance";
export type IntakeId = "intake:returns" | "intake:finance" | "intake:competitor";
export type ProposerId = AgentId | IntakeId;

export interface Product {
  sku: string;
  name: string;
  category: Category;
  cluster: string; // elasticity cluster: category + price band
  cost: number;
  mrp: number;
  basePrice: number;
  currentPrice: number; // reference (west) price
  zonePrice: Record<Region, number>;
  price30dMean: number;
  weight: number; // kg
  dims: { l: number; w: number; h: number }; // cm
  imageSeed: number;
  elasticity: number; // true elasticity used by the simulator
  returnRate: number; // base return probability
  sizingIssue: boolean; // returns are driven by fit rather than demand
  baseDaily: number; // mean daily units at base price
  regionShare: Record<Region, number>;
  supplierIds: string[];
  deadStock?: boolean;
}

export interface Warehouse {
  id: WarehouseId;
  name: string;
  city: string;
  region: Region;
  capacity: number; // units
  holdingCostPerUnitDay: number; // ₹, scaled by category volume factor
}

export interface Pincode {
  pin: string;
  city: string;
  state: string;
  region: Region;
  tier: Tier;
}

export interface CourierRate {
  first500g: number;
  addl500g: number;
}

export interface Courier {
  id: string;
  name: string;
  rateCard: Record<RateZone, CourierRate>;
  codFeePct: number;
  codFeeMin: number;
  rtoChargePct: number; // % of forward charge billed on RTO
  slaDays: Record<RateZone, number>;
  baseRto: number;
  coverage: number;
  regionStrength: Partial<Record<Region, number>>; // SLA multiplier <1 = better
  slaHealth: number; // dynamic: 1 = nominal, >1 = degraded (delay multiplier)
  weight: number; // routing weight adjusted by Risk agent (1 = neutral)
  contractDoc: string;
}

export interface Supplier {
  id: string;
  name: string;
  city: string;
  domestic: boolean;
  categories: Category[];
  leadDaysMin: number;
  leadDaysMax: number;
  moq: number;
  paymentTermsDays: number;
  reliability: number;
  priceBreaks: { qty: number; discountPct: number }[];
  leadDrift: number; // dynamic extra days (supplier slip)
  contractDoc: string;
}

export interface OrderLine {
  sku: string;
  qty: number;
  price: number;
}

export type OrderStatus =
  | "placed"
  | "allocated"
  | "shipped"
  | "delivered"
  | "rto"
  | "returned"
  | "backordered"
  | "cancelled";

export interface RtoExplanation {
  p: number;
  top: { feature: string; label: string; contribution: number }[];
}

export interface Order {
  id: string;
  tick: number;
  source: "storefront" | "synthetic";
  customerName: string;
  firstTime: boolean;
  pincode: string;
  region: Region;
  tier: Tier;
  channel: Channel;
  paymentMode: PaymentMode;
  lines: OrderLine[];
  value: number;
  status: OrderStatus;
  warehouseId?: WarehouseId;
  courierId?: string;
  rto?: RtoExplanation;
  rtoMeasure?: "ivr_confirm" | "none";
  promisedDays?: number;
  shipCost?: number;
  u: { rto: number; ret: number; delay: number }; // common random numbers (shadow comparison)
  booked?: boolean;
  // one entry per parcel; more than one when no single warehouse could fill the whole order
  legs?: OrderLeg[];
  // where the order "should" have shipped from, and whether that node had the stock
  sourcing?: { home: WarehouseId; homeHadStock: boolean; split: boolean };
}

export interface OrderLeg {
  shipmentId: string;
  warehouseId: WarehouseId;
  courierId: string;
  lines: OrderLine[];
  cost: number;
  promisedDays: number;
}

export interface Shipment {
  id: string;
  orderId: string;
  warehouseId: WarehouseId;
  courierId: string;
  zone: RateZone;
  cost: number;
  shippedTick: number;
  etaTick: number;
  resolveTick: number;
  outcome: "in_transit" | "delivered" | "rto";
  willRto: boolean;
  slaBreached: boolean;
  // self-contained so resolution never depends on the order still being in the ring buffer
  lines: OrderLine[];
  value: number;
  channel: Channel;
  paymentMode: PaymentMode;
  region: Region;
  pincode: string;
  u: { ret: number; delay: number };
}

export type ReturnStatus = "requested" | "inspecting" | "restocked" | "liquidated" | "refunded" | "rejected" | "escalated";

export interface ReturnRequest {
  id: string;
  orderId: string;
  sku: string;
  qty: number;
  reasonCode: string;
  freeText: string;
  tick: number;
  status: ReturnStatus;
  refundValue: number;
  source: "storefront" | "synthetic";
  warehouseId: WarehouseId;
  shipCost: number;
  disposition?: string;
  injection?: InjectionHit[];
  resolvedTick?: number;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  sku: string;
  qty: number;
  unitCost: number;
  value: number;
  warehouseId: WarehouseId;
  placedTick: number;
  etaTick: number;
  status: "open" | "received" | "cancelled";
  paymentDueTick: number;
  paid: boolean;
  origin: "agent" | "human";
}

export interface Transfer {
  id: string;
  sku: string;
  from: WarehouseId;
  to: WarehouseId;
  qty: number;
  cost: number;
  arriveTick: number;
}

export interface Citation {
  chunkId: string;
  source: string;
  title: string;
  snippet: string;
  score: number;
}

// ---------- Actions (closed set) ----------
export type Action =
  | { type: "UPDATE_FORECAST"; forecasts: Record<string, ForecastEntry> }
  | { type: "FLAG_DEMAND_SIGNAL"; sku: string; multiplier: number; z: number }
  | { type: "SET_PRICE"; sku: string; zones: Region[]; price: number; prevPrice: number; reason: "ageing" | "viral" | "competitor" | "sell_through" | "restore" }
  | { type: "HOLD_PRICE"; sku: string; zone: Region; untilTick: number; reason: string }
  | { type: "SET_REORDER_POLICY"; sku: string; warehouseId: WarehouseId; reorderPoint: number; orderUpTo: number; safetyStock: number }
  | { type: "REPLENISH_NEED"; sku: string; warehouseId: WarehouseId; qty: number; urgency: "normal" | "urgent" }
  | { type: "MARK_DEAD_STOCK"; sku: string; coverDays: number }
  | { type: "TRANSFER_STOCK"; sku: string; from: WarehouseId; to: WarehouseId; qty: number; cost: number }
  | { type: "CREATE_PO"; supplierId: string; sku: string; qty: number; unitCost: number; warehouseId: WarehouseId; leadDays: number }
  | { type: "ALLOCATE_ORDERS"; allocations: Allocation[] }
  | { type: "ASSIGN_COURIERS"; assignments: CourierAssignment[] }
  | { type: "RESOLVE_RETURN"; returnId: string; disposition: "restock" | "inspect" | "liquidate" | "reject"; refund: number; skipInspection: boolean }
  | { type: "RTO_PREVENTION"; orderIds: string[]; measure: "ivr_confirm" }
  | { type: "FIX_SIZE_GUIDE"; sku: string; expectedReturnDrop: number }
  | { type: "ADJUST_COURIER_WEIGHT"; courierId: string; weight: number; reason: string }
  | { type: "EXPEDITE_PO"; poId: string; cost: number; daysSaved: number }
  | { type: "RAISE_ALERT"; severity: "info" | "warn" | "critical"; pattern: string; detail: string }
  | { type: "RAISE_DISPUTE"; settlementId: string; amount: number; clause: string }
  | { type: "RELEASE_PAYOUT"; poId: string; amount: number }
  | { type: "CASH_CONSTRAINT"; available: number; buffer: number; nextInflowTick: number };

export type ActionType = Action["type"];

export interface Allocation {
  orderId: string;
  warehouseId: WarehouseId | null; // null = backorder
  courierId?: string; // cheapest-rate carrier implied by the fulfilment choice
  shipCost: number;
  slaDays: number;
  legs?: ShipLeg[]; // split fulfilment across warehouses
}

/** One parcel of a (possibly split) order: which node ships which lines, via which carrier. */
export interface ShipLeg {
  warehouseId: WarehouseId;
  courierId: string;
  lines: OrderLine[];
  cost: number;
  expectedCost: number;
  rtoP: number;
  slaDays: number;
}

export interface CourierAssignment {
  orderId: string;
  warehouseId: WarehouseId;
  courierId: string;
  cost: number;
  expectedCost: number;
  rtoP: number;
  slaDays: number;
  legs?: ShipLeg[]; // present when the order ships in several parcels from different warehouses
}

export interface ForecastEntry {
  daily: number;
  sigma: number;
  byRegion: Record<Region, number>;
  velocityMult: number;
  updatedTick: number;
}

export interface Proposal {
  id: string;
  agentId: ProposerId;
  action: Action;
  reasoning: string;
  confidence: number;
  costImpact: number; // ₹ (+ = cost, - = saving)
  serviceImpact: number; // expected fill-rate/SLA contribution (units or pts)
  citations?: Citation[];
  resources?: ResourceClaim[];
  tainted?: boolean; // derived from untrusted content flagged by injection detection
  derivedFromUntrusted?: boolean;
  llmText?: string; // any LLM text attached to the proposal (numeric validation)
  meta?: Record<string, unknown>;
}

export interface ResourceClaim {
  kind: "price" | "cash" | "stock" | "capacity" | "order";
  key: string;
  direction?: "down" | "up" | "hold";
  amount?: number;
}

export interface GuardrailResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export type DecisionKind = "commit" | "conflict" | "block" | "escalate" | "human" | "security" | "info";

export interface Decision {
  id: string;
  tick: number;
  wall: number;
  agentId: ProposerId | "orchestrator" | "human" | "security";
  kind: DecisionKind;
  title: string;
  summary: string;
  reasoning: string;
  explanation?: string;
  explanationSource?: "template" | "llm";
  citations?: Citation[];
  guardrails?: GuardrailResult[];
  count?: number;
  costImpact?: number;
  scenario?: string;
  details?: Record<string, unknown>;
}

export interface Escalation {
  id: string;
  tick: number;
  wall: number;
  agentId: ProposerId;
  key: string;
  status: "open" | "authorised" | "held" | "expired";
  breach: string; // which guardrail / envelope
  ask: string;
  proposal: Proposal;
  fallback?: { label: string; action: Action | null };
  guardrails: GuardrailResult[];
  highlight?: { text: string; spans: [number, number][] };
  resolvedTick?: number;
}

export interface AgentState {
  id: AgentId;
  status: "idle" | "active" | "blocked" | "halted";
  decisions: number;
  proposals: number;
  escalations: number;
  blocked: number;
  envelopeUtil: number; // 0..1+ (max recent utilisation)
  lastAction?: string;
  lastTick?: number;
}

export interface DailyAggregate {
  date: string; // YYYY-MM-DD
  orders: number;
  units: number;
  revenue: number;
  returns: number;
  rto: number;
  codShare: number;
  byCategory: Record<Category, number>;
  festival?: string;
}

export interface HourlyAggregate {
  ts: string;
  orders: number;
  units: number;
}

export interface KpiSnapshot {
  contributionMarginPct: number;
  fillRate: number;
  rtoRate: number;
  daysOfCover: number;
  settlementGap: number;
  revenue7d: number;
  ordersToday: number;
}

export interface InjectionHit {
  pattern: string;
  label: string;
  span: [number, number];
  excerpt: string;
}

export interface SecurityEvent {
  id: string;
  tick: number;
  wall: number;
  surface: "return_request" | "competitor_page" | "supplier_email" | "settlement_notice" | "invoice";
  refId: string;
  hits: InjectionHit[];
  blocked: boolean;
  note: string;
}

export interface Settlement {
  id: string;
  marketplace: string;
  periodEndTick: number;
  dueTick: number;
  orderIds: string[];
  gross: number;
  expectedCommission: number;
  noticeText: string;
  status: "pending" | "reconciled" | "disputed" | "paid";
  claimedDeduction?: number;
  disputeAmount?: number;
}

export interface InboxMessage {
  id: string;
  tick: number;
  kind: "supplier_email" | "invoice" | "settlement_notice";
  from: string;
  subject: string;
  body: string;
  refId?: string;
  processed: boolean;
  pending?: boolean;
  extracted?: Record<string, unknown>;
  injection?: InjectionHit[];
}

export interface CompetitorQuote {
  sku: string;
  page: string; // raw scraped HTML-ish text (untrusted)
  tick: number;
  hits?: InjectionHit[];
  poisoned?: boolean;
}

export interface LedgerDay {
  day: number;
  revenue: number;
  cogs: number;
  shipping: number;
  rtoCost: number;
  returnCost: number;
  commission: number;
  holding: number;
  unitsDemanded: number;
  unitsFilled: number;
  shipmentsClosed: number;
  rtos: number;
  stockouts: number;
  orders: number;
}

export interface PolicyLedger {
  days: LedgerDay[]; // ring (last 30 sim days)
  totals: Omit<LedgerDay, "day">;
}

export interface ShadowState {
  inventory: Record<string, Record<WarehouseId, number>>;
  // outcomes booked on the same timeline as the live policy (delivery / RTO / return lag), bucketed by due tick
  pending: Record<string, { closed: number; rtos: number; rtoCost: number; revenue: number; cogs: number; commission: number; returnCost: number; restock: { sku: string; wh: WarehouseId; qty: number }[] }>;
  pipeline: { sku: string; warehouseId: WarehouseId; qty: number; arriveTick: number }[];
  ledger: PolicyLedger;
  stockoutKeys: Record<string, number>;
}

export interface ForecastAccuracy {
  // live, rolling sums of absolute errors per method (WAPE)
  model: number;
  naive: number;
  movingAvg: number;
  actual: number;
  days: number;
}

export interface ScenarioState {
  id: "normal" | "viral" | "conflict" | "attack_return" | "attack_competitor" | "attack_invoice" | null;
  startedTick: number;
  startedWall: number;
  sku?: string;
  note?: string;
}

export interface MarketState {
  viral: { sku: string; mult: number; startTick: number; regionMult?: Partial<Record<Region, number>> } | null;
  competitor: Record<string, CompetitorQuote>;
  poisonedSku: string | null;
  eventsSuppressedUntil: number;
}

export interface Settings {
  injectionDetection: boolean;
  llmEnabled: boolean;
  fillRateFloor: number;
  autoExplain: boolean;
  syntheticDemand: boolean;
}

export interface EngineLock {
  holderId: string;
  heartbeat: number;
  claimedAt: number;
  visible: boolean;
}
