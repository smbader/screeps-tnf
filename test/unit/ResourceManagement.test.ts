import {
  MarketRoomInventory,
  PriceSample,
  getMaxAmountWithinReserves,
  getNetworkResourceReserve,
  getNetworkResourceStock,
  getNetworkResourceSurplus,
  getRecentMedianPrice,
  isSalePriceAcceptable
} from "../../src/utils/ResourceManagement";
import { assert } from "chai";

describe("resource management policy", () => {
  const rooms: MarketRoomInventory[] = [
    {
      hasStorage: true,
      hasTerminal: true,
      storage: { energy: 850000, H: 6000 },
      terminal: { energy: 40000, H: 3000 }
    },
    {
      hasStorage: true,
      hasTerminal: true,
      storage: { energy: 800000, H: 1000 },
      terminal: { energy: 30000, H: 2000 }
    }
  ];

  it("counts only market-accessible network stock and preserves room reserves", () => {
    assert.strictEqual(getNetworkResourceStock(rooms, "energy"), 1720000);
    assert.strictEqual(getNetworkResourceReserve(rooms, "energy"), 460000);
    assert.strictEqual(getNetworkResourceSurplus(rooms, "energy"), 1260000);
    assert.strictEqual(getNetworkResourceStock(rooms, "H"), 12000);
    assert.strictEqual(getNetworkResourceReserve(rooms, "H"), 4000);
    assert.strictEqual(getNetworkResourceSurplus(rooms, "H"), 8000);
  });

  it("does not reserve deposit resources that are configured for sale", () => {
    const depositStock: MarketRoomInventory[] = [
      {
        hasStorage: true,
        hasTerminal: true,
        storage: { biomass: 5000 },
        terminal: { biomass: 3000 }
      }
    ];

    assert.strictEqual(getNetworkResourceReserve(depositStock, "biomass"), 0);
    assert.strictEqual(getNetworkResourceSurplus(depositStock, "biomass"), 8000);
  });

  it("uses the median of recent days with actual market activity", () => {
    const history = [
      { date: "2026-10-22", transactions: 1, avgPrice: 200 },
      { date: "2026-10-23", transactions: 1, avgPrice: 100 },
      { date: "2026-10-25", transactions: 1, avgPrice: 1 },
      { date: "2026-10-26", transactions: 1, avgPrice: 4 },
      { date: "2026-10-27", transactions: 0, avgPrice: 100 },
      { date: "2026-10-28", transactions: 1, avgPrice: 3 },
      { date: "2026-10-29", transactions: 1, avgPrice: 2 },
      { date: "2026-10-30", transactions: 1, avgPrice: 5 }
    ];

    assert.strictEqual(getRecentMedianPrice(history), 3.5);
    assert.isNull(getRecentMedianPrice(history.slice(0, 2)));
  });

  it("defers pricing when market history is missing or malformed", () => {
    assert.isNull(getRecentMedianPrice(undefined));
    assert.isNull(getRecentMedianPrice(null));
    assert.isNull(getRecentMedianPrice([null] as unknown as PriceSample[]));
  });

  it("caps sale and transfer amounts at both resource and energy reserves", () => {
    const resourceLimit = getMaxAmountWithinReserves({
      resource: "H",
      availableResource: 5000,
      terminalResourceReserve: 2000,
      availableTerminalEnergy: 50000,
      terminalEnergyReserve: 30000,
      networkEnergySurplus: 1000,
      maxAmount: 5000,
      transactionCost: () => 10
    });
    assert.strictEqual(resourceLimit, 3000);

    const energyLimit = getMaxAmountWithinReserves({
      resource: "energy",
      availableResource: 60000,
      terminalResourceReserve: 50000,
      availableTerminalEnergy: 60000,
      terminalEnergyReserve: 50000,
      networkEnergySurplus: 800,
      maxAmount: 1000,
      transactionCost: amount => Math.ceil(amount / 10)
    });
    assert.strictEqual(energyLimit, 727);
  });

  it("requires the recent median price and positive net proceeds", () => {
    assert.isTrue(isSalePriceAcceptable(12, 10, 100, 10, 9));
    assert.isFalse(isSalePriceAcceptable(9, 10, 100, 10, 1));
    assert.isFalse(isSalePriceAcceptable(10, 10, 1, 2, 5));
  });
});
