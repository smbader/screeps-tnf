import { extend } from "lodash";
import { Operator } from "../classes/operator";
import {MapHelper} from "../utils/MapHelper";

interface GeologistMemory extends CreepMemory {
    targetRoom: string;
    target?: Id<any> | null;
}

export class GeologistCreep extends Creep {
    memory!: GeologistMemory;

    constructor(creepid: any, targetRoom: string) {
        super(creepid);

        const baseMemory: CreepMemory = super.memory;
        this.memory.room = baseMemory.room;
        this.memory.targetRoom = targetRoom;
    }
}

// An operator is a screep who performs an operation.
export class Geologist extends Operator {

    creep: GeologistCreep | null;

    constructor(name: string, room: Room) {
        super(name, room);

        if (Game.creeps[this.name]) {
            this.creep = new GeologistCreep(Game.creeps[this.name].id, room.name);
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

        // While you're harvesting continue until you're full.
        if (this.creep.memory.working == true) {

            if (this.creep.ticksToLive && this.creep.ticksToLive < 60) {
                // Need to offload before death.
                this.creep.memory.working = false;
                this.creep.memory.target = null;
            }

            if (this.creep.memory.target == null) {

                let mineral = this.creep.room.find(FIND_MINERALS)[0];
                let extractor = mineral.pos.lookFor(LOOK_STRUCTURES);

                if (extractor.length == 1) {
                    this.creep.memory.target = mineral.id;
                }
                return;

            } else {

                let target = Game.getObjectById(this.creep.memory.target);
                let actionresult = this.creep.harvest(target);

                if (actionresult == ERR_NOT_IN_RANGE) {
                    if (this.creep.travelTo(target.pos) == ERR_NO_PATH) {
                        return;
                    }
                } else if (actionresult == ERR_INVALID_TARGET) {
                    this.creep.memory.target = null
                } else if (this.creep.store.getUsedCapacity() == this.creep.store.getCapacity()) {
                    this.creep.memory.working = false;
                    this.creep.memory.target = null;
                }
                return;
            }

        } else {

            if (this.creep.memory.target == null) {

                let target = this.creep.pos.findClosestByPath<StructureContainer>(FIND_STRUCTURES, {
                    filter: structure => (structure.structureType == STRUCTURE_TERMINAL || structure.structureType == STRUCTURE_STORAGE)
                });

                if (target) {
                    this.creep.memory.target = target.id;
                }

            } else {

                let target = Game.getObjectById(this.creep.memory.target);
                let actionresult;
                for(const resourceType in this.creep.store) {
                    actionresult = this.creep.transfer(target, <"energy" | "power" | "ops" | "U" | "L" | "K" | "Z" | "O" | "H" | "X" | "OH" | "ZK" | "UL" | "G" | "UH" | "UO" | "KH" | "KO" | "LH" | "LO" | "ZH" | "ZO" | "GH" | "GO" | "UH2O" | "UHO2" | "KH2O" | "KHO2" | "LH2O" | "LHO2" | "ZH2O" | "ZHO2" | "GH2O" | "GHO2" | "XUH2O" | "XUHO2" | "XKH2O" | "XKHO2" | "XLH2O" | "XLHO2" | "XZH2O" | "XZHO2" | "XGH2O" | "XGHO2" | "mist" | "biomass" | "metal" | "silicon" | "utrium_bar" | "lemergium_bar" | "zynthium_bar" | "keanium_bar" | "ghodium_melt" | "oxidant" | "reductant" | "purifier" | "battery" | "composite" | "crystal" | "liquid" | "wire" | "switch" | "transistor" | "microchip" | "circuit" | "device" | "cell" | "phlegm" | "tissue" | "muscle" | "organoid" | "organism" | "alloy" | "tube" | "fixtures" | "frame" | "hydraulics" | "machine" | "condensate" | "concentrate" | "extract" | "spirit" | "emanation" | "essence">resourceType);
                }

                if (actionresult == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(target.pos);
                } else if (actionresult == ERR_FULL) {
                    this.creep.memory.target = null;
                } else if (this.creep.store.getUsedCapacity() == 0) {
                    this.creep.memory.target = null;
                    this.creep.memory.working = true;
                } else if (actionresult == OK) {

                }
            }
        }

    }


}
