import {Operator} from "../classes/operator";

import {MapHelper} from "../utils/MapHelper";
type GSResourceTypes = "energy" | "power" | "ops" | "U" | "L" | "K" | "Z" | "O" | "H" | "X" | "OH" | "ZK" | "UL" | "G" | "UH" | "UO" | "KH" | "KO" | "LH" | "LO" | "ZH" | "ZO" | "GH" | "GO" | "UH2O" | "UHO2" | "KH2O" | "KHO2" | "LH2O" | "LHO2" | "ZH2O" | "ZHO2" | "GH2O" | "GHO2" | "XUH2O" | "XUHO2" | "XKH2O" | "XKHO2" | "XLH2O" | "XLHO2" | "XZH2O" | "XZHO2" | "XGH2O" | "XGHO2" | "mist" | "biomass" | "metal" | "silicon" | "utrium_bar" | "lemergium_bar" | "zynthium_bar" | "keanium_bar" | "ghodium_melt" | "oxidant" | "reductant" | "purifier" | "battery" | "composite" | "crystal" | "liquid" | "wire" | "switch" | "transistor" | "microchip" | "circuit" | "device" | "cell" | "phlegm" | "tissue" | "muscle" | "organoid" | "organism" | "alloy" | "tube" | "fixtures" | "frame" | "hydraulics" | "machine" | "condensate" | "concentrate" | "extract" | "spirit" | "emanation" | "essence";


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
    isStorage: Boolean;
    isController: Boolean;

    constructor(name: string, room: Room, sourceid: string, isStorage: boolean, isController: boolean = false) {
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
        this.isStorage = isStorage;
        this.isController = isController;
    }

    actions() {
        // Creep may not exist yet.
        if (!this.creep) {
            return;
        }

        if (this.creep.store.getUsedCapacity() == this.creep.store.getCapacity()) {
            this.creep.memory.working = false;
        }
        if (this.creep.store.getUsedCapacity() == 0 && this.creep.memory.working == false) {
            this.creep.memory.working = true;
            this.creep.memory.targetResources = null;
            this.creep.memory.targetContainer = null;
        }


        if (this.isController) {

            if (this.room.storage) {
                if (this.creep.memory.working == null || this.creep.memory.working == true) {
                    if (this.creep.withdraw(this.room.storage, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(this.room.storage.pos);
                        this.creep.say('🚚');
                        return;
                    } else {
                        this.creep.say('🏗️');
                        return;
                    }
                } else {

                    if (this.room.controller && this.creep.pos.getRangeTo(this.room.controller) > 3) {
                        this.creep.travelTo(this.room.controller.pos);
                        this.creep.say('⚡');
                        return;
                    } else {
                        this.creep.say('🔋');
                        return;
                    }
                }
            }
            return;
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

            if (this.isStorage) {

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
                    return;
                }


                let containers = this.creep.room.find<StructureContainer>(FIND_STRUCTURES, {
                    filter: (s) => s.structureType == STRUCTURE_CONTAINER
                });

                let targetContainer = null;
                let maxEnergy = 0;

                for (let container of containers) {

                    let notThisContainer = false;
                    if (this.creep.room.memory.config.fieldContainers) {
                        for (const fc of this.creep.room.memory.config.fieldContainers) {
                            if (container.pos.x == fc.x && container.pos.y == fc.y ) {
                                notThisContainer = true;
                            }
                        }
                    }
                    if (notThisContainer) {
                        continue;
                    }

                    if (container.store.getUsedCapacity(RESOURCE_ENERGY) > maxEnergy) {
                        maxEnergy = container.store[RESOURCE_ENERGY];
                        targetContainer = container;
                    }
                }

                if (targetContainer && maxEnergy > 0) {
                    this.creep.memory.targetContainer = targetContainer.id;
                    const result = this.creep.withdraw(targetContainer, RESOURCE_ENERGY);
                    if (result == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(targetContainer.pos);
                        this.creep.say('🚚');
                        return;
                    } else if (result == OK) {
                        this.creep.say('🏗️');
                        return;
                    }
                    return;
                }

                // move away from spawn.
                let target = this.creep.pos.findClosestByPath<StructureSpawn>(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return (structure.structureType == STRUCTURE_SPAWN);
                    }
                });
                if (target && this.creep.pos.getRangeTo(target) < 2) {
                    this.creep.travelTo(RoomPosition(25,25, this.creep.room.name));
                }

                return;
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
            if (
                (this.creep.name.startsWith('RemoteHauler') &&
                    storage &&
                    (storage.store.getUsedCapacity(RESOURCE_ENERGY) < 20000 || this.creep.room.controller?.level == 8) )
                    || this.isStorage) {
                this.creep.say(this.creep.name);
                if (this.creep.transfer(storage, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(storage.pos);
                    this.creep.say('175');
                }
                return;
            } else if (this.creep.name.startsWith('RemoteHauler')) {
                // Find the nearest empty extension           or spawn
                const closestEmpty = MapHelper.getClosestEmpty(this.creep);
                if (closestEmpty) {
                    if (this.creep.transfer(closestEmpty, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(closestEmpty.pos);
                        this.creep.say('195');
                    }
                } else {
                    // Go to storage if no empty found
                    if (storage) {
                        if (this.creep.transfer(storage, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                            this.creep.travelTo(storage.pos);
                            this.creep.say('200');
                        }
                    }
                }
                return;
            }

            if (this.creep.store.getUsedCapacity(RESOURCE_ENERGY) != this.creep.store.getUsedCapacity()) {
                for(const resourceType in this.creep.store) {

                    if (this.creep.transfer(storage, <GSResourceTypes>resourceType) == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(storage.pos);
                        this.creep.say('175');
                        return;
                    }
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
