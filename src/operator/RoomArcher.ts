import { extend } from "lodash";
import { Operator } from "../classes/operator";
import {MapHelper} from "../utils/MapHelper";

interface RoomArcherMemory extends CreepMemory {
    targetRoom: string;
    target?: Id<any> | null;
    waypoint: number | null;
}

export class RoomArcherCreep extends Creep {
    memory!: RoomArcherMemory;

    constructor(creepid: any, targetRoom: string) {
        super(creepid);

        const baseMemory: CreepMemory = super.memory;
        this.memory.room = baseMemory.room;
        this.memory.targetRoom = targetRoom;
    }
}

// An operator is a screep who performs an operation.
export class RoomArcher extends Operator {
    creep: RoomArcherCreep | null;
    targetroom: string;
    waypoints?: any[];

    constructor(name: string, room: Room, targetRoom: string, waypoints: string[]) {
        super(name, room);

        if (Game.creeps[this.name]) {
            this.creep = new RoomArcherCreep(Game.creeps[this.name].id, targetRoom);
        } else {
            this.creep = null;
        }
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
                    console.log(this.creep.travelTo(wayPointPos) + ' ');
                }
                return;
            }
        }

        const target = this.findPriorityTarget(this.creep);
        if (!target) {
            this.creep.say("👀 No target");
            return;
        }

        // Movement logic (kite or approach)
        this.handleKiting(this.creep, target);

        // Attack logic (mass or single)
        this.attackWithRanged(this.creep, target);

    }



    findPriorityTarget(creep: Creep): Creep | null {
        const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);

        if (hostiles.length === 0) return null;

        // Prioritize targets: Healers > Damaged > Others
        const healers = hostiles.filter(h => h.getActiveBodyparts(HEAL) > 0);
        if (healers.length > 0) {
            return creep.pos.findClosestByPath(healers) || null;
        }

        const damaged = hostiles.filter(h => h.hits < h.hitsMax);
        if (damaged.length > 0) {
            return creep.pos.findClosestByPath(damaged) || null;
        }

        return creep.pos.findClosestByPath(hostiles) || null;
    }

    handleKiting(creep: Creep, target: Creep): void {
        const range = creep.pos.getRangeTo(target);

        // If enemy is too close (melee range)
        if (range <= 1) {
            const fleePath = PathFinder.search(
                creep.pos,
                [{ pos: target.pos, range: 2 }],
                {
                    flee: true,
                    maxRooms: 1,
                    roomCallback: (roomName: string) => {
                        const room = Game.rooms[roomName];
                        if (!room) return false;

                        const costs = new PathFinder.CostMatrix();

                        // Treat non-walkable structures as walls
                        room.find(FIND_STRUCTURES).forEach(struct => {
                            if (
                                struct.structureType !== STRUCTURE_ROAD &&
                                struct.structureType !== STRUCTURE_CONTAINER &&
                                (struct.structureType !== STRUCTURE_RAMPART || !struct.my)
                            ) {
                                costs.set(struct.pos.x, struct.pos.y, 255);
                            }
                        });

                        // Avoid other creeps
                        room.find(FIND_CREEPS).forEach(c => {
                            if (c.id !== creep.id) {
                                costs.set(c.pos.x, c.pos.y, 255);
                            }
                        });

                        return costs;
                    }
                }
            );

            if (fleePath.path.length > 0) {
                creep.move(creep.pos.getDirectionTo(fleePath.path[0]));
                creep.say("🚪 Kite");
            }
        }
        // If out of range to shoot, move closer
        else if (range > 3) {
            creep.moveTo(target, {
                visualizePathStyle: { stroke: "#ffaa00" },
                reusePath: 3,
                maxRooms: 1
            });
            creep.say("➡️ Close in");
        }
        // Otherwise (range 2–3): stay in position
    }

    attackWithRanged(creep: Creep, target: Creep): void {
        const enemiesInRange = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3);

        if (enemiesInRange.length > 2) {
            const result = creep.rangedMassAttack();
            if (result === OK) {
                creep.say("💥 AoE!");
            }
        } else if (creep.pos.getRangeTo(target) <= 3) {
            const result = creep.rangedAttack(target);
            if (result === OK) {
                creep.say("🎯 Shoot");
            }
        }
    }


}
