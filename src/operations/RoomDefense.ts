import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import {Field} from "../operator/Field";
import { RoomHealer } from "../operator/RoomHealer";
import { RoomFighter } from "../operator/RoomFighter";
import { MapHelper } from "../utils/MapHelper";
//import { GroundSupportOld } from "../operator/GroundSupport-old";
import { GroundSupport } from "../operator/GroundSupport";
import { RoomHelper } from "../utils/RoomHelper";

export class RoomDefense extends Operation {
  public operationOperators: Operator[];

  public constructor() {
    super();

    this.operationOperators = [];
  }

  public init() {
      // Cache the shard name for quick comparisons
      const shardName = Game.shard.name;

      // Iterate over owned rooms only
      for (const roomid in Game.rooms) {
          const room = Game.rooms[roomid];

          // Fast, early skips for non-relevant rooms
          if (
              !room ||
              room.controller?.owner?.username !== "ricane"
          ) {
              continue;
          }

          const cfg = RoomHelper.getRoomConfig(room);

          if (!cfg || cfg.type !== "owned" || (cfg.shard && cfg.shard !== shardName)) {
              continue;
          }

          // Cache all towers for this room at once
          const towers = room.find<StructureTower>(FIND_MY_STRUCTURES, {
              filter: { structureType: STRUCTURE_TOWER },
          });

          // Process tower actions in a single loop, minimize nested logic
          if (towers.length) {

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
                      if (range < 20 || (target.hits < (target.hitsMax * 0.75) && range < 30) || (target.hits < (target.hitsMax * 0.5) && range < 40) || target.getActiveBodyparts(CLAIM) > 0) {

                          const result = tower.attack(target);
                          if (result === OK) {
                              console.log(`Attacking hostile creep with tower at (${tower.pos.x}, ${tower.pos.y}) in room ${room.name}` + ` at range ${range} with target hits ${target.hits}/${target.hitsMax}`);
                          } else if (result !== ERR_NOT_IN_RANGE) {
                              console.log(`Tower at (${tower.pos.x}, ${tower.pos.y}) failed to attack hostile: ${result} in room ${room.name}`);
                          }
                      }
                  }
              }

              // Find all damaged creeps and structures once
              const damagedCreeps = room.find(FIND_MY_CREEPS, {
                  filter: (creep) => creep.hits < creep.hitsMax,
              });
              const damagedStructures = room.find(FIND_STRUCTURES, {
                  filter: (structure) =>
                      structure.hits < structure.hitsMax &&
                      structure.structureType !== STRUCTURE_WALL,
              });

              // Find worst structure for emergency repair once

              let worststructure: AnyStructure | null = null;
              if (
                  (room.terminal && room.memory.nextTrade &&
                      room.memory.nextTrade - Game.time <= 10)
                  //||
                  //(room.storage &&
                  //    room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 930000)
              ) {
                  for (const damageStructure of damagedStructures) {
                      if (
                          !worststructure ||
                          worststructure.hitsMax - worststructure.hits <
                          damageStructure.hitsMax - damageStructure.hits
                      ) {
                          worststructure = damageStructure;
                      }
                  }
              }

              for (const tower of towers) {
                  let jobFound = false;
/*
                  const closestDamagedCreep = tower.pos.findClosestByRange(damagedCreeps);
                  if (closestDamagedCreep && !jobFound) {
                      tower.heal(closestDamagedCreep);
                      jobFound = true;
                      continue;
                  }
 */
                  // Find heavily damaged non-wall/rampart structures
                  const criticalDamagedStructure = tower.pos.findClosestByRange(
                      room.find(FIND_STRUCTURES, {
                          filter: (structure) =>
                              (structure.hits < structure.hitsMax * 0.5 &&
                                  structure.structureType !== STRUCTURE_WALL &&
                                  structure.structureType !== STRUCTURE_RAMPART) ||
                              (structure.hits < 200000 &&
                                  //(//structure.structureType === STRUCTURE_WALL ||
                                      structure.structureType === STRUCTURE_RAMPART)
                      //),
                      })
                  );

                  if (criticalDamagedStructure && !jobFound) {
                      tower.repair(criticalDamagedStructure);
                      jobFound = true;
                      continue;
                  }
                  // Emergency repair logic, only if needed
                  if (worststructure && !jobFound) {
                      tower.repair(worststructure);
                  }


              }
          }

