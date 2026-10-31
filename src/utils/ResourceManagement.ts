export type MarketManagedResource = "energy" | "H" | "O" | "Z" | "K" | "U" | "L" | "X" | "power";

export interface MarketResourcePolicy {
  terminalTarget: number;
  terminalReserve: number;
  transferThreshold: number;
  maxTransfer: number;
}

export interface MarketRoomInventory {
  hasStorage: boolean;
  hasTerminal: boolean;
  storage: Partial<Record<MarketManagedResource, number>>;
  terminal: Partial<Record<MarketManagedResource, number>>;
}

export interface PriceSample {
  date: string;
  transactions: number;
  avgPrice: number;
}

export interface AmountReserveConstraints {
  resource: MarketManagedResource;
  availableResource: number;
  terminalResourceReserve: number;
  availableTerminalEnergy: number;
  terminalEnergyReserve: number;
  networkEnergySurplus: number;
  maxAmount: number;
  transactionCost: (amount: number) => number;
}

export const MARKET_MANAGED_RESOURCES: MarketManagedResource[] = ["energy", "H", "O", "Z", "K", "U", "L", "X", "power"];

export const ENERGY_STORAGE_RESERVE = 800000;
export const MARKET_STORAGE_ENERGY_RESERVE = 200000;
export const TERMINAL_ENERGY_RESERVE = 30000;
export const ENERGY_TERMINAL_TRANSFER_RESERVE = 50000;
export const RESOURCE_NETWORK_RESERVE = 2000;
export const RESOURCE_TERMINAL_RESERVE = 10000;
export const MARKET_CHECK_INTERVAL = 10;
export const MARKET_MAX_DEAL_AMOUNT = 1000;
export const MINIMUM_PRICE_HISTORY_DAYS = 3;
export const RECENT_PRICE_HISTORY_DAYS = 7;

export const MARKET_RESOURCE_POLICIES: Record<MarketManagedResource, MarketResourcePolicy> = {
  energy: {
    terminalTarget: 30000,
    terminalReserve: ENERGY_TERMINAL_TRANSFER_RESERVE,
    transferThreshold: ENERGY_TERMINAL_TRANSFER_RESERVE,
    maxTransfer: 5000
  },
  H: {
    terminalTarget: RESOURCE_NETWORK_RESERVE,
    terminalReserve: RESOURCE_TERMINAL_RESERVE,
    transferThreshold: RESOURCE_TERMINAL_RESERVE,
    maxTransfer: 2000
  },
  O: {
    terminalTarget: RESOURCE_NETWORK_RESERVE,
    terminalReserve: RESOURCE_TERMINAL_RESERVE,
    transferThreshold: RESOURCE_TERMINAL_RESERVE,
    maxTransfer: 2000
  },
  Z: {
    terminalTarget: RESOURCE_NETWORK_RESERVE,
    terminalReserve: RESOURCE_TERMINAL_RESERVE,
    transferThreshold: RESOURCE_TERMINAL_RESERVE,
    maxTransfer: 2000
  },
  K: {
    terminalTarget: RESOURCE_NETWORK_RESERVE,
    terminalReserve: RESOURCE_TERMINAL_RESERVE,
    transferThreshold: RESOURCE_TERMINAL_RESERVE,
    maxTransfer: 2000
  },
  U: {
    terminalTarget: RESOURCE_NETWORK_RESERVE,
    terminalReserve: RESOURCE_TERMINAL_RESERVE,
    transferThreshold: RESOURCE_TERMINAL_RESERVE,
    maxTransfer: 2000
  },
  L: {
    terminalTarget: RESOURCE_NETWORK_RESERVE,
    terminalReserve: RESOURCE_TERMINAL_RESERVE,
    transferThreshold: RESOURCE_TERMINAL_RESERVE,
    maxTransfer: 2000
  },
  X: {
    terminalTarget: RESOURCE_NETWORK_RESERVE,
    terminalReserve: RESOURCE_TERMINAL_RESERVE,
    transferThreshold: RESOURCE_TERMINAL_RESERVE,
    maxTransfer: 2000
  },
  power: {
    terminalTarget: RESOURCE_NETWORK_RESERVE,
    terminalReserve: RESOURCE_TERMINAL_RESERVE,
    transferThreshold: RESOURCE_TERMINAL_RESERVE,
    maxTransfer: 2000
  }
};

