import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import { RemoteWorker } from "../operator/RemoteWorker";
import { Scout } from "../operator/Scout";
import { Claimer } from "../operator/Claimer";
import { RoomHelper } from "../utils/RoomHelper";

export class ExpansionManagement extends Operation {

    operationOperators: Operator[];
    expansionRooms: any[] = [
        { target: 'E28S1', source: 'E31N1', forcespawn: true, waypoints: [] },
        { target: 'E37S1', source: 'E31N1', forcespawn: true, waypoints: [] },
        { target: 'E33N5', source: 'E31N3', forcespawn: true, waypoints: [] },
        { target: 'E32N4', source: 'E31N3', forcespawn: true, waypoints: [] },
    ];

    constructor() {
        super();
        this.operationOperators = [];
    }

    init() {
        for (const expansionRoom of this.expansionRooms) {
            const targetRoom = Game.rooms[expansionRoom.target];
            const sourceRoom = Game.rooms[expansionRoom.source];

            const name = 'Claimer_' + expansionRoom.target;
            const operator = new Claimer(name, sourceRoom, expansionRoom.target, expansionRoom.waypoints);
            this.operationOperators.push(operator);

            const sname = 'Scout_' + expansionRoom.target;
            const soperator = new Scout(sname, sourceRoom, expansionRoom.target, expansionRoom.waypoints);
            this.operationOperators.push(soperator);

            if (!expansionRoom.forcespawn && (targetRoom == null || targetRoom.controller?.owner?.username != 'ricane')) {
                continue;
            }

            let idx = 0;
            if (targetRoom && targetRoom.memory && targetRoom.memory.sources) {
                for (const sourceid in targetRoom.memory.sources) {
                    for (let i = 1; i <= 4; i++) {
                        const rname = 'RemoteWorker_' + expansionRoom.target + '_' + i + '_' + idx;
                        const eoperator = new RemoteWorker(rname, sourceRoom, targetRoom, sourceid, expansionRoom.waypoints);
                        this.operationOperators.push(eoperator);
                    }
                    idx++;
                }
            }
        }
    }

    roleCall() {
        for (const operationOperator of this.operationOperators) {
            const creepOperator = Game.creeps[operationOperator.name];
            if (creepOperator) continue;

            if (!operationOperator.room) continue;

            const spawns = operationOperator.room.find(FIND_MY_SPAWNS);
            if (spawns.length == 0) continue;

            const cfg = RoomHelper.getRoomConfig(operationOperator.room);

            for (const spawn of spawns) {
                if (!spawn.spawning) {
                    let spawnDirection = [TOP, TOP_LEFT, LEFT, BOTTOM_LEFT, BOTTOM, BOTTOM_RIGHT, RIGHT, TOP_RIGHT];
                    for (const spawnconfig of (cfg && cfg.spawns || [])) {
                        if (spawnconfig.x == spawn.pos.x && spawnconfig.y == spawn.pos.y) {
                            if (spawnconfig.direction) spawnDirection = [spawnconfig.direction];
                        }
                    }

                    if (operationOperator instanceof Scout) {
                        console.log(`    Spawning: ` + operationOperator.name);
                        spawn.spawnCreep([MOVE], operationOperator.name, { directions: spawnDirection });
                        continue;
                    }

                    if (operationOperator instanceof Claimer) {
                        if (Game.rooms[operationOperator.memory.targetroom] &&
                            Game.rooms[operationOperator.memory.targetroom].controller?.owner?.username !== 'ricane') {
                            console.log(`    Spawning: ` + operationOperator.name);
                            spawn.spawnCreep([MOVE, CLAIM], operationOperator.name, { directions: spawnDirection });
                        }
                    }

                    if ((operationOperator as any).constructor.name === 'RemoteWorker') {
                        if (operationOperator.room.storage && operationOperator.room.controller &&
                            operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 10000) {

                            if (operationOperator.room.controller.level > 5) {
                                console.log(`    Spawning: ` + operationOperator.name);
                                spawn.spawnCreep([
                                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
                                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
                                    MOVE, MOVE, MOVE, MOVE, MOVE,
                                    WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK,
                                    WORK, WORK, WORK, WORK, WORK,
                                    CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
                                    CARRY, CARRY
                                ], operationOperator.name, { directions: spawnDirection });
                            } else {
                                console.log(`    Spawning: ` + operationOperator.name);
                                spawn.spawnCreep([
                                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
                                    WORK, WORK,
                                    CARRY, CARRY, CARRY, CARRY, CARRY
                                ], operationOperator.name, { directions: spawnDirection });
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
