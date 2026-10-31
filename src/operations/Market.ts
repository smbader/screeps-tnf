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

const TERMINAL_RESOURCE_MIN_THRESHOLD = 2000; // threshold for deciding when to move/sell resources
const TERMINAL_RESOURCE_MAX_THRESHOLD = 10000; // threshold for deciding when to move/sell resources

const TERMINAL_ENERGY_MIN_THRESHOLD = 20000; // threshold for deciding when to move/sell resources
const TERMINAL_ENERGY_MAX_THRESHOLD = 50000; // threshold for deciding when to move/sell resources

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

        // Terminal Rules to follow:
        //
        // 1. If there is more energy than TERMINAL_ENERGY_MAX_THRESHOLD in a terminal:
        //    a. If any other owned terminal has less than TERMINAL_ENERGY_MIN_THRESHOLD, send 5k to it.
        //    b. If all other owned terminals have TERMINAL_ENERGY_MIN_THRESHOLD and this terminal holds TERMINAL_ENERGY_MAX_THRESHOLD + 20k or more, SELL_DEAL_AMOUNT energy on the market.
        //
        // 2. If a non-energy resource has more than TERMINAL_RESOURCE_MAX_THRESHOLD in a terminal:
        //    a. If any other owned terminal has less than TERMINAL_RESOURCE_MIN_THRESHOLD, send 2k to it.
        //    b. If all other owned terminals have TERMINAL_RESOURCE_THRESHOLD or more, sell SELL_DEAL_AMOUNT on the market.
        //

        // Loop through each terminal and apply the rules
        for (const roomName in Game.rooms) {

            // Only consider rooms with terminals
            const room = Game.rooms[roomName];
            if (!room.terminal) continue;
            if (!room.terminal.my) continue; // skip if terminal is not owned

            const terminal = room.terminal;
            const energyAmount = terminal.store[RESOURCE_ENERGY] || 0;

            if (terminal.cooldown > 0) continue; // skip if terminal is on cooldown

            if (terminal.store.getUsedCapacity(RESOURCE_ENERGY) < 30000) {
                marketLog(`Skipping terminal in ${roomName} due to low energy (${energyAmount})`, roomName);
                continue;
            }
            if (room.storage && room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) < 50000) {
                marketLog(`Skipping terminal in due to low storage energy ${roomName}`);
                continue;
            }
            // Handle energy balancing and selling
            if (energyAmount > TERMINAL_ENERGY_MAX_THRESHOLD) {

                // Try to balance energy with other terminals first
                let balanced = false;

                for (const otherRoomName in Game.rooms) {

                    if (otherRoomName === roomName) continue;

                    const otherRoom = Game.rooms[otherRoomName];
                    if (!otherRoom.terminal) continue;
                    if (!otherRoom.terminal.my) continue; // skip if terminal is not owned

                    const otherTerminal = otherRoom.terminal;
                    const otherEnergyAmount = otherTerminal.store[RESOURCE_ENERGY] || 0;

                    if (otherEnergyAmount < TERMINAL_ENERGY_MIN_THRESHOLD) {

                        const sendAmount = Math.min(MAX_NETWORK_SEND, energyAmount - TERMINAL_ENERGY_MAX_THRESHOLD);
                        terminal.send(RESOURCE_ENERGY, sendAmount, otherRoomName);

                        marketLog(`Sent ${sendAmount} energy to ${otherRoomName} for balancing`, roomName);
                        balanced = true;

                        break; // only send to one terminal per tick
                    }
                }

                //// If we didn't balance, consider selling
                //if (!balanced && energyAmount > TERMINAL_ENERGY_MAX_THRESHOLD + 20000) {
                //    const sellAmount = Math.min(SELL_DEAL_AMOUNT, energyAmount - TERMINAL_ENERGY_MAX_THRESHOLD);

                //    marketLog(`Created sell order for ${sellAmount} energy`, roomName);
                //}
            }

            if (terminal.cooldown > 0) continue; // skip if terminal is on cooldown

            // Handle non-energy resources
            for (const resourceType in terminal.store) {
                if (resourceType === RESOURCE_ENERGY) continue;

                const resource = resourceType as ResourceConstant;
                const resourceAmount = terminal.store.getUsedCapacity(resource) || 0;

                if (resourceAmount > TERMINAL_RESOURCE_MAX_THRESHOLD) {

                    // Try to balance with other terminals first
                    let balanced = false;

                    for (const otherRoomName in Game.rooms) {

                        if (otherRoomName === roomName) continue;

                        const otherRoom = Game.rooms[otherRoomName];
                        if (!otherRoom.terminal) continue;
                        if (!otherRoom.terminal.my) continue; // skip if terminal is not owned

                        const otherTerminal = otherRoom.terminal;
                        const otherResourceAmount = otherTerminal.store.getUsedCapacity(resource) || 0;

                        if (otherResourceAmount < TERMINAL_RESOURCE_MIN_THRESHOLD) {

                            const sendAmount = Math.min(2000, resourceAmount - TERMINAL_RESOURCE_MAX_THRESHOLD);
                            terminal.send(resource, sendAmount, otherRoomName);

                            marketLog(`Sent ${sendAmount} ${resource} to ${otherRoomName} for balancing`, roomName);
                            balanced = true;

                            break; // only send to one terminal per tick
                        }
                    }

                    //// If we didn't balance, consider selling
                    //if (!balanced && resourceAmount > TERMINAL_RESOURCE_MAX_THRESHOLD) {
                    //    const sellAmount = Math.min(SELL_DEAL_AMOUNT, resourceAmount - TERMINAL_RESOURCE_MAX_THRESHOLD);

                    //    marketLog(`Created sell order for ${sellAmount} ${resource}`, roomName);
                    //}
                }
            }
        }

    }
}