function isPriceSample(value: unknown): value is PriceSample {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const sample = value as Record<string, unknown>;
  return (
    typeof sample.date === "string" && typeof sample.transactions === "number" && typeof sample.avgPrice === "number"
  );
}

export function getNetworkResourceStock(
  rooms: readonly MarketRoomInventory[],
  resource: MarketManagedResource
): number {
  return rooms.reduce((total, room) => total + (room.storage[resource] || 0) + (room.terminal[resource] || 0), 0);
}

export function getNetworkResourceReserve(
  rooms: readonly MarketRoomInventory[],
  resource: MarketManagedResource
): number {
  if (resource === "energy") {
    return rooms.reduce(
      (total, room) =>
        total +
        (room.hasStorage ? MARKET_STORAGE_ENERGY_RESERVE : 0) +
        (room.hasTerminal ? TERMINAL_ENERGY_RESERVE : 0),
      0
    );
  }

  return rooms.filter(room => room.hasTerminal).length * RESOURCE_NETWORK_RESERVE;
}

export function getNetworkResourceSurplus(
  rooms: readonly MarketRoomInventory[],
  resource: MarketManagedResource
): number {
  return Math.max(0, getNetworkResourceStock(rooms, resource) - getNetworkResourceReserve(rooms, resource));
}

export function getRecentMedianPrice(
  history: readonly PriceSample[] | null | undefined,
  maxDays = RECENT_PRICE_HISTORY_DAYS,
  minSamples = MINIMUM_PRICE_HISTORY_DAYS
): number | null {
  if (!Array.isArray(history)) {
    return null;
  }

  const samples: unknown[] = history;
  const recentPrices = samples
    .filter(isPriceSample)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, maxDays)
    .filter(sample => sample.transactions > 0 && Number.isFinite(sample.avgPrice) && sample.avgPrice > 0)
    .map(sample => sample.avgPrice)
    .sort((left, right) => left - right);

  if (recentPrices.length < minSamples) {
    return null;
  }

  const middle = Math.floor(recentPrices.length / 2);
  if (recentPrices.length % 2 === 1) {
    return recentPrices[middle] ?? null;
  }
  const lower = recentPrices[middle - 1];
  const upper = recentPrices[middle];
  return lower !== undefined && upper !== undefined ? (lower + upper) / 2 : null;
}

export function getMaxAmountWithinReserves(constraints: AmountReserveConstraints): number {
  let low = 0;
  let high = Math.max(0, Math.floor(constraints.maxAmount));

  while (low < high) {
    const amount = Math.ceil((low + high) / 2);
    const transactionCost = constraints.transactionCost(amount);
    const energyConsumed = transactionCost + (constraints.resource === "energy" ? amount : 0);
    const resourceRemaining = constraints.availableResource - amount;
    const terminalEnergyRemaining =
      constraints.availableTerminalEnergy - transactionCost - (constraints.resource === "energy" ? amount : 0);
    const fitsReserves =
      Number.isFinite(transactionCost) &&
      transactionCost >= 0 &&
      resourceRemaining >= constraints.terminalResourceReserve &&
      terminalEnergyRemaining >= constraints.terminalEnergyReserve &&
      energyConsumed <= constraints.networkEnergySurplus;

    if (fitsReserves) {
      low = amount;
    } else {
      high = amount - 1;
    }
  }

  return low;
}

export function isSalePriceAcceptable(
  unitPrice: number,
  medianPrice: number,
  amount: number,
  transactionEnergyCost: number,
  energyUnitValue: number
): boolean {
  return (
    Number.isFinite(unitPrice) &&
    Number.isFinite(medianPrice) &&
    Number.isFinite(energyUnitValue) &&
    unitPrice >= medianPrice &&
    unitPrice * amount > transactionEnergyCost * energyUnitValue
  );
}
