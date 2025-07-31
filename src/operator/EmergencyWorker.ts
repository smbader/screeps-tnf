import { Operator } from "../classes/operator";
import { MapHelper } from "../utils/MapHelper";

interface EmergencyMemory extends CreepMemory {
    targetResources: Id<Resource> | null;
    targetContainer: Id<StructureContainer> | null;
    target?: Id<any> | null;
    action?: string;
};

export class EmergencyCreep extends Creep {

    memory!: EmergencyMemory;

    constructor(creepid: any) {
        super(creepid);
    }

};

// An operator is a screep who performs an operation.
export class EmergencyWorker extends Operator {

    memory: {
        sourceid?: any,
        roomname: string,
        targetroom: string,
        name?: string,
    }

    creep: EmergencyCreep | null;
    source: Source;
    targetroom: Room;

    constructor (name:string, room:Room, targetRoom:Room, sourceid:any) {
        super(name, room);

        this.memory = {
            roomname: room.name,
            targetroom: targetRoom.name,
        };
        this.memory.name = name;
        this.memory.sourceid = sourceid;


        this.source = Game.getObjectById(sourceid) as Source;

        if (Game.creeps[this.name]) {
            this.creep = new EmergencyCreep(Game.creeps[this.name].id);
        } else {
            this.creep = null;
        }

        this.room = room;
        this.targetroom = targetRoom;
    }

    actions() {

        // Creep may not exist yet.
        if (!this.creep) { return; }

        // While you're harvesting continue until you're full.
        if (this.creep.memory.working == true) {
            // Am I in range of the source?  If not, let's focus on that.
            //if (this.creep.pos.getRangeTo(this.source) > 6) {
            //    this.creep.say('closer');
            //    this.creep.travelTo(this.source.pos);
            //    return;
            //}

            if (this.creep.memory.target == null) {

                // Harvest is default, unless we find something else
                this.creep.memory.target = this.source.id;
                this.creep.memory.action = 'harvest';

                // Look for loose resources on the group near our source.
                let resources = this.creep.room.lookForAt(LOOK_RESOURCES, this.creep.room.memory.sources[this.memory.sourceid].container.x, this.creep.room.memory.sources[this.memory.sourceid].container.y);

                // Look for the nearest container to the source.
                let targets = this.source.pos.findInRange<StructureContainer>(FIND_STRUCTURES, 5,{
                    filter: (structure) => structure.structureType == STRUCTURE_CONTAINER
                });

                if (resources.length > 0) {
                    let target = resources[0];

                    for (let t in resources) {
                        let ttarget = resources[t];
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
                    this.creep.memory.target = target.id;
                    this.creep.memory.action = 'pickup';

                } else if (targets.length > 0) {

                    if (targets[0].store.getUsedCapacity(RESOURCE_ENERGY) > 50) {
                        let target = targets[0];
                        this.creep.memory.target = target.id;
                        this.creep.memory.action = 'withdraw';
                    }
                }
            } else {

                let target = Game.getObjectById(this.creep.memory.target);
                let actionresult = 0;
                if (target != null) {
                    if (this.creep.memory.action == 'withdraw') {
                        actionresult = this.creep.withdraw(target, RESOURCE_ENERGY);
                    } else if  (this.creep.memory.action == 'pickup') {
                        actionresult = this.creep.pickup(target);
                    } else if (this.creep.memory.action == 'harvest') {
                        actionresult = this.creep.harvest(target);
                    } else {
                        this.creep.memory.action = '';
                        this.creep.memory.target = null;
                        this.creep.memory.working = false;
                    }
                } else {
                    // something went missing
                    this.creep.memory.action = '';
                    this.creep.memory.target = null;
                }

                if (actionresult == ERR_NOT_IN_RANGE) {
                    if (this.creep.travelTo(target.pos) == ERR_NO_PATH) {
                        return;
                    }
                } else if (this.creep.store[RESOURCE_ENERGY] == this.creep.store.getCapacity()) {
                    this.creep.memory.action = '';
                    this.creep.memory.target = null;
                    this.creep.memory.working = false;
                }
                return;
            }

        } else {

            if (this.creep.memory.target == null) {

                // IF TOWERS NEED ENERGY
                var targets = this.creep.room.find<StructureTower>(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_TOWER &&
                            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 200;
                    }
                });

                let spawnConstruction = this.source.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
                let empty = MapHelper.getClosestEmpty(this.creep);
                // If this room has a field opertor present, just dump into storage.
                if (Memory.creeps["Field_" + this.room.name + "_0"] || Memory.creeps["Field_" + this.room.name + "_1"]) {
                    if (this.room.storage && this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 5000) {
                        empty = this.room.storage;
                    }

                }

                if (targets.length > 0) {
                    this.creep.memory.target = targets[0].id;
                    this.creep.memory.action = 'transfer';
                } else if (empty) {
                    this.creep.memory.target = empty.id;
                    this.creep.memory.action = 'transfer';
                } else if (spawnConstruction) {
                    this.creep.memory.target = spawnConstruction.id;
                    this.creep.memory.action = 'build';
                } else if (this.targetroom.controller) {
                    this.creep.memory.target = this.targetroom.controller.id;
                    this.creep.memory.action = 'upgrade';
                }

            } else {

                let target = Game.getObjectById(this.creep.memory.target);
                let actionresult = 0;

                if (target != null) {
                    if (this.creep.memory.action == 'build') {
                        actionresult = this.creep.build(target);
                    } else if  (this.creep.memory.action == 'transfer') {
                        actionresult = this.creep.transfer(target, RESOURCE_ENERGY);
                    } else if (this.creep.memory.action == 'upgrade') {
                        actionresult = this.creep.upgradeController(target);
                        if (actionresult == OK) {
                            this.creep.moveTo(target.pos);
                        }
                    } else {
                        this.creep.memory.action = '';
                        this.creep.memory.target = null;
                        this.creep.memory.working = true;
                    }
                } else {
                    // construction could have completed.
                    this.creep.memory.action = '';
                    this.creep.memory.target = null;
                }

                if (actionresult == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(target.pos);
                } else if (actionresult == ERR_FULL) {
                    this.creep.memory.action = '';
                    this.creep.memory.target = null;
                } else if (this.creep.store[RESOURCE_ENERGY] == 0) {
                    this.creep.memory.action = '';
                    this.creep.memory.target = null;
                    this.creep.memory.working = true;
                }
            }
        }
    }

}
