# Post-mortem — Kumkumadi Glow Serum Went Viral

**Date:** 10–24 February 2026 · **Severity:** SEV-2 · **Impact:** 5-day stockout, then 140 days of excess cover

## What happened
A creator video drove a 10× spike for three days. The team first stocked out, then placed an order sized on peak velocity × lead time. Demand decayed with a ~3-day half-life; the PO landed into a market that had moved on.

## Lessons
1. Detect velocity anomalies hourly, not in the weekly review.
2. Ration gently with price (≤15%) while replenishment is in flight.
3. Size replenishment against the decay curve; split large POs into tranches and escalate above the PO ceiling.
4. Rebalance stock towards the regions driving the spike before buying more.
