import {forEach} from "lodash";
import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import { DemoCrew } from "../operator/DemoCrew";

export class RemoteDeconstruction extends Operation {
    public operationOperators: DemoCrew[];

    targetDeconstruction:any[] = [
/*        {
            room: 'W13N2',
            targetroom: 'W19N2',
            targetpos: [
                { "x": 24, "y": 26 },
                { "x": 24, "y": 27 },
            ],
            waypointrooms: [
                "W13N0", "W19N0"
            ]
        },
*/
    ];

    public constructor() {
        super();

        this.operationOperators = [];
    }

    public init() {


        for (var demoTarget of this.targetDeconstruction) {
            let sourceRoom = Game.rooms[demoTarget.room];
            let targetRoom = Game.rooms[demoTarget.targetroom];

            const room = Game.rooms[demoTarget.room];

            // What kind of room are we looking at?
            if (room.controller?.owner?.username !== "ricane") {
                continue;
            } else { }

            if (room.memory.config.shard && room.memory.config.shard != Game.shard.name) {
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

            if (demoTarget.targetpos.length > 0) {
                for (let i = 0; i < 1; i++) {
                    // We need a unique name
                    const name = "Demo_" + demoTarget.targetroom;
                    const operator = new DemoCrew(name, room, demoTarget);

                    this.operationOperators.push(operator);
                }
            }
        }
    }

    public roleCall() {
        // Let's determine if we need any spawns.

        for (const operationOperator of this.operationOperators) {
            const creepOperator = Game.creeps[operationOperator.name];

            if (creepOperator) {
                //console.log(`    Clocking in: ` + operationOperator.name);
            } else {
                // Spawn him.
                const spawns = operationOperator.room.find(FIND_MY_SPAWNS);

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

                        let workParts = Math.min(5, Math.max(1, Math.floor((operationOperator.room.energyAvailable) / 150)));
                        let operatorParts:BodyPartConstant[] = [];
                        for (let i = 1; i <= workParts;  i++) {
                            operatorParts.push(WORK);
                            operatorParts.push(MOVE);
                        }
                        if (spawn.spawnCreep(operatorParts, operationOperator.name, {directions: [spawnDirection]}) == OK) {
                            continue;
                        }
                    }
                }
            }
        }
    }

    public actions() {

        //console.log(`--------  Operator Demo Crew Actions  ------`);
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
