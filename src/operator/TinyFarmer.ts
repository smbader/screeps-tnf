import { Operator } from "../classes/operator";
import {MapHelper} from "../utils/MapHelper";

interface TinyFarmerMemory extends CreepMemory {
    targetRoom: string;
    assignedTarget: Id<any>;
    target?: Id<any> | null;
}

export class TinyFarmerCreep extends Creep {
    memory!: TinyFarmerMemory;

    constructor(creepid: any, targetRoom: string, assignedTarget: Id<any>) {
        super(creepid);

        const baseMemory: CreepMemory = super.memory;
        this.memory.room = baseMemory.room;
        this.memory.targetRoom = targetRoom;
        this.memory.assignedTarget = assignedTarget;
    }
}

// An operator is a screep who performs an operation.
export class TinyFarmer extends Operator {

    creep: TinyFarmerCreep | null;

    constructor(name: string, room: Room, targetRoom: string, assignedTarget: Id<any>) {
        super(name, room);

        if (Game.creeps[this.name]) {
            this.creep = new TinyFarmerCreep(Game.creeps[this.name].id, targetRoom, assignedTarget);
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
        if (this.creep.store.getUsedCapacity() == 0) {
            this.creep.memory.working = true;
        }

        // While you're harvesting continue until you're full.
        if (this.creep.memory.working == true) {

            if (this.creep.ticksToLive && this.creep.ticksToLive < 1400 &&
                this.creep.pos.roomName == this.room.name &&
                this.creep.store.getUsedCapacity() == 0 && this.room.energyAvailable >= 300) {

                // Renew yourself.
                let spawn = this.creep.pos.findClosestByPath(FIND_MY_SPAWNS, {
                    filter: structure => (!(structure.spawning && structure.spawning.remainingTime >= 0))
                });
                if (spawn) {
                    let range = this.creep.pos.getRangeTo(spawn);

                    if (range > 9) {
                        // Already leaving
                    } else {
                        if (range == 1) {
                            spawn.renewCreep(this.creep);
                        } else {
                            this.creep.travelTo(spawn.pos);
                        }
                        return;
                    }
                }
            }
            this.creep.memory.target = this.creep.memory.assignedTarget;

            if (this.creep.memory.target == null) {

                if (this.creep.memory.assignedTarget) {
                    this.creep.memory.target = this.creep.memory.assignedTarget;
                }

                this.creep.say('68');
                return;

            } else {

                let target = Game.getObjectById(this.creep.memory.target);

                // Go to target room first.
                if (this.creep.pos.roomName != this.creep.memory.targetRoom) {
                    this.creep.travelTo(new RoomPosition(25, 25, this.creep.memory.targetRoom));
                    this.creep.say('58');
                    return;
                }

/*
                let keeper = target.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
                    filter: (c: Creep) => (
                        _.filter(c.body, function(bp){return bp.type == "ranged_attack"}).length > 0 ||
                        _.filter(c.body, function(bp){return bp.type == "attack"}).length > 0
                    )
                });
                if (keeper) {

                    let enemyRange = this.creep.pos.getRangeTo(keeper);
                    if (enemyRange <= 6) {
                        // move away
                        let exit = this.creep.pos.findClosestByPath(FIND_EXIT);
                        if (exit) {
                            this.creep.travelTo(exit);
                            this.creep.say('84');
                            return;
                        }
                    } else if (enemyRange == 7) {
                        this.creep.say('88');
                        return;
                    }
                }
*/
                let resources = target.pos.findInRange(FIND_DROPPED_RESOURCES, 5);
                if (resources.length > 0) {
                    let result = this.creep.pickup(resources[0]);
                    if (result == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(resources[0].pos);
                        this.creep.say('98 ' + target.pos.x + ',' + target.pos.y);
                        return;
                    }
                }
/*
                let container = target.pos.findInRange(FIND_STRUCTURES, 5);
                if (container && container.type == STRUCTURE_CONTAINER && container.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    const result = this.creep.withdraw(container, RESOURCE_ENERGY);
                    if (result == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(container.pos);
                        this.creep.say('🚚');
                        return;
                    } else if (result == OK) {
                        this.creep.say('🏗️');
                        return;
                    }
                }
*/
                let actionresult = this.creep.harvest(target);

                if (actionresult == ERR_NOT_IN_RANGE) {
                    if (this.creep.travelTo(target.pos) == ERR_NO_PATH) {
                        this.creep.say('107');
                        return;
                    }
                } else if (actionresult == ERR_INVALID_TARGET) {
                    this.creep.memory.target = null
                } else if (this.creep.store.getUsedCapacity() == this.creep.store.getCapacity()) {
                    this.creep.memory.working = false;
                    this.creep.memory.target = null;
                }

                this.creep.say('117');
                return;
            }

        } else {

            if (this.creep.memory.target == null) {

                // Go to target room first.
                if (this.creep.pos.roomName != this.room.name) {
                    this.creep.travelTo(new RoomPosition(25, 25, this.room.name));
                    return;
                }

                if (this.room.controller) {
                    let spawnConstruction = this.room.controller.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);

                    if (spawnConstruction) {
                        if (this.creep.build(spawnConstruction) == ERR_NOT_IN_RANGE) {
                            this.creep.travelTo(spawnConstruction.pos);
                            return;
                        }
                    }
                }


                let target = this.creep.pos.findClosestByPath<StructureContainer>(FIND_STRUCTURES, {
                    filter: structure => (structure.structureType == STRUCTURE_TERMINAL || structure.structureType == STRUCTURE_STORAGE)
                });

                if (target) {
                    this.creep.memory.target = target.id;
                }

                // controller.
                if (this.room.controller) {
                    if (this.creep.upgradeController(this.room.controller) == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(this.room.controller.pos);
                        return;
                    }
                }


            } else {


                let target = Game.getObjectById(this.creep.memory.target);
                let actionresult;
                for(const resourceType in this.creep.store) {
                    actionresult = this.creep.transfer(target, <"energy" | "power" | "ops" | "U" | "L" | "K" | "Z" | "O" | "H" | "X" | "OH" | "ZK" | "UL" | "G" | "UH" | "UO" | "KH" | "KO" | "LH" | "LO" | "ZH" | "ZO" | "GH" | "GO" | "UH2O" | "UHO2" | "KH2O" | "KHO2" | "LH2O" | "LHO2" | "ZH2O" | "ZHO2" | "GH2O" | "GHO2" | "XUH2O" | "XUHO2" | "XKH2O" | "XKHO2" | "XLH2O" | "XLHO2" | "XZH2O" | "XZHO2" | "XGH2O" | "XGHO2" | "mist" | "biomass" | "metal" | "silicon" | "utrium_bar" | "lemergium_bar" | "zynthium_bar" | "keanium_bar" | "ghodium_melt" | "oxidant" | "reductant" | "purifier" | "battery" | "composite" | "crystal" | "liquid" | "wire" | "switch" | "transistor" | "microchip" | "circuit" | "device" | "cell" | "phlegm" | "tissue" | "muscle" | "organoid" | "organism" | "alloy" | "tube" | "fixtures" | "frame" | "hydraulics" | "machine" | "condensate" | "concentrate" | "extract" | "spirit" | "emanation" | "essence">resourceType);
                }

                if (actionresult == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(target.pos);
                } else if (actionresult == ERR_FULL) {
                    this.creep.memory.target = null;
                } else if (this.creep.store.getUsedCapacity() == 0) {
                    this.creep.memory.target = null;
                    this.creep.memory.working = true;
                } else if (actionresult == OK) {

                }
            }
        }

    }


}
