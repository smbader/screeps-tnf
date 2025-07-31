import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import {RoomFighter} from "../operator/RoomFighter";
import {RoomHealer} from "../operator/RoomHealer";
import {RoomArcher} from "../operator/RoomArcher";

export class RemoteAttack extends Operation {

    operationOperators:Operator[];
    attackRooms:any[] = [
        ////{ target: 'W4N1', source: 'W13N1', forcespawn: true, waypoints: [ { 'room': 'W13N0', 'x': 47, 'y': 34 , 'shard': 3}, { 'room': 'W4N0', 'x': 18, 'y': 7 , 'shard': 3}, { 'room': 'W4N1', 'x': 25, 'y': 41 , 'shard': 3} ] },
        { target: 'W4N2', source: 'W13N1', forcespawn: true, waypoints: [ { 'room': 'W13N0', 'x': 47, 'y': 34 , 'shard': 3}, { 'room': 'W4N0', 'x': 18, 'y': 7 , 'shard': 3}, { 'room': 'W4N1', 'x': 25, 'y': 41 , 'shard': 3}, { 'room': 'W4N2', 'x': 2, 'y': 48 , 'shard': 3} ] }
    ];

    constructor() {
        super();

        this.operationOperators = [];
    }

    init() {

        for (var attackRoom of this.attackRooms) {
            let sourceRoom = Game.rooms[attackRoom.source];

            //let namerf = 'RoomFighter_' + attackRoom.target + '_' + 0;
            //let operatorrf = new RoomFighter(namerf, sourceRoom, attackRoom.target, attackRoom.waypoints);
            //this.operationOperators.push(operatorrf);

            //let namerh = 'RoomHealer_' + attackRoom.target + '_' + 0;
            //let operatorrh = new RoomHealer(namerh, sourceRoom, namerf, attackRoom.target, attackRoom.waypoints);
            //this.operationOperators.push(operatorrh);
            //for(var creepName in Game.creeps) {
//
            //    if (creepName.startsWith("RoomArcher_")) {
           //         var creep = Game.creeps[creepName];
           //         if (creep) {
           //             let operatorranger = new RoomArcher(creepName, sourceRoom, attackRoom.target, attackRoom.waypoints);
           //             this.operationOperators.push(operatorranger);
           //         }
           //     }


           // }

            let nameranger = 'RoomArcher_' + 0;
            let operatorranger = new RoomArcher(nameranger, sourceRoom, attackRoom.target, attackRoom.waypoints);
            this.operationOperators.push(operatorranger);

            let nameranger1 = 'RoomArcher_' + 1;
            let operatorranger1 = new RoomArcher(nameranger1, sourceRoom, attackRoom.target, attackRoom.waypoints);
            this.operationOperators.push(operatorranger1);

            //let nameranger2 = 'RoomArcher_' + attackRoom.target + '_' + 2;
            //let operatorranger2 = new RoomArcher(nameranger2, sourceRoom, attackRoom.target, attackRoom.waypoints);
            //this.operationOperators.push(operatorranger2);


        }
    }


    roleCall() {
        // Let's determine if we need any spawns.

        for (let operationOperator of this.operationOperators) {
            var creepOperator = Game.creeps[operationOperator.name];

            if (creepOperator) {
                //console.log(`    Clocking in: ` + operationOperator.name + ' (' + creepOperator.ticksToLive + ')');
            } else {

                if (!operationOperator.room) {
                    continue;
                }
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

                            //if (operationOperator instanceof RoomHealer) {
                            //    spawn.spawnCreep([
                            //        HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE,
                            //        HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE,
                            //        HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE,
                            //        HEAL, HEAL, HEAL, HEAL, HEAL, MOVE, MOVE, MOVE, MOVE, MOVE
                            //    ], operationOperator.name, { directions: [spawnDirection]});
                            //}
                            //if (operationOperator instanceof RoomFighter) {
                            //    spawn.spawnCreep([
                            //        ATTACK, MOVE, ATTACK, MOVE, ATTACK, MOVE, ATTACK, MOVE, ATTACK, MOVE,
                            //        ATTACK, MOVE, ATTACK, MOVE, ATTACK, MOVE, ATTACK, MOVE, ATTACK, MOVE,
                            //        ATTACK, MOVE, ATTACK, MOVE, ATTACK, MOVE, ATTACK, MOVE, ATTACK, MOVE,
                            //        ATTACK, MOVE, ATTACK, MOVE, ATTACK, MOVE, ATTACK, MOVE, ATTACK, MOVE,
                            //    ], operationOperator.name, { directions: [spawnDirection]});
                            //}
                            if (operationOperator instanceof RoomArcher) {
                                spawn.spawnCreep([
                                    TOUGH, TOUGH,
                                    RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
                                    RANGED_ATTACK, RANGED_ATTACK,
                                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
                                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
                                    HEAL, HEAL, HEAL, HEAL, HEAL, HEAL
                                ], operationOperator.name, { directions: [spawnDirection]});
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
