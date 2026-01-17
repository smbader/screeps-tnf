import { Operation } from "../classes/operation";

export const RESOURCE_VALUE = {
    energy: 9.5,
    H: 1,
    O: 1,
    Z: 1,
    K: 1,
    U: 1,
    L: 1,
    X: 1,
};

export const TERMINAL_GOALS = {
    energy: 35000,
    H: 2000,
    O: 2000,
    Z: 2000,
    K: 2000,
    U: 2000,
    L: 2000,
    X: 2000,
};

const MIN_CREDITS = 100000000;
const CPU_BUCKET_MIN = 4000;
const ENERGY_BUY_LIMIT = 20000;
const ENERGY_DEAL_MIN = 5000;
const SELL_DEAL_AMOUNT = 1000;
const ENERGY_COST_PER_UNIT = 15;
const PRICE_HISTORY_LENGTH = 20; // number of ticks to average

// Throttle console logs so we don't spam the console every tick
const LOG_THROTTLE = 1; // only emit detailed logs every N ticks

function marketLog(message: string, roomName?: string) {
    const prefix = `[Market ${Game.time}]`;
    if (roomName) {
        console.log(`${prefix} [${roomName}] ${message}`);
    } else {
        console.log(`${prefix} ${message}`);
    }
}

function recordPrice(resource: string, price: number) {
    if (!Memory.marketPriceHistory) Memory.marketPriceHistory = {};
    if (!Memory.marketPriceHistory[resource]) Memory.marketPriceHistory[resource] = [];
    Memory.marketPriceHistory[resource].push(price);
    // Only keep the last N entries
    if (Memory.marketPriceHistory[resource].length > PRICE_HISTORY_LENGTH) {
        Memory.marketPriceHistory[resource].shift();
    }
}

function getAvgPrice(resource: string): number {
    if (!Memory.marketPriceHistory || !Memory.marketPriceHistory[resource]) { // @ts-ignore
        return RESOURCE_VALUE[resource] || 1;
    }
    const arr = Memory.marketPriceHistory[resource];
    if (!arr.length) { // @ts-ignore
        return RESOURCE_VALUE[resource] || 1;
    }
    return arr.reduce(function (a: any, b: any) {
        return a + b;
    }, 0) / arr.length;
}

export class Market extends Operation {

    public constructor() {
        super();
    }

    public init() { }

    public roleCall() { }

