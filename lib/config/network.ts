import type { Courier, Pincode, RateZone, Region, Supplier, Tier, Warehouse, WarehouseId } from "@/lib/types";

// Simulation calendar: history ends the day before SIM_EPOCH; tick 0 = SIM_EPOCH 00:00 IST.
export const SIM_EPOCH = "2026-09-14";
export const HISTORY_DAYS = 548; // ~18 months
export const TICKS_PER_DAY = 24;

export const REGIONS: Region[] = ["north", "west", "south", "east", "northeast"];
export const REGION_LABEL: Record<Region, string> = {
  north: "North",
  west: "West",
  south: "South",
  east: "East",
  northeast: "North-East",
};

export const WAREHOUSES: Warehouse[] = [
  { id: "WH-BHW", name: "Bhiwandi FC", city: "Bhiwandi", region: "west", capacity: 60000, holdingCostPerUnitDay: 0.32 },
  { id: "WH-GGN", name: "Gurugram FC", city: "Gurugram", region: "north", capacity: 50000, holdingCostPerUnitDay: 0.38 },
  { id: "WH-BLR", name: "Bengaluru FC", city: "Bengaluru", region: "south", capacity: 45000, holdingCostPerUnitDay: 0.35 },
];
export const WAREHOUSE_IDS: WarehouseId[] = WAREHOUSES.map((w) => w.id);
export const WAREHOUSE_BY_ID = Object.fromEntries(WAREHOUSES.map((w) => [w.id, w])) as Record<WarehouseId, Warehouse>;

// Which warehouse "naturally" serves each customer region (used for placement demand geography).
export const HOME_WAREHOUSE: Record<Region, WarehouseId> = {
  north: "WH-GGN",
  east: "WH-GGN",
  northeast: "WH-GGN",
  west: "WH-BHW",
  south: "WH-BLR",
};

const ADJACENT: Record<Region, Region[]> = {
  north: ["west", "east"],
  west: ["north", "south"],
  south: ["west", "east"],
  east: ["north", "south", "northeast"],
  northeast: ["east"],
};

export function rateZone(from: Region, to: Region): RateZone {
  if (to === "northeast" && from !== "northeast") return "D";
  if (from === to) return "A";
  if (ADJACENT[from].includes(to)) return "B";
  return "C";
}

export const CATEGORY_VOLUME_FACTOR = { apparel: 1, electronics: 0.8, home: 3, personal_care: 0.6 } as const;

