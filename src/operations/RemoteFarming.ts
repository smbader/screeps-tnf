import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import {Harvester} from "../operator/Harvester";
import {Hauler} from "../operator/Hauler";
import {Scout} from "../operator/Scout";
import {Claimer} from "../operator/Claimer";
import {TinyFarmer} from "../operator/TinyFarmer";


export class RemoteFarming extends Operation {

    operationOperators:Operator[];
    expansionRooms:any[] = [
        //{ target: 'W18S6', source: 'W19S6', 'shard': 'shard0' },
        { target: 'W17S13', source: 'W18S13', 'shard': 'shard0' },
        { target: 'W18S14', source: 'W18S13', 'shard': 'shard0' },
    ];

    constructor() {
        super();

        this.operationOperators = [];
    }

    init() {

        for (var expansionRoom of this.expansionRooms) {
            let sourceRoom = Game.rooms[expansionRoom.source];

            if (expansionRoom.shard != Game.shard.name || sourceRoom == undefined) {
                continue;
            }

            if (sourceRoom && sourceRoom.controller && sourceRoom.controller.level >= 5) {
                // Do the normal remote farming.

                // we can see it.
                let name = 'Claimer_' + expansionRoom.target;
                let operator = new Claimer(name, sourceRoom, expansionRoom.target);
                this.operationOperators.push(operator);

                name = 'Scout_' + expansionRoom.target;
                let soperator = new Scout(name, sourceRoom, expansionRoom.target);
                this.operationOperators.push(soperator);

                if (!Game.rooms[expansionRoom.target]) {
                    continue;
                }
                let targetRoom = Game.rooms[expansionRoom.target];

                let idx = 0;
                if (targetRoom.memory.sources) {
                    for(var sourceid in targetRoom.memory.sources) {

                        name = 'RemoteHarvester_' + expansionRoom.target + '_3_' + idx;
                        let hoperator = new Harvester(name, sourceRoom, sourceid, targetRoom);
                        this.operationOperators.push(hoperator);

                        for (let i = 1; i <= 2; i++) {
                            name = 'RemoteHauler_' + expansionRoom.target + '_' + i + '_' + idx;
                            let rhoperator = new Hauler(name, sourceRoom, sourceid);
                            this.operationOperators.push(rhoperator);
                        }
                        idx++;
                    }
                }
            } else {
                // Very young room, use tiny workers to extract resources.

                let name = 'Scout_' + expansionRoom.target;
                let soperator = new Scout(name, sourceRoom, expansionRoom.target);
                this.operationOperators.push(soperator);

                if (!Game.rooms[expansionRoom.target]) {
                    continue;
                }
                let targetRoom = Game.rooms[expansionRoom.target];

                if (targetRoom.memory.config.energysources) {
                    let idx = 0;
                    for(var source in targetRoom.memory.config.energysources) {

                        for (let i = 1; i <= 2; i++) {
                            let name = 'TinyFarmer_' + expansionRoom.target + '_' + i + '_' + idx;
                            let rhoperator = new TinyFarmer(name, sourceRoom, targetRoom.name, targetRoom.memory.config.energysources[source].id);
                            this.operationOperators.push(rhoperator);
                        }
                        idx++;
                    }
                }


            }




        }
    }


