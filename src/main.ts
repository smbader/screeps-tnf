import internal from "stream";
import { ErrorMapper } from "utils/ErrorMapper";
import { MapHelper } from "utils/MapHelper";
import { OperationHelper } from "utils/OperationHelper";
import { RoomHelper } from "utils/RoomHelper";
import { TravelToOptions, Traveler, TravelData } from "utils/Traveler";

declare global {
  /*
    Example types, expand on these or remove them and add your own.
    Note: Values, properties defined here do no fully *exist* by this type definiton alone.
          You must also give them an implemention if you would like to use them. (ex. actually setting a `role` property in a Creeps memory)

    Types added in this `global` block are in an ambient, global context. This is needed because `main.ts` is a module file (uses import or export).
    Interfaces matching on name from @types/screeps will be merged. This is how you can extend the 'built-in' interfaces from @types/screeps.
  */
  // Memory extension samples
  interface Memory {
    uuid: number;
    log: any;
  }

  interface CreepMemory {
    role: string;
    room: string;
    working: boolean;
    _travel?: any;
  }

  // Syntax for adding proprties to `global` (ex "global.log")
  namespace NodeJS {
    interface Global {
      log: any;
    }
  }
  interface Room {
    memory: RoomMemory;
  }
  interface Creep {
      travelTo(destination: RoomPosition, options?: TravelToOptions):
          CreepMoveReturnCode | ERR_NO_PATH | ERR_INVALID_TARGET | ERR_NOT_FOUND;
  }

  interface RoomMemory {
      owner: string;
      cacheTime: number;
      sources: {[sourceid: string]: { x:number, y:number, container:{ id:string, x:number, y:number } } };
      avoid: number;
      srcPos: string;
      level: number;
      nextTrade: number;
      nextScan: number;
      nextRadar: number;
      radarData: { x: number, y: number };
      spawnMemory: any;
      starvedTime: number;
      occupied: boolean;
      boostRequests: {[boostType: string]: {flagName: string, requesterIds: string[]} };
      config: any;
      data: {
          storagelinkcommand: string;
          storagelinktarget: Id<StructureLink> | null;
          terminal: {
              energy: number;
          };
      };
  }


}

// When compiling TS to JS and bundling with rollup, the line numbers and file names in error messages change
// This utility uses source maps to get the line numbers and file names of the original, TS source code
export const loop = ErrorMapper.wrapLoop(() => {
    const traveler = new Traveler();
    Creep.prototype.travelTo = function(destination: RoomPosition, options?: TravelToOptions) {
        return traveler.travelTo(this, {pos: destination}, options);
    };

    // Automatically delete memory of missing creeps
    for (const name in Memory.creeps) {
        if (!(name in Game.creeps)) {
            delete Memory.creeps[name];
        }
    }

  // Display current game tick to the console.
  //console.log(`Current game tick is ${Game.time}`);
  //console.log(`vvvvvvvv  Start of tick  vvvvvvvv`);

  MapHelper.loadWorld();

  RoomHelper.loadRoomMemory();

  // Load system level tasks for game
  let operations = OperationHelper.getOperations()

  /////console.log(` `);
  /////console.log(`********  Operation Initialization  ********`);
  for (let operation of operations) {
    // Takes evalution of what operation and tasks are needed.
      try {
          //console.log(operation.name);
          operation.init();
      } catch (error: any) {
        console.log(error);
      }
  }
  /////console.log(`Tick CPU Usage: ${Game.cpu.getUsed()}`);

  /////console.log(` `);
  /////console.log(`********  Operation Rolecall and Spawn  ********`);
  for (let operation of operations) {
      try {
          //console.log(operation.name);
          operation.roleCall();
      } catch (e) {
          console.log(e);
      }
  }
  /////console.log(`Tick CPU Usage: ${Game.cpu.getUsed()}`);

  /////console.log(` `);
  /////console.log(`********  Operation Action  ********`);
    let ct = 1;
  for (let operation of operations) {
      let beforeCpu = Game.cpu.getUsed();
      try {
          operation.actions();
      } catch (e) {
          console.log(e);
      }

      //console.log(`Tick CPU Usage: ${(Game.cpu.getUsed() - beforeCpu).toFixed(2)}`);

      let tickCPULimit = Game.cpu.shardLimits[Game.shard.name];
      if (Game.cpu.bucket < 5000) {
          tickCPULimit = (Game.cpu.shardLimits[Game.shard.name] - 15.5);
          if (ct == 5) {
              console.log('<span style="color:red">' + Game.time + ' 5 Operation Limit - Low Bucket (' + Math.round(Game.cpu.getUsed() * 100)/100 + ') [ ' + ct + ': ' + operation.name + ' ]</span>');
              break;
          }
      } else if (Game.cpu.bucket > 5000 && Game.cpu.bucket < 8000) {
          tickCPULimit = (Game.cpu.shardLimits[Game.shard.name] - 11.5);
      }

      if (Game.cpu.getUsed() > tickCPULimit) {
          console.log('<span style="color:red">' + Game.time + ' Tick halts due to cpu limit (' + Math.round(Game.cpu.getUsed() * 100)/100 + ') [ ' + ct + ': ' + operation.name + ' ]</span>');
          break;
      }
      ct ++;
  }

    /////console.log(` `);
    /*
    for (var roomid in Memory.rooms) {
        let room = Game.rooms[roomid];
        if (!room) { continue; }
        if (room.controller?.owner?.username != 'ricane') {
            continue;
        }
        if (!room.memory.config || room.memory.config.type !== 'owned') {
            continue;
        }
        let storageEnergy = 0;
        if (room.storage) {
            storageEnergy = room.storage.store.getUsedCapacity(RESOURCE_ENERGY);
        }
        //console.log(room.name + ' (' + room.controller.level + ') ' +
        //    'Room Counter: ' + (room.memory.nextTrade - Game.time) + ' ' +
        //    'Storage Energy: ' + storageEnergy + ' ' +
        //    'Terminal Energy: ' + room.memory.data.terminal.energy);
    }*/

    if (Game.cpu.bucket < 9000) {
        console.log('[' + Game.shard.name + '] ' + `Tick CPU Usage: ${Game.cpu.getUsed().toFixed(2)}` + ` CPU Bucket: ` + Game.cpu.bucket);
    }
 //console.log(`^^^^^^^^    End tick     ^^^^^^^^`);
  //console.log(`---------------------------------`);
  //console.log(` `);
});
