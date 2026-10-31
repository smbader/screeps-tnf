# Resource Management and Market Plan

## Goal

Keep owned rooms supplied for survival, spawning, construction, labs, and planned expansion; move stock where it is useful; sell only verified surplus at an acceptable net price. Market activity should be conservative, observable, and safe to resume after a global reset.

## Baseline findings before implementation

- [`Market.ts`](../src/operations/Market.ts) is registered as an operation and runs on a CPU-bucket gate. It currently only attempts terminal-to-terminal transfers. The code that would sell energy or minerals is commented out, and there is no active `Game.market.deal`, sell-order creation, or buy-order logic elsewhere in `src`.
- Market actions return when credits are below `100,000,000`, which also disables resource balancing even though the guard is described as restricting spending. Separate sale/balancing eligibility from purchase spending.
- The current balancing rules use terminal thresholds of 2,000/10,000 for other resources and 20,000/50,000 for energy, with a separate 30,000 terminal-energy gate and 50,000 storage-energy gate. These overlapping gates make the actual policy difficult to reason about. Transfer return codes are ignored, and a failed send can still be logged as successful.
- The module has unused sale, price-history, and transaction-cost constants/helpers (`SELL_DEAL_AMOUNT`, `RESOURCE_VALUE`, `ENERGY_COST_PER_UNIT`, and `recordPrice`). `Memory.marketPriceHistory` is untyped and has no active writer.
- Inventory decisions are largely local to each subsystem. [`EnergyManagement.ts`](../src/operations/EnergyManagement.ts) manages source/storage links; [`ConstructionCompany.ts`](../src/operations/ConstructionCompany.ts) gates some construction on storage energy; [`PowerHarvestOperation.ts`](../src/operations/PowerHarvestOperation.ts) deposits power into a terminal when possible; [`LabProcesses.ts`](../src/operations/LabProcesses.ts) processes power but does not coordinate market stock. There is no shared view of strategic reserves or surplus across these consumers.
- [`main.ts`](../src/main.ts) uses `RoomMemory.nextTrade` for other room scheduling, including power processing and construction checks. Do not reuse it for market scheduling; market cadence and per-resource state should have their own memory fields.

## Proposed policy

**Implementation status: Implemented.** The policy is in [`ResourceManagement.ts`](../src/utils/ResourceManagement.ts) and runs through [`Market.ts`](../src/operations/Market.ts). Energy, raw minerals (H/O/Z/K/U/L/X), power, and all four deposit resources (mist, biomass, metal, and silicon) are eligible for sale. Deposit resources have no protected market reserve or terminal target, so available stock is sold when market-history, buy-order, and transaction-cost checks pass. Compound resources remain ineligible.

### 1. Build one inventory and demand view

For each visible owned room, aggregate managed-resource stock in storage and terminal while retaining each terminal's location for capacity, cooldown, and transaction-cost checks. Labs, factories, power spawns, and other operational structures are excluded from marketable inventory and treated as committed stock. Unseen rooms with configured ownership contribute conservative reserves rather than being treated as empty.

Use explicit typed policy data for:

- **Reserve:** stock protected for ordinary operations (for example, room energy, lab reagents, power-spawn power/energy, and materials committed to a current operation).
- **Target:** desired amount available across the owned network.
- **Surplus:** stock above the target and reserve that can be redistributed or sold.
- **Maximum terminal stock:** a per-resource cap that avoids filling terminals with inventory that belongs in storage or should be sold.

Use resource-specific policies rather than assuming every non-energy resource is interchangeable. Energy targets 30,000 in each terminal, transfers only from above 50,000, keeps at least 50,000 in the sending terminal, and reserves 30,000 energy per terminal network-wide. The market protects 200,000 energy in each storage before selling; this is deliberately separate from the 800,000 upgrader-spawn threshold. Raw minerals and power target 2,000, transfer only from above 10,000, and retain at least 10,000 in the sending terminal. Deposit resources have zero target/reserve and are sold from terminal stock; GroundSupport moves existing storage stock to the terminal when it has capacity, and deposit miners unload to terminal first.

