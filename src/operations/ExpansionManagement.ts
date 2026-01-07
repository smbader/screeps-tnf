import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import { RemoteWorker } from "../operator/RemoteWorker";
import {Field} from "../operator/Field";
import {Scout} from "../operator/Scout";
import {Claimer} from "../operator/Claimer";


export class ExpansionManagement extends Operation {

    operationOperators:Operator[];
    expansionRooms:any[] = [
      { target: 'E28S1', source: 'E31N1', forcespawn: true, waypoints: [    ] },
      { target: 'E37S1', source: 'E31N1', forcespawn: true, waypoints: [    ] },
      { target: 'E33N5', source: 'E31N3', forcespawn: true, waypoints: [    ] },
      { target: 'E32N4', source: 'E31N3', forcespawn: true, waypoints: [    ] },
        //{ target: 'W1N1', source: 'W4N1', forcespawn: true, waypoints: [ { 'room': 'W4N0', 'x': 38, 'y': 5 , 'shard': 3}, { 'room': 'W1N0', 'x': 4, 'y': 12 , 'shard': 3}, { 'room': 'W1N1', 'x': 25, 'y': 41 , 'shard': 3} ] },
        //{ target: 'W1N3', source: 'W4N1', forcespawn: true, waypoints: [ { 'room': 'W4N0', 'x': 38, 'y': 5 , 'shard': 3}, { 'room': 'W0N0', 'x': 39, 'y': 38 , 'shard': 3}, { 'room': 'W0N0', 'x': 24, 'y': 42, 'shard': 2 }, { 'room': 'W0N0', 'x': 14, 'y': 9, 'shard': 1 }, { 'room': 'W0N3', 'x': 6, 'y': 41, 'shard': 1 }, { 'room': 'W1N3', 'x': 40, 'y': 38, 'shard': 1 } ] },
        //{ target: 'W1N1', source: 'W13N2', forcespawn: true, waypoints: [ { 'room': 'W13N0', 'x': 47, 'y': 34 , 'shard': 3}, { 'room': 'W1N0', 'x': 18, 'y': 7 , 'shard': 3}, { 'room': 'W1N1', 'x': 25, 'y': 41 , 'shard': 3} ] },
        //{ target: 'W4N1', source: 'W13N2', forcespawn: true, waypoints: [ { 'room': 'W13N0', 'x': 47, 'y': 34 , 'shard': 3}, { 'room': 'W4N0', 'x': 18, 'y': 7 , 'shard': 3}, { 'room': 'W4N1', 'x': 25, 'y': 41 , 'shard': 3} ] }
        //{ target: 'W13S6', source: 'W19S6', forcespawn: false, waypoints: [ { 'room': 'W17S7', 'x': 27, 'y': 9 , 'shard': 0} , { 'room': 'W13S7', 'x': 27, 'y': 9 , 'shard': 0} ] }
        //{ target: 'W19S6', source: 'W13N2', forcespawn: true, waypoints: [ { 'room': 'W13N0', 'x': 47, 'y': 34 , 'shard': 3}, { 'room': 'W10S0', 'x': 14, 'y': 22 , 'shard': 3}, { 'room': 'W10S0', 'x': 10, 'y': 8, 'shard': 2 }, { 'room': 'W10S0', 'x': 9, 'y': 20, 'shard': 1 }, { 'room': 'W20S6', 'x': 38, 'y': 4, 'shard': 0 }, { 'room': 'W19S6', 'x': 20, 'y': 20, 'shard': 0 } ] }
        //{ target: 'W19S6', source: 'W13N2', forcespawn: true, waypoints: [ { 'room': 'W13N0', 'x': 47, 'y': 34 , 'shard': 3}, { 'room': 'W12N0', 'x': 19, 'y': 48 , 'shard': 3}, { 'room': 'W12S0', 'x': 48, 'y': 14 , 'shard': 3}, { 'room': 'W10S0', 'x': 14, 'y': 22 , 'shard': 3}, { 'room': 'W10S0', 'x': 10, 'y': 8, 'shard': 2 }, { 'room': 'W10S0', 'x': 9, 'y': 20, 'shard': 1 }, { 'room': 'W20S6', 'x': 38, 'y': 4, 'shard': 0 }, { 'room': 'W19S6', 'x': 20, 'y': 20, 'shard': 0 } ] }
    ];

    constructor() {
        super();

        this.operationOperators = [];
    }

