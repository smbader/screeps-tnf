import { extend } from "lodash";
import { Operator } from "../classes/operator";
import {MapHelper} from "../utils/MapHelper";

interface RoomHealerMemory extends CreepMemory {
    targetFighter: string;
    targetRoom: string;
    target?: Id<any> | null;
    waypoint: number | undefined;
}

export class RoomHealerCreep extends Creep {
    memory!: RoomHealerMemory;

    constructor(creepid: any, targetFighter: string, targetRoom: string) {
        super(creepid);

        const baseMemory: CreepMemory = super.memory;
        this.memory.room = baseMemory.room;
        this.memory.targetFighter = targetFighter;
        this.memory.targetRoom = targetRoom;
    }
}

// An operator is a screep who performs an operation.
export class RoomHealer extends Operator {

    creep: RoomHealerCreep | null;
    targetroom: string;
    waypoints?: any[];

    constructor(name: string, room: Room, targetFighter: string, targetroom: string, waypoints: string[]) {
        super(name, room);

        if (Game.creeps[this.name]) {
            this.creep = new RoomHealerCreep(Game.creeps[this.name].id, targetFighter, targetroom);
        } else {
            this.creep = null;
        }
        this.room = room;
        this.targetroom = targetroom;
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

        this.creep.say(this.creep.memory.waypoint + ' ');
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

        // Once through all the waypoints, follow fighter.

        let myPowerFighter = Game.creeps[this.creep.memory.targetFighter];

        if (!myPowerFighter || myPowerFighter.spawning) {


            // move away from spawn
            let target = this.creep.pos.findClosestByRange<StructureSpawn>(FIND_STRUCTURES, {
                filter: structure => (structure.structureType == STRUCTURE_SPAWN)
            });
            if (target && this.creep.pos.getRangeTo(target) < 2) {
                this.creep.travelTo(new RoomPosition(25, 25, this.room.name));
            }

            return;
        }


        let range = this.creep.pos.getRangeTo(myPowerFighter);
        if (range > 1) {
            if (range < 3) {
                this.creep.rangedHeal(myPowerFighter);
            } else {
                this.creep.heal(this.creep);
            }

            this.creep.travelTo(myPowerFighter.pos);
        } else {
            this.creep.heal(myPowerFighter);
        }


    }


}
