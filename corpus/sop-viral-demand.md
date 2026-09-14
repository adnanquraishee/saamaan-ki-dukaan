# SOP — Viral Demand Spike

**Owner:** Demand planning · **Trigger:** a SKU's hourly or daily sales velocity exceeds 3× its 28-day baseline (z-score above 3) outside a planned sale event.

## Why this matters
Viral spikes from short-video platforms typically peak within 72 hours and decay with a half-life of roughly three days. The two classic failure modes are (a) stocking out during the peak and (b) over-ordering at the peak and holding months of dead stock after decay.

## Response steps
1. **Confirm the signal.** Check that orders come from multiple pincodes and customers, not a single buyer or a bot pattern.
2. **Ration gently with price.** A price increase of up to 10–15% is permitted to slow depletion while replenishment is arranged. Never raise above MRP.
3. **Redistribute stock** towards the regions driving the spike.
4. **Replenish against the decayed curve, not the peak.** Size purchase orders on expected demand across the lead time assuming exponential decay, not on peak-day velocity multiplied by lead time.
5. **Escalate large orders.** Viral purchase orders frequently exceed standard PO ceilings; any PO above the ceiling requires human approval, with the order split into an immediate tranche within the ceiling and a conditional second tranche.
6. **Review after 7 days** and cancel conditional tranches if velocity has decayed below 2× baseline.
