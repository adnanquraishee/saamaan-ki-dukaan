import { createInitialState } from "../../lib/store/state";
import { planFulfilment, warehousesByProximity } from "../../lib/ml/routing";
import { bestCourierOption } from "../../lib/agents/courier";
import { PINCODE_BY_PIN } from "../../lib/config/network";
const s = createInitialState();
const cat = Object.fromEntries(s.catalog.map((p) => [p.sku, p]));
const pin = PINCODE_BY_PIN["781001"]; // Guwahati
const sku = "ELE-001";
const order = { lines: [{ sku, qty: 8, price: cat[sku].zonePrice.northeast }, { sku: "APP-001", qty: 1, price: cat["APP-001"].zonePrice.northeast }], pincode: pin.pin, region: pin.region, tier: pin.tier, paymentMode: "prepaid" as const, value: 0, firstTime: false };
order.value = order.lines.reduce((a, l) => a + l.price * l.qty, 0);
console.log("proximity", warehousesByProximity(order), "stock", s.inventory[sku], s.inventory["APP-001"]);
console.log(JSON.stringify(planFulfilment(order, cat, s.inventory, s.couriers, bestCourierOption)?.map((l) => ({ wh: l.warehouseId, courier: l.courierId, lines: l.lines.map((x) => `${x.qty}x${x.sku}`), sla: l.slaDays }))));
