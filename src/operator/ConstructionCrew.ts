import { Operator } from "../classes/operator";

type StoreStructure = StructureStorage|StructureContainer|StructureLink;

interface ConstructionCrewMemory extends CreepMemory {
    targetResources: Id<Resource> | null;
    targetContainer: Id<StoreStructure> | null;
};

export class ConstructionCrewCreep extends Creep {

    memory!: ConstructionCrewMemory;

    constructor(creepid: any) {
        super(creepid);
    }
};

// An operator is a screep who performs an operation.
export class ConstructionCrew extends Operator {

    memory: {
        sourceid?: any,
        batteryid?: any,
        roomname?: string,
        name?: string,
    }

    creep: ConstructionCrewCreep | null;
    source: Source;

    constructor (name:string, room:Room, sourceid:any, batteryid:any) {
        super(name, room);

        this.memory = {};
        this.memory.name = name;
        this.memory.sourceid = sourceid;
        this.memory.roomname = room.name;
        this.memory.batteryid = batteryid;

        this.source = Game.getObjectById(sourceid) as Source;

        if (Game.creeps[this.name]) {
            this.creep = new ConstructionCrewCreep(Game.creeps[this.name].id);
        } else {
            this.creep = null;
        }

        this.room = room;
    }

    trySpawnCreep() {
    }

    actions() {

        // Creep may not exist yet.
        if (!this.creep) { return; }

        if (this.creep.store[RESOURCE_ENERGY] == this.creep.store.getCapacity()) {
            this.creep.memory.working = false;
        }
        if (this.creep.store[RESOURCE_ENERGY] == 0 && this.creep.memory.working == false) {
            this.creep.memory.working = true;
            this.creep.memory.targetResources = null;
            this.creep.memory.targetContainer = null;
        }

        // While you're harvesting continue until you're full.
        if (this.creep.memory.working == true) {
            if (this.creep.memory.targetResources != null) {
                let target = Game.getObjectById(this.creep.memory.targetResources);
                if (target != null) {
                    let result = this.creep.pickup(target);
                    if(result == ERR_NOT_IN_RANGE) {
                        this.creep.moveTo(target);
                        return;
                    } else if (result == OK) {
                        return;
                    }
                } else {
                    this.creep.memory.targetResources = null;
                }
            } else if (this.creep.memory.targetContainer != null) {
                let target = Game.getObjectById(this.creep.memory.targetContainer);
                if (target != null) {
                    let result = this.creep.withdraw(target, RESOURCE_ENERGY);
                    if(result == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(target.pos);
                        return;
                    } else if (result == OK) {
                        return;
                    }
                } else {
                    this.creep.memory.targetResources = null;
                }
            }

            var targets = this.creep.room.lookForAt(LOOK_RESOURCES, this.creep.room.memory.sources[this.memory.sourceid].container.x, this.creep.room.memory.sources[this.memory.sourceid].container.y);
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
                this.creep.memory.targetResources = target.id;
                let result = this.creep.pickup(target);
                if(result == ERR_NOT_IN_RANGE) {
                    this.creep.moveTo(target);
                }
            } else {

                let target = this.creep.pos.findClosestByPath<StoreStructure>(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return ((structure.structureType == STRUCTURE_STORAGE ||
                                structure.structureType == STRUCTURE_CONTAINER) &&
                            structure.store.getUsedCapacity(RESOURCE_ENERGY) > 100);
                    }
                });

                if (target) {
                    this.creep.memory.targetContainer = target.id;
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
                        this.creep.say('🚜');
                        this.creep.travelTo(this.source.pos);
                    }
                }
            }

        } else {

            let constructionSites = this.getClosestFinished(this.room);
            if (constructionSites.length > 0) {

                let result = this.creep.build(constructionSites[0])

                if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(constructionSites[0].pos);
                    return;
                } else if (result == ERR_INVALID_TARGET &&
                            constructionSites[0].pos.x == this.creep.pos.x &&
                            constructionSites[0].pos.y == this.creep.pos.y) {
                    this.creep.travelTo(new RoomPosition(1,1, this.room.name));
                } else if (result == OK) {
                    if (this.creep.room.storage && this.creep.pos.getRangeTo(this.creep.room.storage) < 2) {
                        this.creep.travelTo(constructionSites[0].pos);
                    }
                    return;
                }
            }

            //let allRamparts = this.creep.room.find(FIND_STRUCTURES, {filter: {structureType: STRUCTURE_RAMPART | STRUCTURE_WALL}});
            let allRamparts = this.creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                    return (structure.structureType == STRUCTURE_RAMPART); // || structure.structureType == STRUCTURE_WALL);
                }
            });
            let lowestRampart = _.min(allRamparts, r => r.hits);

            if (lowestRampart?.hits < 10000000) {
                this.creep.say('🔨');
                let result = this.creep.repair(lowestRampart)
                if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(lowestRampart.pos);
                    return;
                } else if (result == OK) {
                    return;
                }
            }
/*
            let allWalls = this.creep.room.find(FIND_STRUCTURES, {filter: {structureType: STRUCTURE_WALL}});
            let lowestWall = _.min(allWalls, r => r.hits);

            if (lowestWall?.hits < 100000) {
                this.creep.say('🔨');
                let result = this.creep.repair(lowestWall)
                if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(lowestWall.pos);
                    return;
                } else if (result == OK) {
                    return;
                }
            }
*/
            if (this.creep.store[RESOURCE_ENERGY] == 0) {
                this.creep.memory.working = true;
                this.creep.memory.targetResources = null;
                this.creep.memory.targetContainer = null;
            }
        }
    }

    private getClosestFinished(room:Room): any {

        let targets = room.find(FIND_CONSTRUCTION_SITES);
        targets.sort((a,b) => (a.progressTotal - a.progress) - (b.progressTotal - b.progress));
        return targets;
    }
}
