import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import { DepositMiner } from "../operator/DepositMiner";


export class DepositFarmer extends Operation {

    operationOperators:Operator[];
    depositRooms:any[] = [
        /*{ target: 'W11N0', source: 'W13N2', 'shard': 'shard3' },
        { target: 'W12N0', source: 'W13N2', 'shard': 'shard3' },
        { target: 'W13N0', source: 'W13N2', 'shard': 'shard3' },
        { target: 'W14N0', source: 'W13N2', 'shard': 'shard3' },
        { target: 'W15N0', source: 'W13N2', 'shard': 'shard3' },
        { target: 'W11S0', source: 'W13N2', 'shard': 'shard3' },
        { target: 'W12S0', source: 'W13N2', 'shard': 'shard3' },
        { target: 'W13S0', source: 'W13N2', 'shard': 'shard3' },
        { target: 'W14S0', source: 'W13N2', 'shard': 'shard3' },
        { target: 'W15S0', source: 'W13N2', 'shard': 'shard3' },

        { target: 'W20N0', source: 'W18N2', 'shard': 'shard3' },*/
    ];

    constructor() {
        super();

        this.operationOperators = [];
    }

    init() {

        for (var depositRoom of this.depositRooms) {
            let sourceRoom = Game.rooms[depositRoom.source];

            if (depositRoom.shard != Game.shard.name) {
                continue;
            }

            if (!Game.rooms[depositRoom.target]) {
                let observers = sourceRoom.find<StructureObserver>(FIND_MY_STRUCTURES, {
                    filter: structure => (structure.structureType == STRUCTURE_OBSERVER)
                });
                if (observers.length > 0) {
                    let observer = observers[0];
                    let result = observer.observeRoom(depositRoom.target);
                    //console.log('[' + sourceRoom.name + '] scanning room [' + depositRoom.target + '] (' + result + ')');
                }
            }

            let pfname = 'DepositMiner' + depositRoom.target;
            let pfoperator = new DepositMiner(pfname, sourceRoom, depositRoom.target);
            this.operationOperators.push(pfoperator);

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


                            if (operationOperator instanceof DepositMiner) {
                                if (operationOperator.room.storage &&
                                    operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 100000) {


                                    let targetRoom = Game.rooms[operationOperator.targetroom];
                                    if (targetRoom) {
                                        let target = targetRoom.find(FIND_DEPOSITS);
                                        if (target.length > 0) {

                                            if (spawn.spawnCreep(
                                                [MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY]
                                                , operationOperator.name, {directions: [spawnDirection]}) == OK) {
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
