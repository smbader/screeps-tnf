import { extend } from "lodash";
import { Operator } from "../classes/operator";
import {MapHelper} from "../utils/MapHelper";

interface DepositMinerMemory extends CreepMemory {
    targetRoom: string;
    target?: Id<any> | null;
}

export class DepositMinerCreep extends Creep {
    memory!: DepositMinerMemory;

    constructor(creepid: any, targetRoom: string) {
        super(creepid);

        const baseMemory: CreepMemory = super.memory;
        this.memory.room = baseMemory.room;
        this.memory.targetRoom = targetRoom;
    }
}

// An operator is a screep who performs an operation.
export class DepositMiner extends Operator {
    creep: DepositMinerCreep | null;
    targetroom: string;

    constructor(name: string, room: Room, targetRoom: string) {
        super(name, room);

        if (Game.creeps[this.name]) {
            this.creep = new DepositMinerCreep(Game.creeps[this.name].id, targetRoom);
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

        let returnHome = false;

        // If we're full, return home.
        if (this.creep.store.getFreeCapacity() == 0) {
            //console.log('[' + this.targetroom + '] Mining cart is full');
            returnHome = true;
        }


        // Life is getting short.
        if (this.creep.ticksToLive != undefined && this.creep.ticksToLive < 250) {
            //console.log('[' + this.targetroom + '] Im about to die.');
            if (this.creep.store.getUsedCapacity() == 0) {
                // I'm empty and about to die.
                this.creep.suicide();
                return;
            }
            returnHome = true;
        }

        if (!returnHome) {

            if (this.targetroom != this.creep.pos.roomName) {
                this.creep.say('🚗');
                this.creep.travelTo(new RoomPosition(25, 25, this.targetroom));
                return;
            }

            // If we're in the room, look for a power node.
            let targetRoom = Game.rooms[this.targetroom];
            let targets = targetRoom.find(FIND_DEPOSITS);

            if (targets.length > 0) {
                let target = targets[0];

                if (target && !returnHome) {
                    let result = this.creep.harvest(target);
                    if (result == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(target.pos);
                        return;
                    }
                }
            } else {
                // If the deposit is gone
                //console.log('[' + this.targetroom + '] Deposit is gone.');
                returnHome = true;
            }
        }

        if (returnHome) {
            let storage = this.room.storage;
            if (storage) {
                let actionresult;
                for(const resourceType in this.creep.store) {
                    actionresult = this.creep.transfer(storage, <"energy" | "power" | "ops" | "U" | "L" | "K" | "Z" | "O" | "H" | "X" | "OH" | "ZK" | "UL" | "G" | "UH" | "UO" | "KH" | "KO" | "LH" | "LO" | "ZH" | "ZO" | "GH" | "GO" | "UH2O" | "UHO2" | "KH2O" | "KHO2" | "LH2O" | "LHO2" | "ZH2O" | "ZHO2" | "GH2O" | "GHO2" | "XUH2O" | "XUHO2" | "XKH2O" | "XKHO2" | "XLH2O" | "XLHO2" | "XZH2O" | "XZHO2" | "XGH2O" | "XGHO2" | "mist" | "biomass" | "metal" | "silicon" | "utrium_bar" | "lemergium_bar" | "zynthium_bar" | "keanium_bar" | "ghodium_melt" | "oxidant" | "reductant" | "purifier" | "battery" | "composite" | "crystal" | "liquid" | "wire" | "switch" | "transistor" | "microchip" | "circuit" | "device" | "cell" | "phlegm" | "tissue" | "muscle" | "organoid" | "organism" | "alloy" | "tube" | "fixtures" | "frame" | "hydraulics" | "machine" | "condensate" | "concentrate" | "extract" | "spirit" | "emanation" | "essence">resourceType);
                    break;
                }
                if (actionresult == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(storage.pos);
                    return;
                }

            }
        }

    }


}