// ---- Pincodes (representative) ----
const P = (pin: string, city: string, state: string, region: Region, tier: Tier): Pincode => ({ pin, city, state, region, tier });
export const PINCODES: Pincode[] = [
  // West
  P("400001", "Mumbai", "Maharashtra", "west", "metro"), P("400053", "Mumbai (Andheri)", "Maharashtra", "west", "metro"),
  P("400601", "Thane", "Maharashtra", "west", "metro"), P("411001", "Pune", "Maharashtra", "west", "metro"),
  P("411045", "Pune (Baner)", "Maharashtra", "west", "metro"), P("440001", "Nagpur", "Maharashtra", "west", "tier2"),
  P("422001", "Nashik", "Maharashtra", "west", "tier2"), P("431001", "Aurangabad", "Maharashtra", "west", "tier2"),
  P("416001", "Kolhapur", "Maharashtra", "west", "tier3"), P("413001", "Solapur", "Maharashtra", "west", "tier3"),
  P("444001", "Akola", "Maharashtra", "west", "tier3"), P("380001", "Ahmedabad", "Gujarat", "west", "metro"),
  P("395001", "Surat", "Gujarat", "west", "tier2"), P("390001", "Vadodara", "Gujarat", "west", "tier2"),
  P("360001", "Rajkot", "Gujarat", "west", "tier2"), P("364001", "Bhavnagar", "Gujarat", "west", "tier3"),
  P("361001", "Jamnagar", "Gujarat", "west", "tier3"), P("403001", "Panaji", "Goa", "west", "tier2"),
  P("452001", "Indore", "Madhya Pradesh", "west", "tier2"), P("462001", "Bhopal", "Madhya Pradesh", "west", "tier2"),
  P("474001", "Gwalior", "Madhya Pradesh", "west", "tier3"), P("482001", "Jabalpur", "Madhya Pradesh", "west", "tier3"),
  P("456001", "Ujjain", "Madhya Pradesh", "west", "tier3"), P("492001", "Raipur", "Chhattisgarh", "west", "tier2"),
  P("495001", "Bilaspur", "Chhattisgarh", "west", "tier3"),
  // North
  P("110001", "New Delhi", "Delhi", "north", "metro"), P("110085", "Delhi (Rohini)", "Delhi", "north", "metro"),
  P("122001", "Gurugram", "Haryana", "north", "metro"), P("201301", "Noida", "Uttar Pradesh", "north", "metro"),
  P("201001", "Ghaziabad", "Uttar Pradesh", "north", "metro"), P("121001", "Faridabad", "Haryana", "north", "metro"),
  P("226001", "Lucknow", "Uttar Pradesh", "north", "tier2"), P("208001", "Kanpur", "Uttar Pradesh", "north", "tier2"),
  P("221001", "Varanasi", "Uttar Pradesh", "north", "tier2"), P("282001", "Agra", "Uttar Pradesh", "north", "tier2"),
  P("250001", "Meerut", "Uttar Pradesh", "north", "tier3"), P("211001", "Prayagraj", "Uttar Pradesh", "north", "tier3"),
  P("273001", "Gorakhpur", "Uttar Pradesh", "north", "tier3"), P("243001", "Bareilly", "Uttar Pradesh", "north", "tier3"),
  P("302001", "Jaipur", "Rajasthan", "north", "tier2"), P("342001", "Jodhpur", "Rajasthan", "north", "tier2"),
  P("313001", "Udaipur", "Rajasthan", "north", "tier3"), P("324001", "Kota", "Rajasthan", "north", "tier3"),
  P("334001", "Bikaner", "Rajasthan", "north", "tier3"), P("160017", "Chandigarh", "Chandigarh", "north", "tier2"),
  P("141001", "Ludhiana", "Punjab", "north", "tier2"), P("143001", "Amritsar", "Punjab", "north", "tier2"),
  P("144001", "Jalandhar", "Punjab", "north", "tier3"), P("151001", "Bathinda", "Punjab", "north", "tier3"),
  P("132001", "Karnal", "Haryana", "north", "tier3"), P("125001", "Hisar", "Haryana", "north", "tier3"),
  P("248001", "Dehradun", "Uttarakhand", "north", "tier2"), P("263001", "Haldwani", "Uttarakhand", "north", "tier3"),
  P("171001", "Shimla", "Himachal Pradesh", "north", "tier3"), P("180001", "Jammu", "Jammu & Kashmir", "north", "tier3"),
  P("190001", "Srinagar", "Jammu & Kashmir", "north", "tier3"),
  // South
  P("560001", "Bengaluru", "Karnataka", "south", "metro"), P("560066", "Bengaluru (Whitefield)", "Karnataka", "south", "metro"),
  P("560102", "Bengaluru (HSR)", "Karnataka", "south", "metro"), P("570001", "Mysuru", "Karnataka", "south", "tier2"),
  P("575001", "Mangaluru", "Karnataka", "south", "tier2"), P("580020", "Hubballi", "Karnataka", "south", "tier3"),
  P("590001", "Belagavi", "Karnataka", "south", "tier3"), P("585101", "Kalaburagi", "Karnataka", "south", "tier3"),
  P("600001", "Chennai", "Tamil Nadu", "south", "metro"), P("600096", "Chennai (Perungudi)", "Tamil Nadu", "south", "metro"),
  P("641001", "Coimbatore", "Tamil Nadu", "south", "tier2"), P("625001", "Madurai", "Tamil Nadu", "south", "tier2"),
  P("620001", "Tiruchirappalli", "Tamil Nadu", "south", "tier3"), P("636001", "Salem", "Tamil Nadu", "south", "tier3"),
  P("627001", "Tirunelveli", "Tamil Nadu", "south", "tier3"), P("500001", "Hyderabad", "Telangana", "south", "metro"),
  P("500081", "Hyderabad (Madhapur)", "Telangana", "south", "metro"), P("506001", "Warangal", "Telangana", "south", "tier3"),
  P("530001", "Visakhapatnam", "Andhra Pradesh", "south", "tier2"), P("520001", "Vijayawada", "Andhra Pradesh", "south", "tier2"),
  P("522001", "Guntur", "Andhra Pradesh", "south", "tier3"), P("517501", "Tirupati", "Andhra Pradesh", "south", "tier3"),
  P("518001", "Kurnool", "Andhra Pradesh", "south", "tier3"), P("682001", "Kochi", "Kerala", "south", "tier2"),
  P("695001", "Thiruvananthapuram", "Kerala", "south", "tier2"), P("673001", "Kozhikode", "Kerala", "south", "tier2"),
  P("680001", "Thrissur", "Kerala", "south", "tier3"), P("605001", "Puducherry", "Puducherry", "south", "tier3"),
  // East
  P("700001", "Kolkata", "West Bengal", "east", "metro"), P("700091", "Kolkata (Salt Lake)", "West Bengal", "east", "metro"),
  P("711101", "Howrah", "West Bengal", "east", "metro"), P("734001", "Siliguri", "West Bengal", "east", "tier2"),
  P("713101", "Bardhaman", "West Bengal", "east", "tier3"), P("721101", "Midnapore", "West Bengal", "east", "tier3"),
  P("751001", "Bhubaneswar", "Odisha", "east", "tier2"), P("753001", "Cuttack", "Odisha", "east", "tier2"),
  P("769001", "Rourkela", "Odisha", "east", "tier3"), P("760001", "Berhampur", "Odisha", "east", "tier3"),
  P("800001", "Patna", "Bihar", "east", "tier2"), P("823001", "Gaya", "Bihar", "east", "tier3"),
  P("842001", "Muzaffarpur", "Bihar", "east", "tier3"), P("812001", "Bhagalpur", "Bihar", "east", "tier3"),
  P("834001", "Ranchi", "Jharkhand", "east", "tier2"), P("831001", "Jamshedpur", "Jharkhand", "east", "tier2"),
  P("826001", "Dhanbad", "Jharkhand", "east", "tier3"),
  // North-East
  P("781001", "Guwahati", "Assam", "northeast", "tier2"), P("786001", "Dibrugarh", "Assam", "northeast", "tier3"),
  P("788001", "Silchar", "Assam", "northeast", "tier3"), P("793001", "Shillong", "Meghalaya", "northeast", "tier3"),
  P("795001", "Imphal", "Manipur", "northeast", "tier3"), P("799001", "Agartala", "Tripura", "northeast", "tier3"),
  P("797001", "Kohima", "Nagaland", "northeast", "tier3"), P("796001", "Aizawl", "Mizoram", "northeast", "tier3"),
  P("737101", "Gangtok", "Sikkim", "northeast", "tier3"), P("791111", "Itanagar", "Arunachal Pradesh", "northeast", "tier3"),
];
export const PINCODE_BY_PIN = Object.fromEntries(PINCODES.map((p) => [p.pin, p])) as Record<string, Pincode>;

