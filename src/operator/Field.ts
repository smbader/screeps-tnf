import { Operator } from "../classes/operator";
import { MapHelper } from "../utils/MapHelper";

type FieldStructure = StructureSpawn | StructureExtension | StructureStorage | StructureContainer | StructureLink | StructureTerminal | StructureTower;
type StoreStructure = StructureTower | StructureSpawn | StructureExtension | StructureLink;

interface FieldMemory extends CreepMemory {
    fieldIndex: Number;
    primarySources: Array<Structure> | null;
    targetContainers: Array<Structure> | null;
}

export class FieldCreep extends Creep {
    memory!: FieldMemory;
    constructor(creepid: any) {
        super(creepid);
    }
}

// An operator is a screep who performs an operation.
export class Field extends Operator {
    memory: {
        roomname?: string;
        name?: string;
        fieldindex?: number;
        spawn?: { x: number, y: number };
        spawndirection: DirectionConstant;
        sources?: [{ x: number, y: number }];
        containers?: [{ x: number, y: number }];
        containeridx: number;
    };

    creep: FieldCreep | null;

    constructor(name: string, room: Room, fieldIndex: number) {
        super(name, room);
        this.memory = {
            spawndirection: room.memory.config['field' + fieldIndex].spawndirection,
            containeridx: 0,
        };
        this.memory.name = name;
        this.memory.roomname = room.name;
        this.memory.fieldindex = fieldIndex;

        if (Game.creeps[this.name]) {
            this.creep = new FieldCreep(Game.creeps[this.name].id);
        } else {
            this.creep = null;
        }
        this.room = room;
    }

    actions() {
        let lastcpucheck = Game.cpu.getUsed();
        // Creep may not exist yet.
        const creep = this.creep;
        if (!creep) return;

        // Cache memory and config references for reuse
        const mem = creep.memory;
        const config = this.room.memory.config['field' + this.memory.fieldindex];
        const parkPos = new RoomPosition(config.parkingspot.x, config.parkingspot.y, this.room.name);

        // State management - avoid deep comparisons
        if (creep.store[RESOURCE_ENERGY] === creep.store.getCapacity()) mem.working = false;
        if (creep.store[RESOURCE_ENERGY] === 0 && mem.working === false) mem.working = true;

        // --- HARVESTING/RETRIEVAL (working === true) ---
        if (mem.working == null || mem.working === true) {
            const sources = config.sources;
            let foundTarget = false;

            const potentialTargets: FieldStructure[] = [];
            for (const src of sources) {
                const structure = this.room.find<FieldStructure>(FIND_STRUCTURES, {filter: (structure) => {
                    return (
                            structure.structureType === STRUCTURE_LINK ||
                            structure.structureType === STRUCTURE_STORAGE ||
                            structure.structureType === STRUCTURE_CONTAINER ||
                            structure.structureType === STRUCTURE_TERMINAL
                        ) &&
                        ((structure as AnyStoreStructure).store?.getUsedCapacity(RESOURCE_ENERGY) > 0) &&
                        (src.x === structure.pos.x && src.y === structure.pos.y)
                    }
                });
                if (structure.length > 0) potentialTargets.push(structure[0]);
            }
            let target: Structure | null = null;
            if (potentialTargets.length > 0) {
                target = creep.pos.findClosestByPath(potentialTargets);
            }
            if (target) {
                const result = creep.withdraw(target, RESOURCE_ENERGY);
                if (result === ERR_NOT_IN_RANGE) {
                    creep.travelTo(target.pos);
                    Game.map.visual.line(creep.pos, target.pos, { color: "#ff0000", lineStyle: "dashed" });
                }
                foundTarget = true;
            }

            // If no direct source targets found, fallback for low level rooms
            if (!foundTarget && creep.room.controller?.level && creep.room.controller.level < 5) {
                const containerOrStorage = creep.room.find(FIND_STRUCTURES, {
                    filter: structure =>
                        (structure.structureType === STRUCTURE_CONTAINER || structure.structureType === STRUCTURE_STORAGE) &&
                        (structure as AnyStoreStructure).store?.getUsedCapacity(RESOURCE_ENERGY) > 0
                });
                if (containerOrStorage.length > 0) {
                    const result = creep.withdraw(containerOrStorage[0], RESOURCE_ENERGY);
                    if (result === ERR_NOT_IN_RANGE) {
                        creep.travelTo(containerOrStorage[0].pos);
                        Game.map.visual.line(creep.pos, containerOrStorage[0].pos, { color: "#ff0000", lineStyle: "dashed" });
                    } else if (result === ERR_NOT_ENOUGH_ENERGY) {
                        const chemistPark = this.room.memory.config.chemist?.parking;
                        if (chemistPark && !(creep.pos.x == chemistPark.x && creep.pos.y == chemistPark.y)) {
                            creep.travelTo(new RoomPosition(chemistPark.x, chemistPark.y, this.room.name));
                        }
                    }
                } else {
                    if (!(creep.pos.x == parkPos.x && creep.pos.y == parkPos.y)) {
                        creep.travelTo(parkPos);
                    }
                }
            } else if (!foundTarget) {
                // If no work to do, park
                if (!(creep.pos.x == parkPos.x && creep.pos.y == parkPos.y)) {
                    creep.travelTo(parkPos);
                }
            }
        }

        // --- DELIVERY (working === false) ---
        else {

            const containers = config.containers;
            // Batch all structures once for efficient filtering
            const structures = this.room.find<FieldStructure>(FIND_STRUCTURES, {
                filter: (structure) => {
                    return (
                        structure.structureType === STRUCTURE_EXTENSION ||
                        structure.structureType === STRUCTURE_SPAWN ||
                        structure.structureType === STRUCTURE_LINK ||
                        structure.structureType === STRUCTURE_TOWER ||
                        structure.structureType === STRUCTURE_TERMINAL
                    ) &&
                        (structure as AnyStoreStructure).store?.getFreeCapacity(RESOURCE_ENERGY) > 0
                }
            });

            let foundTarget = false;
            let target = null;
            // looping through all empty containers in the room
            for (let i = 0; i < structures.length; i++) {
                for (let j = 0; j < containers.length; j++) {
                    if (containers[j].x == structures[i].pos.x && containers[j].y == structures[i].pos.y) {
                        target = structures[i];
                        foundTarget = true;
                        break
                    }
                }
                if (foundTarget) {break;}
            }
            if (target) {
                const result = creep.transfer(target, RESOURCE_ENERGY);
                if (result === ERR_NOT_IN_RANGE) {
                    creep.travelTo(target.pos);
                } else if (result == OK) {
                } else {
                    console.log(`FieldCreep ${creep.name} failed to transfer energy to target: ${result}`);
                }
                return;
            }

            if (!(creep.pos.x == parkPos.x && creep.pos.y == parkPos.y)) {
                creep.travelTo(parkPos);
            }
        }
    }
}
