export function StockBadge({ stock, days }: { stock: number; days: number | null }) {
  if (stock <= 0) return <span className="text-xs font-medium text-red-700">Out of stock</span>;
  return (
    <span className="text-xs text-stone-600">
      {stock < 15 ? <span className="font-medium text-shop-clay">Only {stock} left · </span> : null}
      {days && Number.isFinite(days) ? `Delivery in ${days} day${days > 1 ? "s" : ""}` : "Not deliverable to this pincode"}
    </span>
  );
}
