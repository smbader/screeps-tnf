import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import {RoomFighter} from "../operator/RoomFighter";
import {RoomHealer} from "../operator/RoomHealer";
import {RoomArcher} from "../operator/RoomArcher";
import { RoomHelper } from "../utils/RoomHelper";

class RemoteAttack extends Operation {

    operationOperators:Operator[];

    smallRangerBody = [RANGED_ATTACK, MOVE, HEAL, MOVE];
    mediumRangerBody = [
        TOUGH, MOVE,
        RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE,
        HEAL, MOVE, HEAL, MOVE
    ];
    largeRangerBody = [
        TOUGH, MOVE,
        RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE,
        RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE,
        HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE
    ];
    jumboRangerBody = [
        RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
        RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE,
        RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE,
        RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
        HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE
    ];

    attackRooms:any[] = [
        { target: 'W28S35', source: 'W28S36', forcespawn: true, total: 1, rangertype: this.mediumRangerBody, waypoints: [ ] },
        { target: 'W28S35', source: 'W28S36', forcespawn: true, total: 1, rangertype: this.mediumRangerBody, waypoints: [ ] },
        //{ target: 'W28S35', source: 'W28S36', forcespawn: true, total: 1, rangertype: this.mediumRangerBody, waypoints: [ ] },
        //{ target: 'W28S35', source: 'W28S36', forcespawn: true, total: 1, rangertype: this.mediumRangerBody, waypoints: [ ] },
        //{ target: "E31N2", source: 'E31N1', forcespawn: true, total: 4, rangertype: this.jumboRangerBody, waypoints: [ ] },
        //{ target: "E33S0", source: 'E31N1', forcespawn: true, total: 4, rangertype: this.jumboRangerBody, waypoints: [ ] },
        //{ target: "E33S1", source: 'E31N1', forcespawn: true, total: 4, rangertype: this.jumboRangerBody, waypoints: [ ] },
        //{ target: "E33S1", source: 'E37S1', forcespawn: true, total: 4, rangertype: this.jumboRangerBody, waypoints: [ ] },
    ];

    constructor() {
        super();

        this.operationOperators = [];
    }

    init() {

        for (var attackRoom of this.attackRooms) {
            let sourceRoom = Game.rooms[attackRoom.source];

            for (let i = 0; i < attackRoom.total; i++) {
                const nameranger = 'RoomArcher_' + i + '_' + attackRoom.target;
                const operatorranger = new RoomArcher(nameranger, sourceRoom, attackRoom.target, attackRoom.waypoints, attackRoom.rangertype);
                this.operationOperators.push(operatorranger);
            }

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
                if (!operationOperator.room.storage || operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 50000) {
                    continue;
                }
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
                                let body:BodyPartConstant[] = this.smallRangerBody;
                                if (operationOperator.body) {
                                    body = operationOperator.body;
                                }
                                let result = spawn.spawnCreep(body, operationOperator.name, { directions: spawnDirection});
                                console.log(`Spawning Room Archer ${operationOperator.name} in room ${operationOperator.room.name} with result ${result}`);
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

export default RemoteAttack
