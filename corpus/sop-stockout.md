# SOP — Imminent Stockout Response

**Owner:** Inventory planning · **Trigger:** projected days of cover for a SKU at any fulfilment centre falls below the replenishment lead time plus safety stock.

## Detection
A stockout risk exists when days of cover at a node is below the lead time of the fastest eligible supplier, or when network-wide cover falls under 7 days for an A-class SKU.

## Response steps
1. **Protect the constrained zone.** Do not run price promotions for the SKU in zones served by the constrained fulfilment centre. Promotions may continue in zones with surplus cover (over 45 days).
2. **Rebalance before buying.** If another fulfilment centre holds more than 30 days of cover, raise an inter-FC transfer sized to bring the constrained node to 14 days of cover, provided the source node keeps at least 21 days.
3. **Replenish.** Raise a purchase order with the fastest whitelisted supplier. Order up to lead-time demand plus safety stock, adjusted for expected restockable returns.
4. **Promise honestly.** Update the customer delivery promise to reflect the node that will actually ship. Do not show "in stock" for a zone that can only be served beyond 7 days.
5. **Escalate** to the category manager if the PO value exceeds the procurement agent's envelope or if the SKU will be out of stock network-wide for more than 3 days.

## Do not
- Do not cancel confirmed orders to protect stock for new orders.
- Do not raise prices by more than 15% as a demand-rationing measure without category manager approval.
