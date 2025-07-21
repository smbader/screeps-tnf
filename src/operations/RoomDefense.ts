import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import { RoomHealer } from "../operator/RoomHealer";
import { RoomFighter } from "../operator/RoomFighter";
import { MapHelper } from "../utils/MapHelper";
import { GroundSupport } from "../operator/GroundSupport";

export class RoomDefense extends Operation {
  public operationOperators: Operator[];

  public constructor() {
    super();

    this.operationOperators = [];
  }

  public init() {
    for (const roomid in Game.rooms) {
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

        const towers = room.find<StructureTower>(FIND_MY_STRUCTURES, {
        filter: { structureType: STRUCTURE_TOWER }
        });

        //if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 10000) {
            _.forEach(towers, function (tower) {
                let jobFound = false;

                const closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
                if (closestHostile && !jobFound) {
                    tower.attack(closestHostile);
                    jobFound = true;
                }

                const closestDamagedCreep = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
                    filter: structure => (structure.hits < structure.hitsMax)
                });

                if (!jobFound && closestDamagedCreep) {
                    tower.heal(closestDamagedCreep);
                }

                const closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
                    filter: structure => (structure.hits < structure.hitsMax * 0.5 && structure.structureType !== STRUCTURE_WALL && structure.structureType !== STRUCTURE_RAMPART && structure.structureType !== STRUCTURE_CONTAINER)
                        || (structure.hits < 200000 && (structure.structureType == STRUCTURE_WALL || structure.structureType == STRUCTURE_RAMPART))
                });

                if (closestDamagedStructure && !jobFound) {
                    tower.repair(closestDamagedStructure);
                    jobFound = true;
                }

                if ((!jobFound && room.memory.nextTrade && (room.memory.nextTrade - Game.time) <= 10) || ((room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 930000))) {
                    var damagedStructures = room.find(FIND_STRUCTURES, {
                        filter: (structure) => structure.hits < structure.hitsMax
                        && structure.structureType != STRUCTURE_WALL
                    });
                    let worststructure: AnyStructure | null = null;
                    for (let dskey in damagedStructures) {
                        let damageStructure = damagedStructures[dskey];
                        if (worststructure == null) {
                            worststructure = damageStructure;
                        } else if ((worststructure.hitsMax - worststructure.hits) < (damageStructure.hitsMax - damageStructure.hits)) {
                            worststructure = damageStructure;
                        }
                    }
                    if (worststructure) {
                        tower.repair(worststructure);
                    }
                }
            });
        //}

        if (room.controller?.level >= 4 && towers.length > 0 && room.storage) {
            let name = 'GroundSupport_' + room.name + '_' + 0;
            let operator = new GroundSupport(name, room);
            this.operationOperators.push(operator);
        }

        if (room.controller.level <= 4) {
            let namerf = 'RoomFighter_' + room.name + '_' + 0;
            let operatorrf = new RoomFighter(namerf, room, room.name, []);
            this.operationOperators.push(operatorrf);

            let namerh = 'RoomHealer_' + room.name + '_' + 0;
            let operatorrh = new RoomHealer(namerh, room, namerf, room.name, []);
            this.operationOperators.push(operatorrh);
        }
    }
  }

  public roleCall() {

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
                  for (let spawn of spawns) {
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

                      if (!spawn.spawning) {

                          if (operationOperator.room.find(FIND_HOSTILE_CREEPS).length > 0) {
                              if (operationOperator instanceof RoomHealer) {
                                  spawn.spawnCreep([HEAL, MOVE], operationOperator.name, { directions: [spawnDirection]});
                              }
                              if (operationOperator instanceof RoomFighter) {
                                  spawn.spawnCreep([ATTACK, MOVE], operationOperator.name, { directions: [spawnDirection]});
                              }
                          }


                          if (controllerLevel <= 3) {
                              continue;
                          }
                          if (operationOperator instanceof GroundSupport) {
                              let operatorParts:BodyPartConstant[] = [];
                              let haulerParts = Math.min(16, Math.max(4, Math.floor(operationOperator.room.energyAvailable / 100)));
                              for (let i = 1; i <= haulerParts; i++) {
                                  operatorParts.push(CARRY);
                                  operatorParts.push(MOVE);
                              }
                              console.log(`    Spawning: ` +  operationOperator.name + ` Spawn Response: ` + spawn.spawnCreep(operatorParts, operationOperator.name, { directions: [spawnDirection]}));

                          }


                      }

                  }
              }
          }
      }


      return;
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
