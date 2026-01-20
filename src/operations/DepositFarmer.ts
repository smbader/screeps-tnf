import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import { DepositMiner } from "../operator/DepositMiner";
import { RoomHelper } from "../utils/RoomHelper";


export class DepositFarmer extends Operation {

    operationOperators:Operator[];
    depositRooms:any[] = [
        { target: 'E30N1', source: 'E31N0', 'shard': 'shard1' },
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

            if (!Game.rooms[depositRoom.target] && sourceRoom) {
                let observers = sourceRoom.find<StructureObserver>(FIND_MY_STRUCTURES, {
                    filter: structure => (structure.structureType == STRUCTURE_OBSERVER)
                });
                if (observers.length > 0) {
                    let observer = observers[0];
                    observer.observeRoom(depositRoom.target);
                    console.log('[' + sourceRoom.name + '] scanning room [' + depositRoom.target + ']');
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
                // alive
            } else {

                // Spawn him.
                let spawns = operationOperator.room.find(FIND_MY_SPAWNS);
                if (spawns.length == 0) {
                    // no spawns
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


                            if (operationOperator instanceof DepositMiner) {
                                if (operationOperator.room.storage &&
                                    operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 100000) {


                                    let targetRoom = Game.rooms[operationOperator.targetroom];
                                    if (targetRoom) {
                                        let target = targetRoom.find(FIND_DEPOSITS);
                                        if (target.length > 0) {

                                            if (spawn.spawnCreep(
                                                [MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY]
                                                , operationOperator.name, {directions: spawnDirection}) == OK) {
                                                // spawn queued (if possible)
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

        for (let operationOperator of this.operationOperators) {
            let cpuStart = Game.cpu.getUsed();
            operationOperator.actions();
            let cpuUsed = Game.cpu.getUsed() - cpuStart;
            if (cpuUsed > 0.5) {
            }
        }
    }

}
