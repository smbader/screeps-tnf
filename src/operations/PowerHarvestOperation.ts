import { Operation } from "../classes/operation";

//try { console.log(`PowerHarvestOperation module loaded`); } catch (e) {}

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

    // Helper: append an event to a bank's timeline (keeps only recent N entries)
    private appendTimeline(bank: PowerBankMemory, event: string, value?: any, maxEntries = 12) {
        try {
            if (!bank.timeline) bank.timeline = [];
            bank.timeline.push({ tick: Game.time, event, value });
            if (bank.timeline.length > maxEntries) bank.timeline = bank.timeline.slice(-maxEntries);
        } catch (e) {}
    }

    // Helper: draw lightweight visuals for a bank to aid tuning
    private drawBankVisuals(bank: PowerBankMemory) {
        try {
            const pos = new RoomPosition(bank.pos.x, bank.pos.y, bank.room);
            const vis = new RoomVisual(bank.room);
            // Draw a small circle at bank position with color based on state
            const colorMap: { [k: string]: string } = { waiting: '#ffff00', breaking: '#ff6600', hauling: '#00ccff', done: '#999999' };
            const col = colorMap[bank.state] || '#ffffff';
            vis.circle(pos.x, pos.y, { radius: 0.6, fill: 'transparent', stroke: col, opacity: 0.8 });
            // Show state and TTL above the bank
            vis.text(`${bank.state} ${bank.ticksToDecay}`, pos.x, Math.max(0, pos.y - 0.8), { color: col, font: 0.6, align: 'center' });
            // Show a compact timeline string below the bank (most recent 3 events)
            if (bank.timeline && bank.timeline.length > 0) {
                const recent = bank.timeline.slice(-3).map(t => `${Game.time - t.tick}:${t.event}`);
                vis.text(recent.join(' '), pos.x, Math.min(49, pos.y + 0.8), { color: '#ffffff', font: 0.45, align: 'center' });
            }
        } catch (e) {
            // ignore visual errors in headless/test environments
        }
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
        const observedRoom = Game.rooms[roomName];
        if (!observedRoom) return;

        const powerbanks = observedRoom.find<StructurePowerBank>(FIND_STRUCTURES, {
            filter: structure => structure.structureType === STRUCTURE_POWER_BANK
        });

        // Ensure memory banks array exists
        if (!room.memory.powerHarvest.banks) room.memory.powerHarvest.banks = [];

        // For each observed bank, merge into existing memory entry (preserve arrays/timeline) or create new entry
        for (const bank of powerbanks) {
            // try to find existing entry for this bank by room+pos
            let existing = room.memory.powerHarvest.banks.find(b => b.room === roomName && b.pos.x === bank.pos.x && b.pos.y === bank.pos.y);
            if (existing) {
                // update dynamic fields but preserve names/timeline/home/claimedBy/state unless they are missing
                existing.ticksToDecay = bank.ticksToDecay;
                existing.power = bank.power;
                existing.lastChecked = Game.time;
            } else {
                const pb: PowerBankMemory = {
                    room: roomName,
                    pos: bank.pos,
                    ticksToDecay: bank.ticksToDecay,
                    power: bank.power,
                    lastChecked: Game.time,
                    state: "waiting",
                    claimedBy: undefined,
                    timeline: [{ tick: Game.time, event: 'seen', value: { power: bank.power, ttl: bank.ticksToDecay } }]
                } as PowerBankMemory;
                room.memory.powerHarvest.banks.push(pb);
            }
        }

        // Optionally remove banks from memory for this observed room that are no longer present in the observed room
        room.memory.powerHarvest.banks = room.memory.powerHarvest.banks.filter(b => b.room !== roomName || powerbanks.some(pb => pb.pos.x === b.pos.x && pb.pos.y === b.pos.y));
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
        // Only block starting new operations if the bank is still in waiting and its TTL is too low.
        // If we've already started breaking, allow breakers to continue even if TTL has dropped below the threshold.
        if (bank.state === 'waiting' && bank.ticksToDecay < POWERBANK_MIN_TTL) return;

        // If an operation is not already underway, require >100k energy in storage before starting
        const operationActive = (bank.state === 'breaking' || bank.state === 'hauling' || (bank.fighterNames && bank.fighterNames.length > 0) || (bank.healerNames && bank.healerNames.length > 0) || (bank.haulerNames && bank.haulerNames.length > 0));
        if (!operationActive) {
            const storageEnergy = (room.storage && (room.storage.store as any) ? (room.storage.store[RESOURCE_ENERGY] || 0) : 0);
            if (storageEnergy <= 100000) {
                //console.log(`[PowerHarvest:${room.name}] insufficient storage energy (${storageEnergy}) to start breakers for bank ${bank.room}; need >100000 - skipping`);
                return;
            }
        }

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
                            //console.log(`[PowerHarvest:${room.name}] spawned fighter ${pfName} for bank ${bank.room}`);
                            break;
                        } else {
                            //console.log(`[PowerHarvest] Failed to spawn fighter ${pfName} in ${room.name}: ${result}`);
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
                            //console.log(`[PowerHarvest:${room.name}] spawned healer ${phName} for bank ${bank.room}`);
                            break;
                        }
                    }
                }
            }
        }

        // If we have any fighters (spawned now or previously), mark the bank as breaking so the operation knows it's active
        if ((bank.fighterNames && bank.fighterNames.length > 0) || (bank.healerNames && bank.healerNames.length > 0)) {
            const prev = bank.state;
            bank.state = 'breaking';
            if (prev !== 'breaking') {
                this.appendTimeline(bank, 'start_breaking');
            }
        }
    }

    spawnHaulers(room: Room, bank: PowerBankMemory) {
        if (bank.state === "hauling") return; // Already hauling
        if (bank.homeRoom !== room.name) return;

        //console.log(`[PowerHarvest:${room.name}] spawnHaulers called for bank ${bank.room} (state=${bank.state}, power=${bank.power}, ticksToDecay=${bank.ticksToDecay})`);

        // If an operation is not already underway, require >100k energy in storage before spawning haulers
        // Note: we already return above if bank.state === 'hauling', so that case is removed to avoid a TS narrowing error
        const operationActive = (bank.state === 'breaking' || (bank.fighterNames && bank.fighterNames.length > 0) || (bank.healerNames && bank.healerNames.length > 0) || (bank.haulerNames && bank.haulerNames.length > 0));
        if (!operationActive) {
            const storageEnergy = (room.storage && (room.storage.store as any) ? (room.storage.store[RESOURCE_ENERGY] || 0) : 0);
            if (storageEnergy <= 100000) {
                //console.log(`[PowerHarvest:${room.name}] insufficient storage energy (${storageEnergy}) to spawn haulers for bank ${bank.room}; need >100000 - skipping`);
                return;
            }
        }

        const breakTime = this.estimateBreakTime(bank);console.log(`Estimated break time for bank in ${bank.room}: ${breakTime} ticks`);
        const haulTravelTime = this.estimateHaulerTravelTime(room, bank.room);console.log(`Estimated hauler travel time to ${bank.room}: ${haulTravelTime} ticks`);
        const haulerLeadTime = haulTravelTime + HAULER_BUFFER;console.log(`Hauler lead time for bank in ${bank.room}: ${haulerLeadTime} ticks`);
        const ticksUntilSpawn = breakTime - haulerLeadTime;
        //console.log(`Power bank in ${bank.room} ticksUntilSpawn (negative => spawn now): ${ticksUntilSpawn}`);
        // Spawn haulers when the remaining estimated break time is less than or equal to the lead time required for haulers to arrive
        if (breakTime <= haulerLeadTime) {
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
                                 //console.log(`[PowerHarvest:${room.name}] spawned hauler ${haulerName} for bank ${bank.room}`);
                                 this.appendTimeline(bank, 'spawn_hauler', { name: haulerName });
                                 break;
                             } else {
                                 //console.log(`[PowerHarvest:${room.name}] spawn attempt for ${haulerName} returned ${result}`);
                             }
                         }
                     }
                 }
             }
             bank.state = "hauling";
             // Append timeline entry for starting hauling (no conditional to avoid TS narrowing issues)
             this.appendTimeline(bank, 'start_hauling');
         }
     }

    runFighter(bank: PowerBankMemory) {
         if (bank.fighterNames) {
             for (const fighterName of bank.fighterNames) {
                 const fighter = Game.creeps[fighterName];
                 if (!fighter) continue;
                 if (fighter.memory.role === "powerFighter") {
                     //console.log(`[PowerFighter:${fighterName}] tick in room ${fighter.room.name}, target bank room ${bank.room}`);
                     if (fighter.room.name !== bank.room) {
                         //console.log(`[PowerFighter:${fighterName}] traveling to bank room ${bank.room}`);
                         try { (fighter as any).travelTo(new RoomPosition(25, 25, bank.room)); } catch(e) { fighter.moveTo(new RoomPosition(25,25,bank.room)); }
                     } else {
                         const powerBank = fighter.pos.findClosestByPath(FIND_STRUCTURES, {
                             filter: s => s.structureType === STRUCTURE_POWER_BANK
                         });
                         if (powerBank) {
                             // Always attempt to attack the power bank. If not in range, move into range.
                             const attackRes = fighter.attack(powerBank);
                            if (attackRes === ERR_NOT_IN_RANGE) {
                                //console.log(`[PowerFighter:${fighterName}] attack not in range, moving to bank pos`);
                                try { (fighter as any).travelTo(powerBank.pos); } catch(e) { fighter.moveTo(powerBank.pos); }
                            } else if (attackRes !== OK) {
                                //console.log(`[PowerFighter:${fighterName}] attack returned ${attackRes}`);
                            }
                            if (attackRes === ERR_NOT_IN_RANGE) {
                                //console.log(`[PowerFighter:${fighterName}] attack not in range, moving to bank pos`);
                                try { (fighter as any).travelTo(powerBank.pos); } catch(e) { fighter.moveTo(powerBank.pos); }
                                this.appendTimeline(bank, 'attack_move', { fighter: fighterName });
                                bank.state = 'breaking';
                            } else if (attackRes === OK) {
                                //console.log(`[PowerFighter:${fighterName}] attacked power bank`);
                                this.appendTimeline(bank, 'attack', { fighter: fighterName });
                                bank.state = 'breaking';
                            } else {
                                //console.log(`[PowerFighter:${fighterName}] attack returned ${attackRes}`);
                                this.appendTimeline(bank, 'attack_err', { fighter: fighterName, code: attackRes });
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
                    //console.log(`[PowerHealer:${healerName}] tick in room ${healer.room.name}, target fighter ${healer.memory.targetFighter}`);
                    const fighter = Game.creeps[healer.memory.targetFighter];
                    if (fighter) {
                        if (healer.room.name !== bank.room) {
                            //console.log(`[PowerHealer:${healerName}] traveling to bank room ${bank.room}`);
                            try { (healer as any).travelTo(new RoomPosition(25, 25, bank.room)); } catch(e) { healer.moveTo(new RoomPosition(25,25,bank.room)); }
                        } else {
                            const range = healer.pos.getRangeTo(fighter);
                            if (range > 1) {
                                healer.rangedHeal(fighter);
                                //console.log(`[PowerHealer:${healerName}] rangedHeal, moving to fighter`);
                                try { (healer as any).travelTo(fighter.pos); } catch(e) { healer.moveTo(fighter.pos); }
                            } else {
                                healer.heal(fighter);
                            }
                        }
                    } else {
                        //console.log(`[PowerHealer:${healerName}] target fighter not found, moving to bank room ${bank.room}`);
                        try { (healer as any).travelTo(new RoomPosition(25, 25, bank.room)); } catch(e) { healer.moveTo(new RoomPosition(25,25,bank.room)); }
                     }
                 }
             }
         }
     }

    runHaulers(room: Room, bank: PowerBankMemory) {
        // draw visuals each tick for tuning
        try { this.drawBankVisuals(bank); } catch (e) {}
         if (bank.haulerNames) {
            //console.log(`[PowerHarvest:${room.name}] running haulers: ${bank.haulerNames.join(', ')}`);
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
                        //console.log(`[PowerHauler:${haulerName}] found ${dropsInRoom.length} dropped power items in room ${targetRoom}`);
                        const droppedPower = hauler.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
                            filter: r => r.resourceType === RESOURCE_POWER
                        });
                        if (droppedPower) {
                            const res = hauler.pickup(droppedPower);
                            //console.log(`[PowerHauler:${haulerName}] pickup attempt for drop at ${droppedPower.pos} returned ${res}`);
                            if (res === ERR_NOT_IN_RANGE) {
                                logStatus(`pickup not in range, traveling to dropped power at ${droppedPower.pos}`);
                                doTravelTo(hauler, droppedPower.pos);
                            } else if (res === OK) {
                                logStatus(`picked up ${droppedPower.resourceType} x${droppedPower.amount}`);
                                this.appendTimeline(bank, 'hauler_pickup', { hauler: haulerName, amount: droppedPower.amount });
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
                        // Prefer terminal if it has room for RESOURCE_POWER, otherwise use storage
                        let dest: StructureTerminal | StructureStorage | null = null;
                        try {
                            const term = room.terminal && room.terminal.my ? room.terminal : null;
                            const stor = room.storage ? room.storage : null;
                            if (term && (term.store.getFreeCapacity && term.store.getFreeCapacity(RESOURCE_POWER) > 0)) {
                                dest = term;
                            } else if (stor && (stor.store.getFreeCapacity && stor.store.getFreeCapacity(RESOURCE_POWER) > 0)) {
                                dest = stor;
                            } else if (term && term.store.getFreeCapacity && term.store.getFreeCapacity() > 0) {
                                // fallback: any free capacity in terminal
                                dest = term;
                            } else if (stor && stor.store.getFreeCapacity && stor.store.getFreeCapacity() > 0) {
                                dest = stor;
                            } else {
                                // fallback to terminal if exists, else storage
                                dest = term || stor;
                            }
                        } catch (e) {
                            // defensive: if store.getFreeCapacity with resource param isn't available, fallback to old behavior
                            dest = (room.terminal && room.terminal.my) ? room.terminal : (room.storage ? room.storage : null);
                        }

                        if (dest) {
                            const res = hauler.transfer(dest, RESOURCE_POWER);
                            //console.log(`[PowerHauler:${haulerName}] transfer attempt to ${dest.structureType} returned ${res}`);
                            if (res === ERR_NOT_IN_RANGE) {
                                logStatus(`transfer target not in range, traveling to dest ${dest.pos}`);
                                doTravelTo(hauler, dest.pos);
                            } else if (res === OK) {
                                logStatus(`transferred power to ${dest.structureType}`);
                                this.appendTimeline(bank, 'hauler_deposit', { hauler: haulerName, dest: dest.structureType });
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
                // Prefer terminal if it has room for RESOURCE_POWER, otherwise use storage
                let dest: StructureTerminal | StructureStorage | null = null;
                try {
                    const term = homeRoom && homeRoom.terminal && homeRoom.terminal.my ? homeRoom.terminal : null;
                    const stor = homeRoom && homeRoom.storage ? homeRoom.storage : null;
                    if (term && (term.store.getFreeCapacity && term.store.getFreeCapacity(RESOURCE_POWER) > 0)) {
                        dest = term;
                    } else if (stor && (stor.store.getFreeCapacity && stor.store.getFreeCapacity(RESOURCE_POWER) > 0)) {
                        dest = stor;
                    } else if (term && term.store.getFreeCapacity && term.store.getFreeCapacity() > 0) {
                        dest = term;
                    } else if (stor && stor.store.getFreeCapacity && stor.store.getFreeCapacity() > 0) {
                        dest = stor;
                    } else {
                        dest = term || stor;
                    }
                } catch (e) {
                    dest = (homeRoom && homeRoom.terminal && homeRoom.terminal.my) ? homeRoom.terminal : (homeRoom && homeRoom.storage ? homeRoom.storage : null);
                }

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
        //try { console.log(`[PowerHarvestOperation] actions tick ${Game.time} start`); } catch(e) {}
         for (const roomName in Game.rooms) {
             const room = Game.rooms[roomName];
             if (!room.controller || !room.controller.my) continue;

            // lightweight per-room debug so we can see why the operation may be silent
            try {
                // lightweight debug: presence of powerHarvest is available via room.memory.powerHarvest
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
                 //console.log(`PowerHarvestOperation in room ${room.name} managing bank in ${bank.room} at (${bank.pos.x},${bank.pos.y}) state: ${bank.state} claimedBy=${bank.claimedBy} ticksToDecay=${bank.ticksToDecay} power=${bank.power}`);
                 // Verbose: show existing hauler/fighter/healer counts
                 //console.log(`  fighters=${bank.fighterNames?.length || 0}, healers=${bank.healerNames?.length || 0}, haulers=${bank.haulerNames?.length || 0}`);
                 // append a per-iteration seen event so timeline includes TTL updates
                 this.appendTimeline(bank, 'seen', { ticksToDecay: bank.ticksToDecay, power: bank.power });

                 // Sync live creeps into bank memory arrays so we don't lose track of active breakers/haulers
                 try {
                     if (!bank.fighterNames) bank.fighterNames = [];
                     if (!bank.healerNames) bank.healerNames = [];
                     if (!bank.haulerNames) bank.haulerNames = [];
                     for (const cname in Game.creeps) {
                         const c = Game.creeps[cname];
                         if (!c || !c.memory) continue;
                         // fighters
                         if (c.memory.role === 'powerFighter' && c.memory.targetRoom === bank.room && !bank.fighterNames.includes(cname)) {
                             bank.fighterNames.push(cname);
                         }
                         // healers
                         if (c.memory.role === 'powerHealer' && c.memory.targetRoom === bank.room && !bank.healerNames.includes(cname)) {
                             bank.healerNames.push(cname);
                         }
                         // haulers
                         if (c.memory.role === 'powerHauler' && (c.memory.targetRoom === bank.room || (c.memory as any).targetRoom === bank.room) && !bank.haulerNames.includes(cname)) {
                             bank.haulerNames.push(cname);
                         }
                     }
                     // If we have fighters or healers present, ensure state reflects breaking
                     if ((bank.fighterNames && bank.fighterNames.length > 0) || (bank.healerNames && bank.healerNames.length > 0)) {
                         if (bank.state !== 'breaking') {
                             bank.state = 'breaking';
                             this.appendTimeline(bank, 'start_breaking');
                         }
                     }
                 } catch (e) {}
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
                         // log done state unconditionally to avoid TS narrowing errors
                         this.appendTimeline(bank, 'done');
                     }
                 }
             }
         }
         // After processing banks, also handle any standalone haulers (creeps that exist but whose bank memory may have been removed)
         try { this.runStandaloneHaulers(); } catch (e) { console.log(`runStandaloneHaulers threw: ${e}`); }
     }
 }
