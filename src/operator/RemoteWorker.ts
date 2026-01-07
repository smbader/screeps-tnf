import { Operator } from "../classes/operator";
import { MapHelper } from "../utils/MapHelper";
import {ClaimerCreep} from "./Claimer";

type SupplyStructure = StructureExtension | StructureSpawn | StructureTower | StructureLab | StructureStorage;
type EnergyStructure = StructureContainer | StructureTerminal | StructureStorage;

interface RemoteWorkerMemory extends CreepMemory {
    targetResources: Id<Resource> | null;
    targetContainer: Id<StructureContainer> | null;
    target?: Id<any> | null;
    action?: string;
    waypoint: number | undefined;
    targetRoom: string;
};

export class RemoteWorkerCreep extends Creep {

    memory!: RemoteWorkerMemory;

    constructor(creepid: any, targetRoom: string) {
        super(creepid);

        const baseMemory: CreepMemory = super.memory;
        this.memory.targetRoom = targetRoom;
    }
};

// An operator is a screep who performs an operation.
export class RemoteWorker extends Operator {

    creep: RemoteWorkerCreep | null;
    source: Source;
    targetroom: Room;
    waypoints?: any[];

    constructor (name:string, room:Room, targetRoom:Room, sourceid:any, waypoints: string[]) {
        super(name, room);

        if (Game.creeps[this.name]) {
            if (targetRoom) {

                this.creep = new RemoteWorkerCreep(Game.creeps[this.name].id, targetRoom.name);
                if (sourceid == null || sourceid == '') {
                    let parts = this.name.split("_");
                    let sources = targetRoom.find(FIND_SOURCES);
                    // @ts-ignore
                    let sid = (1 + parts[2]) % sources.length;

                    sourceid = targetRoom.find(FIND_SOURCES)[sid].id;
                }
            } else {
                this.creep = new RemoteWorkerCreep(Game.creeps[this.name].id, '');
            }

        } else {
            this.creep = null;
        }

        this.source = Game.getObjectById(sourceid) as Source;
        this.room = room;
        this.targetroom = targetRoom;
        this.waypoints = waypoints;
    }

    actions() {

        // Creep may not exist yet.
        if (!this.creep) {
            return;
        }

        // First objective is to complete waypoints
        if (this.creep.memory.waypoint == undefined || this.creep.memory.waypoint == null)  {
            this.creep.memory.waypoint = 0;
        }
         if (this.creep.memory.working == undefined) {
             this.creep.memory.working == true;
         }

        //this.creep.say(this.creep.memory.waypoint + ' ');
        if (this.creep.memory.waypoint == null)  { this.creep.memory.waypoint = 0; }
        if (this.waypoints != undefined) {
            if (this.waypoints[this.creep.memory.waypoint]) {
                let currentWayPoint = this.waypoints[this.creep.memory.waypoint];
                let wayPointPos = new RoomPosition(currentWayPoint.x, currentWayPoint.y, currentWayPoint.room);
                if ('shard' + currentWayPoint.shard !== Game.shard.name){
                    this.creep.memory.waypoint += 1;
                } else if (this.creep.pos.getRangeTo(wayPointPos) == 0) {
                    this.creep.memory.waypoint += 1;
                } else {
                    this.creep.say(this.creep.travelTo(wayPointPos) + ' ');
                }
                return;
            }
        }

        if (this.creep.memory.targetRoom !== this.creep.room.name) {
            let roomPos = new RoomPosition(6, 48, this.creep.memory.targetRoom)
            this.creep.travelTo(roomPos);
            return;
        }


        if (this.shouldFlee(this.creep)) {
            this.flee(this.creep);
            this.creep.say('🚨 Flee!');
            return; // Skip other logic if fleeing
        }

        // WAYPOINT MOVEMENT IS COMPLETE

        // While you're harvesting continue until you're full.
        if ( this.creep.memory.working == true) {
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
                let resources = this.creep.room.lookForAt(LOOK_RESOURCES, this.creep.room.memory.sources[this.source.id].container.x, this.creep.room.memory.sources[this.source.id].container.y);

                // Look for the nearest container to the source.
                let targets:EnergyStructure[] = [];
                if (this.creep.room.controller) {
                    targets = this.creep.room.controller.pos.findInRange<EnergyStructure>(FIND_STRUCTURES, 13,{
                        filter: (structure) => (
                            structure.structureType == STRUCTURE_CONTAINER ||
                            structure.structureType == STRUCTURE_STORAGE ||
                            structure.structureType == STRUCTURE_TERMINAL
                        )
                    });
                }

                this.creep.say('' + targets.length);

                if (targets.length > 0) {

                    if (targets[0].store.getUsedCapacity(RESOURCE_ENERGY) > 50) {
                        let target = targets[0];
                        this.creep.memory.target = target.id;
                        this.creep.memory.action = 'withdraw';
                    }
                } else if (resources.length > 0) {
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

                }
            } else {

                let target = Game.getObjectById(this.creep.memory.target);
                let actionresult = 0;
                if (target != null) {
                    if (this.creep.memory.action == 'withdraw') {
                        actionresult = this.creep.withdraw(target, RESOURCE_ENERGY);
                    } else if (this.creep.memory.action == 'pickup') {
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
                        this.creep.memory.action = '';
                        this.creep.memory.target = null;
                        return;
                    }
                } else if (actionresult == ERR_INVALID_TARGET || actionresult == ERR_NOT_ENOUGH_ENERGY) {
                    this.creep.memory.action = '';
                    this.creep.memory.target = null;
                    this.creep.memory.working = false;
                } else if (this.creep.store[RESOURCE_ENERGY] == this.creep.store.getCapacity()) {
                    this.creep.memory.action = '';
                    this.creep.memory.target = null;
                    this.creep.memory.working = false;
                }
                return;
            }

        } else {

            if (this.creep.memory.target == null) {

                let spawnConstruction = this.creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
                //let empty = MapHelper.getClosestEmpty(this.creep);
                let empty = this.creep.pos.findClosestByRange(FIND_STRUCTURES, {
                    filter: function(object:SupplyStructure) {
                        return (
                            ( object.structureType == STRUCTURE_SPAWN  ) &&
                            //(object.structureType == STRUCTURE_TOWER) &&
                            (object.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
                        );
                    }
                });

                if (empty) {
                    this.creep.memory.target = empty.id;
                    this.creep.memory.action = 'transfer';
                } else if ((spawnConstruction && !this.targetroom.controller) || (spawnConstruction && this.targetroom.controller && this.targetroom.controller.level > 1)) {
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

    shouldFlee(creep:Creep) {
        // Find hostiles in the room
        const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);

        // Find nearby enemies within a dangerous range (e.g., 4 tiles)
        const threateningEnemies = hostiles.filter(enemy =>
            creep.pos.getRangeTo(enemy) <= 9
        );

        // Return true if there's at least one enemy close enough
        return threateningEnemies.length > 0;
    }

    flee(creep:Creep) {
        const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);

        // Move away using pathfinding with the flee option
        const fleePath = PathFinder.search(
            creep.pos,
            hostiles.map(enemy => ({
                pos: enemy.pos,
                range: 10  // try to keep at least 3 tiles distance
            })),
            {
                flee: true,
                maxRooms: 1
            }
        );

        // Move the creep along the flee path
        if (fleePath.path.length > 0) {
            creep.move(creep.pos.getDirectionTo(fleePath.path[0]));
        }
    }
}
