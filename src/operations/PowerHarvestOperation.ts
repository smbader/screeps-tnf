import { Operation } from "../classes/operation";

try { console.log(`PowerHarvestOperation module loaded`); } catch (e) {}

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

// Helper: find the closest owned room to a given room name (file-level helper to avoid static lookup issues)
function getClosestOwnedRoom(targetRoom: string): string | null {
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
                            console.log(`[PowerHarvest:${room.name}] spawned fighter ${pfName} for bank ${bank.room}`);
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
                            console.log(`[PowerHarvest:${room.name}] spawned healer ${phName} for bank ${bank.room}`);
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

        console.log(`[PowerHarvest:${room.name}] spawnHaulers called for bank ${bank.room} (state=${bank.state}, power=${bank.power}, ticksToDecay=${bank.ticksToDecay})`);

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
                                console.log(`[PowerHarvest:${room.name}] spawned hauler ${haulerName} for bank ${bank.room}`);
                                break;
                            } else {
                                console.log(`[PowerHarvest:${room.name}] spawn attempt for ${haulerName} returned ${result}`);
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
                    console.log(`[PowerFighter:${fighterName}] tick in room ${fighter.room.name}, target bank room ${bank.room}`);
                    if (fighter.room.name !== bank.room) {
                        console.log(`[PowerFighter:${fighterName}] traveling to bank room ${bank.room}`);
                        try { (fighter as any).travelTo(new RoomPosition(25, 25, bank.room)); } catch(e) { fighter.moveTo(new RoomPosition(25,25,bank.room)); }
                    } else {
                        const powerBank = fighter.pos.findClosestByPath(FIND_STRUCTURES, {
                            filter: s => s.structureType === STRUCTURE_POWER_BANK
                        });
                        if (powerBank) {
                            if ((fighter.hitsMax - fighter.hits) <= 500) {
                                if (fighter.attack(powerBank) === ERR_NOT_IN_RANGE) {
                                    console.log(`[PowerFighter:${fighterName}] attack not in range, moving to bank pos`);
                                    try { (fighter as any).travelTo(powerBank.pos); } catch(e) { fighter.moveTo(powerBank.pos); }
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
                    console.log(`[PowerHealer:${healerName}] tick in room ${healer.room.name}, target fighter ${healer.memory.targetFighter}`);
                    const fighter = Game.creeps[healer.memory.targetFighter];
                    if (fighter) {
                        if (healer.room.name !== bank.room) {
                            console.log(`[PowerHealer:${healerName}] traveling to bank room ${bank.room}`);
                            try { (healer as any).travelTo(new RoomPosition(25, 25, bank.room)); } catch(e) { healer.moveTo(new RoomPosition(25,25,bank.room)); }
                        } else {
                            const range = healer.pos.getRangeTo(fighter);
                            if (range > 1) {
                                healer.rangedHeal(fighter);
                                console.log(`[PowerHealer:${healerName}] rangedHeal, moving to fighter`);
                                try { (healer as any).travelTo(fighter.pos); } catch(e) { healer.moveTo(fighter.pos); }
                            } else {
                                healer.heal(fighter);
                            }
                        }
                    } else {
                        console.log(`[PowerHealer:${healerName}] target fighter not found, moving to bank room ${bank.room}`);
                        try { (healer as any).travelTo(new RoomPosition(25, 25, bank.room)); } catch(e) { healer.moveTo(new RoomPosition(25,25,bank.room)); }
                     }
                 }
             }
         }
     }

    runHaulers(room: Room, bank: PowerBankMemory) {
        if (bank.haulerNames) {
            console.log(`[PowerHarvest:${room.name}] running haulers: ${bank.haulerNames.join(', ')}`);
            for (const haulerName of bank.haulerNames) {
                const hauler = Game.creeps[haulerName];
                if (!hauler) continue;
                if (hauler.memory.role === "powerHauler") {
                    const targetRoom = (hauler.memory as any).targetRoom || bank.room;
                    const doTravelTo = (creep: Creep, dest: RoomPosition | { pos: RoomPosition } | RoomObject) => {
                        // prefer travelTo if available, otherwise fallback to moveTo
                        try {
                            const pos = (dest as any).pos ? (dest as any).pos : dest as RoomPosition;
                            // Draw a lightweight visual in the creep's current room indicating the destination room
                            try {
                                const vis = creep.room.visual as any;
                                const destRoom = pos.roomName;
                                // show destination room name above the creep
                                vis.text(`${destRoom}`, creep.pos.x, Math.max(0, creep.pos.y - 0.6), { color: '#00ff00', font: 0.7, align: 'center' });
                                // if destination is in the same room, draw a line to it and a small circle
                                if (destRoom === creep.room.name) {
                                    vis.line(creep.pos.x, creep.pos.y, pos.x, pos.y, { color: '#00ff00', width: 0.08, opacity: 0.6 });
                                    vis.circle(pos.x, pos.y, { radius: 0.4, fill: 'transparent', stroke: '#00ff00' });
                                }
                            } catch (e) {
                                // visual draw may fail in tests; ignore
                            }

                            if ((creep as any).travelTo) {
                                // travelTo accepts position or object
                                (creep as any).travelTo(dest);
                            } else {
                                // fallback
                                creep.moveTo(pos as RoomPosition);
                            }
                        } catch (e) {
                            // fallback safe move
                            const pos = (dest as any).pos ? (dest as any).pos : dest as RoomPosition;
                            creep.moveTo(pos as RoomPosition);
                        }
                    };

                    // Debug helper
                    const logStatus = (msg: string) => console.log(`[PowerHauler:${haulerName}] ${msg}`);

                    // If the hauler is not in the bank room and is empty, travel to the bank room
                    if (hauler.room.name !== targetRoom && hauler.store.getUsedCapacity(RESOURCE_POWER) === 0) {
                        logStatus(`not in targetRoom ${targetRoom}, currentRoom=${hauler.room.name}, empty -> traveling to targetRoom`);
                        doTravelTo(hauler, new RoomPosition(25, 25, targetRoom));
                        continue;
                    }

                    // If in the bank room and have capacity, try to pickup dropped power
                    if (hauler.room.name === targetRoom && hauler.store.getFreeCapacity() > 0) {
                        const dropsInRoom = hauler.room.find(FIND_DROPPED_RESOURCES, { filter: r => r.resourceType === RESOURCE_POWER });
                        console.log(`[PowerHauler:${haulerName}] found ${dropsInRoom.length} dropped power items in room ${targetRoom}`);
                        const droppedPower = hauler.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
                            filter: r => r.resourceType === RESOURCE_POWER
                        });
                        if (droppedPower) {
                            const res = hauler.pickup(droppedPower);
                            console.log(`[PowerHauler:${haulerName}] pickup attempt for drop at ${droppedPower.pos} returned ${res}`);
                            if (res === ERR_NOT_IN_RANGE) {
                                logStatus(`pickup not in range, traveling to dropped power at ${droppedPower.pos}`);
                                doTravelTo(hauler, droppedPower.pos);
                            } else if (res === OK) {
                                logStatus(`picked up ${droppedPower.resourceType} x${droppedPower.amount}`);
                            } else {
                                logStatus(`pickup returned ${res}`);
                                // attempt to move to the drop anyway
                                doTravelTo(hauler, droppedPower.pos);
                            }
                        } else {
                            logStatus(`no dropped power found in room ${targetRoom}, moving to center`);
                            doTravelTo(hauler, new RoomPosition(25, 25, targetRoom));
                        }
                        continue;
                    }

                    // If hauler is carrying power, return to home room storage/terminal
                    if (hauler.store.getUsedCapacity(RESOURCE_POWER) > 0) {
                        const dest = room.terminal && room.terminal.my
                            ? room.terminal
                            : room.storage;
                        if (dest) {
                            const res = hauler.transfer(dest, RESOURCE_POWER);
                            console.log(`[PowerHauler:${haulerName}] transfer attempt to ${dest.structureType} returned ${res}`);
                            if (res === ERR_NOT_IN_RANGE) {
                                logStatus(`transfer target not in range, traveling to dest ${dest.pos}`);
                                doTravelTo(hauler, dest.pos);
                            } else if (res === OK) {
                                logStatus(`transferred power to ${dest.structureType}`);
                            } else {
                                logStatus(`transfer returned ${res}`);
                            }
                        } else {
                            logStatus(`no destination (terminal/storage) available in home room ${room.name}`);
                        }
                        continue;
                    }
                    // If none of the above matched, print a debug line so we can see why it's idle
                    logStatus(`idle: room=${hauler.room.name}, targetRoom=${targetRoom}, carry=${hauler.store.getUsedCapacity()}, free=${hauler.store.getFreeCapacity()}`);
                }
            }
        }
    }

    // Handle any powerHauler creeps that exist but are not currently tracked in any bank memory
    // This allows haulers to pick up dropped power even after the power bank structure has been removed.
    runStandaloneHaulers() {
        // Build set of hauler names already tracked by banks
        const tracked = new Set<string>();
        try {
            for (const rid in Memory.rooms) {
                const rmem = Memory.rooms[rid];
                if (!rmem || !rmem.powerHarvest || !rmem.powerHarvest.banks) continue;
                for (const b of rmem.powerHarvest.banks) {
                    if (b.haulerNames && Array.isArray(b.haulerNames)) {
                        for (const n of b.haulerNames) tracked.add(n);
                    }
                }
            }
        } catch (e) {}

        // For each alive hauler creep not tracked, attempt pickup/return logic
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (!creep) continue;
            if (creep.memory.role !== 'powerHauler') continue;
            if (tracked.has(name)) continue;

            const hauler = creep;
            const targetRoom = (hauler.memory as any).targetRoom || null;
            // find closest owned room to targetRoom to act as home; fallback to any owned room
            let homeRoomName = targetRoom ? getClosestOwnedRoom(targetRoom) : null;
            if (!homeRoomName) {
                for (const rn in Game.rooms) {
                    const rr = Game.rooms[rn];
                    if (rr.controller && rr.controller.my) { homeRoomName = rn; break; }
                }
            }
            const homeRoom = homeRoomName ? Game.rooms[homeRoomName] : null;

            const doTravelTo = (creep: Creep, dest: RoomPosition | { pos: RoomPosition } | RoomObject) => {
                try {
                    const pos = (dest as any).pos ? (dest as any).pos : dest as RoomPosition;
                    try {
                        const vis = creep.room.visual as any;
                        const destRoom = pos.roomName;
                        vis.text(`${destRoom}`, creep.pos.x, Math.max(0, creep.pos.y - 0.6), { color: '#00ff00', font: 0.7, align: 'center' });
                        if (destRoom === creep.room.name) {
                            vis.line(creep.pos.x, creep.pos.y, pos.x, pos.y, { color: '#00ff00', width: 0.08, opacity: 0.6 });
                            vis.circle(pos.x, pos.y, { radius: 0.4, fill: 'transparent', stroke: '#00ff00' });
                        }
                    } catch (e) {}

                    if ((creep as any).travelTo) {
                        (creep as any).travelTo(dest);
                    } else {
                        creep.moveTo(pos as RoomPosition);
                    }
                } catch (e) {
                    const pos = (dest as any).pos ? (dest as any).pos : dest as RoomPosition;
                    creep.moveTo(pos as RoomPosition);
                }
            };

            const logStatus = (msg: string) => console.log(`[PowerHauler:${name}] ${msg}`);

            // If we don't know targetRoom, idle
            if (!targetRoom) {
                logStatus(`no targetRoom in memory, idle`);
                continue;
            }

            if (hauler.room.name !== targetRoom && hauler.store.getUsedCapacity(RESOURCE_POWER) === 0) {
                logStatus(`standalone: not in targetRoom ${targetRoom} -> traveling there`);
                doTravelTo(hauler, new RoomPosition(25,25,targetRoom));
                continue;
            }

            if (hauler.room.name === targetRoom && hauler.store.getFreeCapacity() > 0) {
                const drops = hauler.room.find(FIND_DROPPED_RESOURCES, { filter: r => r.resourceType === RESOURCE_POWER });
                console.log(`[PowerHauler:${name}] standalone found ${drops.length} drops in ${targetRoom}`);
                const drop = hauler.pos.findClosestByPath(FIND_DROPPED_RESOURCES, { filter: r => r.resourceType === RESOURCE_POWER });
                if (drop) {
                    const res = hauler.pickup(drop);
                    console.log(`[PowerHauler:${name}] standalone pickup attempt returned ${res}`);
                    if (res === ERR_NOT_IN_RANGE) doTravelTo(hauler, drop.pos);
                    continue;
                } else {
                    doTravelTo(hauler, new RoomPosition(25,25,targetRoom));
                    continue;
                }
            }

            if (hauler.store.getUsedCapacity(RESOURCE_POWER) > 0) {
                const dest = homeRoom && homeRoom.terminal && homeRoom.terminal.my ? homeRoom.terminal : (homeRoom ? homeRoom.storage : null);
                if (dest) {
                    const res = hauler.transfer(dest, RESOURCE_POWER);
                    console.log(`[PowerHauler:${name}] standalone transfer to ${dest.structureType} returned ${res}`);
                    if (res === ERR_NOT_IN_RANGE) doTravelTo(hauler, dest.pos);
                    continue;
                } else {
                    logStatus(`standalone: no home dest to transfer to`);
                    continue;
                }
            }

            logStatus(`standalone idle: room=${hauler.room.name}, targetRoom=${targetRoom}, carry=${hauler.store.getUsedCapacity()}, free=${hauler.store.getFreeCapacity()}`);
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
        try { console.log(`[PowerHarvestOperation] actions tick ${Game.time} start`); } catch(e) {}
         for (const roomName in Game.rooms) {
             const room = Game.rooms[roomName];
             if (!room.controller || !room.controller.my) continue;

            // lightweight per-room debug so we can see why the operation may be silent
            try {
                const hasPH = !!room.memory.powerHarvest;
                const bankCount = room.memory.powerHarvest ? (room.memory.powerHarvest.banks || []).length : 0;
                console.log(`[PowerHarvestOperation] checking room ${roomName} owner=${room.controller?.owner?.username} hasPowerHarvest=${hasPH} banks=${bankCount}`);
            } catch (e) {}

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
                 const closestRoom = getClosestOwnedRoom(bank.room);
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
                 console.log(`PowerHarvestOperation in room ${room.name} managing bank in ${bank.room} at (${bank.pos.x},${bank.pos.y}) state: ${bank.state} claimedBy=${bank.claimedBy} ticksToDecay=${bank.ticksToDecay} power=${bank.power}`);
                 // Verbose: show existing hauler/fighter/healer counts
                 console.log(`  fighters=${bank.fighterNames?.length || 0}, healers=${bank.healerNames?.length || 0}, haulers=${bank.haulerNames?.length || 0}`);
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
         // After processing banks, also handle any standalone haulers (creeps that exist but whose bank memory may have been removed)
         try { this.runStandaloneHaulers(); } catch (e) { console.log(`runStandaloneHaulers threw: ${e}`); }
     }
 }