### 2. Apply decisions in a fixed priority order

1. Protect critical room energy and active operational commitments.
2. Satisfy known deficits by moving usable stock between owned terminals.
3. Keep a configured terminal energy reserve to pay transaction costs and support local terminal use.
4. Identify surplus only after network demand and reserves are accounted for.
5. Sell surplus only when the net proceeds are acceptable and the operation is safe to run.

Do not let a market action consume resources already assigned to room operation, lab production, power processing, construction, or a configured mission.

### 3. Start with conservative instant sales

Sales use existing buy orders and `Game.market.deal`, not persistent sell orders. The market runs every 10 ticks when the CPU bucket is at least 4,000. For each eligible surplus resource:

- Require at least three days of recent market activity within the latest seven days; use the median daily average price as the floor.
- Find active buy orders at or above that median and calculate the transaction energy cost from the selected terminal.
- Require positive net credits after valuing transaction energy at the recent median energy price.
- Cap the amount by network surplus, order remaining amount, the sending terminal's protected stock, and affordable transaction energy.
- Execute at most one successful terminal market action per terminal cooldown; check and log every Screeps return code.
- If no order meets the floor or market history is missing/invalid, leave stock untouched and report deferred candidates periodically. Do not race to the lowest price or sell at any price just to clear inventory.

Credit balance does not gate sales or internal balancing; it should only gate a future purchase implementation.

### 4. Balance before sale

Choose recipients by measured deficit against their target, not by room iteration order. Transfer only the amount needed to close that deficit, within the sender's reserve and network energy surplus. Account for terminal cooldown and transaction cost, and update the in-memory inventory view after a successful action so later decisions in the same tick do not spend the same stock twice. Rebalance deficits before considering sales.

If a resource is surplus network-wide, evaluate the highest-priced eligible buy orders against transaction energy cost. If the receiver or market action fails, report the error and do not mark the resource as balanced or sold.

### 5. Separate market control from room-operation scheduling

Use the typed market policy and `Game.market.getHistory` rather than custom persistent price memory. The unused `marketPriceHistory` field was removed. Use explicit intervals and CPU gates; do not make a sale dependent on a room's unrelated `nextTrade` timer.

Keep the market operation early enough in the action phase to run reliably, but ensure a low CPU bucket skips discretionary market work without delaying critical room operations. Log a compact decision record: room, resource, amount, action, expected net price/transaction cost, and result code. Avoid per-tick logs for unchanged inventory.

## Implementation sequence and status

1. **Balancing and typed policy — complete:** check API results; count one attempted action per sending terminal per market pass; apply energy and resource reserves.
2. **Inventory and reserve accounting — complete:** aggregate storage and terminal stock across visible owned rooms, add reserves for remembered unseen owned rooms, and use pure helper functions for surplus and amount limits.
3. **Conservative sales — complete:** sell energy, raw minerals, power, and deposit resources from terminals only when network surplus, order-book, recent-median, and transaction-cost checks pass. Energy storage reserve is 200,000 per room, separate from the larger upgrader-spawn threshold; debug output reports network energy inventory, protected reserve, and available surplus.
4. **Expansion by evidence — deferred:** add new resources only when their production/consumption and reserve rules are understood.
5. **Persistent sell orders or purchasing — deferred:** these need separate order reconciliation, stale-order cleanup, credit budgets, and monitoring.

## Acceptance criteria

- Critical energy and configured reserves are never sold or transferred below policy.
- A resource is sold only when aggregate owned-room stock exceeds reserves and known demand.
- Sale sizing accounts for available stock, order volume, terminal cooldown, and transaction energy.
- No deal or transfer is logged as successful unless the Screeps API returns `OK`.
- Insufficient credits disable purchases only; CPU or safety gates may independently defer market activity.
- Unit tests cover aggregate reserves, recent median selection, sale price floors, transaction-cost limits, and reserve-preserving amount caps.
- Runtime logs and memory provide enough information to explain why surplus was kept, moved, or sold.
