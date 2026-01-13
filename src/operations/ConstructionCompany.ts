import { Operation } from "../classes/operation";
import { ConstructionCrew } from "../operator/ConstructionCrew";
import { RoomHelper } from "../utils/RoomHelper";

export class ConstructionCompany extends Operation {
  public operationOperators: ConstructionCrew[];

  public constructor() {
    super();

    this.operationOperators = [];
  }

  public init() {
    // This operation is for what rooms we own and have spawns in.

    // Either the room is in active upgrading or just needs sustained at level 8.
    for (const roomid in Game.rooms) {
      // roomid (E43S27) is the current room being evaluated
      const room = Game.rooms[roomid];

      // What kind of room are we looking at?
      if (room.controller?.owner?.username !== "ricane") {
        continue;
      } else {
        // Nothing Yet.
        // Find available controller parking spaces.
      }
      const cfgRoom = RoomHelper.getRoomConfig(room);
      if (cfgRoom.shard && cfgRoom.shard != Game.shard.name) {
          continue;
      }

      // To be productive, we need a spawn
      const spawns = room.find(FIND_MY_SPAWNS);
      if (spawns.length === 0) {
        // no spawns
      } else {
         for (const spawn of spawns) {
           // Nothing yet.
         }
       }

      const source = spawns[0].pos.findClosestByRange(FIND_SOURCES);
      if (!source) {
        // no source
      } else {

         for (let i = 0; i < 1; i++) {
             // We need a unique name
             const name = "Builder_" + room.name + "_" + i;
             const operator = new ConstructionCrew(name, room, source.id, "");

             this.operationOperators.push(operator);
         }
       }
     }
   }

  public roleCall() {
    // Let's determine if we need any spawns.

    for (const operationOperator of this.operationOperators) {
      const creepOperator = Game.creeps[operationOperator.name];

      if (creepOperator) {
        // console.log(`    Clocking in: ` + operationOperator.name);
      } else {
        // Spawn him.
        const spawns = operationOperator.room.find(FIND_MY_SPAWNS);

          const cfgRoom = RoomHelper.getRoomConfig(operationOperator.room);
          if (!(cfgRoom && cfgRoom.nextTrade && (cfgRoom.nextTrade - 50) < Game.time)) {
              continue;
          }
          if (Game.cpu.bucket < 5000) {
              continue;
          }

        if (spawns.length === 0) {
          continue;
        } else {
          for (const spawn of spawns) {
              let spawnDirection = [TOP, TOP_LEFT, LEFT, BOTTOM_LEFT, BOTTOM, BOTTOM_RIGHT, RIGHT, TOP_RIGHT];
              for (let spawnconfig of (cfgRoom && cfgRoom.spawns || [])) {
                  if (spawnconfig.x == spawn.pos.x && spawnconfig.y == spawn.pos.y) {
                      if (spawnconfig.direction) spawnDirection = [spawnconfig.direction];
                  }
              }

                const constructionSites = spawn.room.find(FIND_CONSTRUCTION_SITES);
                let totalDebt = 0;
                for (const constructionSite of constructionSites) {
                    totalDebt += constructionSite.progressTotal - constructionSite.progress;
                }
                // const numBuilders = Math.floor(totalDebt / 3000); // unused

                  let rampartsToRepair = spawn.room.find(FIND_STRUCTURES, {
                      filter: (structure) => {
                          return (structure.structureType == STRUCTURE_RAMPART && structure.hits < 1000000);
                      }
                  });

                if (constructionSites.length > 0 || rampartsToRepair.length > 0) {
                    let workParts = Math.min(8, Math.max(1, Math.floor((operationOperator.room.energyAvailable - 200) / 200)));
                    const operatorParts: BodyPartConstant[] = [];
                    console.log(`    Spawning: ` + operationOperator.name + ` ` + workParts);
                    for (let i = 1; i <= workParts; i++) {
                        operatorParts.push(WORK);
                        operatorParts.push(CARRY);
                        operatorParts.push(MOVE);
                    }

                    spawn.spawnCreep(operatorParts, operationOperator.name, { directions: spawnDirection});
                }

          }
        }
      }
    }
  }

