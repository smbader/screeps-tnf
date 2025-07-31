import { extend } from "lodash";
import { Operator } from "../classes/operator";

interface ClaimerMemory extends CreepMemory {
    targetRoom: string;
    waypoint: number | undefined;
}

export class ClaimerCreep extends Creep {
    memory!: ClaimerMemory;

    constructor(creepid: any, targetRoom: string) {
        super(creepid);

        const baseMemory: CreepMemory = super.memory;
        this.memory.room = baseMemory.room;
        this.memory.working = false;
        this.memory.targetRoom = targetRoom;
    }
}

// An operator is a screep who performs an operation.
export class Claimer extends Operator {
    memory: {
        roomname?: string;
        name?: string;
        targetroom: string;
        waypoints?: any[];
    };

    creep: ClaimerCreep | null;

    constructor(name: string, room: Room, targetRoom: string, waypoints?: string[]) {
        super(name, room);

        this.memory = {
            targetroom: targetRoom,
        };

        this.memory.name = name;
        this.memory.roomname = targetRoom;
        this.memory.waypoints = waypoints;

        if (Game.creeps[this.name]) {
            this.creep = new ClaimerCreep(Game.creeps[this.name].id, targetRoom);
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

        let claimRoom = Game.rooms[this.creep.memory.targetRoom];
        if (claimRoom && claimRoom.controller) {
            if (this.creep.pos.getRangeTo(claimRoom.controller.pos) < 3) {
                let result = 0;
                if (claimRoom.memory.config?.type == 'owned') {
                    result = this.creep.claimController(claimRoom.controller);
                    this.creep.say('🔐');
                } else {
                    result = this.creep.reserveController(claimRoom.controller);
                    this.creep.say('🔒');
                }
                if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(claimRoom.controller.pos);
                    return;
                } else if (result == OK) {
                    return;
                }
            } else {
                this.creep.travelTo(claimRoom.controller.pos);
                this.creep.say('🔓');
                return;
            }
        }

    }


}
