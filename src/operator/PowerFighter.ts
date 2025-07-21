import { extend } from "lodash";
import { Operator } from "../classes/operator";
import {MapHelper} from "../utils/MapHelper";

interface PowerFighterMemory extends CreepMemory {
    targetRoom: string;
    target?: Id<any> | null;
}

export class PowerFighterCreep extends Creep {
    memory!: PowerFighterMemory;

    constructor(creepid: any, targetRoom: string) {
        super(creepid);

        const baseMemory: CreepMemory = super.memory;
        this.memory.room = baseMemory.room;
        this.memory.targetRoom = targetRoom;
    }
}

// An operator is a screep who performs an operation.
export class PowerFighter extends Operator {
    creep: PowerFighterCreep | null;
    targetroom: string;

    constructor(name: string, room: Room, targetRoom: string) {
        super(name, room);

        if (Game.creeps[this.name]) {
            this.creep = new PowerFighterCreep(Game.creeps[this.name].id, targetRoom);
        } else {
            this.creep = null;
        }
        this.room = room;
        this.targetroom = targetRoom;
    }

    actions() {

        // Creep may not exist yet.
        if (!this.creep) {
            return;
        }

        if (this.creep.memory.targetRoom !== this.creep.room.name) {

            let roomPos = new RoomPosition(25, 25, this.creep.memory.targetRoom)
            this.creep.travelTo(roomPos);
            return;
        }

        // If we're in the room, look for a power node.
        let target = this.creep.pos.findClosestByPath<StructurePowerBank>(FIND_STRUCTURES, {
            filter: structure => (structure.structureType == STRUCTURE_POWER_BANK)
        });

        if (target) {
            if ((this.creep.hitsMax - this.creep.hits) > 500) {
                // Don't attack
            } else {
                let result = this.creep.attack(target);
                if (result == OK) {
                    // Am I done?
                } else if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(target.pos);
                }
            }
        }
    }


}
