import { Operator } from "../classes/operator";
import { MapHelper } from "../utils/MapHelper";
import { filter } from "lodash";

type FieldStructure = StructureSpawn|StructureExtension|StructureStorage|StructureContainer|StructureLink|StructureTerminal;
type StoreStructure = StructureTower|StructureSpawn|StructureExtension|StructureLink;

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
        spawn?: { x:number, y:number };
        spawndirection: DirectionConstant;
        sources?: [ { x:number, y:number } ];
        containers?: [ { x:number, y:number } ];
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
        // Creep may not exist yet.
        if (!this.creep) {
            return;
        }

        if (this.creep.store[RESOURCE_ENERGY] == this.creep.store.getCapacity()) {
            this.creep.memory.working = false;
        }
        if (this.creep.store[RESOURCE_ENERGY] == 0 && this.creep.memory.working == false) {
            this.creep.memory.working = true;
        }

        // While you're harvesting continue until you're full.
        if (this.creep.memory.working == null || this.creep.memory.working == true) {

            let sources = this.room.memory.config['field' + this.memory.fieldindex].sources;

            for (let i = this.memory.containeridx; i < sources.length; i++) {

                let target = this.creep.pos.findClosestByPath<FieldStructure>(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return structure.pos.x === sources[i].x && structure.pos.y === sources[i].y &&
                            (structure.structureType == STRUCTURE_LINK ||
                                structure.structureType == STRUCTURE_STORAGE) &&
                            structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
                    }
                });
                if (target) {
                    const result = this.creep.withdraw(target, RESOURCE_ENERGY);
                    this.creep.say('🏗️');
                    if (result == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(target.pos);
                        this.creep.say('🚚');
                        Game.map.visual.line(this.creep.pos, target.pos,
                            {color: '#ff0000', lineStyle: 'dashed'});
                        return;
                    } else if (result == OK) {
                        return;
                    }
                }
            }

            // IF I CAN'T FIND MY LISTED SOURCES
            if (this.creep.room.controller && this.creep.room.controller.level < 5) {
                const target = this.creep.pos.findClosestByRange<FieldStructure>(FIND_STRUCTURES, {
                    filter: structure => (structure.structureType == STRUCTURE_CONTAINER || structure.structureType == STRUCTURE_STORAGE)
                        && structure.store[RESOURCE_ENERGY] > 0
                });
                if (target) {
                    const result = this.creep.withdraw(target, RESOURCE_ENERGY);
                    if (result == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(target.pos);
                        this.creep.say('🚚');
                        Game.map.visual.line(this.creep.pos, target.pos, {color: '#ff0000', lineStyle: 'dashed'});
                        return;
                    } else if (result == ERR_NOT_ENOUGH_ENERGY) {
                        this.creep.travelTo(this.room.memory.config.chemist.parking.x, this.room.memory.config.chemist.parking.y);
                        return;
                    } else if (result == OK) {
                        return;
                    }
                    this.creep.say('w' + result);
                }
            }

            this.creep.travelTo(new RoomPosition(this.room.memory.config['field' + this.memory.fieldindex].parkingspot.x,
                this.room.memory.config['field' + this.memory.fieldindex].parkingspot.y, this.room.name));
            this.creep.say('💤');
            // END

        } else {


            let containers = this.room.memory.config['field' + this.memory.fieldindex].containers;

            //for (let i = this.memory.containeridx; i < containers.length; i++) {
            for (let i = 0; i < containers.length; i++) {

                var targets = this.creep.room.find<FieldStructure>(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return structure.pos.x === containers[i].x && structure.pos.y === containers[i].y &&
                            (structure.structureType == STRUCTURE_EXTENSION ||
                                structure.structureType == STRUCTURE_SPAWN ||
                                structure.structureType == STRUCTURE_TOWER ||
                                structure.structureType == STRUCTURE_LINK ||
                                structure.structureType == STRUCTURE_TERMINAL) &&
                            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
                });

                if (targets.length > 0) {
                    let result = this.creep.transfer(targets[0], RESOURCE_ENERGY);
                    if (result == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(targets[0].pos);
                        this.creep.say('🛢️');
                        return;
                    } else if (result == OK) {
                        return;
                    }
                }
            }
            this.creep.travelTo(new RoomPosition(this.room.memory.config['field' + this.memory.fieldindex].parkingspot.x,
                this.room.memory.config['field' + this.memory.fieldindex].parkingspot.y, this.room.name));
            this.creep.say('💤');

        }
    }
}