          // Operators: only create if room meets conditions
          if (room.controller?.level >= 4 && towers.length > 0 && room.storage) {
              this.operationOperators.push(
                  new GroundSupport(`GroundSupport_${room.name}_0`, room)
              );
          }

          if (room.controller.level <= 4) {
              const namerf = `RoomFighter_${room.name}_0`;
              this.operationOperators.push(
                  new RoomFighter(namerf, room, room.name, [])
              );

              const namerh = `RoomHealer_${room.name}_0`;
              this.operationOperators.push(
                  new RoomHealer(namerh, room, namerf, room.name, [])
              );
          }
      }
  }

  public roleCall() {

      for (let operationOperator of this.operationOperators) {
          var creepOperator = Game.creeps[operationOperator.name];


          if (creepOperator) {
              //console.log(`    Clocking in: ` +  operationOperator.name + ' (' + creepOperator.ticksToLive  + ')');
          } else {

              var controllerLevel = 0;
              if (operationOperator.room && operationOperator.room.controller) {
                  controllerLevel = operationOperator.room.controller.level;
              }

              let gsRequested = false;
              // New employement
              if (operationOperator instanceof GroundSupport && operationOperator.room) {
                  const cfg = RoomHelper.getRoomConfig(operationOperator.room);
                  if (cfg && cfg.chemist && cfg.chemist.spawn) {
                      if (controllerLevel > 3) {

                          let spawnX = cfg.chemist.spawn.x;
                          let spawnY = cfg.chemist.spawn.y;

                          let spawn = operationOperator.room.find<StructureSpawn>(FIND_MY_STRUCTURES, {
                              filter: function(object) {
                                  return object.structureType === STRUCTURE_SPAWN &&
                                      object.pos.x === spawnX &&
                                      object.pos.y === spawnY;
                              }
                          })[0];

                          let operatorParts:BodyPartConstant[] = [];
                          let haulerParts = Math.min(16, Math.max(4, Math.floor(operationOperator.room.energyAvailable / 100)));
                          for (let i = 1; i <= haulerParts; i++) {
                              operatorParts.push(CARRY);
                              operatorParts.push(MOVE);
                          }
                          console.log(`    Spawning: ` +  operationOperator.name + ` Spawn Response: ` + spawn.spawnCreep(operatorParts, operationOperator.name, { directions: cfg.chemist.spawndirection }));

                          gsRequested = true;
                      }
                  }
              }


              // Spawn him.
              let spawns = operationOperator.room.find(FIND_MY_SPAWNS);

              if (spawns.length == 0) {
                  continue;
              } else {
                  for (let spawn of spawns) {
                      let spawnDirection = [TOP, TOP_LEFT, LEFT, BOTTOM_LEFT, BOTTOM, BOTTOM_RIGHT, RIGHT, TOP_RIGHT];
                      const cfgOp = RoomHelper.getRoomConfig(operationOperator.room);
                      for (let spawnconfig of (cfgOp && cfgOp.spawns || [])) {
                          if (spawnconfig.x == spawn.pos.x && spawnconfig.y == spawn.pos.y) {
                              if (spawnconfig.direction) spawnDirection = [spawnconfig.direction];
                          }
                      }


                      if (!spawn.spawning) {

                          if (operationOperator.room.find(FIND_HOSTILE_CREEPS).length > 0) {
                              if (operationOperator instanceof RoomHealer) {
                                  spawn.spawnCreep([HEAL, MOVE], operationOperator.name, { directions: spawnDirection});
                              }
                              if (operationOperator instanceof RoomFighter) {
                                  spawn.spawnCreep([ATTACK, MOVE], operationOperator.name, { directions: spawnDirection});
                              }
                          }


                          if (controllerLevel <= 3 && gsRequested) {
                              continue;
                          }
                          if (operationOperator instanceof GroundSupport) {
                              let operatorParts:BodyPartConstant[] = [];
                              let haulerParts = Math.min(16, Math.max(4, Math.floor(operationOperator.room.energyAvailable / 100)));
                              for (let i = 1; i <= haulerParts; i++) {
                                  operatorParts.push(CARRY);
                                  operatorParts.push(MOVE);
                              }
                              console.log(`    Spawning: ` +  operationOperator.name + ` Spawn Response: ` + spawn.spawnCreep(operatorParts, operationOperator.name, { directions: spawnDirection}));

                          }
                      }

                  }
              }
          }
      }
  }


  public actions() {
      //console.log(`--------  Operator Defense Actions  ------`);
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
