import {extend} from "lodash";
import {Operator} from "../classes/operator";
import { RoomHelper } from "../utils/RoomHelper";

interface UpgraderMemory extends CreepMemory {
    targetSource: string;
}

export class UpgraderCreep extends Creep {
    memory: UpgraderMemory;

    constructor(creepid: any) {
        super(creepid);

        const baseMemory: CreepMemory = super.memory;
        this.memory = {
            room: baseMemory.room,
            working: false,
            role: "",
            targetSource: ""
        };
    }
}

// An operator is a screep who performs an operation.
export class Upgrader extends Operator {
    memory: {
        sourceid?: any;
        batteryid?: any;
        roomname?: string;
        name?: string;
    };

    creep: UpgraderCreep | null;

    constructor(name: string, room: Room) {
        super(name, room);

        this.memory = {};
        this.memory.name = name;
        this.memory.roomname = room.name;

        if (Game.creeps[this.name]) {
            this.creep = new UpgraderCreep(Game.creeps[this.name].id);
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

        const cfg = RoomHelper.getRoomConfig(this.creep.room);
        let controllerLinkpos = cfg.controllerLink;
        var controllerLinks = this.creep.room.find<StructureLink>(FIND_STRUCTURES, {
            filter: (structure) => {
                return structure.pos.x === controllerLinkpos.x
                    && structure.pos.y === controllerLinkpos.y
                    && structure.structureType == STRUCTURE_LINK;
            }
        });

        if (controllerLinks.length == 1) {
            let controllerLink = <StructureLink>controllerLinks[0];
            if (controllerLink && this.creep.pos.getRangeTo(controllerLink.pos) >= 1) {
                if (this.creep.withdraw(controllerLink, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    this.creep.moveTo(controllerLink);
                    return;
                }
            }
        } else if (this.room.controller && this.creep.pos.getRangeTo(this.room.controller.pos) >= 3) {
            this.creep.moveTo(this.room.controller);

            if (this.creep.pos.getRangeTo(this.room.controller.pos) >= 10) {
                // Don't bully people until you reach your destination
                return;
            }
        }

        if (this.creep.store[RESOURCE_ENERGY] == 0 && this.creep.memory.working == false) {
            this.creep.memory.working = true;
            this.creep.memory.targetSource = "";
        }
        if (this.creep.store[RESOURCE_ENERGY] > 0) {
            this.creep.memory.working = false;
        }

        // While you're harvesting continue until you're full.
        if (this.creep.memory.working == true) {

            const target = this.creep.pos.findClosestByRange(FIND_CREEPS, {
                filter(object: Creep) {
                    return object.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && object.getActiveBodyparts(WORK) == 0;
                }
            });
            if (target) {
                if (this.creep.pos.getRangeTo(target.pos) <= 4) {
                    this.creep.say("🔫");
                    if (target.transfer(this.creep, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                        target.moveTo(this.creep);
                        this.creep.moveTo(target);
                        target.say("🏳️");
                    }
                }
            }
        } else {
            // Goto and upgrade controller
            if (this.room.controller) {
                this.creep.upgradeController(this.room.controller);
                this.creep.say('🔨');
                return;
            }
        }
        this.creep.say('💤');
    }
}
