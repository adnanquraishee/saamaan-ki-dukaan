# Post-mortem — Kartly Settlement Short-Payment

**Date:** 3 March 2026 · **Severity:** SEV-3 · **Recovered:** ₹2.2 lakh

## What happened
Three consecutive Kartly settlements applied an unexplained "logistics adjustment" deduction and charged apparel commission on electronics orders. Nobody reconciled settlements line-by-line; the gap was found at month-end.

## What we changed
- Every settlement notice is reconciled against order records and the marketplace commission table at receipt.
- Unexplained deductions above ₹500 are disputed automatically within the 30-day window, citing the policy clause.
- Any figure extracted from a settlement notice must match internal order records before a dispute or payout action is committed.
