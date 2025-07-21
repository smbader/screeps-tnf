import {filter} from "lodash";
import {Operator} from "../classes/operator";

import {MapHelper} from "../utils/MapHelper";

interface HaulerMemory extends CreepMemory {
    targetResources: Id<Resource> | null;
    targetContainer: Id<StructureContainer> | null;
}

export class HaulerCreep extends Creep {
    memory!: HaulerMemory;

    constructor(creepid: any) {
        super(creepid);
    }
}

// An operator is a screep who performs an operation.
export class Hauler extends Operator {
    memory: {
        sourceid?: any;
        batteryid?: any;
        roomname?: string;
        name?: string;
    };

    creep: HaulerCreep | null;

    constructor(name: string, room: Room, sourceid: string) {
        super(name, room);

        this.memory = {};
        this.memory.name = name;
        this.memory.roomname = room.name;
        this.memory.sourceid = sourceid;

        if (Game.creeps[this.name]) {
            this.creep = new HaulerCreep(Game.creeps[this.name].id);
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

        if (this.creep.store.getUsedCapacity() == this.creep.store.getCapacity()) {
            this.creep.memory.working = false;
        }
        if (this.creep.store[RESOURCE_ENERGY] == 0 && this.creep.memory.working == false) {
            this.creep.memory.working = true;
            this.creep.memory.targetResources = null;
            this.creep.memory.targetContainer = null;
        }

        // While you're harvesting continue until you're full.
        if (this.creep.memory.working == null || this.creep.memory.working == true) {

            if (this.creep.memory.targetResources != null) {
                const target = Game.getObjectById(this.creep.memory.targetResources);

                if (target != null) {
                    const result = this.creep.pickup(target);
                    if (result == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(target.pos);
                        this.creep.say('🚚');
                        return;
                    } else if (result == OK) {
                        this.creep.say('🏗️');
                        return;
                    }
                } else {
                    this.creep.memory.targetResources = null;
                }
            } else if (this.creep.memory.targetContainer != null) {

                const target = Game.getObjectById(this.creep.memory.targetContainer);
                if (target != null) {
                    const result = this.creep.withdraw(target, RESOURCE_ENERGY);
                    if (result == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(target.pos);
                        this.creep.say('🚚');
                        return;
                    } else if (result == OK) {
                        this.creep.say('🏗️');
                        return;
                    }
                } else {
                    this.creep.memory.targetResources = null;
                }
            }

            let target = this.creep.pos.findClosestByRange<StructureContainer>(FIND_STRUCTURES, {
                filter: structure => structure.structureType == STRUCTURE_CONTAINER
            });
            let sourceNode = Game.getObjectById<Source>(this.memory.sourceid);
            if (sourceNode) {
                target = sourceNode.pos.findClosestByRange<StructureContainer>(FIND_STRUCTURES, {
                    filter: structure => structure.structureType == STRUCTURE_CONTAINER
                });
            }
            if (target) {
                this.creep.memory.targetContainer = target.id;
                const result = this.creep.withdraw(target, RESOURCE_ENERGY);
                if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(target.pos);
                    this.creep.say('🚚');
                    return;
                } else if (result == OK) {
                    this.creep.say('🏗️');
                    return;
                }
            }

            const targets = this.creep.room.find(FIND_DROPPED_RESOURCES);
            if (targets.length > 0) {
                let target = targets[0];

                for (const t in targets) {
                    const ttarget = targets[t];
                    if (ttarget.resourceType == RESOURCE_ENERGY) {
                        if (!target) {
                            target = ttarget;
                            continue;
                        }
                    }
                    if (ttarget.amount > target.amount) {
                        target = ttarget;
                    }
                }

                this.creep.memory.targetResources = target.id;
                const result = this.creep.pickup(target);
                this.creep.say('🏗️');
                if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(target.pos);
                    this.creep.say('🚚');
                }
            } else {
                // move away from spawn.
                let target = this.creep.pos.findClosestByPath<StructureSpawn>(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return (structure.structureType == STRUCTURE_SPAWN);
                    }
                });
                if (target && this.creep.pos.getRangeTo(target) < 2) {
                    this.creep.travelTo(RoomPosition(25,25, this.creep.room.name));
                }
            }
        } else {

            if (!this.room.memory.config) {
                if (this.room.controller && this.room.controller.pos.getRangeTo(this.creep) > 3) {
                    this.creep.travelTo(this.room.controller.pos);
                    this.creep.say('🏭');
                    return;
                }
            }

            let storage = this.room.find<StructureStorage>(FIND_MY_STRUCTURES, {
                filter: structure => structure.structureType == STRUCTURE_STORAGE &&
                    structure.store.getUsedCapacity() < structure.store.getCapacity()
            })[0];

            // If remote hauler, go to storage
            if (this.creep.name.startsWith('RemoteHauler') && storage) {
                this.creep.say(this.creep.name);
                if (this.creep.transfer(storage, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(storage.pos);
                    this.creep.say('175');
                    return;
                }
            }

            let storagelinkpos = this.room.memory.config.storagelink;
            let controllerLinkpos = this.room.memory.config.controllerLink;

            var storagelink = this.creep.room.find<StructureLink>(FIND_STRUCTURES, {
                filter: (structure) => {
                    return structure.pos.x === storagelinkpos.x
                        && structure.pos.y === storagelinkpos.y
                        && structure.structureType == STRUCTURE_LINK;
                }
            });

            var controllerLink = this.creep.room.find<StructureLink>(FIND_STRUCTURES, {
                filter: (structure) => {
                    return structure.pos.x === controllerLinkpos.x
                        && structure.pos.y === controllerLinkpos.y
                        && structure.structureType == STRUCTURE_LINK;
                }
            });

            const empty = MapHelper.getClosestEmpty(this.creep);

            let sourceNode = Game.getObjectById<Source>(this.memory.sourceid);

            if (empty && this.room.energyAvailable < 300 && sourceNode && sourceNode.room.name == this.creep.room.name) {
                if (this.creep.transfer(empty, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(empty.pos);
                    this.creep.say('205');
                    return;
                }
            } else if ((storagelink.length > 0 && controllerLink.length > 0) || (storage && storage.store.getUsedCapacity() < 100000)) {
                this.creep.say(this.creep.name);
                for(let resourceType in this.creep.store) {
                }
                if (this.creep.transfer(storage, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(storage.pos);
                    this.creep.say('213');
                    return;
                }
            } else {
                if (controllerLinkpos && this.creep.pos.getRangeTo(controllerLinkpos.x, controllerLinkpos.y) > 1) {
                    this.creep.travelTo(new RoomPosition(controllerLinkpos.x, controllerLinkpos.y, this.creep.room.name));
                    this.creep.say('218');
                    return;
                } else if (this.room.controller && this.room.controller.pos.getRangeTo(this.creep) > 1) {
                    this.creep.travelTo(this.room.controller.pos);
                    this.creep.say('221');
                    return;
                }
            }
            this.creep.say('💤');
        }
    }
}
