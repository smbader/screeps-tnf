import { Operator } from "../classes/operator";

type SupplyStructure = StructureExtension | StructureSpawn | StructureTower | StructureLab;

// An operator is a screep who performs an operation.
export class EnergyManager extends Operator {

    memory: {
        sourceid?: any,
        batteryid?: any,
        roomname?: string,
        name?: string,
    }

    creep: Creep;
    source: Source;

    constructor (name:string, room:Room, sourceid:any, batteryid:any, ) {
        super(name, room);

        this.memory = {};
        this.memory.name = name;
        this.memory.sourceid = sourceid;
        this.memory.roomname = room.name;
        this.memory.batteryid = batteryid;

        this.source = Game.getObjectById(sourceid) as Source;

        this.creep = Game.creeps[this.name];
        this.room = room;
    }

    actions() {

        // Creep may not exist yet.
        if (!this.creep) { return; }

        // While you're harvesting continue until you're full.
        if (this.creep.memory.working == true) {

            var targets = this.creep.room.find(FIND_DROPPED_RESOURCES);
            if (targets.length > 0) {
                var target = targets[0];

                for (let t in targets) {
                    let ttarget = targets[t];
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
                let result = this.creep.pickup(target);
                if(result == ERR_NOT_IN_RANGE) {
                    this.creep.moveTo(target);
                }
            } else {
                let target = this.source.pos.findClosestByRange(FIND_STRUCTURES, {
                    filter: (structure) => structure.structureType == STRUCTURE_CONTAINER && structure.store[RESOURCE_ENERGY] > 0
                });
                if (target) {
                    let result = this.creep.withdraw(target, RESOURCE_ENERGY);
                    if(result == ERR_NOT_IN_RANGE) {
                        this.creep.moveTo(target);
                        return;
                    } else if (result == OK) {
                        return;
                    }
                } else {
                    // Goto and harvest source
                    if (this.creep.harvest(this.source) == ERR_NOT_IN_RANGE) {
                        this.creep.moveTo(this.source);
                    }
                }
            }

            console.log(`    ` + this.name + `: Harvesting`);
            if (this.creep.store[RESOURCE_ENERGY] == this.creep.store.getCapacity()) {
                this.creep.memory.working = false;
            }

        } else {

            let empty = this.getClosestEmpty(this.creep);
            if (empty) {
                if(this.creep.transfer(empty, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    this.creep.moveTo(empty);
                }
            }

            if (this.creep.store[RESOURCE_ENERGY] == 0) {
                this.creep.memory.working = true;
            }
        }
    }

    private getClosestEmpty(creep:Creep): any {

        let target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: function(object:SupplyStructure) {
                return (
                    (object.structureType == STRUCTURE_EXTENSION || object.structureType == STRUCTURE_SPAWN) &&
                    (object.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
                );
            }
        });

        return target;
    }
}
