Market operation — AI documentation

# Market Operation (Market.ts)

Summary
- The `Market` operation automates selling excess minerals and balancing energy across your terminal network.
- It runs periodically and makes conservative, CPU- and credit-aware decisions about when and what to trade.

Primary responsibilities
- Sell non-energy resources from room terminals when there's demand (and sufficient quantity).
- Optionally balance energy across rooms' terminals by requesting/fulfilling transfers.
- Maintain a short price history in `Memory` to compute average prices over recent ticks.

Where the code lives
- `src/operations/Market.ts` — the full operation implementation and constants.

Key constants and configuration
- `RESOURCE_VALUE` — a baseline price map used as a fallback when no history is available.
- `TERMINAL_GOALS` — desired target amounts in terminals for certain resources.
- `MIN_CREDITS` — minimum credit balance to allow spending on outbound market activities.
- `CPU_BUCKET_MIN` — minimum CPU bucket required for the market loop to run.
- `ENERGY_BUY_LIMIT`, `ENERGY_DEAL_MIN`, `SELL_DEAL_AMOUNT` — thresholds controlling deal sizing and minimums.
- `ENERGY_COST_PER_UNIT` — conversion multiplier used when scoring deals (uses `Game.market.calcTransactionCost`).
- `PRICE_HISTORY_LENGTH` — how many recent prices are kept per resource in `Memory.marketPriceHistory`.
- `LOG_THROTTLE` — determines how often detailed logs are written to the console for this module.

High-level behavior
1. Early exit checks
   - The operation quits early if CPU bucket is below `CPU_BUCKET_MIN` or `Game.market.credits` is below `MIN_CREDITS`.
   - It also throttles certain per-room work to a schedule so it doesn't run every tick for every room.

2. Sell minerals
   - For each owned room that passes several checks (ownership, terminal & storage present, terminal not on cooldown, terminal energy >= 30000), iterate over all resources in the terminal.
   - Skip `RESOURCE_ENERGY` and `RESOURCE_POWER` for the main mineral-sell loop.
   - If a resource's available quantity in the terminal is below a conservative threshold (currently 10k), it is not sold.
   - The operation queries `Game.market.getAllOrders({ type: ORDER_BUY, resourceType })` to find buyers.
   - It selects a `bestOrder` using a heuristics-based profit calculation:
     - For each buyer order, compute `incoming = order.price * SELL_DEAL_AMOUNT`.
     - Compute `outcome = transactionCost * ENERGY_COST_PER_UNIT` where `transactionCost` is `Game.market.calcTransactionCost`.
     - The order with the highest `incoming - outcome` (net gain) is preferred.
   - If no profitable order is found but the room has a large stock (>30k) of the resource, the code will force-select the highest-price buyer and attempt a sale (fallback behavior).
   - Successful deals are recorded in `Memory.marketPriceHistory` using `recordPrice(resource, price)` and aggregated stats are logged.

3. Price history and averages
   - `recordPrice(resource, price)` appends the price to `Memory.marketPriceHistory[resource]` and keeps only the last `PRICE_HISTORY_LENGTH` entries.
   - `getAvgPrice(resource)` returns the average of stored prices or falls back to `RESOURCE_VALUE[resource]` when history is missing.

4. Network energy balancing (disabled by default)
   - There is a sketch for transferring energy between rooms when one room's terminal is low and another has excess.
   - This feature is currently gated / disabled by a conditional in the code and may be re-enabled or extended later.

Memory layout
- `Memory.marketPriceHistory` — an object keyed by resource name; each entry is an array of recent prices (number[]).
  Example:
  ```json
  Memory.marketPriceHistory = {
    "H": [0.4, 0.42, 0.39],
    "O": [0.2, 0.21]
  }
  ```
- Rooms may use `room.memory.nextTrade` to schedule when the room will be considered again for market operations.

Logging and debugging
- The module uses `marketLog()` (prefix `[Market <Game.time>]`) and occasional `console.log` lines.
- `LOG_THROTTLE` controls the frequency of detailed logs; set to `1` means logs may appear every tick (use caution).
- Key debug outputs include selected buyers, prices, net estimated gain, and summary statistics after selling.

Console / runtime checks
- Check market credits and CPU bucket:
  - `Game.market.credits`
  - `Game.cpu.bucket`
- Inspect price history for a resource:
  - `Memory.marketPriceHistory && Memory.marketPriceHistory.H` (replace `H` as needed)
- Force-record a sample price (for testing):
  ```js
  // in the Screeps console
  Memory.marketPriceHistory = Memory.marketPriceHistory || {};
  Memory.marketPriceHistory['H'] = Memory.marketPriceHistory['H'] || [];
  Memory.marketPriceHistory['H'].push(0.5);
  ```
- Trigger a one-off sell (manual test): create and place a buy order in another room or use an existing buyer; then ensure a room terminal has enough of the resource and `Game.market.deal` will be attempted when the operation runs.

Testing recommendations
- Start with a safe configuration:
  - Ensure `Game.market.credits` is well above `MIN_CREDITS`.
  - Make sure terminals you want to test have adequate energy (>=30k) and resources to sell.
- Monitor console logs and `Memory.marketPriceHistory` to ensure prices are recorded.
- Watch the `market summary` log produced by the operation to validate behavior across rooms.

Edge cases & known behaviors
- The operation does not trade `RESOURCE_ENERGY` or `RESOURCE_POWER` in the sell loop; energy balancing is separate.
- If `Game.market.getAllOrders` returns orders with missing `roomName` or insufficient remaining amount, those orders are filtered out.
- The profit computation assumes a conversion factor `ENERGY_COST_PER_UNIT` for transfer-energy; tune this constant if your server's energy costs differ.
- If there are no profitable buyers but the terminal stock is large, the operation will force a sell to the highest-price buyer — watch for suboptimal trades in that mode.

Potential improvements
- Make thresholds (e.g., terminal min energy, sell thresholds) configurable per-room via `roomconfigs/`.
- Add a conservative backoff when failed deals repeatedly occur to avoid repeated charge penalties.
- Add an adaptive pricing strategy that considers `Game.market.getHistory(resource)` in addition to the local `Memory.marketPriceHistory`.
- Re-enable or refine the network energy balancing logic to actively route energy between terminals when safe.

Change log / authorship
- This document was generated by an AI assistant based on `src/operations/Market.ts` on 2026-01-27.


