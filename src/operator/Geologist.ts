import { Operator } from "../classes/operator";

interface GeologistMemory extends CreepMemory {
    targetRoom: string;
    target?: Id<any> | null;
}

export class GeologistCreep extends Creep {
    memory!: GeologistMemory;

    constructor(creepid: Id<Creep>, targetRoom: string) {
        super(creepid);
        this.memory.targetRoom = targetRoom;
    }
}

export class Geologist extends Operator {
    creep: GeologistCreep | null;

    constructor(name: string, room: Room) {
        super(name, room);
        const creepObj = Game.creeps[name];
        this.creep = creepObj ? new GeologistCreep(creepObj.id, room.name) : null;
        this.room = room;
    }

    actions() {
        const creep = this.creep;
        if (!creep) return;

        // Recompute working state based on creep's store
        if (creep.store.getFreeCapacity() === 0) {
            creep.memory.working = false;
        }
        if (creep.store.getUsedCapacity() === 0 && creep.memory.working === false) {
            creep.memory.working = true;
        }

        // --- Harvesting minerals ---
        if (creep.memory.working) {
            if (creep.ticksToLive && creep.ticksToLive < 60) {
                // Offload before death
                creep.memory.working = false;
                creep.memory.target = null;
                return;
            }
            // Select mineral target if none
            if (!creep.memory.target) {
                const mineral = this.room.find(FIND_MINERALS)[0];
                if (mineral) {
                    // Check for extractor present
                    const hasExtractor = mineral.pos.lookFor(LOOK_STRUCTURES)
                        .some(s => s.structureType === STRUCTURE_EXTRACTOR);
                    if (hasExtractor) {
                        creep.memory.target = mineral.id;
                    }
                }
                return;
            }

            // Harvest from mineral
            const mineral = Game.getObjectById<Mineral>(creep.memory.target);

            if (mineral) {
                const result = creep.harvest(mineral);
                if (result === ERR_NOT_IN_RANGE) {
                    creep.travelTo(mineral.pos);
                } else if (result !== OK) {
                    creep.memory.target = null;
                }
            } else {
                creep.memory.target = null;
            }
            if (creep.store.getFreeCapacity() === 0) {
                creep.memory.working = false;
                creep.memory.target = null;
            }
            return;
        }

        // --- Offloading minerals ---
        if (!creep.memory.target) {
            // Find closest storage or terminal with available space
            const targets = this.room.find(FIND_STRUCTURES, {
                filter: (s: Structure) =>
                    (s.structureType === STRUCTURE_STORAGE || s.structureType === STRUCTURE_TERMINAL) &&
                    (s as StructureStorage | StructureTerminal).store.getFreeCapacity() > 0
            }) as (StructureStorage | StructureTerminal)[];
            if (targets.length > 0) {
                // Prefer storage over terminal
                const storage = targets.find(t => t.structureType === STRUCTURE_STORAGE) || targets[0];
                creep.memory.target = storage.id;
            }
            return;
        }

        // Transfer all resources in creep's store to target
        const target = Game.getObjectById<StructureStorage | StructureTerminal>(creep.memory.target);
        if (target && (target.structureType === STRUCTURE_STORAGE || target.structureType === STRUCTURE_TERMINAL)) {
            let transferred = false;
            for (const resourceType in creep.store) {
                if (creep.store[resourceType as ResourceConstant] > 0) {
                    const result = creep.transfer(target, resourceType as ResourceConstant);
                    if (result === ERR_NOT_IN_RANGE) {
                        creep.travelTo(target.pos);
                        return;
                    } else if (result === ERR_FULL) {
                        creep.memory.target = null;
                        return;
                    } else if (result === OK) {
                        transferred = true;
                        // Only transfer one resource per tick for efficiency
                        break;
                    }
                }
            }
            // If nothing left to transfer, reset state
            if (creep.store.getUsedCapacity() === 0) {
                creep.memory.target = null;
                creep.memory.working = true;
            }
            return;
        } else {
            // Target is gone; reset and retry next tick
            creep.memory.target = null;
        }
    }
}
