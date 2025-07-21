import {filter} from "lodash";
import {Operator} from "../classes/operator";
import {MapHelper} from "../utils/MapHelper";
import {PowerFighterCreep} from "./PowerFighter";

interface PowerHaulerMemory extends CreepMemory {
    targetRoom: string;
}

export class PowerHaulerCreep extends Creep {
    memory!: PowerHaulerMemory;

    constructor(creepid: any, targetRoom: string) {
        super(creepid);

        const baseMemory: CreepMemory = super.memory;
        this.memory.room = baseMemory.room;
        this.memory.targetRoom = targetRoom;
    }
}

// An operator is a screep who performs an operation.
export class PowerHauler extends Operator {
    creep: PowerHaulerCreep | null;
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

        if (this.creep.memory.targetRoom !== this.creep.room.name
            && this.creep.store.getUsedCapacity() == 0 ) {

            let roomPos = new RoomPosition(25, 25, this.creep.memory.targetRoom)
            this.creep.travelTo(roomPos);
            return;


        } else if (this.creep.store.getUsedCapacity(RESOURCE_POWER) > 0) {

            let storage = this.room.find<StructureStorage>(FIND_MY_STRUCTURES, {
                filter: structure => structure.structureType == STRUCTURE_STORAGE &&
                    structure.store.getUsedCapacity() < structure.store.getCapacity()
            })[0];

            if (this.creep.transfer(storage, RESOURCE_POWER) == ERR_NOT_IN_RANGE) {
                this.creep.travelTo(storage.pos);
            }

            return;
        }



        // If we're in the room, look for a power node.
        let target = this.creep.pos.findClosestByPath<StructurePowerBank>(FIND_STRUCTURES, {
            filter: structure => (structure.structureType == STRUCTURE_POWER_BANK)
        });

        if (target) {
            if (this.creep.pos.getRangeTo(target) > 5) {
                this.creep.travelTo(target.pos);
            }
            return;
        }

        let powerresource = this.creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
            filter: resource => (resource.resourceType == RESOURCE_POWER)
        });

        if (powerresource) {
            let result = this.creep.pickup(powerresource);
            if (result == OK) {
                // Am I done?
            } else if (result == ERR_NOT_IN_RANGE) {
                this.creep.travelTo(powerresource.pos);
            }
        }

    }
}
