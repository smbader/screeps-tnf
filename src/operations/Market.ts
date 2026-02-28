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

const MIN_CREDITS = 100000000;
const CPU_BUCKET_MIN = 4000;
const SELL_DEAL_AMOUNT = 1000;
const ENERGY_COST_PER_UNIT = 15;
const PRICE_HISTORY_LENGTH = 20; // number of ticks to average

// Donor buffer (kept as a top-level constant so it's easy to tune)
const DONOR_ENERGY_BUFFER = 10000; // donor terminal keeps this much energy reserved

// Network balancing tunables
const TARGET_TERMINAL_ENERGY = 30000; // desired energy level for terminals
const MAX_NETWORK_SEND = 5000; // maximum energy to send in one terminal.send()
const NETWORK_CHECK_INTERVAL = 20; // how often (in ticks) to run balancing

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

export class Market extends Operation {

    public constructor() {
        super();
    }

    public init() {
    }

    public roleCall() {
    }

    public actions() {
        if (Game.cpu.bucket < CPU_BUCKET_MIN) {
            if (Game.time % 100 === 0) marketLog('No market, CPU Bucket low: ' + Game.cpu.bucket);
            return;
        }
        if (Game.market.credits < MIN_CREDITS) {
            if (Game.time % 100 === 0) marketLog('No more spending, credit reserve limit. credits=' + Game.market.credits);
            return;
        }

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
            //marketLog(`skipped: ${reason}`);
        }

        // Helper: check common per-room skip conditions (owner, schedule, terminal/storage presence, cooldown)
        const checkRoomSkip = (room: Room): string | null => {
            if (room.controller?.owner?.username !== 'ricane') return 'owner';
            const nextTrade = room.memory.nextTrade || 0;
            if ((nextTrade - Game.time) % 15 !== 0) return 'schedule';
            if (!(room.storage && room.terminal)) return 'no-terminal';
            if (room.terminal.cooldown > 0) return 'terminal-cooldown';
            return null;
        };

        // Initialize same-tick donor availability map to prevent multiple receivers from over-requesting the same donor
        const donorAvailable = new Map<string, number>();
        for (const r of Object.values(Game.rooms)) {
            if (r.controller?.owner?.username === 'ricane' && r.terminal) {
                const termE = r.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
                donorAvailable.set(r.name, Math.max(0, termE - DONOR_ENERGY_BUFFER));
            }
        }

        // Two-pass approach:
        // 1) Collect eligible rooms (apply skip logic once)
        // 2) Run network balancing for all eligible rooms (this will issue terminal.send calls and use donorAvailable to reserve capacity)
        // 3) Run consolidation for all eligible rooms
        // 4) Recompute energies and perform selling for all eligible rooms

        const eligibleRooms: { room: Room; totalEnergy: number }[] = [];

        // Collect eligible rooms and compute initial energy snapshot
        for (const room of Object.values(Game.rooms)) {
            stats.totalRooms++;

            const skipReason = checkRoomSkip(room);
            if (skipReason) {
                addSkip(skipReason);
                continue;
            }

            const termEnergy = room.terminal ? room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) : 0;
            const storEnergy = room.storage ? room.storage.store.getUsedCapacity(RESOURCE_ENERGY) : 0;
            const totalEnergy = termEnergy + storEnergy;

