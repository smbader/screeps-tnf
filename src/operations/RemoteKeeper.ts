import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import {RemoteGeologist} from "../operator/RemoteGeologist";
import { Scout } from "../operator/Scout";
import { KeeperKiller } from "../operator/KeeperKiller";
import { RemoteHarvester } from "../operator/RemoteHarvester";
import { RoomHelper } from "../utils/RoomHelper";


export class RemoteKeeper extends Operation {

    operationOperators:Operator[];

    keeperRooms:any[] = [
        { target: 'W15N4', source: 'W15N3', shard: 'shard3', forcespawn: true, mineral: true, energy: false },
        { target: 'W16N4', source: 'W15N3', shard: 'shard3', forcespawn: true, mineral: true, energy: false },
    ];

    constructor() {
        super();

        this.operationOperators = [];
    }

    init() {

        for (var keeperRoom of this.keeperRooms) {
            let sourceRoom = Game.rooms[keeperRoom.source];
            if (!sourceRoom) { continue; }

            const cfgSrc = RoomHelper.getRoomConfig(sourceRoom);
            if (sourceRoom.controller?.owner?.username != 'ricane') {
                continue;
            }
            if (!cfgSrc || cfgSrc.type !== 'owned') {
                continue;
            }
            if (cfgSrc.shard && cfgSrc.shard != Game.shard.name) {
                continue;
            }

            let name = 'Scout_' + keeperRoom.target;
            let soperator = new Scout(name, sourceRoom, keeperRoom.target, keeperRoom.waypoints);
            this.operationOperators.push(soperator);

            if (!Game.rooms[keeperRoom.target]) {
                continue;
            }
            let targetRoom = Game.rooms[keeperRoom.target];

            name = 'KeeperKiller_' + keeperRoom.target + '_m';
            let koperator = new KeeperKiller(name, sourceRoom, keeperRoom.target);
            this.operationOperators.push(koperator);

            let mineral = targetRoom.find(FIND_MINERALS);
            if (mineral && mineral.length > 0) {

                if (keeperRoom.mineral) {
                    name = 'RemoteGeo_' + keeperRoom.target + '_m';
                    let goperator = new RemoteGeologist(name, sourceRoom, keeperRoom.target);
                    this.operationOperators.push(goperator);
                }
            }

            name = 'KeeperKiller_' + keeperRoom.target + '_e';
            let k2operator = new KeeperKiller(name, sourceRoom, keeperRoom.target);
            this.operationOperators.push(k2operator);

            const cfgTarget = RoomHelper.getRoomConfig(targetRoom);
            if (cfgTarget?.energysources) {

                let idx = 0;
                for (let energysource of cfgTarget.energysources) {

                    name = 'RemoteHarvester_' + keeperRoom.target + '_' + idx;
                    let rhoperator = new RemoteHarvester(name, sourceRoom, keeperRoom.target, energysource.id);
                    this.operationOperators.push(rhoperator);

                    idx++;
                }
            }
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

                            if (operationOperator instanceof Scout) {
                                console.log(`    Spawning: ` + operationOperator.name);
                                spawn.spawnCreep([MOVE], operationOperator.name, { directions: spawnDirection});
                            }

                            if (operationOperator instanceof KeeperKiller) {
                                console.log(`    Spawning: ` + operationOperator.name);
                                let body = [
                                    RANGED_ATTACK,RANGED_ATTACK,RANGED_ATTACK,RANGED_ATTACK,RANGED_ATTACK,RANGED_ATTACK,RANGED_ATTACK,RANGED_ATTACK,RANGED_ATTACK,RANGED_ATTACK,
                                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
                                    MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL,
                                ];
                                spawn.spawnCreep(body, operationOperator.name, { directions: spawnDirection});
                            }

                            if (operationOperator instanceof RemoteGeologist) {
                                console.log(`    Spawning: ` + operationOperator.name);
                                let body = [
                                    WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK,
                                    CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
                                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
                                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
                                ];
                                spawn.spawnCreep(body, operationOperator.name, { directions: spawnDirection});
                            }

                            if (operationOperator instanceof RemoteHarvester) {
                                console.log(`    Spawning: ` + operationOperator.name);
                                let body = [
                                    WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK,
                                    CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
                                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
                                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
                                ];
                                spawn.spawnCreep(body, operationOperator.name, { directions: spawnDirection});
                            }

                        }
                    }
                }
            }
        }
    }

    actions() {

        //console.log(`--------  Remote Keeper Actions  ------`);
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
