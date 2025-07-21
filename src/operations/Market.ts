import {forEach} from "lodash";
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

export class Market extends Operation {

    public constructor() {
        super();
    }

    public init() { }

    public roleCall() { }

    public actions() {

        //console.log(`--------  Market BUY Actions  ------`);
        if (Game.cpu.bucket < 2000) {
            console.log('No market, CPU Bucket low: ' + Game.cpu.bucket);
        } else {
            if (Game.market.credits < 100000000) {
                console.log('No more spending, credit reserve limit.');
            } else {

                for (const roomid in Game.rooms) {
                    const room = Game.rooms[roomid];

                    // What kind of room are we looking at?
                    if (room.controller?.owner?.username !== "ricane") {
                        continue;
                    }

                    if (!(room.memory.nextTrade < Game.time)) {
                        //console.log('[' + room.name + '] Ticks until trading: ' + (Game.time - room.memory.nextTrade));
                        continue;
                    }
                    // Update next Trade check
                    room.memory.nextTrade = Game.time + 250;

                    if (!(room.storage && room.terminal)) {
                        continue;
                    }

                    let totalEnergy = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) + room.storage.store.getUsedCapacity(RESOURCE_ENERGY);
                    let terminalSpace = room.terminal.store.getFreeCapacity(RESOURCE_ENERGY);
                    let storageSpace = room.storage.store.getFreeCapacity(RESOURCE_ENERGY);

                    if (!(totalEnergy < 300000 && storageSpace > 20000 && terminalSpace > 20000)) {
                        continue;
                    }

                    // Let's go shopping
                    let bestOrder: Order;
                    let lowestExpense = Number.MAX_VALUE;

                    let orders = Game.market.getAllOrders({type: ORDER_SELL, resourceType: RESOURCE_ENERGY});

                    for (let order of orders) {
                        if (order.remainingAmount < 100 && order.roomName == null) { continue; }
                        let expense = order.price;
                        let orderRoomName: string
                        if (order.roomName != null) {
                            orderRoomName = order.roomName;
                        } else {
                            continue;
                        }
                        let transferCost = Game.market.calcTransactionCost(100, room.name, orderRoomName) / 100;
                        expense += transferCost * RESOURCE_VALUE[RESOURCE_ENERGY];
                        if (expense < lowestExpense) {
                            lowestExpense = expense;
                            bestOrder = order;
                            //console.log("[" + room.name + "] could buy from", order.roomName, "for", order.price, "(+" + transferCost + ")");
                        }
                    }

                    // @ts-ignore
                    if (bestOrder) {
                        let amount = Math.min(bestOrder.remainingAmount, 30000);

                        if (lowestExpense <= RESOURCE_VALUE[RESOURCE_ENERGY] || totalEnergy < 10000 ) {
                            let outcome = Game.market.deal(bestOrder.id, amount, room.name);
                            console.log("[" + room.name + "] bought", amount, RESOURCE_ENERGY, "from", bestOrder.roomName, "outcome:", outcome);
                        } else {
                            console.log("[" + room.name + "] NO PURCHASE. " + lowestExpense + " > " + RESOURCE_VALUE[RESOURCE_ENERGY]);
                        }
                    }


                }

            }


            //console.log(`--------  Market SELL Actions  ------`);

            for (const roomid in Game.rooms) {
                const room = Game.rooms[roomid];

                // What kind of room are we looking at?
                if (room.controller?.owner?.username !== "ricane") {
                    continue;
                }

                if (((room.memory.nextTrade - Game.time) % 100) != 0) {
                    //console.log('[' + room.name + '] Ticks until SELLING: ' + ((room.memory.nextTrade - Game.time) % 20));
                    continue;
                }

                if (!(room.storage && room.terminal)) {
                    continue;
                }

                if (room.terminal.cooldown > 0) {
                    continue;
                }

                let totalEnergy = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
                if (totalEnergy < 30000) {
                    continue;
                }

                let dealAmount = 1000;
                let energyCost = 15;

                for (var rid in RESOURCES_ALL) {
                    let resourceType = RESOURCES_ALL[rid];
                    let quanity = room.terminal.store.getUsedCapacity(resourceType);

                    if (quanity > 100 && resourceType != RESOURCE_ENERGY && resourceType != RESOURCE_POWER) {
                        console.log(`Mineral: ${resourceType} has ${quanity} units inside the terminal`);
                        let doNotSell = false;

                        // Let's try to distribute to other local terminals first.
                        // Get all terminals within a 20 block radius.
                        /*
                        for (const roomid2 in Game.rooms) {
                            const room2 = Game.rooms[roomid2];

                            if (!room2 || !room2.terminal || !room2.memory.data.terminal || room.controller?.owner?.username !== "ricane" ) {
                                continue;
                            }
                            if (Game.map.getRoomLinearDistance(room.name, room2.name, true) > 20) {
                                continue;
                            }

                            if (room2.terminal.store.getUsedCapacity(resourceType) < 2000) {

                                // We found need for a resource, don't sell it.
                                doNotSell = true;
                                console.log('[' + roomid + '] Sending 1000 ' + resourceType + ' to ' + roomid2 + ': ' + room.terminal.send(resourceType, 1000, room2.name));
                            }
                        }
                        */

                        // No one needs it, sell it.
                        if (!doNotSell) {
                            let orders = Game.market.getAllOrders({type: ORDER_BUY, resourceType: resourceType});
                            let highestGain = 0;
                            let bestOrder;
                            for (let order of orders) {
                                if (order.remainingAmount < dealAmount) {
                                    continue;
                                }
                                if (!order.roomName) {
                                    continue;
                                }

                                let incoming = order.price * dealAmount;
                                let outcome = (Game.market.calcTransactionCost(dealAmount, room.name, order.roomName) * energyCost);

                                let gain = incoming - outcome;

                                if (gain > highestGain) {
                                    highestGain = gain;
                                    bestOrder = order;
                                    //console.log("I could sell it to", order.roomName, "for", order.price, "(+" + outcome + ")");
                                }
                            }

                            if (bestOrder) {
                                let amount = Math.min(bestOrder.remainingAmount, dealAmount);
                                let outcome = Game.market.deal(bestOrder.id, amount, room.name);

                                if (outcome === OK) {
                                    console.log("sold", amount, resourceType, "to", bestOrder.roomName, "outcome:", outcome);

                                } else if (outcome === ERR_INVALID_ARGS) {
                                    //console.log("invalid deal args:", bestOrder.id, amount, room.name);
                                } else {
                                    //console.log("there was a problem trying to deal:", outcome);
                                }
                            }
                        }
                    }
                }
            }


            //console.log(`--------  Network BALANCE Actions  ------`);

            for (const roomid in Game.rooms) {
                const room = Game.rooms[roomid];

                // What kind of room are we looking at?
                if (room.controller?.owner?.username !== "ricane") {
                    continue;
                }

                if (!room.memory.data.terminal) {
                    room.memory.data.terminal = {
                        energy: 0
                    }
                }

                if (((room.memory.nextTrade - Game.time) % 20) != 0) {
                    //console.log('[' + room.name + '] Ticks until SELLING: ' + ((room.memory.nextTrade - Game.time) % 20));
                    continue;
                }

                if (!room.terminal) {
                    continue;
                }

                if (room.terminal.cooldown > 0) {
                    continue;
                }

                let totalEnergy = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
                // Update for the network.
                room.memory.data.terminal.energy = totalEnergy;

                if (totalEnergy < 30000) {
                    // request from the richest..
                    for (const roomid2 in Game.rooms) {
                        const room2 = Game.rooms[roomid2];

                        if (!room2.terminal || room2.terminal.cooldown > 0 || !room2.memory.data.terminal || room.controller?.owner?.username !== "ricane" ) {
                            continue;
                        }

                        if (room2.memory.data.terminal.energy > 30000) {
                            console.log(
                                '[' + roomid + '] Requesting 1000 Energy from ' + roomid2 + ': ' +
                                room2.terminal.send(RESOURCE_ENERGY, 1000, roomid)
                            );
                        }
                    }
                }

            }

        }

    }
}
