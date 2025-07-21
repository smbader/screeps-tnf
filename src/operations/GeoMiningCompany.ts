import {forEach} from "lodash";
import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import {ConstructionCrew} from "../operator/ConstructionCrew";
import {Field} from "../operator/Field";
import { Geologist } from "../operator/Geologist";
import { Scout } from "../operator/Scout";

export class GeoMiningCompany extends Operation {
    public operationOperators: Geologist[];

    public constructor() {
        super();

        this.operationOperators = [];
    }

    public init() {
        // This operation is for what rooms we own and have spawns in.

        // Either the room is in active upgrading or just needs sustained at level 8.

        for (const roomid in Game.rooms) {
            // roomid (E43S27) is the current room being evaluated
            const room = Game.rooms[roomid];


            // What kind of room are we looking at?
            if (room.controller?.owner?.username !== "ricane") {
                continue;
            } else {
                // Nothing Yet.
                // Find available controller parking spaces.
            }
            if (room.memory.config.shard && room.memory.config.shard != Game.shard.name) {
                continue;
            }

            if (room.controller && room.controller.level < 7) {
                continue;
            }

            // To be productive, we need a spawn
            const spawns = room.find(FIND_MY_SPAWNS);

            if (spawns.length === 0) {
                continue;
            } else {
                for (const spawn of spawns) {
                    // Nothing yet.
                }
            }

            const name = "Geo_" + room.name;
            const operator = new Geologist(name, room);

            this.operationOperators.push(operator);

        }
    }

    public roleCall() {
        // Let's determine if we need any spawns.

        for (const operationOperator of this.operationOperators) {
            const creepOperator = Game.creeps[operationOperator.name];

            if (!(operationOperator instanceof Geologist)) {
                continue
            }

            if (creepOperator) {
                // console.log(`    Clocking in: ` + operationOperator.name);
            } else {

                const spawns = operationOperator.room.find(FIND_MY_SPAWNS);

                if (!(operationOperator.room.memory.nextTrade && (operationOperator.room.memory.nextTrade - 30) < Game.time)) {
                    continue;
                }

                let mineral = operationOperator.room.find(FIND_MINERALS)[0];

                if (mineral.mineralAmount === 0 && mineral.ticksToRegeneration && mineral.ticksToRegeneration > 0) {
                    return; // early
                }

                let extractor = mineral.pos.lookFor(LOOK_STRUCTURES);
                if (extractor.length == 0) {
                    mineral.pos.createConstructionSite(STRUCTURE_EXTRACTOR);
                    return;
                }

                if (spawns.length === 0) {
                    continue;
                } else {
                    for (const spawn of spawns) {
                        let spawnDirection = LEFT;
                        for (let spawnconfig of operationOperator.room.memory.config.spawns) {
                            if (spawnconfig.x == spawn.pos.x && spawnconfig.y == spawn.pos.y) {
                                spawnDirection = spawnconfig.direction;
                            }
                        }

                        let workParts = Math.min(10, Math.max(1, Math.floor((operationOperator.room.energyCapacityAvailable - 200) / 200)));
                        const operatorParts: BodyPartConstant[] = [];
                        console.log(`    Spawning: ` + operationOperator.name + ` ` + workParts);
                        for (let i = 1; i <= workParts; i++) {
                            operatorParts.push(WORK);
                            operatorParts.push(CARRY);
                            operatorParts.push(MOVE);
                        }

                        spawn.spawnCreep(operatorParts, operationOperator.name, {directions: [spawnDirection]});
                    }
                }
            }
        }
    }

    public actions() {
        //console.log(`--------  Geo Mining Company Actions  ------`);

        let lowestCD = 250;
        for (const roomid in Game.rooms) {
            const room = Game.rooms[roomid];

            // What kind of room are we looking at?
            if (room.controller?.owner?.username !== "ricane") {
                continue;
            } else {
                // Nothing Yet.
            }

            if (room.controller.level > 7) {
                if ((room.memory.nextTrade - Game.time - 30) < lowestCD) {
                    lowestCD = (room.memory.nextTrade - Game.time - 30);
                }
            }


        }

        //console.log(` `);
        //console.log(`--------  Operator Geo Mining Crew Actions ` + lowestCD + `  ------`);
        for (const operationOperator of this.operationOperators) {
            let cpuStart = Game.cpu.getUsed();
            operationOperator.actions();
            let cpuUsed = Game.cpu.getUsed() - cpuStart;
            if (cpuUsed > 0.5) {
                //console.log(`    ` + operationOperator.name + `: Actions Complete (cpu used: `+ cpuUsed.toFixed(2) + `)`);
            }
        }
    }
}
