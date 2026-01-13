import { Operation } from "../classes/operation";

export class LabProcesses extends Operation {

    public constructor() {
        super();
    }

    public init() { }

    public roleCall() { }

    public actions() {

        //console.log(`--------  Market BUY Actions  ------`);
        if (Game.cpu.bucket < 2000) {
            console.log('No labs, CPU Bucket low: ' + Game.cpu.bucket);
        } else {

            for (const roomid in Game.rooms) {
                const room = Game.rooms[roomid];

                // What kind of room are we looking at?
                if (room.controller?.owner?.username !== "ricane") {
                    continue;
                }

                if (((room.memory.nextTrade - Game.time) % 12) != 0) {
                    continue;
                }

                let pss = room.find<StructurePowerSpawn>(FIND_MY_STRUCTURES, {
                    filter: function(object) {
                        return object.structureType === STRUCTURE_POWER_SPAWN
                    }
                });
                if (pss.length > 0) {
                    let powerSpawn = pss[0];

                    if (powerSpawn.store.getUsedCapacity(RESOURCE_ENERGY) >= 50 && powerSpawn.store.getUsedCapacity(RESOURCE_POWER) >= 1) {
                        powerSpawn.processPower();
                    }
                }

            }
        }
    }
}
