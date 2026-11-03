import { Operator } from "../classes/operator";
import { RoomHelper } from "../utils/RoomHelper";
import { isExpansionAssignmentInPhase } from "../operations/ExpansionManagementTypes";

export type ClaimMode = "claim" | "reserve" | "configured";

export interface Waypoint {
    x: number;
    y: number;
    room: string;
    shard?: string;
}

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
        waypoints?: Waypoint[];
        claimMode: ClaimMode;
    };

    creep: ClaimerCreep | null;

    constructor(name: string, room: Room, targetRoom: string, waypoints?: Waypoint[], claimMode: ClaimMode = "configured") {
        super(name, room);

        this.memory = {
            targetroom: targetRoom,
            claimMode
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
        if (
            this.creep.memory.operation === "expansionManagement" &&
            !isExpansionAssignmentInPhase(this.creep.memory.expansionAssignment, "claiming")
        ) {
            this.creep.suicide();
            return;
        }
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
                    this.creep.travelTo(wayPointPos);
                }
                return;
            }
        }

        if (this.creep.memory.targetRoom !== this.creep.room.name) {

            let roomPos = new RoomPosition(25, 25, this.creep.memory.targetRoom)
            this.creep.say('' + this.creep.travelTo(roomPos));
            return;
        }

        let claimRoom = Game.rooms[this.creep.memory.targetRoom];
        const cfg = RoomHelper.getRoomConfigByName(this.creep.memory.targetRoom);
        const playerUsername = this.room.controller?.owner?.username || "ricane";

        if (claimRoom && claimRoom.controller) {
            if (
                claimRoom.controller.owner &&
                claimRoom.controller.owner.username !== playerUsername
            ) {
                return;
            }
            if (
                this.memory.claimMode === "claim" &&
                claimRoom.controller.reservation &&
                claimRoom.controller.reservation.username !== playerUsername
            ) {
                return;
            }
            if (this.creep.pos.getRangeTo(claimRoom.controller.pos) < 2) {
                let result = 0;
                const claimMode = this.memory.claimMode;
                if (claimMode === "claim" || (claimMode === "configured" && (cfg?.type === "owned" || cfg?.type === "defend"))) {
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
                } else if (result !== ERR_NOT_IN_RANGE && Game.time % 100 === 0) {
                    console.log(`[Claimer] ${this.creep.name} could not ${claimMode === "claim" ? "claim" : "reserve"} ${claimRoom.name}: ${result}`);
                }
            } else {
                this.creep.travelTo(claimRoom.controller.pos);
                this.creep.say('🔓');
                return;
            }
        }

    }


}
