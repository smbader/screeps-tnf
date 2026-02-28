import { Operation } from "../classes/operation";

export class SiloDefense extends Operation {

    private roomsToDefend: any[] = [
        {
            roomName: 'E32N2',
            source: { x: 20, y: 33 },
            harvestSpot: { x: 21, y: 33 },
            loadingSpot: { x: 22, y: 33 },
            towerPositions: [{ x: 23, y: 33 },{ x: 23, y: 32 }],
            spawnPosition: { x: 23, y: 34 },
            spawnDirection: TOP_LEFT,
            rampartPositions: [{ x: 21, y: 33 },{ x: 22, y: 33 },{ x: 23, y: 33 },{ x: 23, y: 32 },{ x: 23, y: 34 }],
        },
        {
            roomName: 'E31N2',
            source: { x: 44, y: 43 },
            harvestSpot: { x: 43, y: 44 },
            loadingSpot: { x: 43, y: 45 },
            towerPositions: [{ x: 42, y: 46 },{ x: 41, y: 46 }],
            spawnPosition: { x: 43, y: 46 },
            spawnDirection: TOP,
            rampartPositions: [{ x: 43, y: 44 },{ x: 43, y: 45 },{ x: 42, y: 46 },{ x: 41, y: 46 },{ x: 43, y: 46 }],
        },
    ];

