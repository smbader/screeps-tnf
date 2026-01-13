import { Operation } from "../classes/operation";
import { EmergencyWorker } from "../operator/EmergencyWorker";
import { RoomHelper } from "../utils/RoomHelper";

export class EmergencyServices extends Operation {
    public operationOperators: EmergencyWorker[];

    public constructor() {
        super();

        this.operationOperators = [];
    }

    public init() {

        for (var roomid in Memory.rooms) {

            let room = Game.rooms[roomid];
            if (!room) { continue; }
            if (room.controller?.owner?.username != 'ricane') {
                continue;
            }
            const cfgRoom = RoomHelper.getRoomConfig(room);
            if (!cfgRoom || cfgRoom.type !== 'owned') {
                continue;
            }
            if (cfgRoom.shard && cfgRoom.shard != Game.shard.name) {
                continue;
            }

            if (room.energyAvailable < 500) {
                room.memory.starvedTime += 1;
            } else if (room.energyAvailable >= 500) {
                room.memory.starvedTime = 0;
            }

            let name = '';
            let idx = 0;

            for(var sourceid in cfgRoom.energysources) {
                let parkingSpaces = cfgRoom.energysources[idx].parkingspots.length;

                // 3 for each parking spot, pull, travel, offloading
                // there should be max limit because of the source regen
                let perSource = 1;
                if (room.controller?.level <= 3 || ((room.controller?.level == 4) && !room.storage)) {
                    perSource = 2;
                }

                for (let i = 1; i <= (parkingSpaces * perSource); i++) {
                    name = 'Emergency_' + room.name + '_' + i + '_' + idx;
                    let eoperator = new EmergencyWorker(name, room, room, cfgRoom.energysources[idx].id);
                    this.operationOperators.push(eoperator);
                }
                idx++;
            }

        }
    }

    public roleCall() {

        for (let operationOperator of this.operationOperators) {

            var creepOperator = Game.creeps[operationOperator.name];

            if (creepOperator) {
                //console.log(`    Clocking in: ` +  operationOperator.name + ' (' + creepOperator.ticksToLive  + ')');
            } else {
                //console.log(operationOperator.room.name + ' ' + operationOperator.room.energyCapacityAvailable);

                // Spawn him.
                let spawns = operationOperator.room.find(FIND_MY_SPAWNS);

                if (spawns.length == 0) {
                    // no spawns
                } else {
                    for(let spawn of spawns) {
                        let spawnDirection = [TOP, TOP_LEFT, LEFT, BOTTOM_LEFT, BOTTOM, BOTTOM_RIGHT, RIGHT, TOP_RIGHT];
                        const cfg = RoomHelper.getRoomConfig(operationOperator.room);
                        for (let spawnconfig of (cfg && cfg.spawns || [])) {
                            if (spawnconfig.x == spawn.pos.x && spawnconfig.y == spawn.pos.y) {
                                if (spawnconfig.direction) {
                                    spawnDirection = [spawnconfig.direction];
                                }
                            }
                        }

                        var controllerLevel = 0;
                        if (spawn.room && spawn.room.controller) {
                            controllerLevel = spawn.room.controller.level;
                        }
                        if (!spawn.spawning) {
                                 // New Emergency worker rule.  Always spawn level 1, 2, 3 or if there are no workers and low energy.
                                if (controllerLevel <= 3 || operationOperator.room.memory.starvedTime > 200 || operationOperator.room.storage == undefined) {
                                    console.log(`    Spawning: ` +  operationOperator.name + ` Spawn Response: ` + spawn.spawnCreep([WORK, CARRY, MOVE, MOVE], operationOperator.name, { directions: spawnDirection}));
                                }
                        }
                    }
                }
            }
        }
    }

    public actions() {

        //console.log(`--------  Operator Emergency Services Actions  ------`);
        for (let operationOperator of this.operationOperators) {
            let cpuStart = Game.cpu.getUsed();
            operationOperator.actions();
            let cpuUsed = Game.cpu.getUsed() - cpuStart;
            if (cpuUsed > 0.5) {
                //console.log(`    ` + operationOperator.name + `: Actions Complete (cpu used: `+ cpuUsed.toFixed(2) + `)`);
            }
        }
    }
}
