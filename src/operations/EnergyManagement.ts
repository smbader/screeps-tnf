import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import { Field } from "../operator/Field";
import { Hauler } from "../operator/Hauler";
import { Harvester } from "../operator/Harvester";
import { Upgrader } from "../operator/Upgrader";
import { getFieldConfig } from "../roomconfigs/RoomConfig";
import { ENERGY_STORAGE_RESERVE } from "../utils/ResourceManagement";
import { RoomHelper } from "../utils/RoomHelper";

// Minimum free energy a recipient link must have to accept transfers from storage link
const LINK_MIN_FREE_TO_ACCEPT = 100;

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
            const cfg = RoomHelper.getRoomConfig(room);
            if (!cfg || cfg.type !== 'owned') {
                continue;
            }
            if (cfg.shard && cfg.shard != Game.shard.name) {
                continue;
            }
            let operator:Operator;
            // New employment plan begin

            let name = '';

            for (let i = 0; i < 4; i++) {
                name = 'Upgrader_' + room.name + '_' + i;
                operator = new Upgrader(name, room);
                this.operationOperators.push(operator);
            }

            for (let i = 0; i < 6;  i++) {
                const fieldConfig = getFieldConfig(cfg, i);
                if (fieldConfig && fieldConfig.levels?.includes(room.controller.level)) {
                    name = 'Field_' + room.name + '_' + i;
                    operator = new Field(name, room, i);
                    this.operationOperators.push(operator);
                }
            }

            for (const [idx, energySource] of cfg.energysources.entries()) {
                let harvesterName1 = 'Harvester_' + room.name + '_' + 0 + '_' + idx;
                operator = new Harvester(harvesterName1, room, energySource.id as Id<Source>, room);
                this.operationOperators.push(operator);

                if (energySource.linkpos && room.lookForAt(LOOK_STRUCTURES, energySource.linkpos.x, energySource.linkpos.y).length > 0) {
                    // Using link to deliver energy. Don't need haulers anymore for this energy source.
                    //console.log('[' + room.name + '] Haulers not needed: ' + idx);
                } else {
                    if (room.storage != null) {
                        for (let i = 0; i < (energySource.haulers || 0);  i++) {
                            let haulerName = 'Hauler_' + room.name + '_' + i + '_' + idx;

                            operator = new Hauler(haulerName, room, energySource.id, false);
                            this.operationOperators.push(operator);
                        }

                    }
                }
            }

            if (room.controller.level == 4 && room.storage && room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 50000) {
                let haulerName = 'Hauler_' + room.name + '_controller';
                operator = new Hauler(haulerName, room, room.storage.id, false, true);
                this.operationOperators.push(operator);
            }

            if (room.controller.level < 5 && room.storage && cfg.energysources.length > 0) {
                let haulerName = 'Hauler_' + room.name + '_storage';
                operator = new Hauler(haulerName, room, cfg.energysources[0].id, true);
                this.operationOperators.push(operator);
            }


        }

    }

    roleCall() {
        // Let's determine if we need any spawns.

        let holding: { [key: string]: boolean } = {};

        for (let operationOperator of this.operationOperators) {
            if (holding[operationOperator.room.name] == undefined) {
                holding[operationOperator.room.name] = false;
            }

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
                    for(let spawn of spawns) {
                        let spawnDirection = [TOP, TOP_LEFT, LEFT, BOTTOM_LEFT, BOTTOM, BOTTOM_RIGHT, RIGHT, TOP_RIGHT];
                        for (let spawnconfig of (cfg && cfg.spawns || [])) {
                            if (spawnconfig.x == spawn.pos.x && spawnconfig.y == spawn.pos.y) {
                                if (spawnconfig.direction) spawnDirection = [spawnconfig.direction];
                            }
                        }
                        var controllerLevel = 0;
                        if (spawn.room && spawn.room.controller) {
                            controllerLevel = spawn.room.controller.level;
                        }
                        if (controllerLevel <=3) { continue; }
                        if (controllerLevel > 8 && spawn.room.storage && spawn.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > ENERGY_STORAGE_RESERVE) { continue; }
                        if (holding[operationOperator.room.name]) { continue; }
                        if (!spawn.spawning) {
                            if (operationOperator instanceof Harvester) {

                                let workParts = Math.max(1, Math.min(6, Math.floor((operationOperator.room.energyCapacityAvailable - 100) / 150)));
                                let operatorParts:BodyPartConstant[] = [];
                                for (let i = 1; i <= workParts;  i++) {
                                    operatorParts.push(WORK);
                                    operatorParts.push(MOVE);
                                }
                                operatorParts.push(CARRY);
                                operatorParts.push(MOVE);
                                let result = spawn.spawnCreep(operatorParts, operationOperator.name, { directions: spawnDirection});
                                console.log(`    Spawning: ` +  operationOperator.name + ` Spawn Response: ` + result);
                                if (result == ERR_NOT_ENOUGH_RESOURCES) {
                                    console.log(`    HOLDING: ` +  operationOperator.name + ` Waiting on resources`);
                                    holding[operationOperator.room.name] = true;
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

                                if
                                    (
                                        (operationOperator.room.storage && operationOperator.name === 'Upgrader_' + operationOperator.room.name + '_0'  && operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 40000  && controllerLevel < 8) ||
                                        (operationOperator.room.storage && operationOperator.name === 'Upgrader_' + operationOperator.room.name + '_1'  && operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 100000 && operatorParts.length > 10 && controllerLevel < 8) ||
                                        (operationOperator.room.storage && operationOperator.name === 'Upgrader_' + operationOperator.room.name + '_2'  && operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 400000 && operatorParts.length > 16 && controllerLevel < 8) ||
                                        (operationOperator.room.storage && operationOperator.name === 'Upgrader_' + operationOperator.room.name + '_3'  && operationOperator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 800000 && operatorParts.length > 16 && controllerLevel < 8) ||
                                        (operationOperator.room.storage && operationOperator.name === 'Upgrader_' + operationOperator.room.name + '_0'  && controllerLevel == 8 && operationOperator.room.controller && operationOperator.room.controller.ticksToDowngrade < 65000)
                                    ) {
                                    console.log(`    Spawning ` + operationOperator.name + ` Spawn Response: ` + spawn.spawnCreep(operatorParts, operationOperator.name, { directions: spawnDirection}));
                                }

                            } else if (operationOperator instanceof Hauler) {

                                let haulerParts = Math.min(10, Math.max(4, Math.floor(operationOperator.room.energyCapacityAvailable / 100)));
                                let operatorParts:BodyPartConstant[] = [];
                                for (let i = 1; i <= haulerParts; i++) {
                                    operatorParts.push(CARRY);
                                    operatorParts.push(MOVE);
                                }
                                console.log(`    Spawning: ` +  operationOperator.name + ` Spawn Response: ` + spawn.spawnCreep(operatorParts, operationOperator.name, { directions: spawnDirection}));
                            }
                        }
                    }
                }


                // New employement
                if (operationOperator instanceof Field) {

                    const cfgField = RoomHelper.getRoomConfig(operationOperator.room);
                    const fieldCfg = getFieldConfig(cfgField, operationOperator.memory.fieldindex ?? -1);

                    if (fieldCfg && fieldCfg.levels && operationOperator.room.controller && fieldCfg.levels.includes(operationOperator.room.controller.level)) {

                        let spawn = operationOperator.room.find<StructureSpawn>(FIND_MY_STRUCTURES, {
                            filter: function(object) {
                                return object.structureType === STRUCTURE_SPAWN &&
                                       object.spawning == null
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
                                { directions: fieldCfg.spawndirection }));

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
            const cfg = RoomHelper.getRoomConfig(room);
            if (!cfg || cfg.type !== 'owned') {
                continue;
            }

            try {

                //console.log('[' + room.name + '] Energy Network ');
                const storagelinkpos = cfg.storagelink;

                var sourceLinks:StructureLink[] = [];

                for (const energysource of cfg.energysources) {
                    const sourcelinkpos = energysource.linkpos;
                    if (sourcelinkpos) {
                        sourceLinks = [...sourceLinks, ...(room.find<StructureLink>(FIND_STRUCTURES, {
                            filter: (structure) => {
                                return structure.pos.x === sourcelinkpos.x
                                    && structure.pos.y === sourcelinkpos.y
                                    && structure.structureType == STRUCTURE_LINK;
                            }
                        }))];
                    }
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

                        // Ensure targetLink is a StructureLink
                        const tlink = targetLink as StructureLink;
                        const targetFree = (tlink.store && tlink.store.getFreeCapacity) ? tlink.store.getFreeCapacity(RESOURCE_ENERGY) : 0;
                        if (targetFree > LINK_MIN_FREE_TO_ACCEPT) {
                            storagelink.transferEnergy(tlink, Math.min(targetFree, storagelink.store.getUsedCapacity(RESOURCE_ENERGY)));
                        } else {
                            // Skip tiny micro-transfers to nearly-full targets; reset command to inbound so other logic can pick a better destination
                            console.log(`[EnergyManagement:${room.name}] skipping storagelink -> target ${tlink.id} because free=${targetFree} <= ${LINK_MIN_FREE_TO_ACCEPT}`);
                            room.memory.data.storagelinktarget = null;
                            room.memory.data.storagelinkcommand = 'inbound';
                        }
                        //console.log('[' + room.name + '] Send Link Xfer called');

                        room.memory.data.storagelinktarget = null;
                        room.memory.data.storagelinkcommand == 'inbound';
                        // done for this room

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
            if (cpuUsed > 0.20) {
                //console.log(`    ` + operationOperator.name + `: Actions Complete (cpu used: `+ cpuUsed.toFixed(2) + `)`);
            }
        }
    }
}