    roleCall() {
        // Let's determine if we need any spawns.

        for (let operationOperator of this.operationOperators) {
            var creepOperator = Game.creeps[operationOperator.name];

            if (creepOperator) {
                //console.log(`    Clocking in: ` + operationOperator.name + ' (' + creepOperator.ticksToLive + ')');
            } else {

                // Spawn him.
                let spawns = operationOperator.room.find(FIND_MY_SPAWNS);
                if (spawns.length == 0) {
                    continue;
                } else {
                    for (let spawn of spawns) {
                        if (!spawn.spawning) {
                            let spawnDirection = LEFT;
                            for (let spawnconfig of operationOperator.room.memory.config.spawns) {
                                if (spawnconfig.x == spawn.pos.x && spawnconfig.y == spawn.pos.y) {
                                    spawnDirection = spawnconfig.direction;
                                }
                            }

                            if (operationOperator instanceof Scout) {
                                console.log(`    Spawning: ` + operationOperator.name);
                                spawn.spawnCreep([MOVE], operationOperator.name, { directions: [spawnDirection]});
                            }

                            if (operationOperator instanceof TinyFarmer) {
                                console.log(`    Spawning: ` + operationOperator.name);
                                spawn.spawnCreep([WORK, CARRY, MOVE, CARRY ,MOVE ], operationOperator.name, { directions: [spawnDirection]});
                            }

                            if (operationOperator instanceof Claimer) {
                                if (Game.rooms[operationOperator.memory.targetroom] && Game.rooms[operationOperator.memory.targetroom].controller?.owner?.username !== 'ricane') {

                                    let workParts = Math.min(3, Math.max(1, Math.floor((operationOperator.room.energyAvailable) / 650)));
                                    let operatorParts:BodyPartConstant[] = [];
                                    for (let i = 1; i <= workParts;  i++) {
                                        operatorParts.push(MOVE);
                                        operatorParts.push(CLAIM);
                                    }
                                    if (spawn.spawnCreep(operatorParts, operationOperator.name, { directions: [spawnDirection]}) == OK) {
                                        continue;
                                    }
                                }
                            }

                            if (operationOperator instanceof Harvester) {
                                if (Game.rooms[operationOperator.memory.targetroom] &&
                                    operationOperator.room.storage &&
                                    operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 10000) {

                                    if (spawn.spawnCreep([MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
                                        CARRY, WORK, WORK, WORK, WORK, WORK, WORK], operationOperator.name, { directions: [spawnDirection]}) == OK) {
                                        continue;
                                    }
                                } else if (Game.rooms[operationOperator.memory.targetroom] && !operationOperator.room.storage) {

                                    if (spawn.spawnCreep([MOVE, MOVE, MOVE, MOVE, CARRY, WORK, WORK, WORK, WORK], operationOperator.name, { directions: [spawnDirection]}) == OK) {
                                        continue;
                                    }
                                }
                            }

                            if (operationOperator instanceof Hauler) {
                                let containerExists = (Game.getObjectById<Source>(operationOperator.memory.sourceid)?.room.memory.sources[operationOperator.memory.sourceid].container.id !== '');

                                if (operationOperator.room.storage &&
                                    operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 10000 &&
                                    containerExists) {

                                    if (spawn.spawnCreep([
                                        MOVE, CARRY, MOVE, CARRY, MOVE, CARRY,
                                        MOVE, CARRY, MOVE, CARRY, MOVE, CARRY,
                                        MOVE, CARRY, MOVE, CARRY, MOVE, CARRY,
                                        MOVE, CARRY], operationOperator.name, { directions: [spawnDirection]}) == OK) {
                                        continue;
                                    }
                                } else if (containerExists && !operationOperator.room.storage) {

                                    if (spawn.spawnCreep([
                                        MOVE, CARRY, MOVE, CARRY, MOVE, CARRY,
                                        MOVE, CARRY, MOVE, CARRY, MOVE, CARRY], operationOperator.name, { directions: [spawnDirection]}) == OK) {
                                        continue;
                                    }
                                }
                            }
                        } else {
                            if (spawn.spawning.directions[0]) {
                                let direction = spawn.spawning.directions[0];
                                let x = spawn.pos.x;
                                let y = spawn.pos.y;

                                if (direction == TOP || direction == TOP_LEFT || direction == TOP_RIGHT) {
                                    y = y-1;
                                }
                                if (direction == TOP_RIGHT || direction == RIGHT || direction == BOTTOM_RIGHT) {
                                    x = x+1;
                                }
                                if (direction == BOTTOM || direction == BOTTOM_LEFT || direction == BOTTOM_RIGHT) {
                                    y = y+1;
                                }
                                if (direction == TOP_LEFT || direction == LEFT || direction == BOTTOM_LEFT) {
                                    x = x-1;
                                }
                                let creeps = spawn.room.lookForAt(LOOK_CREEPS, x, y);
                                if (creeps.length > 0) {
                                    creeps[0].travelTo(new RoomPosition(1,1,spawn.room.name));
                                    creeps[0].say('Bump!');
                                }

                            }
                        }

                    }

                }
            }
        }
    }

    actions() {

        //console.log(`--------  Remote Farming Actions  ------`);
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
