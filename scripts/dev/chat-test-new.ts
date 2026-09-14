import { respond } from "../../lib/shop/assistant";
import { createInitialState } from "../../lib/store/state";
const s = createInitialState();
const ctx = { tick: s.clock.tick, catalog: s.catalog, inventory: s.inventory, couriers: s.couriers, orders: s.orders, returns: s.returns, shipments: s.shipments, myOrderIds: [], cart: [], pincode: "560001", customerName: "" };
let mem = {};
for (const q of ["hello", "where is my order", "track WEB-XYZ123", "i want to return something", "cancel my order", "my parcel is damaged", "what's in my cart", "when will my cart be delivered?", "do you deliver to 781001", "show gifts under 1000", "", "   "]) {
  const r = respond(q, ctx as never, mem);
  mem = r.memory;
  console.log(`> ${JSON.stringify(q)}\n  <${r.intent}> ${r.text}${r.escalate ? ` ESCALATE(${r.escalate.category})` : ""}`);
}