    init() {

        for (var expansionRoom of this.expansionRooms) {
            let targetRoom = Game.rooms[expansionRoom.target];
            let sourceRoom = Game.rooms[expansionRoom.source];

            // we can see it.
            let name = 'Claimer_' + expansionRoom.target;
            let operator = new Claimer(name, sourceRoom, expansionRoom.target, expansionRoom.waypoints);
            this.operationOperators.push(operator);

            name = 'Scout_' + expansionRoom.target;
            let soperator = new Scout(name, sourceRoom, expansionRoom.target, expansionRoom.waypoints);
            this.operationOperators.push(soperator);

            if (!expansionRoom.forcespawn && (targetRoom == null || targetRoom.controller?.owner?.username != 'ricane')) {
                continue;
            }

            let idx = 0;
            //if (!targetRoom && expansionRoom.forcespawn) {
            //for (let i = 1; i <= 2; i++) {
            //    name = 'RemoteWorker_' + expansionRoom.target + '_' + i + '_' + idx;
            //    let eoperator = new RemoteWorker(name, sourceRoom, targetRoom, '', expansionRoom.waypoints);
            //    this.operationOperators.push(eoperator);
            //}
            //}// else {
                for(var sourceid in targetRoom.memory.sources) {

                    for (let i = 1; i <= 4; i++) {
                        name = 'RemoteWorker_' + expansionRoom.target + '_' + i + '_' + idx;
                        let eoperator = new RemoteWorker(name, sourceRoom, targetRoom, sourceid, expansionRoom.waypoints);
                        this.operationOperators.push(eoperator);
                    }
                    idx++;
                }
            //}
        }

    }


    roleCall() {
        // Let's determine if we need any spawns.


        for (let operationOperator of this.operationOperators) {
            var creepOperator = Game.creeps[operationOperator.name];
            //console.log(`    Role Call: ` +  operationOperator.name);

            if (creepOperator) {
                //console.log(`    Clocking in: ` +  operationOperator.name + ' (' + creepOperator.ticksToLive  + ')');
            } else {
                if (!operationOperator.room) {
                    continue;
                }

                // Spawn him.
                let spawns = operationOperator.room.find(FIND_MY_SPAWNS);

                if (spawns.length == 0) {
                    continue;
                } else {
                    for(let spawn of spawns) {
                        if (!spawn.spawning) {
                            let spawnDirection = LEFT;
                            for (let spawnconfig of operationOperator.room.memory.config.spawns) {
                                if (spawnconfig.x == spawn.pos.x && spawnconfig.y == spawn.pos.y) {
                                    spawnDirection = spawnconfig.direction;
                                }
                            }

                            if (operationOperator instanceof Scout) {
                                console.log(`    Spawning: ` +  operationOperator.name);
                                spawn.spawnCreep([MOVE], operationOperator.name, {directions: [spawnDirection]});
                                continue;
                            }

                            if (operationOperator instanceof Claimer) {
                                if (Game.rooms[operationOperator.memory.targetroom] &&
                                   Game.rooms[operationOperator.memory.targetroom].controller?.owner?.username !== 'ricane') {
                                    console.log(`    Spawning: ` +  operationOperator.name);
                                    spawn.spawnCreep([MOVE, CLAIM], operationOperator.name, {directions: [spawnDirection]});
                                }
                            }

                            if (operationOperator instanceof RemoteWorker) {
                                if (operationOperator.room.storage && operationOperator.room.controller &&
                                    operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 10000) {

                                    if (operationOperator.room.controller.level > 5) {
                                        console.log(`    Spawning: ` +  operationOperator.name);
                                        spawn.spawnCreep([
                                            MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,
                                            MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,
                                            MOVE,MOVE,MOVE,MOVE,MOVE,
                                            WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,
                                            WORK,WORK,WORK,WORK,WORK,
                                            CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,
                                            CARRY,CARRY
                                        ], operationOperator.name, {directions: [spawnDirection]});
                                    } else {
                                        console.log(`    Spawning: ` +  operationOperator.name);
                                        spawn.spawnCreep([
                                            MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,
                                            WORK,WORK,
                                            CARRY,CARRY,CARRY,CARRY,CARRY
                                        ], operationOperator.name, {directions: [spawnDirection]});
                                    }

                                    continue;
                                }
                            }


                        }
                    }

                }

            }
        }
    }

    actions() {

        //console.log(`--------  Operator Expansion Management Actions  ------`);
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
