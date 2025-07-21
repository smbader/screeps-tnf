import {forEach} from "lodash";
import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import { Harvester } from "../operator/Harvester";
import { Hauler } from "../operator/Hauler";
import { Upgrader } from "../operator/Upgrader";
import { Field } from "../operator/Field";

export class EnergyManagement extends Operation {

    operationOperators:Operator[]

    constructor() {
        super();

        this.operationOperators = [];
    }

    /*
    * Energy management.

    * 1. If the room does not have harvesters, haulers, an upgrader, and existing emergencyworker then four EmergencyWorkers should spawn.
    * 2. If four EmergencyWorker exists, build harvester, then hauler, then upgrader.
    * 3. Emergency workers should:
    *   3a. Harvest from assigned source node
    *   3b. Haul to energy containers; if full controller
    *   3c. Upgrade controller
    * 4. Harvesters should:
    *   4a. Travel to assigned source node position.
    *   4b. Farm a miniumum energy to be dropped.
    *   4c. Construct a container at the standing position
    * 5. Haulers should:
    *   5a. Pickup energy from selected node this trip
    *   5b. Fill energy containers identified this trip
    *   5c. Deliver to controller node.
    * 6. Upgrder should:
    *   6a. Travel to the room controller
    *   6b. Use / steal whatever energy available to upgrade controller.
    * 7. Field manager:
    *   7a. Should have an assigned spawn and direction
    *   7b. Move into a set path defined in a config.
    *   7c. Use designated souce locations to find a source structure
    *   7d. Fill and managed assigned structures in config.
    */

    init() {

        for (var roomid in Memory.rooms) {
            let room = Game.rooms[roomid];
            if (!room) { continue; }

            if (room.controller?.owner?.username != 'ricane') {
                continue;
            }
            if (!room.memory.config || room.memory.config.type !== 'owned') {
                continue;
            }
            if (room.memory.config.shard && room.memory.config.shard != Game.shard.name) {
                continue;
            }
            let operator:Operator;
            // New employment plan begin

            let name = '';

            name = 'Upgrader_' + room.name + '_' + 0;
            operator = new Upgrader(name, room);
            this.operationOperators.push(operator);

            name = 'Upgrader_' + room.name + '_' + 1;
            operator = new Upgrader(name, room);
            this.operationOperators.push(operator);

            name = 'Upgrader_' + room.name + '_' + 2;
            operator = new Upgrader(name, room);
            this.operationOperators.push(operator);

            name = 'Upgrader_' + room.name + '_' + 3;
            operator = new Upgrader(name, room);
            this.operationOperators.push(operator);

            for (let i = 0; i < 6;  i++) {
                if (room.memory.config['field' + i]) {
                    if (room.memory.config['field' + i].levels.includes(room.controller.level)) {
                        name = 'Field_' + room.name + '_' + i;
                        operator = new Field(name, room, i);
                        this.operationOperators.push(operator);
                    }
                }
            }

            let idx = 0;
            for(var energysource in room.memory.config.energysources) {

                let harvesterName1 = 'Harvester_' + room.name + '_' + 0 + '_' + idx;
                operator = new Harvester(harvesterName1, room, room.memory.config.energysources[idx].id, room);
                this.operationOperators.push(operator);

                if (room.memory.config.energysources[idx].linkpos && room.lookForAt(LOOK_STRUCTURES, room.memory.config.energysources[idx].linkpos.x, room.memory.config.energysources[idx].linkpos.y).length > 0) {
                    // Using link to deliver energy. Don't need haulers anymore for this energy source.
                    //console.log('[' + room.name + '] Haulers not needed: ' + idx);
                } else {
                    if (room.storage != null) {
                        for (let i = 0; i < room.memory.config.energysources[idx].haulers;  i++) {
                            let haulerName = 'Hauler_' + room.name + '_' + i + '_' + idx;

                            operator = new Hauler(haulerName, room, room.memory.config.energysources[idx].id);
                            this.operationOperators.push(operator);
                        }
                    }
                }

                idx++;
            }

        }

    }

