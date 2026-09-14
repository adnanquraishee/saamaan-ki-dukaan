# Post-mortem — Competitor Feed Misparse Priced Chinos at ₹99

**Date:** 21 June 2025 · **Duration:** 41 minutes · **Severity:** SEV-2 · **Loss:** ₹1.9 lakh contribution

## What happened
During End of Season Sale, the competitor price scraper picked up a hidden promotional banner on a rival listing that read "recommended retail price ₹99". The repricing rule matched the lowest observed competitor price and set Slim Fit Stretch Chinos to ₹99. 612 units sold before a category manager noticed.

## Root cause
- The scraper extracted text from elements hidden with CSS, including text never visible to shoppers.
- The pricing rule had a maximum-discount check but it was disabled for the sale window.
- There was no absolute floor tied to unit contribution.

## What we changed
1. **Margin floor is absolute** — no price may take contribution margin, after expected return cost, below the floor, in any sale window. It cannot be disabled by configuration.
2. Competitor pages are treated as untrusted input; instruction-like or hidden text is flagged.
3. Price changes above 15% run through a simulation gate before commit.
