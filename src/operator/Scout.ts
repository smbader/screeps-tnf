import { Operator } from "../classes/operator";
import {
    isExpansionAssignmentInPhase,
    recordExpansionRoomIntel
} from "../operations/ExpansionManagementTypes";
import type { Waypoint } from "./Claimer";

interface ScoutMemory extends CreepMemory {
    targetRoom: string;
    waypoint: number | undefined;
}

export class ScoutCreep extends Creep {
    memory!: ScoutMemory;

    constructor(creepid: any, targetRoom: string) {
        super(creepid);

        const baseMemory: CreepMemory = super.memory;
        this.memory.targetRoom = targetRoom;
    }
}

// An operator is a screep who performs an operation.
export class Scout extends Operator {
    memory: {
        roomname?: string;
        name?: string;
        waypoints?: Waypoint[];
    };

    creep: ScoutCreep | null;

    constructor(name: string, room: Room, targetRoom: string, waypoints?: Waypoint[]) {
        super(name, room);

        this.memory = {};
        this.memory.name = name;
        this.memory.roomname = targetRoom;
        this.memory.waypoints = waypoints;

        if (Game.creeps[this.name]) {
            this.creep = new ScoutCreep(Game.creeps[this.name].id, targetRoom);
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

        if (
            this.creep.memory.operation === "expansionManagement" &&
            !isExpansionAssignmentInPhase(this.creep.memory.expansionAssignment, "scouting")
        ) {
            this.creep.suicide();
            return;
        }

        if (
            this.creep.memory.operation === "expansionManagement" &&
            this.creep.room.name === this.creep.memory.targetRoom &&
            recordExpansionRoomIntel(this.creep.room)
        ) {
            this.creep.suicide();
            return;
        }

        if (this.creep.memory.waypoint == undefined) { this.creep.memory.waypoint = 0; }
        if (this.creep.memory.waypoint == null)  { this.creep.memory.waypoint = 0; }
        if (this.memory.waypoints != undefined) {
            if (this.memory.waypoints[this.creep.memory.waypoint]) {
                let currentWayPoint = this.memory.waypoints[this.creep.memory.waypoint];
                let wayPointPos = new RoomPosition(currentWayPoint.x, currentWayPoint.y, currentWayPoint.room);
                const waypointShard = currentWayPoint.shard
                    ? currentWayPoint.shard.indexOf("shard") === 0
                        ? currentWayPoint.shard
                        : `shard${currentWayPoint.shard}`
                    : Game.shard.name;
                if (waypointShard !== Game.shard.name){
                    this.creep.memory.waypoint += 1;
                } else if (this.creep.pos.getRangeTo(wayPointPos) == 0) {
                    this.creep.memory.waypoint += 1;
                } else {
                    this.creep.say(this.creep.travelTo(wayPointPos) + ' ');
                    return;
                }
            }
        }

        let roomPos = new RoomPosition(25, 25, this.creep.memory.targetRoom)
        if (this.creep.pos.getRangeTo(roomPos) > 20) {
            this.creep.travelTo(roomPos);
        }
        this.creep.say('💤');

    }


}