// ---- Couriers (fictional carriers) ----
export const COURIERS: Courier[] = [
  {
    id: "CR-VAYU", name: "Vayu Express",
    rateCard: { A: { first500g: 89, addl500g: 34 }, B: { first500g: 109, addl500g: 42 }, C: { first500g: 129, addl500g: 52 }, D: { first500g: 169, addl500g: 68 } },
    codFeePct: 2.5, codFeeMin: 45, rtoChargePct: 100,
    slaDays: { A: 1, B: 2, C: 3, D: 5 }, baseRto: 0.06, coverage: 0.97,
    regionStrength: {}, slaHealth: 1, weight: 1, contractDoc: "courier-vayu-express",
  },
  {
    id: "CR-KAVERI", name: "Kaveri Logistics",
    rateCard: { A: { first500g: 36, addl500g: 15 }, B: { first500g: 45, addl500g: 19 }, C: { first500g: 55, addl500g: 23 }, D: { first500g: 79, addl500g: 33 } },
    codFeePct: 1.5, codFeeMin: 25, rtoChargePct: 100,
    slaDays: { A: 2, B: 3, C: 5, D: 8 }, baseRto: 0.13, coverage: 0.92,
    regionStrength: { northeast: 1.2 }, slaHealth: 1, weight: 1, contractDoc: "courier-kaveri-logistics",
  },
  {
    id: "CR-NORTHSTAR", name: "Northstar Couriers",
    rateCard: { A: { first500g: 44, addl500g: 18 }, B: { first500g: 54, addl500g: 22 }, C: { first500g: 66, addl500g: 27 }, D: { first500g: 96, addl500g: 40 } },
    codFeePct: 2.0, codFeeMin: 30, rtoChargePct: 80,
    slaDays: { A: 1, B: 3, C: 4, D: 6 }, baseRto: 0.09, coverage: 0.88,
    regionStrength: { north: 0.85, south: 1.25 }, slaHealth: 1, weight: 1, contractDoc: "courier-northstar-couriers",
  },
  {
    id: "CR-DAKSHIN", name: "Dakshin Parcel",
    rateCard: { A: { first500g: 40, addl500g: 16 }, B: { first500g: 52, addl500g: 21 }, C: { first500g: 70, addl500g: 29 }, D: { first500g: 99, addl500g: 42 } },
    codFeePct: 1.8, codFeeMin: 28, rtoChargePct: 90,
    slaDays: { A: 1, B: 2, C: 4, D: 7 }, baseRto: 0.08, coverage: 0.8,
    regionStrength: { south: 0.8, west: 0.95, north: 1.3, northeast: 1.4 }, slaHealth: 1, weight: 1, contractDoc: "courier-dakshin-parcel",
  },
];
export const COURIER_BY_ID = Object.fromEntries(COURIERS.map((c) => [c.id, c])) as Record<string, Courier>;

