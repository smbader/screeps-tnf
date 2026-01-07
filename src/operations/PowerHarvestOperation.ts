import { Operation } from "../classes/operation";

const OBSERVER_SCAN_INTERVAL = 10;
const POWERBANK_MIN_TTL = 1100;
const HAULER_BUFFER = 50;

function getRoomName(baseRoom: string, dx: number, dy: number): string | null {
    const match = /^([WE])(\d+)([NS])(\d+)$/.exec(baseRoom);
    if (!match) return null;
    let [_, xDir, xNumStr, yDir, yNumStr] = match;
    let x = parseInt(xNumStr);
    let y = parseInt(yNumStr);

    if (dx !== 0) {
        if (xDir === "W") x -= dx;
        else x += dx;
        if (x < 0) {
            x = -x;
            xDir = xDir === "W" ? "E" : "W";
        }
    }
    if (dy !== 0) {
        if (yDir === "N") y -= dy;
        else y += dy;
        if (y < 0) {
            y = -y;
            yDir = yDir === "N" ? "S" : "N";
        }
    }
    return `${xDir}${x}${yDir}${y}`;
}

export class PowerHarvestOperation extends Operation {
    constructor() {
        super();
    }

    static getAllActiveBanks(): { room: string; pos: { x: number; y: number }; claimedBy?: string }[] {
        const banks: { room: string; pos: { x: number; y: number }; claimedBy?: string }[] = [];
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room.controller || !room.controller.my) continue;
            if (!room.memory.powerHarvest) continue;
            for (const bank of room.memory.powerHarvest.banks) {
                if (
                    bank.state === "breaking" ||
                    bank.state === "hauling"
                ) {
                    banks.push({
                        room: bank.room,
                        pos: { x: bank.pos.x, y: bank.pos.y },
                        claimedBy: bank.claimedBy
                    });
                }
            }
        }
        return banks;
    }

    static isBankClaimed(bankRoom: string, bankPos: RoomPosition, thisHomeRoom: string): boolean {
        const allBanks = PowerHarvestOperation.getAllActiveBanks();
        for (const b of allBanks) {
            if (
                b.room === bankRoom &&
                b.pos.x === bankPos.x &&
                b.pos.y === bankPos.y &&
                b.claimedBy &&
                b.claimedBy !== thisHomeRoom
            ) {
                return true;
            }
        }
        return false;
    }

    // Track what rooms have been scanned and when
    scanAlleyRooms(room: Room, observer: StructureObserver) {
        if (!room.memory.powerHarvest) return;
        if (!observer) return;

        // Ensure scannedRooms exists
        if (!room.memory.powerHarvest.scannedRooms) room.memory.powerHarvest.scannedRooms = {};

        // Only scan every OBSERVER_SCAN_INTERVAL ticks
        if (room.memory.powerHarvest.lastScan && Game.time - room.memory.powerHarvest.lastScan < OBSERVER_SCAN_INTERVAL) return;

        const homeName = room.name;
        const validRooms: string[] = [];
        for (let dx = -3; dx <= 3; dx++) {
            for (let dy = -3; dy <= 3; dy++) {
                if (dx === 0 && dy === 0) continue;
                const scanRoom = getRoomName(homeName, dx, dy);
                if (!scanRoom) continue;
                const match = /^([WE])(\d+)([NS])(\d+)$/.exec(scanRoom);
                if (!match) continue;
                const x = parseInt(match[2]);
                const y = parseInt(match[4]);
                if (x % 10 !== 0 && y % 10 !== 0 && x !== 0 && y !== 0) continue;
                validRooms.push(scanRoom);
            }
        }

        // Find the room with the oldest scan time (or never scanned)
        let oldestRoom: string | null = null;
        let oldestTime: number = Infinity;
        for (const vRoom of validRooms) {
            const scanTime = room.memory.powerHarvest.scannedRooms![vRoom] ?? -1;
            if (scanTime < oldestTime) {
                oldestTime = scanTime;
                oldestRoom = vRoom;
            }
        }

        if (oldestRoom) {
            observer.observeRoom(oldestRoom);
            room.memory.powerHarvest.lastScan = Game.time;
            room.memory.powerHarvest._observedRoom = oldestRoom;
            // Update scan record for this room
            room.memory.powerHarvest.scannedRooms![oldestRoom] = Game.time;
        }
    }

    recordPowerBanks(room: Room) {
        if (!room.memory.powerHarvest) return;
        if (!room.memory.powerHarvest._observedRoom) return;

        const roomName = room.memory.powerHarvest._observedRoom;
        const banks: PowerBankMemory[] = [];
        const observedRoom = Game.rooms[roomName];
        if (observedRoom) {
            const powerbanks = observedRoom.find<StructurePowerBank>(FIND_STRUCTURES, {
                filter: structure => structure.structureType === STRUCTURE_POWER_BANK
            });
            for (const bank of powerbanks) {
                banks.push({
                    room: roomName,
                    pos: bank.pos,
                    ticksToDecay: bank.ticksToDecay,
                    power: bank.power,
                    lastChecked: Game.time,
                    state: "waiting",
                    claimedBy: undefined
                });
            }
            room.memory.powerHarvest.banks = room.memory.powerHarvest.banks
                .filter(b => b.room !== roomName)
                .concat(banks);
        }
    }

    cleanupBanks(room: Room) {
        if (!room.memory.powerHarvest) return;
        room.memory.powerHarvest.banks = room.memory.powerHarvest.banks.filter(
            bank => bank.ticksToDecay > 0 && bank.state !== "done"
        );
    }

    estimateBreakTime(powerbank: PowerBankMemory): number {
        const attackPowerPerTick = 60;
        return Math.ceil(powerbank.power / attackPowerPerTick);
    }

    estimateHaulerTravelTime(homeRoom: Room, targetRoom: string): number {
        const dist = Game.map.getRoomLinearDistance(homeRoom.name, targetRoom, false);
        return dist * 50;
    }

    spawnBreakers(room: Room, bank: PowerBankMemory) {
        if (bank.ticksToDecay < POWERBANK_MIN_TTL) return;

        bank.homeRoom = room.name;

        // Ensure arrays are initialized
        // Only initialize arrays if they are undefined (do not reset every tick)
        if (typeof bank.fighterNames === 'undefined') bank.fighterNames = [];
        if (typeof bank.healerNames === 'undefined') bank.healerNames = [];

        // Clean up dead fighters (remove names of creeps that no longer exist)
        bank.fighterNames = bank.fighterNames.filter(name => Game.creeps[name]);
        // Clean up dead healers (remove names of creeps that no longer exist)
        bank.healerNames = bank.healerNames.filter(name => Game.creeps[name]);

        // Ensure memory is in sync with live creeps
        for (let i = 0; i < 2; i++) {
            const pfName = `PowerFighter_${bank.room}_${i+1}`;
            if (Game.creeps[pfName] && !bank.fighterNames.includes(pfName)) {
                bank.fighterNames.push(pfName);
            }
            const phName = `PowerHealer_${bank.room}_${i+1}`;
            if (Game.creeps[phName] && !bank.healerNames.includes(phName)) {
                bank.healerNames.push(phName);
            }
        }

        // Spawn up to 2 fighters
        for (let i = 0; i < 2; i++) {
            const pfName = `PowerFighter_${bank.room}_${i+1}`;
            if (!Game.creeps[pfName] && !bank.fighterNames.includes(pfName)) {
                const spawns = room.find(FIND_MY_SPAWNS);
                for (const spawn of spawns) {
                    if (!spawn.spawning) {
                        const result = spawn.spawnCreep(
                            [   MOVE, MOVE, MOVE, MOVE, MOVE,
                                MOVE, MOVE, MOVE, MOVE, MOVE,
                                MOVE, MOVE, MOVE, MOVE, MOVE,
                                ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                ATTACK, ATTACK, ATTACK, ATTACK, ATTACK],
                            pfName,
                            { memory: { role: "powerFighter", targetRoom: bank.room } }
                        );
                        if (result === OK) {
                            bank.fighterNames.push(pfName);
                            break;
                        } else {
                            console.log(`[PowerHarvest] Failed to spawn fighter ${pfName} in ${room.name}: ${result}`);
                        }
                    }
                }
            }
        }

        // Spawn up to 2 healers
        for (let i = 0; i < 2; i++) {
            const phName = `PowerHealer_${bank.room}_${i+1}`;
            if (!Game.creeps[phName] && !bank.healerNames.includes(phName)) {
                const spawns = room.find(FIND_MY_SPAWNS);
                for (const spawn of spawns) {
                    if (!spawn.spawning) {
                        const result = spawn.spawnCreep(
                            [   MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
                                MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
                                MOVE, MOVE, MOVE, MOVE, MOVE, HEAL, HEAL, HEAL, HEAL, HEAL,
                                HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL,
                                HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL,],
                            phName,
                            { memory: { role: "powerHealer", targetFighter: `PowerFighter_${bank.room}_${i+1}`, targetRoom: bank.room } }
                        );
                        if (result === OK) {
                            bank.healerNames.push(phName);
                            break;
                        }
                    }
                }
            }
        }
    }

    spawnHaulers(room: Room, bank: PowerBankMemory) {
        if (bank.state === "hauling") return; // Already hauling
        if (bank.homeRoom !== room.name) return;

        const breakTime = this.estimateBreakTime(bank);console.log(`Estimated break time for bank in ${bank.room}: ${breakTime} ticks`);
        const haulTravelTime = this.estimateHaulerTravelTime(room, bank.room);console.log(`Estimated hauler travel time to ${bank.room}: ${haulTravelTime} ticks`);
        const haulerLeadTime = haulTravelTime + HAULER_BUFFER;console.log(`Hauler lead time for bank in ${bank.room}: ${haulerLeadTime} ticks`);
        console.log(`Power bank in ${bank.room} hauler countdown: ${Game.time - breakTime - haulerLeadTime} ticks`);
        if (Game.time > breakTime - haulerLeadTime) {
            if (!bank.haulerNames) bank.haulerNames = [];
            for (let i = 0; i < Math.ceil(bank.power / 2000); i++) {
                const haulerName = `PowerHauler_${bank.room}_${i + 1}`;
                if (!Game.creeps[haulerName]) {
                    const spawns = room.find(FIND_MY_SPAWNS);
                    for (const spawn of spawns) {
                        if (!spawn.spawning) {
                            const result = spawn.spawnCreep(
                                [MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY],
                                haulerName,
                                { memory: { role: "powerHauler", targetRoom: bank.room } }
                            );
                            if (result === OK) {
                                bank.haulerNames.push(haulerName);
                                break;
                            }
                        }
                    }
                }
            }
            bank.state = "hauling";
        }
    }

    runFighter(bank: PowerBankMemory) {
        if (bank.fighterNames) {
            for (const fighterName of bank.fighterNames) {
                const fighter = Game.creeps[fighterName];
                if (!fighter) continue;
                if (fighter.memory.role === "powerFighter") {
                    if (fighter.room.name !== bank.room) {
                        fighter.travelTo(new RoomPosition(25, 25, bank.room));
                    } else {
                        const powerBank = fighter.pos.findClosestByPath(FIND_STRUCTURES, {
                            filter: s => s.structureType === STRUCTURE_POWER_BANK
                        });
                        if (powerBank) {
                            if ((fighter.hitsMax - fighter.hits) <= 500) {
                                if (fighter.attack(powerBank) === ERR_NOT_IN_RANGE) {
                                    fighter.travelTo(powerBank.pos);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    runHealer(bank: PowerBankMemory) {
        if (bank.healerNames) {
            for (const healerName of bank.healerNames) {
                const healer = Game.creeps[healerName];
                if (!healer) continue;
                if (healer.memory.role === "powerHealer" && healer.memory.targetFighter) {
                    const fighter = Game.creeps[healer.memory.targetFighter];
                    if (fighter) {
                        if (healer.room.name !== bank.room) {
                            healer.travelTo(new RoomPosition(25, 25, bank.room));
                        } else {
                            const range = healer.pos.getRangeTo(fighter);
                            if (range > 1) {
                                healer.rangedHeal(fighter);
                                healer.travelTo(fighter.pos);
                            } else {
                                healer.heal(fighter);
                            }
                        }
                    } else {
                        healer.travelTo(new RoomPosition(25, 25, bank.room));
                    }
                }
            }
        }
    }

    runHaulers(room: Room, bank: PowerBankMemory) {
        if (bank.haulerNames) {
            for (const haulerName of bank.haulerNames) {
                const hauler = Game.creeps[haulerName];
                if (!hauler) continue;
                if (hauler.memory.role === "powerHauler") {
                    if (hauler.room.name !== bank.room && hauler.store.getUsedCapacity(RESOURCE_POWER) === 0) {
                        hauler.travelTo(new RoomPosition(25, 25, bank.room));
                    } else if (hauler.room.name === bank.room && hauler.store.getFreeCapacity() > 0) {
                        const droppedPower = hauler.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
                            filter: r => r.resourceType === RESOURCE_POWER
                        });
                        if (droppedPower) {
                            if (hauler.pickup(droppedPower) === ERR_NOT_IN_RANGE) {
                                hauler.travelTo(droppedPower.pos);
                            }
                        } else {
                            hauler.travelTo(new RoomPosition(25, 25, bank.room));
                        }
                    } else if (hauler.store.getUsedCapacity(RESOURCE_POWER) > 0) {
                        const dest = room.terminal && room.terminal.my
                            ? room.terminal
                            : room.storage;
                        if (dest) {
                            if (hauler.transfer(dest, RESOURCE_POWER) === ERR_NOT_IN_RANGE) {
                                hauler.travelTo(dest.pos);
                            }
                        }
                    }
                }
            }
        }
    }

    // Utility: Find the closest owned room to a given room name
    static getClosestOwnedRoom(targetRoom: string): string | null {
        let minDist = Infinity;
        let closestRoom: string | null = null;
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room.controller || !room.controller.my) continue;
            const dist = Game.map.getRoomLinearDistance(roomName, targetRoom, false);
            if (dist < minDist) {
                minDist = dist;
                closestRoom = roomName;
            }
        }
        return closestRoom;
    }

    actions() {
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room.controller || !room.controller.my) continue;

            if (!room.memory.powerHarvest) {
                room.memory.powerHarvest = { banks: [], lastScan: 0 } as PowerHarvestMemory;
            }
            if (!room.memory.powerHarvest.scannedRooms) {
                room.memory.powerHarvest.scannedRooms = {};
            }

            let os = room.find(FIND_STRUCTURES, {
                filter: { structureType: STRUCTURE_OBSERVER }
            });
            const observer = os.length > 0 ? (os[0] as StructureObserver) : undefined;
            if (!observer) {
                continue;
            }

            this.scanAlleyRooms(room, observer);
            this.recordPowerBanks(room);
            this.cleanupBanks(room);

            for (const bank of room.memory.powerHarvest.banks) {
                // Only the closest room can claim and operate on the bank
                const closestRoom = PowerHarvestOperation.getClosestOwnedRoom(bank.room);
                if (closestRoom !== room.name) {
                    continue;
                }
                // Claim logic: only operate if unclaimed or claimed by this room
                if (bank.claimedBy && bank.claimedBy !== room.name && (bank.state === "breaking" || bank.state === "hauling")) {
                    continue;
                }
                if (!bank.claimedBy && (bank.state === "breaking" || bank.state === "hauling")) {
                    bank.claimedBy = room.name;
                }
                // If a farther room claimed it, allow takeover by closer room
                if (bank.claimedBy && bank.claimedBy !== room.name) {
                    bank.claimedBy = room.name;
                }
                console.log(`PowerHarvestOperation in room ${room.name} managing bank in ${bank.room} at (${bank.pos.x},${bank.pos.y}) state: ${bank.state}`);
                this.spawnBreakers(room, bank);
                this.spawnHaulers(room, bank);
                this.runFighter(bank);
                this.runHealer(bank);
                this.runHaulers(room, bank);

                if (bank.state === "hauling" && bank.claimedBy === room.name) {
                    const haulersDone = bank.haulerNames?.every(name => !Game.creeps[name] || Game.creeps[name].store.getUsedCapacity(RESOURCE_POWER) === 0);
                    const bankRoom = Game.rooms[bank.room];
                    const powerBankGone = bankRoom && bankRoom.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_POWER_BANK }).length === 0;
                    if (haulersDone && powerBankGone) {
                        bank.state = "done";
                        bank.claimedBy = undefined;
                    }
                }
            }
        }
    }
}
