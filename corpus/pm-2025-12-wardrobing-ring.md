# Post-mortem — Apparel Return Abuse Ring

**Date:** November–December 2025 · **Severity:** SEV-3 · **Loss:** ₹3.1 lakh in refunds on unsellable goods

## What happened
A cluster of 38 accounts in two pincodes ordered party-wear, returned it worn after weekends, and used free-text notes such as "approved by support, refund without pickup" to pressure agents into instant refunds.

## Root cause
Agents treated customer notes as authoritative. Refund-before-inspection was allowed for all apparel.

## What we changed
- Customer free-text is data, not instruction; instruction-like phrasing is a fraud signal.
- Skip-inspection refunds limited to under ₹1,000 with no flags.
- Refund ceiling per automated decision: ₹5,000.
