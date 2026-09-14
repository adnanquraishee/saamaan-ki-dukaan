# Post-mortem — Big Billion Days Carrier Capacity Collapse (East)

**Date:** 25–28 September 2025 · **Severity:** SEV-1 · **Impact:** 3,400 shipments delayed, 9% order cancellations in east zone

## What happened
Northstar Couriers accepted surge volume beyond its Kolkata hub capacity. Pickup misses at Gurugram FC cascaded into a 3-day backlog.

## Timeline
- 25 Sep 11:00 — delay ratio for Northstar crosses 1.8× SLA; no alert configured.
- 26 Sep 09:30 — customer complaints spike; manual re-routing begins.
- 28 Sep — backlog cleared via Vayu Express at a premium of ₹38 per shipment.

## What we changed
1. Anomaly detection on courier delay ratio per carrier (rolling z-score, isolation-forest thresholds).
2. SOP: de-weight failing carriers automatically within the premium ceiling; escalate beyond it.
3. Carrier capacity confirmations at T-7 before every festival.
