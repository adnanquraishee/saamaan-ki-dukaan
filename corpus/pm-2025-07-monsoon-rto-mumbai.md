# Post-mortem — Monsoon RTO Spike, Mumbai & Thane

**Date:** 8–19 July 2025 · **Severity:** SEV-3 · **Impact:** RTO rate rose from 13% to 24% for west zone COD

## What happened
Heavy rain and waterlogging delayed last-mile attempts. Kaveri Logistics shipments exceeded SLA by 2–4 days; COD customers who had already bought elsewhere refused delivery.

## Root cause
Courier allocation was purely cheapest-rate. Delivery delay directly increases COD refusal probability, which the allocation ignored.

## What we changed
- Courier choice now minimises **expected** landed cost: forward charge + P(RTO) × (RTO charge + handling), not the rate card alone.
- IVR order confirmation for COD orders with high RTO risk.
- Force majeure clause invoked for penalty suspension only; re-routing still permitted.
