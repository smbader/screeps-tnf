import { extend } from "lodash";
import { Operator } from "../classes/operator";

interface KeeperKillerMemory extends CreepMemory {
    targetRoom: string;
    sourceRoom: string;
    waypoint: number | null;
}

export class KeeperKillerCreep extends Creep {
    memory!: KeeperKillerMemory;

    constructor(creepid: any, sourceRoom: string, targetRoom: string) {
        super(creepid);

        const baseMemory: CreepMemory = super.memory;
        this.memory.room = baseMemory.room;
        this.memory.working = false;
        this.memory.targetRoom = targetRoom;
        this.memory.sourceRoom = sourceRoom;
    }
}

// An operator is a screep who performs an operation.
export class KeeperKiller extends Operator {
    memory: {
        roomname?: string;
        name?: string;
        targetroom: string;
        waypoints?: any[];
    };

    creep: KeeperKillerCreep | null;

    constructor(name: string, room: Room, targetRoom: string, waypoints?: string[]) {
        super(name, room);

        this.memory = {
            targetroom: targetRoom,
        };

        this.memory.name = name;
        this.memory.roomname = targetRoom;
        this.memory.waypoints = waypoints;

        if (Game.creeps[this.name]) {
            this.creep = new KeeperKillerCreep(Game.creeps[this.name].id, room.name, targetRoom);
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

        if (this.creep.memory.waypoint == null)  { this.creep.memory.waypoint = 0; }
        if (this.memory.waypoints != undefined) {
            if (this.memory.waypoints[this.creep.memory.waypoint]) {
                let currentWayPoint = this.memory.waypoints[this.creep.memory.waypoint];
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
            let roomPos = new RoomPosition(25, 25, this.creep.memory.targetRoom)
            this.creep.travelTo(roomPos);
            return;
        }

        // We're here, let's dance.

        // Find the mineral location
        let minerals = this.creep.room.find(FIND_MINERALS);

        if (minerals && minerals.length > 0) {
            let mineral = minerals[0];

            let keeper = mineral.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
            if (keeper) { // && mineral.pos.getRangeTo(keeper) < 16) {
                let enemyRange = this.creep.pos.getRangeTo(keeper);

                this.creep.rangedAttack(keeper);

                if (this.creep.hits == this.creep.hitsMax) {
                    const closestDamagedCreep = this.creep.pos.findClosestByRange(FIND_MY_CREEPS, {
                        filter: structure => (structure.hits < structure.hitsMax)
                    });
                    if (closestDamagedCreep) {
                        if (this.creep.heal(closestDamagedCreep) == ERR_NOT_IN_RANGE) {
                            if (this.creep.heal(closestDamagedCreep) == ERR_NOT_IN_RANGE) {
                                this.creep.heal(this.creep);
                            }
                        }
                    } else {
                        this.creep.heal(this.creep);
                    }
                } else {
                    this.creep.heal(this.creep);
                }

                if (enemyRange >= 4 && this.creep.hits > 3000) {
                    // we can step to him.
                    this.creep.travelTo(keeper.pos);
                } else if (enemyRange <= 2 || this.creep.hits < 3000) {
                    // move away
                    let exit = this.creep.pos.findClosestByPath(FIND_EXIT);
                    if (exit) {
                        this.creep.travelTo(exit);
                    }
                }

            } else {
                // heal friends.
                const closestDamagedCreep = this.creep.pos.findClosestByRange(FIND_MY_CREEPS, {
                    filter: structure => (structure.hits < structure.hitsMax)
                });
                if (closestDamagedCreep) {
                    let result = this.creep.heal(closestDamagedCreep);
                    if (result == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(closestDamagedCreep.pos);
                    }
                }
            }
        }

    }


}