    public actions() {
        if (Game.cpu.bucket < CPU_BUCKET_MIN) {
            if (Game.time % 100 === 0) marketLog('No market, CPU Bucket low: ' + Game.cpu.bucket);
            return;
        }
        if (Game.market.credits < MIN_CREDITS) {
            if (Game.time % 100 === 0) marketLog('No more spending, credit reserve limit. credits=' + Game.market.credits);
            return;
        }

        //if (Game.time % LOG_THROTTLE === 0) marketLog('Running market actions');

        // Aggregate stats for better visibility
        const stats = {
            totalRooms: 0,
            processedRooms: 0,
            skippedRooms: 0,
            skipReasons: {} as Record<string, number>,
            deals: 0,
            failedDeals: 0,
            revenue: 0,
        };
        function addSkip(reason: string) {
            stats.skippedRooms++;
            stats.skipReasons[reason] = (stats.skipReasons[reason] || 0) + 1;
        }

        // --- SELL MINERALS ---
        for (const room of Object.values(Game.rooms)) {
            stats.totalRooms++;
            // Log quick reason when throttled if we skip rooms
            const owner = room.controller?.owner?.username;
            if (owner !== "ricane") {
                addSkip('owner');
                //if (Game.time % LOG_THROTTLE === 0) marketLog(`skipped: owner=${owner || 'none'}`, room.name);
                continue;
            }

            const nextTrade = room.memory.nextTrade || 0;
            if ((nextTrade - Game.time) % 15 !== 0) {
                addSkip('schedule');
                //if (Game.time % LOG_THROTTLE === 0) marketLog(`skipped: nextTrade schedule nextTrade=${(nextTrade - Game.time) % 15}`, room.name);
                continue;
            }

            if (!(room.storage && room.terminal)) {
                addSkip('no-terminal');
                //if (Game.time % LOG_THROTTLE === 0) marketLog('skipped: missing storage or terminal', room.name);
                continue;
            }

            if (room.terminal.cooldown > 0) {
                addSkip('terminal-cooldown');
                //if (Game.time % LOG_THROTTLE === 0) marketLog(`skipped: terminal cooldown ${room.terminal.cooldown}`, room.name);
                continue;
            }

            const totalEnergy = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
            if (totalEnergy < 30000) {
                addSkip('low-energy');
                //if (Game.time % LOG_THROTTLE === 0) marketLog(`skipped: terminal energy too low (${totalEnergy})`, room.name);
                continue;
            }

            stats.processedRooms++;
            //if (Game.time % LOG_THROTTLE === 0) marketLog(`processing: terminalEnergy=${totalEnergy}, terminalFree=${room.terminal.store.getFreeCapacity()}, storageFree=${room.storage.store.getFreeCapacity()}`, room.name);

            for (const resourceType of RESOURCES_ALL as ResourceConstant[]) {
                if (resourceType === RESOURCE_ENERGY || resourceType === RESOURCE_POWER) continue;
                const quantity = room.terminal.store.getUsedCapacity(resourceType);
                if (quantity <= 10000) {
                    if (Game.time % LOG_THROTTLE === 0 && quantity > 0) marketLog(`resource ${resourceType} quantity ${quantity} below sell threshold`, room.name);
                    // track as a resource-level skip for visibility
                    if (quantity > 0) stats.skipReasons[`resource-low-${resourceType}`] = (stats.skipReasons[`resource-low-${resourceType}`] || 0) + 1;
                    continue;
                }

                let doNotSell = false;
                // (Optional: implement internal transfer here)
                if (doNotSell) continue;

                let bestOrder: Order | undefined;
                let highestGain = 0;
                const orders = Game.market.getAllOrders({ type: ORDER_BUY, resourceType });
                for (const order of orders) {
                    if (!order.roomName || order.remainingAmount < SELL_DEAL_AMOUNT) continue;
                    const incoming = order.price * SELL_DEAL_AMOUNT;
                    const outcome = Game.market.calcTransactionCost(SELL_DEAL_AMOUNT, room.name, order.roomName) * ENERGY_COST_PER_UNIT;
                    const gain = incoming - outcome;
                    if (gain > highestGain) {
                        highestGain = gain;
                        bestOrder = order;
                    }
                }

                // If there's a profitable bestOrder, or if we have >30k of this resource, attempt a sale.
                if (!bestOrder && quantity > 30000) {
                    // pick the highest-price buyer with enough remaining amount
                    for (const o of orders) {
                        if (!o.roomName || o.remainingAmount < SELL_DEAL_AMOUNT) continue;
                        if (!bestOrder || o.price > bestOrder.price) bestOrder = o;
                    }
                    if (Game.time % LOG_THROTTLE === 0) marketLog(`no profitable order found for ${resourceType}; forcing selection because qty=${quantity}`, room.name);
                }

                if (bestOrder) {
                    if (Game.time % LOG_THROTTLE === 0) marketLog(`selected buyer ${bestOrder.roomName} price=${bestOrder.price.toFixed(3)} remaining=${bestOrder.remainingAmount} estimatedGain=${highestGain.toFixed(2)}`, room.name);
                    // Ensure TypeScript knows roomName is present (we filtered orders earlier for roomName)
                    if (!bestOrder.roomName) {
                        if (Game.time % LOG_THROTTLE === 0) marketLog(`skipping bestOrder with no roomName`, room.name);
                        continue;
                    }
                    const buyerRoom = bestOrder.roomName as string;
                    const amount = Math.min(bestOrder.remainingAmount, SELL_DEAL_AMOUNT, quantity);
                    // compute estimated profit and record price history
                    const transferCost = Game.market.calcTransactionCost(amount, room.name, buyerRoom) * ENERGY_COST_PER_UNIT;
                    const incoming = bestOrder.price * amount;
                    const net = incoming - transferCost;
                    recordPrice(resourceType, bestOrder.price);
                    const outcome = Game.market.deal(bestOrder.id, amount, room.name);
                    if (outcome === OK) {
                        stats.deals++;
                        stats.revenue += net;
                        marketLog(`sold ${amount} ${resourceType} to ${bestOrder.roomName} @${bestOrder.price.toFixed(3)} net=${net.toFixed(2)}`, room.name);
                        console.log(`[${room.name}] sold ${amount} ${resourceType} to ${bestOrder.roomName}, price: ${bestOrder.price.toFixed(3)}, outcome: ${outcome}`);
                    } else {
                        stats.failedDeals++;
                        // Log forced sale attempts separately
                        if (quantity > 3000) {
                            marketLog(`forced-sell attempt ${amount} ${resourceType} to ${bestOrder?.roomName || 'unknown'}, price: ${bestOrder?.price?.toFixed?.(3) || 'n/a'}, outcome: ${outcome}`, room.name);
                        }
                    }
                } else {
                    if (Game.time % LOG_THROTTLE === 0) marketLog(`no buyer found for ${resourceType} (qty=${quantity})`, room.name);
                    stats.skipReasons[`no-buyer-${resourceType}`] = (stats.skipReasons[`no-buyer-${resourceType}`] || 0) + 1;
                }
             }
         }

        // Summary log for SELL MINERALS
        if (Game.time % LOG_THROTTLE === 0 && stats.deals > 0) {
            const reasonEntries = Object.entries(stats.skipReasons).map(([k, v]) => `${k}:${v}`).join(', ');
            marketLog(`market summary rooms=${stats.totalRooms} processed=${stats.processedRooms} skipped=${stats.skippedRooms} deals=${stats.deals} failed=${stats.failedDeals} netRevenue=${stats.revenue.toFixed(2)} skips=${reasonEntries}`);
        }


         // --- NETWORK BALANCE ENERGY ---
        for (const room of Object.values(Game.rooms)) {
            if (room.controller?.owner?.username !== "ricane") continue;
            if (!room.memory.data.terminal) room.memory.data.terminal = { energy: 0 };
            if (Game.time % 20 !== 0) continue;
            if (!room.terminal || room.terminal.cooldown > 0) continue;

            if (1 == 1) { continue; } // Disable for now

            const totalEnergy = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
            room.memory.data.terminal.energy = totalEnergy;

            if (totalEnergy < 30000) {
                for (const otherRoom of Object.values(Game.rooms)) {
                    if (
                        otherRoom === room ||
                        !otherRoom.terminal ||
                        !otherRoom.memory.data.terminal ||
                        otherRoom.terminal.cooldown > 0 ||
                        otherRoom.controller?.owner?.username !== "ricane"
                    ) continue;
                    if (otherRoom.memory.data.terminal.energy > 30000) {
                        console.log(`[${room.name}] Requesting 1000 Energy from ${otherRoom.name}: ${otherRoom.terminal.send(RESOURCE_ENERGY, 1000, room.name)}`);
                    }
                }
            } /* else if (room.name == 'E31N1' || false) { // || room.name == 'W4N1') {
                for (const otherRoom of Object.values(Game.rooms)) {
                    if (
                        otherRoom === room ||
                        !otherRoom.terminal ||
                        !otherRoom.memory.data.terminal ||
                        otherRoom.terminal.cooldown > 0 ||
                        otherRoom.controller?.owner?.username !== "ricane"
                    ) continue;
                    if (otherRoom.memory.data.terminal.energy > 20000 && room.terminal.store.getFreeCapacity() > 10000) {
                        console.log(`[${room.name}] Requesting 3000 Energy from ${otherRoom.name}: ${otherRoom.terminal.send(RESOURCE_ENERGY, 3000, room.name)}`);
                    }
                }
            }*/

        }
    }
}