    roleCall() {
        // Let's determine if we need any spawns.

        let holding = false;
        for (let operationOperator of this.operationOperators) {
            var creepOperator = Game.creeps[operationOperator.name];


            if (creepOperator) {
                //console.log(`    Clocking in: ` +  operationOperator.name + ' (' + creepOperator.ticksToLive  + ')');
            } else {

                // Spawn him.
                let spawns = operationOperator.room.find(FIND_MY_SPAWNS);

                if (spawns.length == 0) {
                    continue;
                } else {

                    for(let spawn of spawns) {
                        let spawnDirection = LEFT;
                        for (let spawnconfig of operationOperator.room.memory.config.spawns) {
                            if (spawnconfig.x == spawn.pos.x && spawnconfig.y == spawn.pos.y) {
                                spawnDirection = spawnconfig.direction;
                            }
                        }
                        var controllerLevel = 0;
                        if (spawn.room && spawn.room.controller) {
                            controllerLevel = spawn.room.controller.level;
                        }
                        if (controllerLevel <=3) { continue; }
                        if (holding) { continue; }
                        if (!spawn.spawning) {

                            if (operationOperator instanceof Harvester) {
                                let min = 6;
                                if (spawn.room.storage && spawn.room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) < 1000) {
                                    min = 1;
                                }
                                let workParts = Math.min(min, Math.max(6, Math.floor((operationOperator.room.energyCapacityAvailable - 100) / 150)));
                                let operatorParts:BodyPartConstant[] = [];
                                for (let i = 1; i <= workParts;  i++) {
                                    operatorParts.push(WORK);
                                    operatorParts.push(MOVE);
                                }
                                operatorParts.push(CARRY);
                                operatorParts.push(MOVE);
                                let result = spawn.spawnCreep(operatorParts, operationOperator.name, { directions: [spawnDirection]});
                                console.log(`    Spawning: ` +  operationOperator.name + ` Spawn Response: ` + result);
                                if (result == ERR_NOT_ENOUGH_RESOURCES) {
                                    holding = true;
                                }

                            } else if (operationOperator instanceof Upgrader) {
                                let upgraderParts = Math.min(22, Math.floor((operationOperator.room.energyCapacityAvailable - 500) / 150));

                                let operatorParts:BodyPartConstant[] = [];
                                for (let i = 1; i <= upgraderParts; i++) {
                                    operatorParts.push(WORK);
                                    operatorParts.push(MOVE);
                                }
                                operatorParts.push(CARRY);
                                operatorParts.push(MOVE);

                                //if (!operationOperator.room.storage && controllerLevel == 4) {
                                //    // The won't be able to build very big upgraders, so build a lot
                                //    console.log(`    Spawning ` + operationOperator.name + ` Spawn Response: ` + spawn.spawnCreep(operatorParts, operationOperator.name, { directions: [spawnDirection]}));
                                //} else if
                                if
                                    (
                                        (operationOperator.room.storage && operationOperator.name === 'Upgrader_' + operationOperator.room.name + '_0'  && operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 40000  && controllerLevel < 8) ||
                                        (operationOperator.room.storage && operationOperator.name === 'Upgrader_' + operationOperator.room.name + '_1'  && operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 100000 && operatorParts.length > 10 && controllerLevel < 8) ||
                                        (operationOperator.room.storage && operationOperator.name === 'Upgrader_' + operationOperator.room.name + '_2'  && operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 400000 && operatorParts.length > 16 && controllerLevel < 8) ||
                                        (operationOperator.room.storage && operationOperator.name === 'Upgrader_' + operationOperator.room.name + '_3'  && operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 800000 && operatorParts.length > 16 && controllerLevel < 8) ||
                                        (operationOperator.room.storage && operationOperator.name === 'Upgrader_' + operationOperator.room.name + '_0'  && controllerLevel == 8 && operationOperator.room.controller && operationOperator.room.controller.ticksToDowngrade < 65000)
                                    ) {
                                    console.log(`    Spawning ` + operationOperator.name + ` Spawn Response: ` + spawn.spawnCreep(operatorParts, operationOperator.name, { directions: [spawnDirection]}));
                                }

                            } else if (operationOperator instanceof Hauler) {

                                let haulerParts = Math.min(10, Math.max(4, Math.floor(operationOperator.room.energyCapacityAvailable / 100)));
                                let operatorParts:BodyPartConstant[] = [];
                                for (let i = 1; i <= haulerParts; i++) {
                                    operatorParts.push(CARRY);
                                    operatorParts.push(MOVE);
                                }
                                console.log(`    Spawning: ` +  operationOperator.name + ` Spawn Response: ` + spawn.spawnCreep(operatorParts, operationOperator.name, { directions: [spawnDirection]}));
                            }
                        }
                    }
                }


                // New employement
                if (operationOperator instanceof Field && operationOperator.room.memory.config) {
                    if (operationOperator.room.memory.config['field' + operationOperator.memory.fieldindex].spawn &&
                        operationOperator.room.memory.config['field' + operationOperator.memory.fieldindex].levels.includes(operationOperator.room.controller?.level)) {

                        let spawnX = operationOperator.room.memory.config['field' + operationOperator.memory.fieldindex].spawn.x;
                        let spawnY = operationOperator.room.memory.config['field' + operationOperator.memory.fieldindex].spawn.y;

                        let spawn = operationOperator.room.find<StructureSpawn>(FIND_MY_STRUCTURES, {
                            filter: function(object) {
                                return object.structureType === STRUCTURE_SPAWN &&
                                       object.pos.x === spawnX &&
                                       object.pos.y === spawnY;
                            }
                        })[0];
                        if (spawn && operationOperator.room.storage && operationOperator.room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) > 4000) {

                            let workParts = Math.min(6, Math.max(3, Math.floor((operationOperator.room.energyAvailable) / 100)));
                            let operatorParts:BodyPartConstant[] = [];
                            for (let i = 1; i <= workParts;  i++) {
                                operatorParts.push(CARRY);
                                operatorParts.push(MOVE);
                            }

                            console.log(`    Spawning: ` +  operationOperator.name + ` Spawn Response: ` + spawn.spawnCreep(operatorParts, operationOperator.name,
                                { directions: operationOperator.room.memory.config['field' + operationOperator.memory.fieldindex].spawndirection }));

                        } else if (operationOperator.room.controller != null && operationOperator.room.controller.level <= 7 && spawns.length > 0) {

                            let workParts = Math.min(7, Math.max(3, Math.floor((operationOperator.room.energyAvailable) / 100)));
                            let operatorParts:BodyPartConstant[] = [];
                            for (let i = 1; i <= workParts;  i++) {
                                operatorParts.push(CARRY);
                                operatorParts.push(MOVE);
                            }
                            console.log(`    Spawning: ` +  operationOperator.name + ` Spawn Response: ` + spawns[0].spawnCreep(operatorParts, operationOperator.name));
                        }


                    }
                }
            }
        }
    }

    actions() {

        //console.log(`--------  Room Energy Management Actions  ------`);

        for (var roomid in Memory.rooms) {
            let room = Game.rooms[roomid];
            if (!room) {
                continue;
            }
            //console.log('[' + room.name + '] ... ');
            if (room.controller?.owner?.username != 'ricane') {
                continue;
            }
            if (!room.memory.config || room.memory.config.type !== 'owned') {
                continue;
            }

            try {

                //console.log('[' + room.name + '] Energy Network ');
                let storagelinkpos = room.memory.config.storagelink;

                let idx = 0;
                var sourceLinks:StructureLink[] = [];

                for(var energysource in room.memory.config.energysources) {
                    let sourcelinkpos = room.memory.config.energysources[idx].linkpos;
                    if (sourcelinkpos) {
                        sourceLinks = [...sourceLinks, ...(room.find<StructureLink>(FIND_STRUCTURES, {
                            filter: (structure) => {
                                return structure.pos.x === sourcelinkpos.x
                                    && structure.pos.y === sourcelinkpos.y
                                    && structure.structureType == STRUCTURE_LINK;
                            }
                        }))];
                    }
                    idx++;
                }

                if (!storagelinkpos) {
                    continue;
                }
                var storagelinks = room.find<StructureLink>(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return structure.pos.x === storagelinkpos.x
                            && structure.pos.y === storagelinkpos.y
                            && structure.structureType == STRUCTURE_LINK;
                    }
                });


                if (storagelinks.length == 1 && room.storage) {
                    let storagelink = <StructureLink>storagelinks[0];

                    // You have SourceLinks, ControllerLink, StorageLink, and FieldLink
                    //console.log('[' + room.name + '] Starting Command: ' +  room.memory.data.storagelinkcommand);
                    if ( (room.memory.data.storagelinkcommand == undefined || room.memory.data.storagelinkcommand == 'inbound') ) {

                        // Check if any source needs shipping in.
                        for ( let sourceLink of sourceLinks ) {
                            if (sourceLink &&
                                sourceLink.cooldown == 0 &&
                                sourceLink.store.getFreeCapacity(RESOURCE_ENERGY) < 100) {
                                sourceLink.transferEnergy(storagelink, Math.min(storagelink.store.getFreeCapacity(RESOURCE_ENERGY), sourceLink.store.getUsedCapacity(RESOURCE_ENERGY)));
                            }
                        }

                    } else {

                        if (!room.memory.data.storagelinktarget) {
                            //console.log('[' + room.name + '] No Target Structure Id ');
                            room.memory.data.storagelinkcommand == 'inbound';
                            continue;
                        }

                        let targetLink = Game.getObjectById(room.memory.data.storagelinktarget);
                        if (!targetLink) {
                            //console.log('[' + room.name + '] Target Structure MIA ');
                            room.memory.data.storagelinktarget = null;
                            room.memory.data.storagelinkcommand == 'inbound';
                            continue;
                        }


                        let result = storagelink.transferEnergy(targetLink, Math.min(targetLink.store.getFreeCapacity(RESOURCE_ENERGY), storagelink.store.getUsedCapacity(RESOURCE_ENERGY)));
                        //console.log('[' + room.name + '] Send Link Xfer ' + result);

                        room.memory.data.storagelinktarget = null;
                        room.memory.data.storagelinkcommand == 'inbound';
                        continue;


                    }

                }

            } catch(e) {
                console.log((e as Error).stack + ` ` + (e as Error).message);
            }

        }

        //console.log(`--------    ------`);

        //console.log(`--------  Operator Energy Management Actions  ------`);
        for (let operationOperator of this.operationOperators) {
            let cpuStart = Game.cpu.getUsed();
            operationOperator.actions();
            let cpuUsed = Game.cpu.getUsed() - cpuStart;
            if (cpuUsed > 0.50) {
                //console.log(`    ` + operationOperator.name + `: Actions Complete (cpu used: `+ cpuUsed.toFixed(2) + `)`);
            }
        }
    }
}
