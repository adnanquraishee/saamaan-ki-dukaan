import type { OrderStatus, ReturnStatus } from "@/lib/types";

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: string }> = {
  placed: { label: "Placed · agents allocating", tone: "bg-sky-100 text-sky-800" },
  allocated: { label: "Allocated", tone: "bg-sky-100 text-sky-800" },
  shipped: { label: "Shipped", tone: "bg-indigo-100 text-indigo-800" },
  delivered: { label: "Delivered", tone: "bg-emerald-100 text-emerald-800" },
  rto: { label: "Returned to origin", tone: "bg-stone-200 text-stone-700" },
  returned: { label: "Returned", tone: "bg-stone-200 text-stone-700" },
  backordered: { label: "Backordered · awaiting stock", tone: "bg-amber-100 text-amber-800" },
  cancelled: { label: "Cancelled", tone: "bg-red-100 text-red-800" },
};

export const RETURN_STATUS: Record<ReturnStatus, { label: string; tone: string }> = {
  requested: { label: "Return requested", tone: "bg-sky-100 text-sky-800" },
  inspecting: { label: "Pickup scheduled · inspection", tone: "bg-indigo-100 text-indigo-800" },
  restocked: { label: "Refunded", tone: "bg-emerald-100 text-emerald-800" },
  liquidated: { label: "Refunded", tone: "bg-emerald-100 text-emerald-800" },
  refunded: { label: "Refunded", tone: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Return declined", tone: "bg-red-100 text-red-800" },
  escalated: { label: "Under manual review", tone: "bg-amber-100 text-amber-800" },
};
