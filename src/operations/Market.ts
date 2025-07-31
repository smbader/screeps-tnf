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
const ENERGY_BUY_LIMIT = 30000;
const ENERGY_DEAL_MIN = 10000;
const SELL_DEAL_AMOUNT = 1000;
const ENERGY_COST_PER_UNIT = 15;
const PRICE_HISTORY_LENGTH = 20; // number of ticks to average

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
            if (Game.time % 100 === 0) console.log('No market, CPU Bucket low: ' + Game.cpu.bucket);
            return;
        }
        if (Game.market.credits < MIN_CREDITS) {
            if (Game.time % 100 === 0) console.log('No more spending, credit reserve limit.');
            return;
        }

        // --- BUY ENERGY ---
        for (const room of Object.values(Game.rooms)) {
            if (room.controller?.owner?.username !== "ricane") continue;
            if (!(room.memory.nextTrade < Game.time)) continue;
            room.memory.nextTrade = Game.time + 250;

            if (!(room.storage && room.terminal)) continue;

            const totalEnergy = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) + room.storage.store.getUsedCapacity(RESOURCE_ENERGY);
            const terminalFree = room.terminal.store.getFreeCapacity();
            const storageFree = room.storage.store.getFreeCapacity();
            const maxBuy = Math.min(ENERGY_BUY_LIMIT, terminalFree, storageFree);

            if (!(totalEnergy < 300000 && storageFree > 20000 && terminalFree > 20000)) continue;
            if (maxBuy < 1000) continue; // avoid overbuying

            let bestOrder: Order | undefined;
            let bestExpense = Number.MAX_VALUE;
            const orders = Game.market.getAllOrders({type: ORDER_SELL, resourceType: RESOURCE_ENERGY});
            for (const order of orders) {
                if (!order.roomName || order.remainingAmount < 100) continue;
                const transferCost = Game.market.calcTransactionCost(100, room.name, order.roomName) / 100;
                const expense = order.price + transferCost * RESOURCE_VALUE.energy;
                if (expense < bestExpense) {
                    bestExpense = expense;
                    bestOrder = order;
                }
            }

            // --- Smarter price comparison ---
            const avgEnergyPrice = getAvgPrice(RESOURCE_ENERGY);
            if (bestOrder) {
                const amount = Math.min(bestOrder.remainingAmount, maxBuy, 30000);
                recordPrice(RESOURCE_ENERGY, bestOrder.price);
                if ((bestExpense <= avgEnergyPrice * 1.10) || totalEnergy < ENERGY_DEAL_MIN) {
                    // Only buy if expense is within 10% of our rolling average, or we're desperate
                    const outcome = Game.market.deal(bestOrder.id, amount, room.name);
                    console.log(`[${room.name}] bought ${amount} energy from ${bestOrder.roomName}, price: ${bestOrder.price.toFixed(3)}, avg: ${avgEnergyPrice.toFixed(3)}, outcome: ${outcome}`);
                } else if (Game.time % 100 === 0) {
                    console.log(`[${room.name}] NO ENERGY PURCHASE. price: ${bestOrder.price.toFixed(3)}, avg: ${avgEnergyPrice.toFixed(3)}`);
                }
            }
        }

        // --- BUY NEEDED RAW MINERALS ---
        for (const room of Object.values(Game.rooms)) {
            if (room.controller?.owner?.username !== "ricane") continue;
            if (!room.terminal || !room.storage) continue;

            for (const mineral of Object.keys(TERMINAL_GOALS) as ResourceConstant[]) {
                if (mineral === "energy") continue;
                // @ts-ignore
                const needed = TERMINAL_GOALS[mineral] - (
                    (room.storage.store.getUsedCapacity(mineral) || 0) +
                    (room.terminal.store.getUsedCapacity(mineral) || 0)
                );
                // Avoid overbuying: don't buy if not enough space, and only if missing significant amount
                const terminalFree = room.terminal.store.getFreeCapacity();
                const storageFree = room.storage.store.getFreeCapacity();
                const maxBuy = Math.min(needed, terminalFree, storageFree, 2000);
                if (maxBuy < 500) continue;

                let bestOrder: Order | undefined;
                let bestExpense = Number.MAX_VALUE;
                const orders = Game.market.getAllOrders({ type: ORDER_SELL, resourceType: mineral });
                for (const order of orders) {
                    if (!order.roomName || order.remainingAmount < 100) continue;
                    const transferCost = Game.market.calcTransactionCost(100, room.name, order.roomName) / 100;
                    // @ts-ignore
                    const expense = order.price + transferCost * (RESOURCE_VALUE[mineral] || 1);
                    if (expense < bestExpense) {
                        bestExpense = expense;
                        bestOrder = order;
                    }
                }

                // --- Smarter price comparison ---
                const avgMineralPrice = getAvgPrice(mineral);
                if (bestOrder && bestExpense <= avgMineralPrice * 1.15) {
                    // Buy if within 15% of rolling average for this mineral
                    const amount = Math.min(bestOrder.remainingAmount, maxBuy);
                    recordPrice(mineral, bestOrder.price);
                    const outcome = Game.market.deal(bestOrder.id, amount, room.name);
                    console.log(`[${room.name}] bought ${amount} ${mineral} from ${bestOrder.roomName}, price: ${bestOrder.price.toFixed(3)}, avg: ${avgMineralPrice.toFixed(3)}, outcome: ${outcome}`);
                }
            }
        }

        // --- SELL MINERALS ---
        for (const room of Object.values(Game.rooms)) {
            if (room.controller?.owner?.username !== "ricane") continue;
            if ((room.memory.nextTrade - Game.time) % 100 !== 0) continue;
            if (!(room.storage && room.terminal) || room.terminal.cooldown > 0) continue;

            const totalEnergy = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
            if (totalEnergy < 30000) continue;

            for (const resourceType of RESOURCES_ALL as ResourceConstant[]) {
                if (resourceType === RESOURCE_ENERGY || resourceType === RESOURCE_POWER) continue;
                const quantity = room.terminal.store.getUsedCapacity(resourceType);
                if (quantity <= 10000) continue;

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
                if (bestOrder) {
                    const amount = Math.min(bestOrder.remainingAmount, SELL_DEAL_AMOUNT, quantity);
                    recordPrice(resourceType, bestOrder.price);
                    const outcome = Game.market.deal(bestOrder.id, amount, room.name);
                    if (outcome === OK) {
                        console.log(`[${room.name}] sold ${amount} ${resourceType} to ${bestOrder.roomName}, price: ${bestOrder.price.toFixed(3)}, outcome: ${outcome}`);
                    }
                }
            }
        }

        // --- NETWORK BALANCE ENERGY ---
        for (const room of Object.values(Game.rooms)) {
            if (room.controller?.owner?.username !== "ricane") continue;
            if (!room.memory.data.terminal) room.memory.data.terminal = { energy: 0 };
            if (Game.time % 20 !== 0) continue;
            if (!room.terminal || room.terminal.cooldown > 0) continue;

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
            } else if (room.name == 'W4N1') {
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
            }

        }
    }
}
