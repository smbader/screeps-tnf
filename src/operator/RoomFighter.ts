import { extend } from "lodash";
import { Operator } from "../classes/operator";
import {MapHelper} from "../utils/MapHelper";

interface RoomFighterMemory extends CreepMemory {
    targetRoom: string;
    target?: Id<any> | null;
    waypoint: number | undefined;
}

export class RoomFighterCreep extends Creep {
    memory!: RoomFighterMemory;

    constructor(creepid: any, targetRoom: string) {
        super(creepid);

        const baseMemory: CreepMemory = super.memory;
        this.memory.room = baseMemory.room;
        this.memory.targetRoom = targetRoom;
    }
}

// An operator is a screep who performs an operation.
export class RoomFighter extends Operator {
    creep: RoomFighterCreep | null;
    targetroom: string;
    waypoints?: any[];

    constructor(name: string, room: Room, targetRoom: string, waypoints: string[]) {
        super(name, room);

        if (Game.creeps[this.name]) {
            this.creep = new RoomFighterCreep(Game.creeps[this.name].id, targetRoom);
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

        if (this.creep.memory.targetRoom !== this.creep.room.name) {

            let roomPos = new RoomPosition(25, 25, this.creep.memory.targetRoom)
            this.creep.travelTo(roomPos);
            return;
        }

       // if ((this.creep.hitsMax - this.creep.hits) < 2750) {
            //hold for heal
          //  return;
        //}
        //this.creep.say('81');
       // if ((this.creep.hitsMax - this.creep.hits) < 2000) {
        //    this.creep.travelTo(new RoomPosition(3, 22, this.room.name));
        //    return;
        //}

        //let target = this.creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3);
        let target = this.creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);

        if (target) {
            //let enemyRange = this.creep.pos.getRangeTo(target.pos);

            if (this.creep.hits > (this.creep.hitsMax * .6)) {
                let result = this.creep.attack(target);
                if (result == OK) {
                    // Am I done?
                } else if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(target.pos);
                }
            } else {
                // move away
                let exit = this.creep.pos.findClosestByPath(FIND_EXIT);
                if (exit) {
                    this.creep.travelTo(exit);
                }
            }
        } else {

            let target = this.creep.pos.findClosestByRange<StructureSpawn>(FIND_STRUCTURES, {
                filter: structure => (structure.structureType == STRUCTURE_SPAWN)
            });
            if (target && this.creep.pos.getRangeTo(target) < 2) {
                this.creep.travelTo(new RoomPosition(25, 25, this.room.name));
            }
        }
    }


}