// ---- Suppliers (fictional) ----
export const SUPPLIERS: Supplier[] = [
  { id: "SUP-TIRUPUR", name: "Tirupur Knit Collective", city: "Tirupur", domestic: true, categories: ["apparel"], leadDaysMin: 8, leadDaysMax: 12, moq: 200, paymentTermsDays: 45, reliability: 0.93, priceBreaks: [{ qty: 1000, discountPct: 4 }, { qty: 3000, discountPct: 7 }], leadDrift: 0, contractDoc: "supplier-tirupur-knit" },
  { id: "SUP-SURAT", name: "Surat Weaves & Prints", city: "Surat", domestic: true, categories: ["apparel", "home"], leadDaysMin: 7, leadDaysMax: 11, moq: 150, paymentTermsDays: 30, reliability: 0.9, priceBreaks: [{ qty: 800, discountPct: 3 }, { qty: 2500, discountPct: 6 }], leadDrift: 0, contractDoc: "supplier-surat-weaves" },
  { id: "SUP-NOIDA", name: "Noida Electronics Assembly", city: "Noida", domestic: true, categories: ["electronics"], leadDaysMin: 10, leadDaysMax: 14, moq: 250, paymentTermsDays: 30, reliability: 0.88, priceBreaks: [{ qty: 1000, discountPct: 3 }, { qty: 5000, discountPct: 8 }], leadDrift: 0, contractDoc: "supplier-noida-electronics" },
  { id: "SUP-BADDI", name: "Baddi Personal Care Labs", city: "Baddi", domestic: true, categories: ["personal_care"], leadDaysMin: 7, leadDaysMax: 10, moq: 300, paymentTermsDays: 30, reliability: 0.95, priceBreaks: [{ qty: 2000, discountPct: 5 }], leadDrift: 0, contractDoc: "supplier-baddi-care" },
  { id: "SUP-SHENZHEN", name: "Shenzhen Brightpath Trading", city: "Shenzhen", domestic: false, categories: ["electronics", "home"], leadDaysMin: 28, leadDaysMax: 38, moq: 500, paymentTermsDays: 0, reliability: 0.82, priceBreaks: [{ qty: 2000, discountPct: 9 }, { qty: 5000, discountPct: 14 }], leadDrift: 0, contractDoc: "supplier-shenzhen-brightpath" },
  { id: "SUP-HCMC", name: "Saigon Homewares Export", city: "Ho Chi Minh City", domestic: false, categories: ["home", "apparel"], leadDaysMin: 32, leadDaysMax: 45, moq: 400, paymentTermsDays: 15, reliability: 0.85, priceBreaks: [{ qty: 1500, discountPct: 8 }, { qty: 4000, discountPct: 12 }], leadDrift: 0, contractDoc: "supplier-saigon-homewares" },
];
export const SUPPLIER_BY_ID = Object.fromEntries(SUPPLIERS.map((s) => [s.id, s])) as Record<string, Supplier>;

