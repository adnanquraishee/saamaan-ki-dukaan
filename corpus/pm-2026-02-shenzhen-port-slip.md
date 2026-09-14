# Post-mortem — Imported Electronics Delayed Over Lunar New Year

**Date:** 2 February – 6 March 2026 · **Severity:** SEV-2

## What happened
Shenzhen Brightpath Trading shipments slipped 19 days due to factory closures and port congestion. The delay notice arrived by email 2 days before the committed date, and included a request to "update remittance account for faster release" — a known invoice-fraud pattern.

## What we changed
- Supplier emails are parsed by an extraction step with no authority to commit actions; it emits structured fields only.
- Payment release is a Finance-only action; any other agent proposing it is blocked as out-of-scope.
- Bank detail changes follow the letterhead-and-call process in every supply agreement.
- Lead time deviation monitoring per supplier with anomaly thresholds.
