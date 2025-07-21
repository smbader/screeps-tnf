import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import { PowerFighter } from "../operator/PowerFighter";
import { PowerHauler } from "../operator/PowerHauler";
import { Scout } from "../operator/Scout";
import { PowerHealer } from "../operator/PowerHealer";


export class PowerFarming extends Operation {

    operationOperators:Operator[];
    powerRooms:any[] = [
        { target: 'W13S0', source: 'W13N2', 'shard': 'shard3' },
        //{ target: 'W13N0', source: 'W13N2', 'shard': 'shard3' },
        //{ target: 'W14N0', source: 'W13N2', 'shard': 'shard3' },
    ];

    constructor() {
        super();

        this.operationOperators = [];
    }

    init() {

        for (var powerRoom of this.powerRooms) {
            let sourceRoom = Game.rooms[powerRoom.source];

            if (powerRoom.shard != Game.shard.name) {
                continue;
            }

            let name = 'Scout_' + powerRoom.target;
            let soperator = new Scout(name, sourceRoom, powerRoom.target);
            this.operationOperators.push(soperator);

            if (!Game.rooms[powerRoom.target]) {
                continue;
            }
            let targetRoom = Game.rooms[powerRoom.target];


            let pfname = 'PowerFighter_' + targetRoom.name;
            let pfoperator = new PowerFighter(pfname, sourceRoom, targetRoom.name);
            this.operationOperators.push(pfoperator);

            name = 'PowerHealer_' + targetRoom.name;
            let hoperator = new PowerHealer(name, sourceRoom, pfname, targetRoom.name);
            this.operationOperators.push(hoperator);


            let pfname2 = 'PowerFighter_' + targetRoom.name + '_2';
            pfoperator = new PowerFighter(pfname2, sourceRoom, targetRoom.name);
            this.operationOperators.push(pfoperator);

            let hname2 = 'PowerHealer_' + targetRoom.name + '_2';
            let hoperator2 = new PowerHealer(hname2, sourceRoom, pfname2, targetRoom.name);
            this.operationOperators.push(hoperator2);

            for (let i = 1; i <= 6; i++) {
                name = 'PowerHauler_' + targetRoom.name + '_' + i;
                let rhoperator = new PowerHauler(name, sourceRoom, targetRoom.name);
                this.operationOperators.push(rhoperator);
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
                                spawn.spawnCreep([MOVE], operationOperator.name, {directions: [spawnDirection]});
                            }


                            if (operationOperator instanceof PowerFighter) {
                                if (operationOperator.room.storage &&
                                    operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 100000) {

                                    let targetRoom = Game.rooms[operationOperator.targetroom];

                                    let target = targetRoom.find<StructurePowerBank>(FIND_STRUCTURES, {
                                        filter: structure => (structure.structureType == STRUCTURE_POWER_BANK)
                                    });

                                    if (target.length > 0) {

                                        let ps = target[0];
                                        if (ps.hits > 0) {
                                            let result = spawn.spawnCreep(
                                                [MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK]
                                                , operationOperator.name, {directions: [spawnDirection]});
                                            if (result == OK) {
                                                continue;
                                            } else {
                                                console.log('Cant spawn fighter: ' + result);
                                            }
                                        }
                                    }

                                }
                            }

                            if (operationOperator instanceof PowerHealer) {
                                if (operationOperator.room.storage &&
                                    operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 150000) {

                                    let targetRoom = Game.rooms[operationOperator.targetroom];
                                    let target = targetRoom.find<StructurePowerBank>(FIND_STRUCTURES, {
                                        filter: structure => (structure.structureType == STRUCTURE_POWER_BANK)
                                    });

                                    if (target.length > 0) {

                                        let ps = target[0];
                                        if (ps.hits > 0) {

                                            if (spawn.spawnCreep(
                                                [MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL], operationOperator.name, {directions: [spawnDirection]}) == OK) {
                                                continue;
                                            }
                                        }
                                    }

                                }
                            }

                            if (operationOperator instanceof PowerHauler) {
                                if (operationOperator.room.storage &&
                                    operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 100000) {


                                    let targetRoom = Game.rooms[operationOperator.targetroom];
                                    let target = targetRoom.find<StructurePowerBank>(FIND_STRUCTURES, {
                                        filter: structure => (structure.structureType == STRUCTURE_POWER_BANK)
                                    });

                                    if (target.length > 0) {
                                        let ps = target[0];
                                        if (ps.hits < 250000 && ps.power > 0) {

                                            if (spawn.spawnCreep([MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY], operationOperator.name, {directions: [spawnDirection]}) == OK) {
                                                continue;
                                            }

                                        }
                                    }
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
