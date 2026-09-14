import { produce } from "immer";
import { runCycleSync } from "../../lib/engine/cycleSync";
import { extractOffline } from "../../lib/engine/offlineExtract";
import { createInitialState } from "../../lib/store/state";
let s = createInitialState();
for (let i = 0; i < 240; i++) { s = runCycleSync(s); s = produce(s, (d) => extractOffline(d)); }
let nan = 0, neg = 0;
for (const r of Object.values(s.inventory)) for (const v of Object.values(r)) { if (!Number.isFinite(v)) nan++; if (v < 0) neg++; }
const sh = s.orders.filter((o) => o.sourcing);
console.log({ nan, neg, split: sh.filter((o) => o.sourcing!.split).length, homeOut: sh.filter((o) => !o.sourcing!.homeHadStock).length, xfers: s.transfers.map((t) => `${t.from}->${t.to}`) });
