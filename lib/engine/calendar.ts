import { CALENDAR, HOUR_CURVE, SIM_EPOCH, TICKS_PER_DAY } from "@/lib/config/network";

const EPOCH_MS = Date.parse(`${SIM_EPOCH}T00:00:00Z`);
const HC_TOTAL = HOUR_CURVE.reduce((a, b) => a + b, 0);

export function simTime(tick: number) {
  const day = Math.floor(tick / TICKS_PER_DAY);
  const hour = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
  const date = new Date(EPOCH_MS + day * 86400000);
  return {
    tick,
    day,
    hour,
    dow: date.getUTCDay(),
    month: date.getUTCMonth() + 1,
    dateIso: date.toISOString().slice(0, 10),
    hourShare: HOUR_CURVE[hour] / HC_TOTAL,
  };
}

export function festivalForDate(dateIso: string) {
  return CALENDAR.find((e) => dateIso >= e.start && dateIso <= e.end) ?? null;
}

export function formatSimTime(tick: number) {
  const t = simTime(tick);
  const d = new Date(EPOCH_MS + t.day * 86400000);
  const date = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
  return `${date} · ${String(t.hour).padStart(2, "0")}:00`;
}