  public actions() {

    //console.log(`--------  Construction Company Actions  ------`);

      for (const roomid in Game.rooms) {
          const room = Game.rooms[roomid];

          // What kind of room are we looking at?
          if (room.controller?.owner?.username !== "ricane") {
              continue;
          }
          const cfgRoom = RoomHelper.getRoomConfig(room);
          if (!cfgRoom || cfgRoom.type != 'owned') {
              console.log('CONSTRUCTION: Room not owned [' + room.name + ']');
              continue;
          }
          if (cfgRoom.shard && cfgRoom.shard != Game.shard.name) {
              console.log('CONSTRUCTION: Wrong shard [' + room.name + ']');
              continue;
          }
          if (Game.cpu.bucket < 5000) {
              console.log('CONSTRUCTION: Bucket is too low for eval. [' + room.name + ']');
              continue;
          }
          if (!(cfgRoom.nextTrade && ((cfgRoom.nextTrade - Game.time) % 30 == 0))) {
              console.log('CONSTRUCTION: Not time for eval (' + cfgRoom.nextTrade + ') (' + (cfgRoom.nextTrade - Game.time) % 30+ ')  [' + room.name + ']');
              continue;
          }

          // find total number of construction sites.
          let totalConstrctionSites = room.find(FIND_CONSTRUCTION_SITES).length;
          if (totalConstrctionSites >= 2) {
              console.log('CONSTRUCTION: Already 2 construction sites. [' + room.name + ']');
              continue;
          }

          console.log('CONSTRUCTION: Checking for Spawns. [' + room.name + ']');
          if (totalConstrctionSites < 2 && cfgRoom.spawns) {

              let spawns = cfgRoom.spawns;
              for (let i = 0; i < spawns.length; i++) {
                  //look for structure in this location
                  if (totalConstrctionSites < 2 &&
                      room.lookForAt(LOOK_STRUCTURES,  spawns[i].x, spawns[i].y).length == 0 &&
                      room.lookForAt(LOOK_CONSTRUCTION_SITES,  spawns[i].x, spawns[i].y).length == 0) {

                      if (room.createConstructionSite(spawns[i].x, spawns[i].y, STRUCTURE_SPAWN) == OK) {
                          totalConstrctionSites++;
                      }
                  }
              }
          }

          if (room.controller.level >= 4) {
              // Level 3 buildings
              // 20 extensions
              // 1 tower
              // 1 storage
              let towers = cfgRoom.towers;
              let containers = cfgRoom.field0.containers;
              if (cfgRoom.field1) {
                  containers = containers.concat(cfgRoom.field1.containers);
              }
              if (cfgRoom.field2) {
                  containers = containers.concat(cfgRoom.field2.containers);
              }
              if (cfgRoom.field3) {
                  containers = containers.concat(cfgRoom.field3.containers);
              }
              if (cfgRoom.field4) {
                  containers = containers.concat(cfgRoom.field4.containers);
              }

              let storage = cfgRoom.storage;

              console.log('CONSTRUCTION: Checking for Towers. [' + room.name + ']');
              for (let i = 0; i < towers.length; i++) {
                  //look for structure in this location
                  if (totalConstrctionSites < 2 &&
                      room.lookForAt(LOOK_STRUCTURES,  towers[i].x, towers[i].y).length == 0 &&
                      room.lookForAt(LOOK_CONSTRUCTION_SITES,  towers[i].x, towers[i].y).length == 0) {

                      if (room.createConstructionSite(towers[i].x, towers[i].y, STRUCTURE_TOWER) == OK) {
                          totalConstrctionSites++;
                      }
                  }
              }

              console.log('CONSTRUCTION: Checking for Extensions. [' + room.name + ']');
              for (let i = 0; i < containers.length; i++) {
                //look for structure in this location
                 if (totalConstrctionSites < 2 &&
                     room.lookForAt(LOOK_STRUCTURES,  containers[i].x, containers[i].y).length == 0 &&
                     room.lookForAt(LOOK_CONSTRUCTION_SITES,  containers[i].x, containers[i].y).length == 0) {

                     if (room.createConstructionSite(containers[i].x, containers[i].y, STRUCTURE_EXTENSION) == OK) {
                         totalConstrctionSites++;
                     }
                 }
              }

              console.log('CONSTRUCTION: Checking for Storage. [' + room.name + ']');
              if (totalConstrctionSites < 2 &&
                  room.lookForAt(LOOK_STRUCTURES,  storage.x, storage.y).length == 0 &&
                  room.lookForAt(LOOK_CONSTRUCTION_SITES,  storage.x, storage.y).length == 0) {

                  if (room.createConstructionSite(storage.x, storage.y, STRUCTURE_STORAGE) == OK) {
                      totalConstrctionSites++;
                  }
              }
          }

          if (room.controller.level >= 5) {
              // Level 5, you can build 2 links.

              let storagelink = cfgRoom.storagelink;

              console.log('CONSTRUCTION: Checking for Links. [' + room.name + ']');
              if (totalConstrctionSites < 2 &&
                  room.lookForAt(LOOK_STRUCTURES,  storagelink.x, storagelink.y).length == 0 &&
                  room.lookForAt(LOOK_CONSTRUCTION_SITES,  storagelink.x, storagelink.y).length == 0) {

                  room.createConstructionSite(storagelink.x, storagelink.y, STRUCTURE_LINK);
                  totalConstrctionSites++;
              }

              let controllerLink = cfgRoom.controllerLink;
              if (totalConstrctionSites < 2 &&
                  room.lookForAt(LOOK_STRUCTURES,  controllerLink.x, controllerLink.y).length == 0 &&
                  room.lookForAt(LOOK_CONSTRUCTION_SITES,  controllerLink.x, controllerLink.y).length == 0) {

                  room.createConstructionSite(controllerLink.x, controllerLink.y, STRUCTURE_LINK);
                  totalConstrctionSites++;
              }

          }

          if (room.controller.level >= 6 && room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 90000) {
              // road
              console.log('CONSTRUCTION: Checking for Roads. [' + room.name + ']');
              if (cfgRoom.road) {
                  //console.log('ROADS IN CONFIG');
                  let roads = cfgRoom.road;

                   for (let i = 0; i < roads.length; i++) {
                       if (totalConstrctionSites >= 2) {
                           continue;
                       }
                       if (this.attemptConstruction (room, roads[i], STRUCTURE_ROAD)) {
                           totalConstrctionSites++;
                       }
                   }
               }
           }

           if (room.controller.level >= 8 && room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 200000) {

               // containers
               console.log('CONSTRUCTION: Checking for Containers. [' + room.name + ']');
               if (cfgRoom.containers) {
                  let containers = cfgRoom.containers;
                   for (let i = 0; i < containers.length; i++) {
                       if (totalConstrctionSites >= 2) {
                           continue;
                       }
                       if (this.attemptConstruction (room, containers[i], STRUCTURE_CONTAINER)) {
                           totalConstrctionSites++;
                       }
                   }
               }

               let rampartsToRepair = room.find(FIND_STRUCTURES, {
                   filter: (structure) => {
                       return (structure.structureType == STRUCTURE_RAMPART && structure.hits < 1000000);
                   }
               });
               if (rampartsToRepair.length > 0) {
                   continue;
               }

               // rampart
               console.log('CONSTRUCTION: Checking for Ramparts. [' + room.name + ']');
               if (cfgRoom.rampart) {
                  let ramparts = cfgRoom.rampart;
                   for (let i = 0; i < ramparts.length; i++) {
                       if (totalConstrctionSites >= 2) {
                           continue;
                       }
                       if (this.attemptConstruction (room, ramparts[i], STRUCTURE_RAMPART)) {
                           totalConstrctionSites++;
                       }
                   }
               }

               // observer
               console.log('CONSTRUCTION: Checking for Observer. [' + room.name + ']');
               if (cfgRoom.observer) {
                  let observer = cfgRoom.observer;
                   if (totalConstrctionSites >= 2) {
                       continue;
                   }
                   if (this.attemptConstruction (room, observer, STRUCTURE_OBSERVER)) {
                       totalConstrctionSites++;
                   }
               }

               // lab
               //console.log('CHECKING lab CONSTRUCTION');
               if (cfgRoom.lab) {
                  let labs = cfgRoom.lab;
                   //console.log('CHECKING lab CONSTRUCTION ' + labs.length);
                   for (let i = 0; i < labs.length; i++) {
                       if (totalConstrctionSites >= 2) {
                           continue;
                       }
                       if (this.attemptConstruction (room, labs[i], STRUCTURE_LAB)) {
                           totalConstrctionSites++;
                       }
                   }
               }


               // nuker
               if (cfgRoom.nuker) {
                  let nuker = cfgRoom.nuker;
                   if (totalConstrctionSites >= 1) {
                       continue;
                   }
                   if (this.attemptConstruction (room, nuker, STRUCTURE_NUKER)) {
                       totalConstrctionSites++;
                   }

               }


               // powerspawn
               if (cfgRoom.powerSpawn) {
                  let ps = cfgRoom.powerSpawn;
                   if (totalConstrctionSites >= 1) {
                       continue;
                   }
                   if (this.attemptConstruction (room, ps, STRUCTURE_POWER_SPAWN)) {
                       totalConstrctionSites++;
                   }
               }

               // factory
               if (cfgRoom.factory) {
                  let factory = cfgRoom.factory;
                   if (totalConstrctionSites >= 1) {
                       continue;
                   }
                   if (this.attemptConstruction (room, factory, STRUCTURE_FACTORY)) {
                       totalConstrctionSites++;
                   }
               }

           }

      }


    //console.log(`Tick CPU Usage: ${Game.cpu.getUsed()}`);
    //console.log(`--------  Operator Construction Crew Actions  ------`);
    for (const operationOperator of this.operationOperators) {
        let cpuStart = Game.cpu.getUsed();
        operationOperator.actions();
        let cpuUsed = Game.cpu.getUsed() - cpuStart;
        if (cpuUsed > 0.5) {
            console.log(`    ` + operationOperator.name + `: Actions Complete (cpu used: `+ cpuUsed.toFixed(2) + `)`);
        }
    }
  }

  public attemptConstruction( room: Room, position: {x:number, y:number}, structure: BuildableStructureConstant): Boolean {
      //console.log('attemptConstruction' + position.x + ' ' + position.y);
      if (
          room.lookForAt(LOOK_STRUCTURES,  position.x, position.y).length == 0 &&
          room.lookForAt(LOOK_CONSTRUCTION_SITES,  position.x, position.y).length == 0) {

          let result = room.createConstructionSite(position.x, position.y, structure);
          if (result == OK) {
              return true;
          } else {
              //console.log('createconstuction ' + result)
          }
      }

      return false;
  }
}
