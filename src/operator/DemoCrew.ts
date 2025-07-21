import { Operator } from "../classes/operator";

interface DemoCrewMemory extends CreepMemory {
    targetResources: Id<Resource> | null;
    waypoint: number | null;
};

export class DemoCrewCreep extends Creep {

    memory!: DemoCrewMemory;

    constructor(creepid: any) {
        super(creepid);
    }
};

// An operator is a screep who performs an operation.
export class DemoCrew extends Operator {

    memory: {
        sourceid?: any,
        roomname?: string,
        name?: string,
        demotarget?: any,
    }

    creep: DemoCrewCreep | null;

    constructor (name:string, room:Room, demoTarget:any) {
        super(name, room);

        this.memory = {};
        this.memory.name = name;
        this.memory.roomname = room.name;
        this.memory.demotarget = demoTarget;

        if (Game.creeps[this.name]) {
            this.creep = new DemoCrewCreep(Game.creeps[this.name].id);
        } else {
            this.creep = null;
        }

        this.room = room;
    }

    actions() {

        // Creep may not exist yet.
        if (!this.creep) { return; }

        if (this.creep.memory.waypoint == null)  { this.creep.memory.waypoint = 0; }

        if (this.memory.demotarget.waypointrooms[this.creep.memory.waypoint]) {

            let waypointtarget = new RoomPosition(25, 25, this.memory.demotarget.waypointrooms[this.creep.memory.waypoint]);
            if (this.creep.pos.getRangeTo(waypointtarget) < 20) {
                this.creep.memory.waypoint += 1;
            } else {
                this.creep.travelTo(waypointtarget);
                return;
            }

        } else {

            var targets;
            let target = new RoomPosition(this.memory.demotarget.targetpos[0].x, this.memory.demotarget.targetpos[0].y, this.memory.demotarget.targetroom);

            for (let pos of this.memory.demotarget.targetpos) {
                targets = this.creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return structure.room.name === target.roomName && structure.pos.x === pos.x && structure.pos.y === pos.y;
                    }
                });
                if (targets.length > 0) {
                    break;
                }
            }

            if (this.creep.pos.getRangeTo(target) > 1) {
                this.creep.travelTo(new RoomPosition(target.x , target.y , target.roomName));
                this.creep.say(target.roomName + ' ' + this.memory.demotarget.targetpos.x + ' ' + this.memory.demotarget.targetpos.y);
                return;
            }

            if (targets == undefined) {
                return;
            }

            for (let structure of targets) {
                let result = this.creep.dismantle(structure);
                if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(structure.pos);
                    return;
                } else if (result == OK) {
                    return;
                }
            }

        }
    }

}
