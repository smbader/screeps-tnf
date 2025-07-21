import { extend } from "lodash";
import { Operator } from "../classes/operator";
import {MapHelper} from "../utils/MapHelper";

interface PowerHealerMemory extends CreepMemory {
    targetFighter: string;
    targetRoom: string;
    target?: Id<any> | null;
}

export class PowerHealerCreep extends Creep {
    memory!: PowerHealerMemory;

    constructor(creepid: any, targetFighter: string, targetRoom: string) {
        super(creepid);

        const baseMemory: CreepMemory = super.memory;
        this.memory.room = baseMemory.room;
        this.memory.targetFighter = targetFighter;
        this.memory.targetRoom = targetRoom;
    }
}

// An operator is a screep who performs an operation.
export class PowerHealer extends Operator {

    creep: PowerHealerCreep | null;
    targetroom: string;

    constructor(name: string, room: Room, targetFighter: string, targetroom: string) {
        super(name, room);

        if (Game.creeps[this.name]) {
            this.creep = new PowerHealerCreep(Game.creeps[this.name].id, targetFighter, targetroom);
        } else {
            this.creep = null;
        }
        this.room = room;
        this.targetroom = targetroom;
    }

    actions() {

        // Creep may not exist yet.
        if (!this.creep) {
            return;
        }


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
            this.creep.rangedHeal(myPowerFighter);
            this.creep.travelTo(myPowerFighter.pos);
        } else {
            this.creep.heal(myPowerFighter);
        }


    }


}