    public actions() {
        for (const roomInfo of this.roomsToDefend) {
            //console.log(`Defending silo in room ${roomInfo.roomName}`);

            // Verify room is visible
            const room = Game.rooms[roomInfo.roomName];
            if (!room) {
                console.log(`Room ${roomInfo.roomName} not visible.`);
                continue;
            }

            // Verify Tower exists at the specified positions
            const towers:StructureTower[] = room.find(FIND_MY_STRUCTURES, {
                filter: (s) => s.structureType === STRUCTURE_TOWER &&
                    ((s.pos.x === roomInfo.towerPositions[0].x && s.pos.y === roomInfo.towerPositions[0].y) ||
                     (s.pos.x === roomInfo.towerPositions[1].x && s.pos.y === roomInfo.towerPositions[1].y))
            });
            if (towers.length == 0) {
                console.log(`Not all towers found at specified positions in room ${roomInfo.roomName}. Found ${towers.length} towers.`);
                continue;
            }

            // Fire towers at hostiles if present

            const hostiles = room.find(FIND_HOSTILE_CREEPS);
            if (hostiles.length > 0) {
                // Find the closest hostile to the tower and attack it with all towers in range
                // Prefer hostiles with a CLAIM part; otherwise use all hostiles
                const claimers = hostiles.filter(h => h.getActiveBodyparts(CLAIM) > 0);

                // For each tower, target the closest hostile from the prioritized list
                for (const tower of towers) {
                    const candidates = claimers.length > 0 ? claimers : hostiles;
                    const target = tower.pos.findClosestByRange(candidates);
                    if (!target) continue;

                    let range = tower.pos.getRangeTo(target);
                    if (
                        (range < 15) || // If the range is less than 4, always attack
                        (target.hits < (target.hitsMax * 0.75) && range < 20) || // If the target is below 75% health and within 20 range, attack
                        (target.hits < (target.hitsMax * 0.5) && range < 25) || // If the target is below 50% health and within 28 range, attack
                        (target.hits < (target.hitsMax * 0.25)) || // If the target is below 25% health, attack regardless of range
                        (target.getActiveBodyparts(CLAIM) > 0)  // If the target has CLAIM parts, attack regardless of range or health
                    ) {

                        const result = tower.attack(target);
                        if (result === OK) {
                            console.log(`Attacking hostile creep with tower at (${tower.pos.x}, ${tower.pos.y}) in room ${roomInfo.roomName}` + ` at range ${range} with target hits ${target.hits}/${target.hitsMax}`);
                        } else if (result !== ERR_NOT_IN_RANGE) {
                            console.log(`Tower at (${tower.pos.x}, ${tower.pos.y}) failed to attack hostile: ${result} in room ${roomInfo.roomName}`);
                        }
                    }
                }
            }


            // Look for injured friendly creeps and heal them if they are in range of the towers
            const injuredCreeps = room.find(FIND_MY_CREEPS, {
                filter: (c) => c.hits < c.hitsMax
            });
            for (const tower of towers) {
                const target = tower.pos.findClosestByRange(injuredCreeps);
                if (!target) continue;

                let range = tower.pos.getRangeTo(target);
                if (range < 10 || (target.hits > (target.hitsMax * 0.5) && range < 20)) {

                    const result = tower.heal(target);
                    if (result === OK) {
                        console.log(`Healing friendly creep with tower at (${tower.pos.x}, ${tower.pos.y}) in room ${roomInfo.roomName}` + ` at range ${range} with target hits ${target.hits}/${target.hitsMax}`);
                    } else if (result !== ERR_NOT_IN_RANGE) {
                        console.log(`Tower at (${tower.pos.x}, ${tower.pos.y}) failed to heal friendly creep: ${result} in room ${roomInfo.roomName}`);
                    }
                }
            }

            // Verify Spawn exists at the specified position
            const spawn = room.find(FIND_MY_SPAWNS, {
                filter: (s) => s.pos.x === roomInfo.spawnPosition.x && s.pos.y === roomInfo.spawnPosition.y
            })[0];
            if (!spawn) {
                console.log(`No spawn found at position (${roomInfo.spawnPosition.x}, ${roomInfo.spawnPosition.y}) in room ${roomInfo.roomName}.`);
                continue;
            }


            // Verify source Spot exists at the specified position
            const source = room.find(FIND_SOURCES, {
                filter: (s) => s.pos.x === roomInfo.source.x && s.pos.y === roomInfo.source.y
            })[0];
            if (!source) {
                console.log(`No source found at position (${roomInfo.source.x}, ${roomInfo.source.y}) in room ${roomInfo.roomName}.`);
                continue;
            }

            // All things exist, we need to find our creep.  If our creep doesn't exist, we need to spawn it at the spawn position.
            const creepName = `siloDefender_${roomInfo.roomName}`;
            let creep = Game.creeps[creepName];
            if (!creep) {
                console.log(`Spawning new silo defender: ${creepName} in room ${roomInfo.roomName}`);
                const body = [WORK, WORK, CARRY, MOVE];
                let result = spawn.spawnCreep(body, creepName, {
                    memory: {
                        role: "siloDefender",
                        operation: 'SiloDefense_' + roomInfo.roomName,
                        targetRoom: roomInfo.roomName
                    },
                    directions: [roomInfo.spawnDirection]
                });
                if (result == OK) {
                    console.log(`Spawning new silo defender: ${creepName} in room ${roomInfo.roomName}`);
                } else {
                    console.log(`Failed to spawn silo defender: ${result} in room ${roomInfo.roomName}`);
                }

            } else {
                // Creep exists, we need to move it to the source and harvest
                let isOnHarvestSpot = creep.pos.x === roomInfo.harvestSpot.x && creep.pos.y === roomInfo.harvestSpot.y;
                let isOnLoadingSpot = creep.pos.x === roomInfo.loadingSpot.x && creep.pos.y === roomInfo.loadingSpot.y;

                // If the creep has no energy move to the harvest spot. If already at the harvest spot, harvest from the source.
                if (creep.store.getUsedCapacity() == 0 && !isOnHarvestSpot) {
                    creep.moveTo(roomInfo.harvestSpot.x, roomInfo.harvestSpot.y);
                    console.log(`Moving silo defender ${creepName} to harvest spot in room ${roomInfo.roomName}`);
                } else if (creep.store.getUsedCapacity() < creep.store.getCapacity() && isOnHarvestSpot) {
                    creep.harvest(source);
                    console.log(`Harvesting energy with silo defender ${creepName} in room ${roomInfo.roomName}`);
                } else if (creep.store.getFreeCapacity() == 0 && !isOnLoadingSpot) {
                    creep.moveTo(roomInfo.loadingSpot.x, roomInfo.loadingSpot.y);
                    console.log(`Moving silo defender ${creepName} to loading spot in room ${roomInfo.roomName}`);
                } else if (creep.store.getUsedCapacity() > 0 && isOnLoadingSpot) {

                    // Loop trough towers array and save the tower that needs the most energy.
                    let towerToFill = null;
                    let greatestCapacity = 0;
                        if (towers.length > 0) {
                        for (const tower of towers) {
                            let towerCapacity = tower.store?.getFreeCapacity(RESOURCE_ENERGY) || 0;
                            if (towerCapacity > greatestCapacity) {
                                greatestCapacity = towerCapacity;
                                towerToFill = tower;
                            }
                        }
                    }

                    // Transfer energy to spawn if it's needed
                    if (spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                        creep.transfer(spawn, RESOURCE_ENERGY);
                        console.log(`Transferring energy to spawn with silo defender ${creepName} in room ${roomInfo.roomName}`);
                    } else if (towerToFill) {
                        creep.transfer(towerToFill, RESOURCE_ENERGY);
                        console.log(`Transferring energy to tower with silo defender ${creepName} in room ${roomInfo.roomName}`);
                    } else {
                        // Find all positions listed and verify a rampart is present. If not, construct a rampart. If all positions have ramparts, build the one with the least hits.
                        let rampartToRepair = null;
                        let lowestHits = Number.MAX_VALUE;

                        for (const pos of roomInfo.rampartPositions) {

                            const structuresAtPos = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
                            const rampart = structuresAtPos.find(s => s.structureType === STRUCTURE_RAMPART) as StructureRampart;
                            if (!rampart) {

                                // Look for a construction site at the position and if there isn't one, create a construction site for a rampart
                                const constructionSitesAtPos = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
                                const rampartSite = constructionSitesAtPos.find(s => s.structureType === STRUCTURE_RAMPART);
                                if (!rampartSite) {
                                    room.createConstructionSite(pos.x, pos.y, STRUCTURE_RAMPART);
                                    console.log(`Creating rampart construction site at (${pos.x}, ${pos.y}) with silo defender ${creepName} in room ${roomInfo.roomName}`);
                                } else {
                                    creep.build(rampartSite);
                                    console.log(`Building rampart construction site at (${pos.x}, ${pos.y}) with silo defender ${creepName} in room ${roomInfo.roomName}`);
                                }
                                continue;
                            }
                        }

                        for (const pos of roomInfo.rampartPositions) {
                            // Look for a rampart at the position
                            const structuresAtPos = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
                            const rampart = structuresAtPos.find(s => s.structureType === STRUCTURE_RAMPART) as StructureRampart;
                            if (rampart && rampart.hits < lowestHits) {
                                lowestHits = rampart.hits;
                                rampartToRepair = rampart;
                            }
                        }

                        if (rampartToRepair) {
                            creep.repair(rampartToRepair);
                            console.log(`Repairing rampart at (${rampartToRepair.pos.x}, ${rampartToRepair.pos.y}) with silo defender ${creepName} in room ${roomInfo.roomName}`);
                            continue;
                        }

                    }

                } else {
                    // Creep is in an unexpected state, move it back to the spawn position to reset
                    console.log(`Silo defender ${creepName} in unexpected state`);
                }
            }
        }
    }
}
