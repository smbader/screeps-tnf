import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import {RoomFighter} from "../operator/RoomFighter";
import {RoomHealer} from "../operator/RoomHealer";
import {RoomArcher} from "../operator/RoomArcher";
import { RoomHelper } from "../utils/RoomHelper";

export class RemoteAttack extends Operation {

    operationOperators:Operator[];
    attackRooms:any[] = [
        { target: 'W4N2', source: 'W13N1', forcespawn: true, waypoints: [ { 'room': 'W13N0', 'x': 47, 'y': 34 , 'shard': 3}, { 'room': 'W4N0', 'x': 18, 'y': 7 , 'shard': 3}, { 'room': 'W4N1', 'x': 25, 'y': 41 , 'shard': 3} ] },
    ];

    constructor() {
        super();

        this.operationOperators = [];
    }

    init() {

        for (var attackRoom of this.attackRooms) {
            let sourceRoom = Game.rooms[attackRoom.source];

            let nameranger = 'RoomArcher_' + 0;
            let operatorranger = new RoomArcher(nameranger, sourceRoom, attackRoom.target, attackRoom.waypoints);
            this.operationOperators.push(operatorranger);

            let nameranger1 = 'RoomArcher_' + 1;
            let operatorranger1 = new RoomArcher(nameranger1, sourceRoom, attackRoom.target, attackRoom.waypoints);
            this.operationOperators.push(operatorranger1);

        }
    }


    roleCall() {
        // Let's determine if we need any spawns.

        for (let operationOperator of this.operationOperators) {
            var creepOperator = Game.creeps[operationOperator.name];

            if (creepOperator) {
                // already alive
            } else {

                if (!operationOperator.room) {
                    continue;
                }
                // Spawn him.
                let spawns = operationOperator.room.find(FIND_MY_SPAWNS);
                if (spawns.length == 0) {
                    continue;
                } else {
                    const cfg = RoomHelper.getRoomConfig(operationOperator.room);
                    for (let spawn of spawns) {
                        if (!spawn.spawning) {
                            let spawnDirection = [TOP, TOP_LEFT, LEFT, BOTTOM_LEFT, BOTTOM, BOTTOM_RIGHT, RIGHT, TOP_RIGHT];
                            for (let spawnconfig of (cfg && cfg.spawns || [])) {
                                if (spawnconfig.x == spawn.pos.x && spawnconfig.y == spawn.pos.y) {
                                    if (spawnconfig.direction) spawnDirection = [spawnconfig.direction];
                                }
                            }

                            if (operationOperator instanceof RoomArcher) {
                                spawn.spawnCreep([
                                    TOUGH, TOUGH,
                                    RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
                                    RANGED_ATTACK, RANGED_ATTACK,
                                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
                                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
                                    HEAL, HEAL, HEAL, HEAL, HEAL, HEAL
                                ], operationOperator.name, { directions: spawnDirection});
                            }

                        } else {
                            // existing spawning handling
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