            eligibleRooms.push({ room, totalEnergy });
        }

        // First pass: run network balancing for all eligible rooms so sends/reservations happen before any sells
        for (const entry of eligibleRooms) {
            this.performNetworkBalanceForRoom(entry.room, entry.totalEnergy, donorAvailable);
        }

        // Second pass: run resource consolidation for all eligible rooms (consolidation checks current room energy itself)
        for (const entry of eligibleRooms) {
            //this.performResourceConsolidationForRoom(entry.room);
        }

        // Final pass: recompute combined energy and run selling for each eligible room
        for (const entry of eligibleRooms) {
            const updatedTotalEnergy = this.getCombinedEnergy(entry.room);
            const processed = this.performSellForRoom(entry.room, updatedTotalEnergy, stats);
            if (processed) stats.processedRooms++;
        }

        // Summary log for SELL MINERALS
        if (Game.time % LOG_THROTTLE === 0 && stats.deals > 0) {
            const reasonEntries = Object.entries(stats.skipReasons).map(([k, v]) => `${k}:${v}`).join(', ');
            marketLog(`market summary rooms=${stats.totalRooms} processed=${stats.processedRooms} skipped=${stats.skippedRooms} deals=${stats.deals} failed=${stats.failedDeals} netRevenue=${stats.revenue.toFixed(2)} skips=${reasonEntries}`);
        }
    }

    // --- Helper methods (kept private) ---

    private getCombinedEnergy(room: Room): number {
        const terminalE = room.terminal ? room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) : 0;
        const storageE = room.storage ? room.storage.store.getUsedCapacity(RESOURCE_ENERGY) : 0;
        return terminalE + storageE;
    }

    private performNetworkBalanceForRoom(room: Room, totalEnergy: number, donorAvailable: Map<string, number>): void {
        if (!room.terminal) return;
        if (totalEnergy >= TARGET_TERMINAL_ENERGY) return; // no need to request

        for (const otherRoom of Object.values(Game.rooms)) {
            if (otherRoom === room) continue;
            if (!otherRoom.terminal) continue;
            if (otherRoom.terminal.cooldown > 0) continue;
            if (otherRoom.controller?.owner?.username !== 'ricane') continue;

            const donorTerminalEnergy = otherRoom.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
            const donorStorageEnergy = otherRoom.storage ? otherRoom.storage.store.getUsedCapacity(RESOURCE_ENERGY) : 0;
            const donorTotalEnergy = donorTerminalEnergy + donorStorageEnergy;

            if (donorTotalEnergy <= TARGET_TERMINAL_ENERGY) continue;

            const donorSurplus = donorTotalEnergy - TARGET_TERMINAL_ENERGY;
            const receiverNeed = TARGET_TERMINAL_ENERGY - totalEnergy;

            // Determine current available send capacity from donor (respecting same-tick reservations)
            const availableNow = donorAvailable.get(otherRoom.name) ?? Math.max(0, donorTerminalEnergy - DONOR_ENERGY_BUFFER);
            if (availableNow <= 0) continue;

            const desired = Math.max(0, Math.min(donorSurplus, receiverNeed, MAX_NETWORK_SEND));
            const amountToSend = Math.min(desired, availableNow);
            if (amountToSend <= 0) continue;

            // Reserve now to prevent other receivers in this tick from using the same donor
            donorAvailable.set(otherRoom.name, Math.max(0, availableNow - amountToSend));

            const res = otherRoom.terminal.send(RESOURCE_ENERGY, amountToSend, room.name);
            if (res === OK) {
                console.log(`[${room.name}] requested ${amountToSend} energy from ${otherRoom.name} -> OK`);
                // Visual: mark receiver terminal with a green plus
                new RoomVisual(room.name).text(`+${amountToSend}`, room.terminal.pos.x + 1, room.terminal.pos.y, {
                    color: 'green',
                    font: 0.5
                });
                // Visual: mark donor terminal with a yellow outgoing annotation
                try {
                    new RoomVisual(otherRoom.name).text(`→${room.name}:${amountToSend}`, otherRoom.terminal.pos.x + 1, otherRoom.terminal.pos.y, {
                        color: 'yellow',
                        font: 0.5
                    });
                    new RoomVisual(otherRoom.name).circle(otherRoom.terminal.pos.x, otherRoom.terminal.pos.y, {
                        radius: 0.4,
                        stroke: 'yellow'
                    });
                } catch (e) { /* ignore visual failures */
                }
            } else {
                // On failure, restore the reservation so others can try this donor
                donorAvailable.set(otherRoom.name, Math.min((donorAvailable.get(otherRoom.name) ?? 0) + amountToSend, donorTerminalEnergy));
                console.log(`[${room.name}] requested ${amountToSend} energy from ${otherRoom.name} -> ${res}`);
                // Visual: mark donor terminal with a red failure marker
                try {
                    new RoomVisual(otherRoom.name).text(`x${room.name}:${amountToSend}`, otherRoom.terminal.pos.x + 1, otherRoom.terminal.pos.y, {
                        color: 'red',
                        font: 0.5
                    });
                    new RoomVisual(otherRoom.name).circle(otherRoom.terminal.pos.x, otherRoom.terminal.pos.y, {
                        radius: 0.4,
                        stroke: 'red'
                    });
                } catch (e) { /* ignore visual failures */
                }
            }

            // use only one donor per receiver per tick
            break;
        }
    }

    private performResourceConsolidationForRoom(room: Room): void {
        if (!room.terminal) return;

        // Only consolidate if this room has sufficient combined energy
        const receiverTotalEnergy = this.getCombinedEnergy(room);
        if (receiverTotalEnergy < TARGET_TERMINAL_ENERGY) return;

        for (const resourceType of RESOURCES_ALL as ResourceConstant[]) {
            if (resourceType === RESOURCE_ENERGY || resourceType === RESOURCE_POWER) continue;

            for (const donorRoom of Object.values(Game.rooms)) {
                if (donorRoom === room) continue;
                if (donorRoom.controller?.owner?.username !== 'ricane') continue;
                if (!donorRoom.terminal || donorRoom.terminal.cooldown > 0) continue;

                const donorQty = donorRoom.terminal.store.getUsedCapacity(resourceType);
                if (!donorQty || donorQty <= 10000) continue; // require some surplus in donor terminal

                const freeForResource = room.terminal.store.getFreeCapacity(resourceType);
                if (!freeForResource || freeForResource === 0) continue;

                const sendAmount = Math.min(donorQty - 10000, freeForResource, MAX_NETWORK_SEND);
                if (sendAmount <= 0) continue;

                const r = donorRoom.terminal.send(resourceType, sendAmount, room.name);
                if (r === OK) {
                    console.log(`Consolidated ${sendAmount} ${resourceType} from ${donorRoom.name} -> ${room.name}`);
                    try {
                        new RoomVisual(room.name).text(`+${sendAmount}${resourceType}`, room.terminal.pos.x + 1, room.terminal.pos.y + 1, {
                            color: '#00ff88',
                            font: 0.45
                        });
                        new RoomVisual(donorRoom.name).text(`→${room.name}:${sendAmount}${resourceType}`, donorRoom.terminal.pos.x + 1, donorRoom.terminal.pos.y + 1, {
                            color: '#ffaa00',
                            font: 0.45
                        });
                    } catch (e) {
                    }
                    // Only consolidate one donor per resource per receiver per tick
                    break;
                } else {
                    console.log(`Failed consolidate ${resourceType} ${sendAmount} from ${donorRoom.name} -> ${room.name}: ${r}`);
                }
            }
        }
    }

    private performSellForRoom(room: Room, totalEnergy: number, stats: any): boolean {
        // Selling runs only when combined energy is sufficient
        if (totalEnergy < 30000) {
            stats.skipReasons['low-energy'] = (stats.skipReasons['low-energy'] || 0) + 1;
            return false;
        }

        for (const resourceType of RESOURCES_ALL as ResourceConstant[]) {
            if (resourceType === RESOURCE_ENERGY || resourceType === RESOURCE_POWER) continue;
            const quantity = room.terminal?.store.getUsedCapacity(resourceType) || 0;
            if (quantity <= 10000) {
                if (Game.time % LOG_THROTTLE === 0 && quantity > 0) marketLog(`resource ${resourceType} quantity ${quantity} below sell threshold`, room.name);
                if (quantity > 0) stats.skipReasons[`resource-low-${resourceType}`] = (stats.skipReasons[`resource-low-${resourceType}`] || 0) + 1;
                continue;
            }

            let bestOrder: Order | null = null;
            let highestGain = 0;
            const orders = Game.market.getAllOrders({type: ORDER_BUY, resourceType});
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

            if (!bestOrder && quantity > 30000) {
                for (const o of orders) {
                    if (!o.roomName || o.remainingAmount < SELL_DEAL_AMOUNT) continue;
                    if (!bestOrder || o.price > bestOrder.price) bestOrder = o;
                }
                if (Game.time % LOG_THROTTLE === 0) marketLog(`no profitable order found for ${resourceType}; forcing selection because qty=${quantity}`, room.name);
            }

            if (bestOrder) {
                const order = bestOrder;
                if (Game.time % LOG_THROTTLE === 0) marketLog(`selected buyer ${order.roomName} price=${order.price.toFixed(3)} remaining=${order.remainingAmount} estimatedGain=${highestGain.toFixed(2)}`, room.name);
                if (!order.roomName) {
                    if (Game.time % LOG_THROTTLE === 0) marketLog(`skipping bestOrder with no roomName`, room.name);
                    continue;
                }
                const buyerRoom = order.roomName as string;
                const amount = Math.min(order.remainingAmount, SELL_DEAL_AMOUNT, quantity);
                const transferCost = Game.market.calcTransactionCost(amount, room.name, buyerRoom) * ENERGY_COST_PER_UNIT;
                const incoming = order.price * amount;
                const net = incoming - transferCost;
                recordPrice(resourceType, order.price);
                const outcome = Game.market.deal(order.id, amount, room.name);
                if (outcome === OK) {
                    stats.deals++;
                    stats.revenue += net;
                    marketLog(`sold ${amount} ${resourceType} to ${order.roomName} @${order.price.toFixed(3)} net=${net.toFixed(2)}`, room.name);
                    console.log(`[${room.name}] sold ${amount} ${resourceType} to ${order.roomName}, price: ${order.price.toFixed(3)}, outcome: ${outcome}`);
                } else {
                    stats.failedDeals++;
                    if (quantity > 3000) {
                        marketLog(`forced-sell attempt ${amount} ${resourceType} to ${order?.roomName || 'unknown'}, price: ${order?.price?.toFixed?.(3) || 'n/a'}, outcome: ${outcome}`, room.name);
                    }
                }
            } else {
                if (Game.time % LOG_THROTTLE === 0) marketLog(`no buyer found for ${resourceType} (qty=${quantity})`, room.name);
                stats.skipReasons[`no-buyer-${resourceType}`] = (stats.skipReasons[`no-buyer-${resourceType}`] || 0) + 1;
            }
        }

        return true;
    }
}
