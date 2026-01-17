import { ErrorMapper } from "utils/ErrorMapper";
import { MapHelper } from "utils/MapHelper";
import { OperationHelper } from "utils/OperationHelper";
import { RoomHelper } from "utils/RoomHelper";
import { TravelToOptions, Traveler } from "utils/Traveler";

declare global {
    interface Memory {
        uuid: number;
        log: any;
        marketPriceHistory: any;
        squadSiege?: any;
    }

    interface CreepMemory {
        role: string;
        room?: string;
        working?: boolean;
        squadId?: string;
        waypoint?: number;
        operation?: string;
        _travel?: any;
        boosted?: boolean;
        boostedParts?: BodyPartConstant[];
        targetContainer?: Id<FieldStructure> | null;
        sourceContainer?: Id<FieldStructure> | null;
        linkSendTo?: Id<StructureLink> | null;
        resourceType?: GSResourceTypes | null;
        phase?: string | null;
        targetRoom?: string | null;
        targetFighter?: string;
    }

    interface Room {
        memory: RoomMemory;
    }

    interface Creep {
        travelTo(destination: RoomPosition, options?: TravelToOptions): CreepMoveReturnCode | ERR_NO_PATH | ERR_INVALID_TARGET | ERR_NOT_FOUND;
    }

    interface RoomMemory {
        owner: string;
        cacheTime: number;
        sources: { [sourceid: string]: { x: number, y: number, container: { id: string, x: number, y: number } } };
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
        boostRequests: { [boostType: string]: { flagName: string, requesterIds: string[] } };
        config: any;
        _cachedLinks?: {
            storage?: Id<StructureLink>;
            controller?: Id<StructureLink>;
            field?: Id<StructureLink>[];
        };
        _gs_linkDebugInfo?: string[];
        _gs_links?: {
            storage?: Id<StructureLink>;
            controller?: Id<StructureLink>;
            sources: Id<StructureLink>[];
            fields: Id<StructureLink>[];
        };
        _gs_linkPct?: any;
        _gs_energyState?: string;
        powerHarvest?:{
            _observedRoom?: string;
            banks: PowerBankMemory[];
            lastScan?: number;
            scannedRooms?: { [roomName: string]: number };
        };
        _observedRoom?: string;
        data: {
            storagelinkcommand: string;
            storagelinktarget: Id<StructureLink> | null;
            terminal: { energy: number };
            labs: {
                reagents: { id: Id<StructureLab>, component: ResourceConstant }[];
                products: { id: Id<StructureLab> }[];
                boosts: { id: Id<StructureLab>, component: ResourceConstant }[];
            };
        };
    }

    interface PowerBankMemory {
        room: string;
        pos: RoomPosition;
        ticksToDecay: number;
        power: number;
        lastChecked: number;
        state: "waiting" | "breaking" | "hauling" | "done";
        homeRoom?: string;
        fighterNames?: string[];
        healerNames?: string[];
        haulerNames?: string[];
        claimedBy?: string;
    }

    interface PowerHarvestMemory {
        banks: PowerBankMemory[];
        lastScan: number;
        scannedRooms?: { [roomName: string]: number }; // roomName -> last scan time
        _observedRoom?: string;
    }

    interface TravelToOptions {
        reusePath?: number;
        maxRooms?: number;

        [key: string]: any;
    }

    type FieldStructure =
        StructureSpawn
        | StructureExtension
        | StructureStorage
        | StructureContainer
        | StructureLink
        | StructureTerminal
        | StructureTower
        | StructureLab
        | StructureNuker
        | StructureFactory
        | StructurePowerSpawn;
    type GSResourceTypes =
        ResourceConstant
        | "mist"
        | "biomass"
        | "metal"
        | "silicon"
        | "utrium_bar"
        | "lemergium_bar"
        | "zynthium_bar"
        | "keanium_bar"
        | "ghodium_melt"
        | "oxidant"
        | "reductant"
        | "purifier"
        | "battery"
        | "composite"
        | "crystal"
        | "liquid"
        | "wire"
        | "switch"
        | "transistor"
        | "microchip"
        | "circuit"
        | "device"
        | "cell"
        | "phlegm"
        | "tissue"
        | "muscle"
        | "organoid"
        | "organism"
        | "alloy"
        | "tube"
        | "fixtures"
        | "frame"
        | "hydraulics"
        | "machine"
        | "condensate"
        | "concentrate"
        | "extract"
        | "spirit"
        | "emanation"
        | "essence";
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

    if (Game.cpu.bucket < 3000) {
        console.log(`<span style="color:red">CPU Bucket Low: ${Game.cpu.bucket}</span>`);
        return;
    }

  // Load system level tasks for game
  let operations = OperationHelper.getOperations()

  /////console.log(` `);
  /////console.log(`********  Operation Initialization  ********`);
  for (let operation of operations) {
    // Takes evalution of what operation and tasks are needed.
      try {
          ////console.log('INIT: ' + operation.name);
          operation.init();
          if (Game.shard.name == 'shard3') {
              //console.log(`INIT ${operation.name} : ${(Game.cpu.getUsed() - beforeCpu).toFixed(2)}`);
          }
      } catch (error: any) {
        console.log(error);
      }
  }
  /////console.log(`Tick CPU Usage: ${Game.cpu.getUsed()}`);

  /////console.log(` `);
  /////console.log(`********  Operation Rolecall and Spawn  ********`);
  for (let operation of operations) {
      try {
          ////console.log('ROLECALL: ' + operation.name);
          operation.roleCall();
          if (Game.shard.name == 'shard3') {
              //console.log(`ROLECALL ${operation.name} : ${(Game.cpu.getUsed() - beforeCpu).toFixed(2)}`);
          }
      } catch (e) {
          console.log(e);
      }
  }
  /////console.log(`Tick CPU Usage: ${Game.cpu.getUsed()}`);

  /////console.log(` `);
  /////console.log(`********  Operation Action  ********`);
    let ct = 1;
  for (let operation of operations) {
      try {
          ////console.log('ACTION: ' + operation.name);
          operation.actions();
      } catch (e) {
          console.log(e);
      }
      if (Game.shard.name == 'shard3') {
         // console.log(`ACTIONS ${operation.name} : ${(Game.cpu.getUsed() - beforeCpu).toFixed(2)}`);
      }
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
        if ((room.memory.nextTrade) + 10 < Game.time ) {
            room.memory.nextTrade = Game.time + (Math.floor(Math.random() * (300 - 250 + 1)) + 250);
        }
        let storageEnergy = 0;
        if (room.storage) {
            storageEnergy = room.storage.store.getUsedCapacity(RESOURCE_ENERGY);
        }
        //console.log(room.name + ' (' + room.controller.level + ') ' +
        //    'Room Counter: ' + (room.memory.nextTrade - Game.time) + ' ' +
        //    'Storage Energy: ' + storageEnergy + ' ' +
        //    'Terminal Energy: ' + room.memory.data.terminal.energy);
    }

    if (Game.cpu.bucket < 9000) {
        console.log('[' + Game.shard.name + '] ' + `Tick CPU Usage: ${Game.cpu.getUsed().toFixed(2)}` + ` CPU Bucket: ` + Game.cpu.bucket);
    }
 //console.log(`^^^^^^^^    End tick     ^^^^^^^^`);
  //console.log(`---------------------------------`);
  //console.log(` `);
});
