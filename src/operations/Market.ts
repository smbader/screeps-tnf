import {
  ENERGY_TERMINAL_TRANSFER_RESERVE,
  MARKET_CHECK_INTERVAL,
  MARKET_MANAGED_RESOURCES,
  MARKET_MAX_DEAL_AMOUNT,
  MARKET_RESOURCE_POLICIES,
  MARKET_STORAGE_ENERGY_RESERVE,
  TERMINAL_ENERGY_RESERVE,
  getMaxAmountWithinReserves,
  getNetworkResourceReserve,
  getNetworkResourceStock,
  getNetworkResourceSurplus,
  getRecentMedianPrice,
  isSalePriceAcceptable
} from "../utils/ResourceManagement";
import type { MarketManagedResource, MarketRoomInventory, PriceSample } from "../utils/ResourceManagement";
import { Operation } from "../classes/operation";
import type { RoomConfig } from "../roomconfigs/RoomConfig";

const CPU_BUCKET_MIN = 4000;
const MARKET_DEBUG = false;

interface OwnedRoomMarketState {
  room: Room;
  roomName: string;
  terminal: StructureTerminal | null;
  inventory: MarketRoomInventory;
}

function marketLog(message: string, roomName?: string): void {
  const prefix = `[Market ${Game.time}]`;
  if (roomName) {
    console.log(`${prefix} [${roomName}] ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

function marketDebugUpdate(updates: string[], roomNames: string[] = []): void {
  if (!MARKET_DEBUG) return;
  const roomUpdates = roomNames.map(roomName => {
    const details = updates
      .filter(update => update.startsWith(`${roomName}: `))
      .map(update => update.slice(roomName.length + 2));
    return `${roomName}: ${details.length > 0 ? details.join("; ") : "No transfer or sale was needed or eligible."}`;
  });
  const globalUpdates = updates.filter(update => !roomNames.some(roomName => update.startsWith(`${roomName}: `)));
  const summary = roomUpdates.concat(globalUpdates).join("\n");
  const report = summary || "No owned visible rooms; no transfer or sale was taken.";
  marketLog(`Tick update:\n${report}`);
}

function getStoredAmount(
  store: { getUsedCapacity: (resource?: ResourceConstant) => number | null },
  resource: MarketManagedResource
): number {
  return store.getUsedCapacity(resource) || 0;
}

function createRoomInventory(room: Room): OwnedRoomMarketState {
  const terminal = room.terminal && room.terminal.my ? room.terminal : null;
  const storageStock: Partial<Record<MarketManagedResource, number>> = {};
  const terminalStock: Partial<Record<MarketManagedResource, number>> = {};

  for (const resource of MARKET_MANAGED_RESOURCES) {
    storageStock[resource] = room.storage ? getStoredAmount(room.storage.store, resource) : 0;
    terminalStock[resource] = terminal ? getStoredAmount(terminal.store, resource) : 0;
  }

  return {
    room,
    roomName: room.name,
    terminal,
    inventory: {
      hasStorage: !!room.storage,
      hasTerminal: terminal !== null,
      storage: storageStock,
      terminal: terminalStock
    }
  };
}

function getUnknownOwnedRoomReserves(): MarketRoomInventory[] {
  const unseenRooms = Object.keys(Memory.rooms).filter(roomName => {
    const roomMemory = Memory.rooms[roomName] as RoomMemory & { config?: RoomConfig };
    return !Game.rooms[roomName] && roomMemory.config?.type === "owned" && roomMemory.config.shard === Game.shard.name;
  });

  return unseenRooms.map(() => ({
    hasStorage: true,
    hasTerminal: true,
    storage: {},
    terminal: {}
  }));
}

function getNetworkEnergySurplus(
  rooms: readonly OwnedRoomMarketState[],
  additionalReserves: readonly MarketRoomInventory[] = []
): number {
  return getNetworkResourceSurplus(rooms.map(room => room.inventory).concat(additionalReserves), "energy");
}

function getTransactionCost(amount: number, fromRoom: string, toRoom: string): number {
  return Game.market.calcTransactionCost(amount, fromRoom, toRoom);
}

function isPriceSample(sample: unknown): sample is PriceSample {
  if (typeof sample !== "object" || sample === null || Array.isArray(sample)) {
    return false;
  }
  const record = sample as Record<string, unknown>;
  return (
    typeof record.date === "string" && typeof record.transactions === "number" && typeof record.avgPrice === "number"
  );
}

function getPriceHistory(resource: MarketManagedResource, updates: string[]): PriceSample[] {
  let history: unknown;
  try {
    history = Game.market.getHistory(resource);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    marketLog(`Unable to read ${resource} price history; sales deferred: ${message}`);
    updates.push(`${resource} sale deferred: unable to read price history (${message})`);
    return [];
  }

  if (!Array.isArray(history)) {
    marketLog(`Market returned invalid ${resource} price history; sales deferred`);
    updates.push(`${resource} sale deferred: invalid price history`);
    return [];
  }

  const samples: unknown[] = history;
  return samples.filter(isPriceSample);
}

function sendToDeficits(rooms: OwnedRoomMarketState[], attemptedTerminals: Set<string>, updates: string[]): void {
  for (const resource of MARKET_MANAGED_RESOURCES) {
    const policy = MARKET_RESOURCE_POLICIES[resource];
    const recipients = rooms
      .filter(room => room.terminal && (room.inventory.terminal[resource] || 0) < policy.terminalTarget)
      .sort((left, right) => (left.inventory.terminal[resource] || 0) - (right.inventory.terminal[resource] || 0));

    for (const recipient of recipients) {
      if (!recipient.terminal) continue;

      const currentRecipientAmount = recipient.inventory.terminal[resource] || 0;
      const freeCapacity = recipient.terminal.store.getFreeCapacity(resource) || 0;
      const deficit = Math.min(policy.terminalTarget - currentRecipientAmount, freeCapacity);
      if (deficit <= 0) continue;

      const donors = rooms
        .filter(
          donor =>
            donor.roomName !== recipient.roomName &&
            donor.terminal &&
            !attemptedTerminals.has(donor.roomName) &&
            donor.terminal.cooldown === 0 &&
            (donor.inventory.terminal[resource] || 0) > policy.transferThreshold
        )
        .sort((left, right) => (right.inventory.terminal[resource] || 0) - (left.inventory.terminal[resource] || 0));

      for (const donor of donors) {
        if (!donor.terminal) continue;

        const donorAmount = donor.inventory.terminal[resource] || 0;
        const candidateAmount = Math.min(policy.maxTransfer, deficit, donorAmount - policy.terminalReserve);
        if (candidateAmount <= 0) continue;

        const energySurplus = getNetworkEnergySurplus(rooms);
        const terminalEnergyReserve =
          resource === "energy" ? ENERGY_TERMINAL_TRANSFER_RESERVE : TERMINAL_ENERGY_RESERVE;
        const amount = getMaxAmountWithinReserves({
          resource,
          availableResource: donorAmount,
          terminalResourceReserve: policy.terminalReserve,
          availableTerminalEnergy: donor.inventory.terminal.energy || 0,
          terminalEnergyReserve,
          networkEnergySurplus: energySurplus,
          maxAmount: candidateAmount,
          transactionCost: quantity => getTransactionCost(quantity, donor.roomName, recipient.roomName)
        });
        if (amount <= 0) continue;

        attemptedTerminals.add(donor.roomName);
        const transactionCost = getTransactionCost(amount, donor.roomName, recipient.roomName);
        const result = donor.terminal.send(resource, amount, recipient.roomName);
        if (result !== OK) {
          updates.push(`${donor.roomName}: transfer ${amount} ${resource} to ${recipient.roomName} failed (${result})`);
          marketLog(
            `Transfer failed: ${amount} ${resource} to ${recipient.roomName}; energy cost=${transactionCost}; result=${result}`,
            donor.roomName
          );
          break;
        }

        donor.inventory.terminal[resource] = donorAmount - amount;
        recipient.inventory.terminal[resource] = currentRecipientAmount + amount;
        donor.inventory.terminal.energy =
          (donor.inventory.terminal.energy || 0) - transactionCost - (resource === "energy" ? amount : 0);
        updates.push(
          `${donor.roomName}: transferred ${amount} ${resource} to ${recipient.roomName} (energy cost ${transactionCost})`
        );
        marketLog(
          `Transferred ${amount} ${resource} to ${recipient.roomName}; energy cost=${transactionCost}`,
          donor.roomName
        );
        break;
      }
    }
  }
}

function getOrders(resource: MarketManagedResource): Order[] {
  return Game.market
    .getAllOrders(order => order.type === ORDER_BUY && order.resourceType === resource)
    .filter(
      order =>
        order.active !== false &&
        order.remainingAmount > 0 &&
        !!order.roomName &&
        !Object.prototype.hasOwnProperty.call(Game.market.orders, order.id)
    )
    .sort((left, right) => right.price - left.price);
}

function trySellSurplus(
  rooms: OwnedRoomMarketState[],
  attemptedTerminals: Set<string>,
  additionalReserves: readonly MarketRoomInventory[],
  updates: string[]
): void {
  const medianPriceCache = new Map<MarketManagedResource, number | null>();
  const orderCache = new Map<MarketManagedResource, Order[]>();
  const deferred = new Map<string, number>();
  const noteDeferred = (reason: string): void => {
    deferred.set(reason, (deferred.get(reason) || 0) + 1);
  };
  const energyMedian = getRecentMedianPrice(getPriceHistory(RESOURCE_ENERGY, updates));
  medianPriceCache.set("energy", energyMedian);
  const energyInventories = rooms.map(room => room.inventory).concat(additionalReserves);
  updates.push(
    `Energy inventory: ${getNetworkResourceStock(energyInventories, "energy")} total, ` +
      `${getNetworkResourceReserve(energyInventories, "energy")} protected, ` +
      `${getNetworkResourceSurplus(energyInventories, "energy")} available above reserve`
  );

  for (const state of rooms) {
    const terminal = state.terminal;
    if (!terminal || terminal.cooldown > 0 || attemptedTerminals.has(state.roomName)) {
      continue;
    }

    for (const resource of MARKET_MANAGED_RESOURCES) {
      const policy = MARKET_RESOURCE_POLICIES[resource];
      const amountInTerminal = state.inventory.terminal[resource] || 0;
      if (amountInTerminal <= policy.transferThreshold) continue;

      const hasTerminalDeficit = rooms.some(
        room => room.terminal && (room.inventory.terminal[resource] || 0) < policy.terminalTarget
      );
      if (hasTerminalDeficit) {
        noteDeferred(`${resource}: terminal deficits`);
        continue;
      }

      if (
        resource === "energy" &&
        (!state.room.storage ||
          getStoredAmount(state.room.storage.store, RESOURCE_ENERGY) < MARKET_STORAGE_ENERGY_RESERVE)
      ) {
        noteDeferred(`${state.roomName}: protected storage energy reserve`);
        continue;
      }

      const networkSurplus = getNetworkResourceSurplus(
        rooms.map(room => room.inventory).concat(additionalReserves),
        resource
      );
      if (networkSurplus <= 0) {
        noteDeferred(`${resource}: network reserve`);
        continue;
      }

      let medianPrice = medianPriceCache.get(resource);
      if (medianPrice === undefined) {
        medianPrice = getRecentMedianPrice(getPriceHistory(resource, updates));
        medianPriceCache.set(resource, medianPrice);
      }
      if (medianPrice === null || energyMedian === null) {
        noteDeferred(`${resource}: insufficient recent price history`);
        continue;
      }

      let orders = orderCache.get(resource);
      if (!orders) {
        orders = getOrders(resource);
        orderCache.set(resource, orders);
      }
      if (orders.length === 0) {
        noteDeferred(`${resource}: no external buy orders`);
        continue;
      }

      let completedSale = false;
      let attemptedDeal = false;
      for (const order of orders) {
        const orderRoomName = order.roomName;
        if (!orderRoomName || order.price < medianPrice) continue;

        const maxAmount = Math.min(
          MARKET_MAX_DEAL_AMOUNT,
          order.remainingAmount,
          amountInTerminal - policy.terminalReserve,
          networkSurplus
        );
        const terminalEnergyReserve =
          resource === "energy" ? ENERGY_TERMINAL_TRANSFER_RESERVE : TERMINAL_ENERGY_RESERVE;
        const amount = getMaxAmountWithinReserves({
          resource,
          availableResource: amountInTerminal,
          terminalResourceReserve: policy.terminalReserve,
          availableTerminalEnergy: state.inventory.terminal.energy || 0,
          terminalEnergyReserve,
          networkEnergySurplus: getNetworkEnergySurplus(rooms, additionalReserves),
          maxAmount,
          transactionCost: quantity => getTransactionCost(quantity, state.roomName, orderRoomName)
        });
        if (amount <= 0) continue;

        const transactionEnergyCost = getTransactionCost(amount, state.roomName, orderRoomName);
        if (!isSalePriceAcceptable(order.price, medianPrice, amount, transactionEnergyCost, energyMedian)) {
          continue;
        }

        attemptedTerminals.add(state.roomName);
        attemptedDeal = true;
        const result = Game.market.deal(order.id, amount, state.roomName);
        if (result !== OK) {
          updates.push(`${state.roomName}: sale of ${amount} ${resource} at ${order.price} failed (${result})`);
          marketLog(
            `Sale failed: ${amount} ${resource} at ${order.price}; energy cost=${transactionEnergyCost}; result=${result}`,
            state.roomName
          );
          break;
        }

        state.inventory.terminal[resource] = amountInTerminal - amount;
        state.inventory.terminal.energy =
          (state.inventory.terminal.energy || 0) - transactionEnergyCost - (resource === "energy" ? amount : 0);
        const netCredits = order.price * amount - transactionEnergyCost * energyMedian;
        updates.push(
          `${state.roomName}: sold ${amount} ${resource} at ${order.price} (net ${netCredits.toFixed(2)} credits)`
        );
        marketLog(
          `Sold ${amount} ${resource} at ${
            order.price
          }; median=${medianPrice}; energy cost=${transactionEnergyCost}; net credits=${netCredits.toFixed(2)}`,
          state.roomName
        );
        completedSale = true;
        break;
      }

      if (!completedSale && !attemptedDeal) {
        noteDeferred(`${resource}: no order cleared price, reserve, and transaction-cost checks`);
      }
      if (attemptedTerminals.has(state.roomName)) break;
    }
  }

  if (deferred.size > 0 && Game.time % 100 === 0) {
    const summary = Array.from(deferred.entries())
      .map(([reason, count]) => `${reason} (${count})`)
      .join("; ");
    marketLog(`Deferred sale candidates: ${summary}`);
  }
  if (deferred.size > 0) {
    const summary = Array.from(deferred.entries())
      .map(([reason, count]) => `${reason} (${count})`)
      .join("; ");
    updates.push(`Sales deferred: ${summary}`);
  }
}

export class Market extends Operation {
  public constructor() {
    super();
  }

  public init(): void {
    return;
  }

  public roleCall(): void {
    return;
  }

  public actions(): void {
    if (Game.cpu.bucket < CPU_BUCKET_MIN) {
      if (Game.time % 100 === 0) {
        marketLog(`Skipping market work because CPU bucket is low (${Game.cpu.bucket})`);
      }
      marketDebugUpdate([`Skipped: CPU bucket ${Game.cpu.bucket} is below ${CPU_BUCKET_MIN}`]);
      return;
    }
    if (Game.time % MARKET_CHECK_INTERVAL !== 0) {
      marketDebugUpdate([
        `No market action this tick; next scheduled check in ${
          MARKET_CHECK_INTERVAL - (Game.time % MARKET_CHECK_INTERVAL)
        } ticks`
      ]);
      return;
    }

    const updates: string[] = [];
    const rooms = Object.values(Game.rooms)
      .filter(room => room.controller?.my)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(createRoomInventory);
    for (const state of rooms) {
      const storageEnergy = state.inventory.storage.energy || 0;
      const terminalEnergy = state.inventory.terminal.energy || 0;
      updates.push(
        `${state.roomName}: energy storage=${storageEnergy}, terminal=${terminalEnergy}, ` +
          `terminal cooldown=${state.terminal?.cooldown ?? "no terminal"}`
      );
    }
    const attemptedTerminals = new Set<string>();
    const additionalReserves = getUnknownOwnedRoomReserves();

    sendToDeficits(rooms, attemptedTerminals, updates);
    trySellSurplus(rooms, attemptedTerminals, additionalReserves, updates);
    marketDebugUpdate(
      updates,
      rooms.map(room => room.roomName)
    );
  }
}