export const MARKETPLACES = [
  { id: "MP-KARTLY", name: "Kartly Marketplace", commissionPct: { apparel: 18, electronics: 8, home: 14, personal_care: 12 }, settlementDays: 14, returnWindowDays: 10, fixedFee: 12, doc: "marketplace-kartly-policy" },
  { id: "MP-NEXA", name: "Nexa Mall", commissionPct: { apparel: 20, electronics: 9, home: 15, personal_care: 13 }, settlementDays: 14, returnWindowDays: 7, fixedFee: 15, doc: "marketplace-nexa-policy" },
] as const;

// ---- Festival / sale calendar (history + simulated future) ----
export interface CalendarEvent {
  name: string;
  start: string;
  end: string;
  lift: Partial<Record<"apparel" | "electronics" | "home" | "personal_care" | "all", number>>;
  discountPct: number;
}
export const CALENDAR: CalendarEvent[] = [
  { name: "End of Season Sale", start: "2025-06-20", end: "2025-06-29", lift: { apparel: 1.9, all: 1.1 }, discountPct: 25 },
  { name: "Independence Day Sale", start: "2025-08-13", end: "2025-08-15", lift: { all: 1.6 }, discountPct: 15 },
  { name: "Big Billion Days", start: "2025-09-23", end: "2025-09-30", lift: { electronics: 3.4, apparel: 2.4, home: 2.2, personal_care: 1.6 }, discountPct: 22 },
  { name: "Diwali", start: "2025-10-13", end: "2025-10-21", lift: { home: 2.8, apparel: 2.1, electronics: 2.2, personal_care: 1.8 }, discountPct: 18 },
  { name: "Year End Sale", start: "2025-12-24", end: "2025-12-31", lift: { all: 1.35 }, discountPct: 12 },
  { name: "Republic Day Sale", start: "2026-01-23", end: "2026-01-26", lift: { all: 1.8, electronics: 2.1 }, discountPct: 18 },
  { name: "Holi", start: "2026-03-02", end: "2026-03-04", lift: { apparel: 1.4, personal_care: 1.3 }, discountPct: 8 },
  { name: "End of Season Sale", start: "2026-06-19", end: "2026-06-28", lift: { apparel: 1.9, all: 1.1 }, discountPct: 25 },
  { name: "Independence Day Sale", start: "2026-08-13", end: "2026-08-15", lift: { all: 1.6 }, discountPct: 15 },
  { name: "Big Billion Days", start: "2026-10-02", end: "2026-10-09", lift: { electronics: 3.4, apparel: 2.4, home: 2.2, personal_care: 1.6 }, discountPct: 22 },
  { name: "Diwali", start: "2026-10-31", end: "2026-11-08", lift: { home: 2.8, apparel: 2.1, electronics: 2.2, personal_care: 1.8 }, discountPct: 18 },
];

export const DOW_FACTOR = [1.3, 0.92, 0.9, 0.93, 0.97, 1.08, 1.25]; // Sun..Sat
// Evening peak 8-10pm, trough 3-5am
export const HOUR_CURVE = [
  0.018, 0.011, 0.007, 0.005, 0.005, 0.008, 0.015, 0.027, 0.036, 0.042, 0.046, 0.048,
  0.05, 0.051, 0.047, 0.044, 0.044, 0.047, 0.054, 0.063, 0.074, 0.078, 0.066, 0.034,
];

export function isMonsoon(month: number) {
  return month >= 6 && month <= 9; // Jun..Sep (1-indexed)
}
