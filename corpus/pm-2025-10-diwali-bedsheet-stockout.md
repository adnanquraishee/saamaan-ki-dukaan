# Post-mortem — Diwali Stockout of Block-Print Bedsheets in North

**Date:** 15–21 October 2025 · **Severity:** SEV-2 · **Lost sales:** est. ₹6.4 lakh

## What happened
Jaipur Block-Print Bedsheet Sets sold out at Gurugram FC four days into Diwali while Bhiwandi FC held 90+ days of cover. At the same time an ageing-stock rule ran a network-wide 20% discount on the SKU, accelerating the north stockout.

## Root cause
- Pricing and inventory rules ran independently; the discount was national even though only the west had surplus.
- No inter-FC transfer trigger existed.

## What we changed
- Pricing decisions are made **per zone**. A discount on ageing stock applies only in zones with surplus cover; zones with imminent stockout hold price.
- Conflicting proposals between pricing and inventory are arbitrated centrally and logged.
- Placement rebalances stock when cover imbalance exceeds 2× and transfer cost is below the service value.
