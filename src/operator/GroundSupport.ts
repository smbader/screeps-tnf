import { Operator } from "../classes/operator";
import type { LabProductionState } from "../roomconfigs/RoomConfig";
import {
  getAffordableLabPurchaseAmount,
  getLoadedLabReaction,
  LAB_COMPOUND_TARGET,
  LAB_PRODUCTION_ENERGY_FLOOR,
  LAB_REACTION_ENERGY_AMOUNT,
  LAB_REACTION_MINERAL_AMOUNT,
  LabPosition,
  selectLabInputPair,
  selectLabReactionPlan
} from "./GroundSupportLabProduction";
import { RoomHelper } from "../utils/RoomHelper";

const DEPOSIT_MARKET_RESOURCES: DepositConstant[] = ["mist", "biomass", "metal", "silicon"];
const BOOST_LAB_STORAGE_ENERGY_FLOOR = 30000;
const LAB_INPUT_BUFFER = 1000;
const LAB_PRODUCT_ENERGY_BUFFER = 1000;
const LAB_MARKET_PURCHASE_INTERVAL = 100;
const LAB_MARKET_MAX_PURCHASE = 1000;

interface GroundSupportTaskData {
  labId?: Id<StructureLab>;
  resource?: ResourceConstant;
}

interface GroundSupportLabNeed {
  lab: StructureLab;
  resource: ResourceConstant;
  amount: number;
  clear?: boolean;
}

interface LabStock {
  available: Partial<Record<ResourceConstant, number>>;
  product: Partial<Record<ResourceConstant, number>>;
}

export class GroundSupportCreep extends Creep {
  memory!: CreepMemory & {
    task?: string | null;
    taskData?: GroundSupportTaskData | null;
  };

  constructor(creepid: Id<Creep>) {
    super(creepid);
  }
}

export class GroundSupport extends Operator {
  creep: GroundSupportCreep | null;
  roomValues: any;

  constructor(name: string, room: Room) {
    super(name, room);

    this.creep = Game.creeps[name] ? new GroundSupportCreep(Game.creeps[name].id) : null;
    this.room = room;
  }

  actions(): void {
    this.runLabProduction();

    if (!this.creep || !this.room.storage) {
      // display debug information
      return;
    }

    // Update room values
    this.roomValues = RoomHelper.getRoomValues(this.room);
    const boostRequested = (this.room.memory.data?.labs?.boosts || []).length > 0;
    if (boostRequested && this.creep.memory.task !== "FILL_BOOST_LABS") {
      this.creep.memory.task = "FILL_BOOST_LABS";
      this.creep.memory.taskData = null;
    } else if (
      !boostRequested &&
      this.creep.memory.task !== "SUPPLY_LAB_PRODUCTION" &&
      this.getProductionLabNeed()?.resource === RESOURCE_ENERGY
    ) {
      this.creep.memory.task = "SUPPLY_LAB_PRODUCTION";
      this.creep.memory.taskData = null;
    }

    // Run creep actions, if not working a task find one.
    if (this.creep.memory.task) {
      console.log(`${this.creep.name} working on task ${this.creep.memory.task}`);

      try {
        switch (this.creep.memory.task) {
          case "FILL_STORAGE_FROM_TERMINAL":
            this.fillStorageAction();
            break;
          case "FILL_TERMINAL_FROM_STORAGE":
            this.fillTerminalAction();
            break;
          case "OFFLOAD_SOURCE_LINK_1":
            this.offloadSourceLink1Action();
            break;
          case "OFFLOAD_SOURCE_LINK_2":
            this.offloadSourceLink2Action();
            break;
          case "FILL_FIELD_LINK_1":
            this.fillFieldLink1Action();
            break;
          case "FILL_FIELD_LINK_2":
            this.fillFieldLink2Action();
            break;
          case "FILL_CONTROLLER_LINK":
            this.fillControllerLinkAction();
            break;
          case "FILL_TOWERS_CRITICAL":
            this.fillTowerAction();
            break;
          case "FILL_TOWERS":
            this.fillTowerAction();
            break;
          case "FILL_POWER_SPAWW_ENERGY":
            this.fillPowerSpawnEnergyAction();
            break;
          case "FILL_POWER_SPAWN_POWER":
            this.fillPowerSpawnPowerAction();
            break;
          case "FILL_TERMINAL_RESOURCES_FROM_STORAGE":
            this.fillTerminalResourcesFromStorageAction();
            break;
          case "FILL_BOOST_LABS":
            this.fillBoostLabsAction();
            break;
          case "SUPPLY_LAB_PRODUCTION":
            this.supplyLabProductionAction();
            break;
          case "OFFLOAD_DEPOSIT_RESOURCES_TO_TERMINAL":
            this.offloadDepositResourcesToTerminalAction();
            break;

          default:
            // Unknown task, clear it
            this.creep.memory.task = null;
            this.creep.memory.taskData = null;
            break;
        }
      } catch (e) {
        console.log(`Error in GroundSupport actions for creep ${this.creep.name}: ${e}`);
      }
    } else {
      try {
        if (boostRequested) {
          this.creep.memory.task = "FILL_BOOST_LABS";
          this.fillBoostLabsAction();
          return;
        }
        // Before new task, return to parking spot
        const parkingSpot = this.roomValues.chemist.parking;
        if (this.creep.pos.x !== parkingSpot.x || this.creep.pos.y !== parkingSpot.y) {
          this.creep.moveTo(new RoomPosition(parkingSpot.x, parkingSpot.y, this.room.name), {
            visualizePathStyle: { stroke: "#ffffff" }
          });
          return;
        }

        // Find a new task for the creep
        this.findNewTask();
      } catch (e) {
        console.log(`Error in GroundSupport finding new task for creep ${this.creep.name}: ${e}`);
      }
    }
  }

  private findNewTask(): void {
    if (!this.creep) {
      return;
    }

    // 00. Room storage is too low, look for energy
    if (this.roomStorageLowCheck()) {
      console.log(`${this.room.name} GroundSupport 00: Storage level.`);
      this.creep.memory.task = "FILL_STORAGE_FROM_TERMINAL";
      return;
    }

    // 01. Room storage has excess energy, look to distribute it
    if (this.roomStorageHighCheck()) {
      console.log(`${this.room.name} GroundSupport 01: Storage level.`);
      this.creep.memory.task = "FILL_TERMINAL_FROM_STORAGE";
      return;
    }

    // 02. Room terminal needs energy
    if (this.roomTerminalLowCheck()) {
      console.log(`${this.room.name} GroundSupport 02: Terminal level.`);
      this.creep.memory.task = "FILL_TERMINAL_FROM_STORAGE";
      return;
    }

    // 03. Room terminal has excess energy
    if (this.roomTerminalHighCheck()) {
      console.log(`${this.room.name} GroundSupport 03: Terminal level.`);
      this.creep.memory.task = "FILL_STORAGE_FROM_TERMINAL";
      return;
    }

    // 04. Fill field link 1
    if (this.fieldLink1Check()) {
      console.log(`${this.room.name} GroundSupport 04. Field Link 1 level.`);
      this.creep.memory.task = "FILL_FIELD_LINK_1";
      return;
    }

    // 05. Offload source link 1
    if (this.sourceLink1Check()) {
      console.log(`${this.room.name} GroundSupport 05. Source Link 1 level.`);
      this.creep.memory.task = "OFFLOAD_SOURCE_LINK_1";
      return;
    }

    // 06. Fill field link 2
    if (this.fieldLink2Check()) {
      console.log(`${this.room.name} GroundSupport 06. Field Link 2 level.`);
      this.creep.memory.task = "FILL_FIELD_LINK_2";
      return;
    }

    // 07. Offload source link 2
    if (this.sourceLink2Check()) {
      console.log(`${this.room.name} GroundSupport 07. Source Link 2 level.`);
      this.creep.memory.task = "OFFLOAD_SOURCE_LINK_2";
      return;
    }

    // 08. Fill controller link
    if (this.controllerLinkCheck()) {
      console.log(`${this.room.name} GroundSupport 08. Controller Link level.`);
      this.creep.memory.task = "FILL_CONTROLLER_LINK";
      return;
    }

    // 09. Fill critically low towers
    if (this.towerCriticalCheck()) {
      console.log(`${this.room.name} GroundSupport 09. Tower levels critical.`);
      this.creep.memory.task = "FILL_TOWERS_CRITICAL";
      return;
    }

    // 10. Fill boost labs reserved by a siege
    if (this.getBoostLabNeed()) {
      this.creep.memory.task = "FILL_BOOST_LABS";
      return;
    }

    if (this.getProductionLabNeed()) {
      this.creep.memory.task = "SUPPLY_LAB_PRODUCTION";
      return;
    }

    // 11. Fill power spawns
    if (this.powerSpawnEnergyCheck()) {
      console.log(`${this.room.name} GroundSupport 11. Power Spawn energy low.`);
      this.creep.memory.task = "FILL_POWER_SPAWW_ENERGY";
      return;
    }
    if (this.powerSpawnPowerCheck()) {
      console.log(`${this.room.name} GroundSupport 11. Power Spawn power low.`);
      this.creep.memory.task = "FILL_POWER_SPAWN_POWER";
      return;
    }

    // Fill nuker

    // 15. Fill critically low towers
    if (this.towerCheck()) {
      console.log(`${this.room.name} GroundSupport 15. Tower levels.`);
      this.creep.memory.task = "FILL_TOWERS";
      return;
    }

    if (this.depositResourcesNeedMarketCheck()) {
      this.creep.memory.task = "OFFLOAD_DEPOSIT_RESOURCES_TO_TERMINAL";
      return;
    }

    // 16. Room terminal low resource check (non-energy)
    if (this.roomTerminalResourceLowCheck()) {
      console.log(`${this.room.name} GroundSupport 16: Resource Low.`);
      this.creep.memory.task = "FILL_TERMINAL_RESOURCES_FROM_STORAGE";
      return;
    }

    // console.log(`${this.room.name} GroundSupport: Sleeping.`);
  }

  /** 00. FILL_STORAGE_FROM_TERMINAL **/
  private roomStorageLowCheck(): boolean {
    if (!this.room.storage || !this.roomValues) {
      return false;
    }

    const storageEnergy = this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY);
    if (storageEnergy <= 10000) {
      // If there is a place to get the enrgy from, then return true.
      if (this.room.terminal && this.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) > 5000) {
        return true;
      }
    }
    return false;
  }

  private roomTerminalHighCheck(): boolean {
    if (!this.room.terminal || !this.room.storage) {
      return false;
    }

    const terminalFreeCapacity = this.room.terminal.store.getFreeCapacity();
    if (terminalFreeCapacity <= 5000) {
      // If there is a place to get the energy from, then return true.
      if (this.room.storage && this.room.storage.store.getFreeCapacity() > 20000) {
        return true;
      }
    }
    return false;
  }

  private fillStorageAction(): void {
    if (!this.creep || !this.room.storage || !this.room.terminal) {
      // clear task if something is missing
      this.clearCreepTask(this.creep);
      return;
    }

    if (this.clearNonEnergyResources()) {
      return;
    }

    // If creep is empty, go get energy from terminal
    if (this.creep.store.getUsedCapacity() === 0) {
      if (this.creep.withdraw(this.room.terminal, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        this.creep.moveTo(this.room.terminal, { visualizePathStyle: { stroke: "#ffaa00" } });
      }
      return;
    }

    // If creep is full or has some energy, go fill storage
    if (this.creep.store.getUsedCapacity() > 0) {
      let result = this.transferAll(this.room.storage);
      if (result === ERR_NOT_IN_RANGE) {
        this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: "#00ff00" } });
      } else if (result === OK) {
        // Successfully transferred all energy, clear task
        this.clearCreepTask(this.creep);
      }
      return;
    }
  }

  /** 01. FILL_TERMINAL_FROM_STORAGE **/
  private roomStorageHighCheck(): boolean {
    if (!this.room.storage || !this.room.terminal) {
      return false;
    }

    const storageFreeCapacity = this.room.storage.store.getFreeCapacity();

    // Critically full storage, move over if there is any room in terminal
    if (storageFreeCapacity <= 10000) {
      // If there is a place to get the energy from, then return true.
      if (this.room.terminal && this.room.terminal.store.getFreeCapacity() > 5000) {
        return true;
      }
    }

    // Abundantly full storage with energy, move over if terminal has room
    const storageEnergy = this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY);
    if (storageEnergy > 250000) {
      // If there is a place to get the energy from, then return true.
      if (
        this.room.terminal &&
        this.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) < 50000 &&
        this.room.terminal.store.getFreeCapacity() > 10000
      ) {
        return true;
      }
    }
    return false;
  }

  private roomTerminalLowCheck(): boolean {
    if (!this.room.terminal || !this.room.storage) {
      return false;
    }

    const terminalEnergy = this.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
    if (terminalEnergy <= 30000) {
      // If there is a place to get the energy from, then return true.
      if (this.room.storage && this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 70000) {
        return true;
      }
    }
    return false;
  }

  private fillTerminalAction(): void {
    if (!this.creep || !this.room.storage || !this.room.terminal) {
      // clear task if something is missing
      this.clearCreepTask(this.creep);
      return;
    }

    if (this.clearNonEnergyResources()) {
      return;
    }

    // If creep is empty, go get energy from storage
    if (this.creep.store.getUsedCapacity() === 0) {
      if (this.creep.withdraw(this.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: "#ffaa00" } });
      }
      return;
    }

    // If creep is full or has some energy, go fill terminal
    if (this.creep.store.getUsedCapacity() > 0) {
      let result = this.transferAll(this.room.terminal);
      if (result === ERR_NOT_IN_RANGE) {
        this.creep.moveTo(this.room.terminal, { visualizePathStyle: { stroke: "#00ff00" } });
      } else if (result === OK) {
        // Successfully transferred all energy, clear task
        this.clearCreepTask(this.creep);
      }
      return;
    }
  }

  /** 04. FILL_FIELD_LINK_1 **/

  private fieldLink1Check(): boolean {
    if (!this.roomValues) {
      return false;
    }
    if (this.room.storage && this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 800) {
      return false;
    }

    let fieldLinkPos = this.roomValues.fieldLinks[0];
    let fieldLink1 =
      this.room.find<StructureLink>(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_LINK && s.pos.x === fieldLinkPos.x && s.pos.y === fieldLinkPos.y
      })[0] || null;
    if (!fieldLink1) {
      return false;
    }

    const linkField1 = fieldLink1.store.getUsedCapacity(RESOURCE_ENERGY);
    return linkField1 <= 100;
  }

  private fillFieldLink1Action(): void {
    if (!this.creep || !this.room.storage || !this.roomValues) {
      return;
    }

    if (this.clearNonEnergyResources()) {
      return;
    }

    let fieldLinkPos = this.roomValues.fieldLinks[0];
    let fieldLink1 =
      this.room.find<StructureLink>(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_LINK && s.pos.x === fieldLinkPos.x && s.pos.y === fieldLinkPos.y
      })[0] || null;
    if (!fieldLink1) {
      return;
    }
    if (this.room.storage && this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 800) {
      this.clearCreepTask(this.creep);
      return;
    }

    const storageLink =
      this.room.find<StructureLink>(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_LINK &&
          s.pos.x === this.roomValues.storagelink.x &&
          s.pos.y === this.roomValues.storagelink.y
      })[0] || null;
    if (!storageLink) {
      return;
    }

    if (storageLink.store.getUsedCapacity(RESOURCE_ENERGY) >= fieldLink1.store.getFreeCapacity(RESOURCE_ENERGY)) {
      // Transfer.
      if (storageLink.transferEnergy(fieldLink1, fieldLink1.store.getFreeCapacity(RESOURCE_ENERGY)) === OK) {
        // Successfully transferred all energy, clear task
        this.clearCreepTask(this.creep);
      }
    } else {
      // Fill storage link from storage first.
      if (this.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
        if (this.creep.withdraw(this.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
        return;
      }

      // If creep is full or has some energy, go fill storage link
      if (this.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        let result = this.transferAll(storageLink);
        if (result === ERR_NOT_IN_RANGE) {
          this.creep.moveTo(storageLink, { visualizePathStyle: { stroke: "#00ff00" } });
        }
      }
    }
    return;
  }

  /** 05. OFFLOAD_SOURCE_LINK_1 **/

  private sourceLink1Check(): boolean {
    if (!this.roomValues || !this.room.storage) {
      return false;
    }

    let energysource = this.roomValues.energysources[0];
    let sourceLink1 =
      this.room.find<StructureLink>(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_LINK && s.pos.x === energysource.linkpos.x && s.pos.y === energysource.linkpos.y
      })[0] || null;
    if (!sourceLink1) {
      return false;
    }

    let linkSource1 = sourceLink1.store.getUsedCapacity(RESOURCE_ENERGY);
    return linkSource1 >= 650;
  }

  private offloadSourceLink1Action(): void {
    if (!this.creep || !this.room.storage || !this.roomValues) {
      return;
    }

    if (this.clearNonEnergyResources()) {
      return;
    }

    const sourceLink1 =
      this.room.find<StructureLink>(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_LINK &&
          s.pos.x === this.roomValues.energysources[0].linkpos.x &&
          s.pos.y === this.roomValues.energysources[0].linkpos.y
      })[0] || null;
    if (!sourceLink1) {
      return;
    }

    const storageLink =
      this.room.find<StructureLink>(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_LINK &&
          s.pos.x === this.roomValues.storagelink.x &&
          s.pos.y === this.roomValues.storagelink.y
      })[0] || null;
    if (!storageLink) {
      return;
    }

    // If the storage has capacity greater than the source link, transfer the energy.

    // Otherwise empty the storage link into storage first.
    if (
      storageLink.store.getFreeCapacity(RESOURCE_ENERGY) >= sourceLink1.store.getUsedCapacity(RESOURCE_ENERGY) &&
      sourceLink1.store.getUsedCapacity(RESOURCE_ENERGY) > 100
    ) {
      // Transfer.
      sourceLink1.transferEnergy(storageLink, sourceLink1.store.getUsedCapacity(RESOURCE_ENERGY));
      this.clearCreepTask(this.creep);
    } else {
      // Unload storage links
      if (this.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
        if (this.creep.withdraw(storageLink, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.creep.moveTo(storageLink, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
        return;
      } else {
        // If creep is full or has some energy, go fill storage link
        let result = this.transferAll(this.room.storage);
        if (result === ERR_NOT_IN_RANGE) {
          this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: "#00ff00" } });
        }
      }
    }
  }

  /** 06. FILL_FIELD_LINK_2 **/

  private fieldLink2Check(): boolean {
    if (!this.roomValues) {
      return false;
    }
    if (this.room.storage && this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 800) {
      return false;
    }

    let fieldLinkPos = this.roomValues.fieldLinks[1];
    let fieldLink2 =
      this.room.find<StructureLink>(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_LINK && s.pos.x === fieldLinkPos.x && s.pos.y === fieldLinkPos.y
      })[0] || null;
    if (!fieldLink2) {
      return false;
    }

    const linkField2 = fieldLink2.store.getUsedCapacity(RESOURCE_ENERGY);
    return linkField2 <= 100;
  }

  private fillFieldLink2Action(): void {
    if (!this.creep || !this.room.storage || !this.roomValues) {
      return;
    }

    if (this.clearNonEnergyResources()) {
      return;
    }

    let fieldLinkPos = this.roomValues.fieldLinks[1];
    let fieldLink2 =
      this.room.find<StructureLink>(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_LINK && s.pos.x === fieldLinkPos.x && s.pos.y === fieldLinkPos.y
      })[0] || null;
    if (!fieldLink2) {
      return;
    }
    if (this.room.storage && this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 800) {
      this.clearCreepTask(this.creep);
      return;
    }

    const storageLink =
      this.room.find<StructureLink>(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_LINK &&
          s.pos.x === this.roomValues.storagelink.x &&
          s.pos.y === this.roomValues.storagelink.y
      })[0] || null;
    if (!storageLink) {
      return;
    }

    if (storageLink.store.getUsedCapacity(RESOURCE_ENERGY) >= fieldLink2.store.getFreeCapacity(RESOURCE_ENERGY)) {
      // Transfer.
      if (storageLink.transferEnergy(fieldLink2, fieldLink2.store.getFreeCapacity(RESOURCE_ENERGY)) === OK) {
        // Successfully transferred all energy, clear task
        this.clearCreepTask(this.creep);
      }
    } else {
      // Fill storage link from storage first.
      if (this.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
        if (this.creep.withdraw(this.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
        return;
      }

      // If creep is full or has some energy, go fill storage link
      if (this.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        let result = this.transferAll(storageLink);
        if (result === ERR_NOT_IN_RANGE) {
          this.creep.moveTo(storageLink, { visualizePathStyle: { stroke: "#00ff00" } });
        }
      }
    }
    return;
  }

  /** 07. OFFLOAD_SOURCE_LINK_2 **/
  private sourceLink2Check(): boolean {
    if (!this.roomValues || !this.room.storage) {
      return false;
    }
    let energysource = this.roomValues.energysources[1];
    let sourceLink2 = this.room.find(FIND_STRUCTURES, {
      filter: structure => {
        return (
          structure.structureType === STRUCTURE_LINK &&
          structure.pos.x === energysource.linkpos.x &&
          structure.pos.y === energysource.linkpos.y
        );
      }
    })[0] as StructureLink | undefined;
    if (!sourceLink2) {
      return false;
    }

    let linkSource2 = sourceLink2.store.getUsedCapacity(RESOURCE_ENERGY);
    return linkSource2 >= 650;
  }

  private offloadSourceLink2Action(): void {
    if (!this.creep || !this.room.storage || !this.roomValues) {
      return;
    }

    if (this.clearNonEnergyResources()) {
      return;
    }

    const sourceLink2 =
      this.room.find<StructureLink>(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_LINK &&
          s.pos.x === this.roomValues.energysources[1].linkpos.x &&
          s.pos.y === this.roomValues.energysources[1].linkpos.y
      })[0] || null;
    if (!sourceLink2) {
      return;
    }

    const storageLink =
      this.room.find<StructureLink>(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_LINK &&
          s.pos.x === this.roomValues.storagelink.x &&
          s.pos.y === this.roomValues.storagelink.y
      })[0] || null;
    if (!storageLink) {
      return;
    }

    // If the storage has capacity greater than the source link, transfer the energy.

    // Otherwise empty the storage link into storage first.
    if (
      storageLink.store.getFreeCapacity(RESOURCE_ENERGY) >= sourceLink2.store.getUsedCapacity(RESOURCE_ENERGY) &&
      sourceLink2.store.getUsedCapacity(RESOURCE_ENERGY) > 100
    ) {
      // Transfer.
      sourceLink2.transferEnergy(storageLink, sourceLink2.store.getUsedCapacity(RESOURCE_ENERGY));
      this.clearCreepTask(this.creep);
    } else {
      // Unload storage links
      if (this.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
        if (this.creep.withdraw(storageLink, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.creep.moveTo(storageLink, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
        return;
      } else {
        // If creep is full or has some energy, go fill storage link
        let result = this.transferAll(this.room.storage);
        if (result === ERR_NOT_IN_RANGE) {
          this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: "#00ff00" } });
        }
      }
    }
  }

  /** 08. FILL_CONTROLLER_LINK **/
  private controllerLinkCheck(): boolean {
    if (!this.roomValues) {
      return false;
    }

    let controllerLink = this.room.find(FIND_STRUCTURES, {
      filter: structure => {
        return (
          structure.structureType === STRUCTURE_LINK &&
          structure.pos.x === this.roomValues.controllerLink.x &&
          structure.pos.y === this.roomValues.controllerLink.y
        );
      }
    })[0] as StructureLink | undefined;
    if (!controllerLink) {
      return false;
    }

    const linkController = controllerLink.store.getUsedCapacity(RESOURCE_ENERGY);
    return linkController <= 100;
  }

  private fillControllerLinkAction(): void {
    if (!this.creep || !this.room.storage || !this.roomValues) {
      return;
    }

    if (this.clearNonEnergyResources()) {
      return;
    }

    let controllerLink = this.room.find(FIND_STRUCTURES, {
      filter: structure => {
        return (
          structure.structureType === STRUCTURE_LINK &&
          structure.pos.x === this.roomValues.controllerLink.x &&
          structure.pos.y === this.roomValues.controllerLink.y
        );
      }
    })[0] as StructureLink | undefined;
    if (!controllerLink) {
      return;
    }

    const storageLink =
      this.room.find<StructureLink>(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_LINK &&
          s.pos.x === this.roomValues.storagelink.x &&
          s.pos.y === this.roomValues.storagelink.y
      })[0] || null;
    if (!storageLink) {
      return;
    }

    if (storageLink.store.getUsedCapacity(RESOURCE_ENERGY) >= controllerLink.store.getFreeCapacity(RESOURCE_ENERGY)) {
      // Transfer.
      if (storageLink.transferEnergy(controllerLink, controllerLink.store.getFreeCapacity(RESOURCE_ENERGY)) === OK) {
        // Successfully transferred all energy, clear task
        this.clearCreepTask(this.creep);
      }
    } else {
      // Fill storage link from storage first.
      if (this.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
        if (this.creep.withdraw(this.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
        return;
      }

      // If creep is full or has some energy, go fill storage link
      if (this.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        let result = this.transferAll(storageLink);
        if (result === ERR_NOT_IN_RANGE) {
          this.creep.moveTo(storageLink, { visualizePathStyle: { stroke: "#00ff00" } });
        }
      }
    }
    return;
  }

  /** 09. FILL_TOWERS_CRITICAL **/
  private towerCriticalCheck(): boolean {
    if (!this.roomValues) {
      return false;
    }

    const towers = this.room.find<StructureTower>(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER
    });

    for (const tower of towers) {
      const towerEnergy = tower.store.getUsedCapacity(RESOURCE_ENERGY);
      const towerCapacity = tower.store.getCapacity(RESOURCE_ENERGY);
      if (towerEnergy <= 0.2 * towerCapacity) {
        return true;
      }
    }
    return false;
  }

  private towerCheck(): boolean {
    if (!this.roomValues) {
      return false;
    }

    const towers = this.room.find<StructureTower>(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 200
    });

    for (const tower of towers) {
      return true;
    }
    return false;
  }

  private fillTowerAction(): void {
    if (!this.creep || !this.room.storage || !this.roomValues) {
      return;
    }

    if (this.clearNonEnergyResources()) {
      return;
    }

    if (this.room.storage && this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 800) {
      this.clearCreepTask(this.creep);
      return;
    }

    const towers = this.room.find<StructureTower>(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 200
    });

    for (const tower of towers) {
      const towerEnergy = tower.store.getUsedCapacity(RESOURCE_ENERGY);
      const towerCapacity = tower.store.getCapacity(RESOURCE_ENERGY);
      if (
        (towerEnergy <= 0.2 * towerCapacity && this.creep.memory.task === "FILL_TOWERS_CRITICAL") ||
        this.creep.memory.task === "FILL_TOWERS"
      ) {
        // Need to fill this tower.
        // If creep is empty, go get energy from storage
        if (this.creep.store.getUsedCapacity() === 0) {
          if (this.creep.withdraw(this.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: "#ffaa00" } });
          }
          return;
        }

        // If creep is full or has some energy, go fill tower
        if (this.creep.store.getUsedCapacity() > 0) {
          let result = this.transferAll(tower);
          if (result === ERR_NOT_IN_RANGE) {
            this.creep.moveTo(tower, { visualizePathStyle: { stroke: "#00ff00" } });
          } else if (result === OK) {
            // Successfully transferred all energy, clear task
            this.clearCreepTask(this.creep);
          }
          return;
        }
      }
    }
    this.clearCreepTask(this.creep);
    return;
  }

  /** 11. POWER_SPAWN_ENERGY_LOW **/
  private powerSpawnEnergyCheck(): boolean {
    if (!this.roomValues) {
      return false;
    }

    const powerSpawns = this.room.find<StructurePowerSpawn>(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_POWER_SPAWN
    });

    for (const powerSpawn of powerSpawns) {
      const psEnergy = powerSpawn.store.getUsedCapacity(RESOURCE_ENERGY);
      const psCapacity = powerSpawn.store.getCapacity(RESOURCE_ENERGY);
      if (psEnergy <= 0.2 * psCapacity) {
        return true;
      }
    }
    return false;
  }

  private fillPowerSpawnEnergyAction(): void {
    if (!this.creep || !this.room.storage || !this.roomValues) {
      return;
    }

    const powerSpawns = this.room.find<StructurePowerSpawn>(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_POWER_SPAWN
    });

    for (const powerSpawn of powerSpawns) {
      // If creep is empty, go get energy from storage
      if (this.creep.store.getUsedCapacity() === 0) {
        if (this.creep.withdraw(this.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
        return;
      }

      // If creep is full or has some energy, go fill power spawn
      if (this.creep.store.getUsedCapacity() > 0) {
        let result = this.transferAll(powerSpawn);
        if (result === ERR_NOT_IN_RANGE) {
          this.creep.moveTo(powerSpawn, { visualizePathStyle: { stroke: "#00ff00" } });
        } else if (result === OK) {
          // Successfully transferred all energy, clear task
          this.clearCreepTask(this.creep);
        }
        return;
      }
    }
    this.clearCreepTask(this.creep);
    return;
  }

  /** 11. POWER_SPAWN_POWER_LOW **/
  private powerSpawnPowerCheck(): boolean {
    if (!this.roomValues) {
      return false;
    }

    // Verify there is power in storage or terminal first
    let powerInStorage = 0;
    if (this.room.storage) {
      powerInStorage += this.room.storage.store.getUsedCapacity(RESOURCE_POWER);
    }
    if (this.room.terminal) {
      powerInStorage += this.room.terminal.store.getUsedCapacity(RESOURCE_POWER);
    }
    if (powerInStorage < 50) {
      return false;
    }

    const powerSpawns = this.room.find<StructurePowerSpawn>(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_POWER_SPAWN
    });

    for (const powerSpawn of powerSpawns) {
      const psPower = powerSpawn.store.getUsedCapacity(RESOURCE_POWER);
      const psCapacity = powerSpawn.store.getCapacity(RESOURCE_POWER);
      if (psPower <= 0.2 * psCapacity) {
        return true;
      }
    }
    return false;
  }

  private fillPowerSpawnPowerAction(): void {
    if (!this.creep || !this.room.storage || !this.roomValues) {
      return;
    }

    const powerSpawns = this.room.find<StructurePowerSpawn>(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_POWER_SPAWN
    });

    if (this.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      // First offload any energy the creep has
      if (this.room.storage) {
        let result = this.transferAll(this.room.storage);
        if (result === ERR_NOT_IN_RANGE) {
          this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: "#00ff00" } });
        } else if (result === OK) {
          // Successfully transferred all energy, continue
        }
        return;
      }
    }

    for (const powerSpawn of powerSpawns) {
      // If creep is empty, go get power from storage
      if (this.creep.store.getUsedCapacity(RESOURCE_POWER) === 0) {
        // Prioritize storage first
        if (this.room.storage && this.room.storage.store.getUsedCapacity(RESOURCE_POWER) > 0) {
          if (this.creep.withdraw(this.room.storage, RESOURCE_POWER) === ERR_NOT_IN_RANGE) {
            this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: "#ffaa00" } });
          }
          return;
        }

        // Then terminal
        if (this.room.terminal && this.room.terminal.store.getUsedCapacity(RESOURCE_POWER) > 0) {
          if (this.creep.withdraw(this.room.terminal, RESOURCE_POWER) === ERR_NOT_IN_RANGE) {
            this.creep.moveTo(this.room.terminal, { visualizePathStyle: { stroke: "#ffaa00" } });
          }
          return;
        }
      }

      // If creep is full or has some power, go fill power spawn
      if (this.creep.store.getUsedCapacity(RESOURCE_POWER) > 0) {
        let result = this.transferAll(powerSpawn);
        if (result === ERR_NOT_IN_RANGE) {
          this.creep.moveTo(powerSpawn, { visualizePathStyle: { stroke: "#00ff00" } });
        } else if (result === OK) {
          // Successfully transferred all power, clear task
          this.clearCreepTask(this.creep);
        }
        return;
      }
    }
    this.clearCreepTask(this.creep);
    return;
  }

  private roomTerminalResourceLowCheck(): boolean {
    // Keep ordinary non-energy resources stocked independently from deposit sales.
    if (!this.room.storage || !this.room.terminal) {
      return false;
    }

    for (const resourceType in this.room.storage.store) {
      if (
        resourceType === RESOURCE_ENERGY ||
        DEPOSIT_MARKET_RESOURCES.some(depositResource => depositResource === resourceType)
      ) {
        continue;
      }
      const resource = resourceType as ResourceConstant;
      if (this.room.storage.store.getUsedCapacity(resource)! > 0) {
        const terminalAmount = this.room.terminal.store.getUsedCapacity(resource)!;
        if (terminalAmount < 20000) {
          return true;
        }
      }
    }

    return false;
  }

  private fillTerminalResourcesFromStorageAction(): void {
    if (!this.creep || !this.room.storage || !this.room.terminal) {
      // clear task if something is missing
      this.clearCreepTask(this.creep);
      return;
    }

    for (const resourceType in this.room.storage.store) {
      if (
        resourceType === RESOURCE_ENERGY ||
        DEPOSIT_MARKET_RESOURCES.some(depositResource => depositResource === resourceType)
      ) {
        continue;
      }
      const resource = resourceType as ResourceConstant;
      if (this.room.storage.store.getUsedCapacity(resource)! > 0) {
        const terminalAmount = this.room.terminal.store.getUsedCapacity(resource)!;
        if (terminalAmount < 20000) {
          // If creep is empty, go get resource from storage
          if (this.creep.store.getUsedCapacity() === 0) {
            if (this.creep.withdraw(this.room.storage, resource) === ERR_NOT_IN_RANGE) {
              this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: "#ffaa00" } });
            }
            return;
          }

          // If creep is full or has some energy, go fill terminal
          if (this.creep.store.getUsedCapacity() > 0) {
            let result = this.transferAll(this.room.terminal);
            if (result === ERR_NOT_IN_RANGE) {
              this.creep.moveTo(this.room.terminal, { visualizePathStyle: { stroke: "#00ff00" } });
            } else if (result === OK) {
              // Successfully transferred all energy, clear task
              this.clearCreepTask(this.creep);
            }
            return;
          }
        }
      }
    }
    this.clearCreepTask(this.creep);
  }

  private depositResourcesNeedMarketCheck(): boolean {
    const storage = this.room.storage;
    const terminal = this.room.terminal;
    const creep = this.creep;
    if (
      storage &&
      creep &&
      DEPOSIT_MARKET_RESOURCES.some(resource => (creep.store.getUsedCapacity(resource) || 0) > 0)
    ) {
      return true;
    }
    if (!storage || !terminal || (terminal.store.getFreeCapacity() || 0) <= 0) return false;

    return DEPOSIT_MARKET_RESOURCES.some(
      resource =>
        (storage.store.getUsedCapacity(resource) || 0) > 0 && (terminal.store.getFreeCapacity(resource) || 0) > 0
    );
  }

  private offloadDepositResourcesToTerminalAction(): void {
    const creep = this.creep;
    const storage = this.room.storage;
    const terminal = this.room.terminal;
    if (!creep || !storage) {
      this.clearCreepTask(creep);
      return;
    }

    const carriedResource = DEPOSIT_MARKET_RESOURCES.find(
      candidate => (creep.store.getUsedCapacity(candidate) || 0) > 0
    );
    const resource =
      carriedResource ||
      (terminal &&
        DEPOSIT_MARKET_RESOURCES.find(
          candidate =>
            (storage.store.getUsedCapacity(candidate) || 0) > 0 && (terminal.store.getFreeCapacity(candidate) || 0) > 0
        ));
    if (!resource) {
      this.clearCreepTask(creep);
      return;
    }

    if (carriedResource) {
      const target = terminal && (terminal.store.getFreeCapacity(resource) || 0) > 0 ? terminal : storage;
      const result = creep.transfer(target, resource);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: "#00ff00" } });
      } else if (result === OK) {
        this.clearCreepTask(creep);
      } else {
        console.log(`[${this.room.name}] GroundSupport could not move ${resource} to destination: ${result}`);
        if (result !== ERR_FULL) this.clearCreepTask(creep);
      }
      return;
    }

    if (!terminal) {
      this.clearCreepTask(creep);
      return;
    }

    if ((terminal.store.getFreeCapacity(resource) || 0) <= 0) {
      this.clearCreepTask(creep);
      return;
    }

    const amount = Math.min(
      creep.store.getFreeCapacity() || 0,
      storage.store.getUsedCapacity(resource) || 0,
      terminal.store.getFreeCapacity(resource) || 0
    );
    if (amount <= 0) {
      this.clearCreepTask(creep);
      return;
    }

    const withdrawalResult = creep.withdraw(storage, resource, amount);
    if (withdrawalResult === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, { visualizePathStyle: { stroke: "#ffaa00" } });
    } else if (withdrawalResult !== OK) {
      console.log(`[${this.room.name}] GroundSupport could not withdraw ${resource}: ${withdrawalResult}`);
      this.clearCreepTask(creep);
    }
  }

  private getBoostLabNeed(): GroundSupportLabNeed | null {
    const storage = this.room.storage;
    const boosts = this.room.memory.data?.labs?.boosts || [];
    if (!storage) return null;

    for (const entry of boosts) {
      const lab = Game.getObjectById(entry.id);
      if (!lab) continue;
      if (lab.mineralType && lab.mineralType !== entry.component) {
        const amount = lab.store.getUsedCapacity(lab.mineralType) || 0;
        if (amount > 0) return { lab, resource: lab.mineralType, amount, clear: true };
      }

      const mineralDeficit =
        (lab.store.getCapacity(entry.component) || 0) - (lab.store.getUsedCapacity(entry.component) || 0);
      const mineralStock =
        (storage.store.getUsedCapacity(entry.component) || 0) +
        (this.room.terminal?.store.getUsedCapacity(entry.component) || 0);
      if (mineralDeficit > 0 && mineralStock > 0) {
        return { lab, resource: entry.component, amount: Math.min(mineralDeficit, mineralStock) };
      }

      const energyDeficit =
        (lab.store.getCapacity(RESOURCE_ENERGY) || 0) - (lab.store.getUsedCapacity(RESOURCE_ENERGY) || 0);
      if (energyDeficit > 0 && (storage.store.getUsedCapacity(RESOURCE_ENERGY) || 0) > BOOST_LAB_STORAGE_ENERGY_FLOOR) {
        return { lab, resource: RESOURCE_ENERGY, amount: energyDeficit };
      }
    }
    return null;
  }

  private fillBoostLabsAction(): void {
    const creep = this.creep;
    const storage = this.room.storage;
    if (!creep || !storage) {
      this.clearCreepTask(creep);
      return;
    }

    const need = this.getBoostLabNeed();
    const carried = (Object.keys(creep.store) as ResourceConstant[])[0];

    if (need?.clear) {
      if (carried) {
        const destination = this.getResourceDepositTarget(carried);
        if (!destination) {
          this.clearCreepTask(creep);
          return;
        }
        const result = creep.transfer(destination, carried);
        if (result === ERR_NOT_IN_RANGE) creep.moveTo(destination, { visualizePathStyle: { stroke: "#00ff00" } });
        else if (result !== OK) this.clearCreepTask(creep);
      } else {
        const result = creep.withdraw(
          need.lab,
          need.resource,
          Math.min(need.amount, creep.store.getFreeCapacity() || 0)
        );
        if (result === ERR_NOT_IN_RANGE) creep.moveTo(need.lab, { visualizePathStyle: { stroke: "#ffaa00" } });
        else if (result !== OK) this.clearCreepTask(creep);
      }
      return;
    }

    if (carried && (!need || carried !== need.resource)) {
      const destination = this.getResourceDepositTarget(carried);
      if (!destination) {
        this.clearCreepTask(creep);
        return;
      }
      const result = creep.transfer(destination, carried);
      if (result === ERR_NOT_IN_RANGE) creep.moveTo(destination, { visualizePathStyle: { stroke: "#00ff00" } });
      return;
    }

    if (!need) {
      this.clearCreepTask(creep);
      return;
    }

    if (carried) {
      const result = creep.transfer(need.lab, need.resource);
      if (result === ERR_NOT_IN_RANGE) creep.moveTo(need.lab, { visualizePathStyle: { stroke: "#00ff00" } });
      else if (result !== OK) this.clearCreepTask(creep);
      return;
    }

    const source = this.getResourceSource(need.resource);
    if (!source) {
      this.clearCreepTask(creep);
      return;
    }
    const amount = Math.min(
      need.amount,
      creep.store.getFreeCapacity() || 0,
      source.store.getUsedCapacity(need.resource) || 0
    );
    const result = creep.withdraw(source, need.resource, amount);
    if (result === ERR_NOT_IN_RANGE) creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
    else if (result !== OK) this.clearCreepTask(creep);
  }

  private runLabProduction(): void {
    const labsMemory = this.room.memory.data?.labs;
    if (!this.room.controller?.my || !labsMemory || !this.room.storage) return;

    if (!labsMemory.boosts) labsMemory.boosts = [];
    if (!labsMemory.reagents) labsMemory.reagents = [];
    if (!labsMemory.products) labsMemory.products = [];
    if (labsMemory.boosts.length > 0) {
      this.logLabProductionStatus(labsMemory.production, "paused: siege boost labs are reserved");
      return;
    }

    const state = this.ensureProductionLabAssignments();
    if (!state) return;

    if (state.paused) {
      state.activeProduct = undefined;
      state.activeReagents = undefined;
      this.logLabProductionStatus(state, "paused: manual override");
      return;
    }

    const stock = this.getLabStock(state.inputLabIds);
    const roomEnergy =
      (this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) || 0) +
      (this.room.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) || 0);
    if (roomEnergy < LAB_PRODUCTION_ENERGY_FLOOR) {
      state.activeProduct = undefined;
      state.activeReagents = undefined;
      this.logLabProductionStatus(state, `paused: room energy below ${LAB_PRODUCTION_ENERGY_FLOOR}`);
      return;
    }

    const inputA = Game.getObjectById(state.inputLabIds[0]);
    const inputB = Game.getObjectById(state.inputLabIds[1]);
    if (!inputA || !inputB) return;

    const loadedRecipe = getLoadedLabReaction(
      inputA.mineralType || null,
      inputB.mineralType || null,
      inputA.store.getUsedCapacity(inputA.mineralType || RESOURCE_ENERGY) || 0,
      inputB.store.getUsedCapacity(inputB.mineralType || RESOURCE_ENERGY) || 0
    );
    const plan = loadedRecipe
      ? { recipe: loadedRecipe }
      : selectLabReactionPlan(stock.available, REACTIONS, LAB_COMPOUND_TARGET, stock.product);
    if (!plan) {
      state.activeProduct = undefined;
      state.activeReagents = undefined;
      this.logLabProductionStatus(state, "idle: all tier 1-3 compound targets met");
      return;
    }
    if (plan.missingBase) {
      state.activeProduct = undefined;
      state.activeReagents = undefined;
      this.buyMissingLabBaseMineral(state, plan.missingBase, stock.available);
      return;
    }
    if (!plan.recipe) return;

    state.activeProduct = plan.recipe.product;
    state.activeReagents = [plan.recipe.reagentA, plan.recipe.reagentB];
    labsMemory.reagents = [
      { id: state.inputLabIds[0], component: plan.recipe.reagentA },
      { id: state.inputLabIds[1], component: plan.recipe.reagentB }
    ];
    this.logLabProductionStatus(
      state,
      `producing ${plan.recipe.product} from ${plan.recipe.reagentA}+${plan.recipe.reagentB}`
    );

    const outputLabs = labsMemory.products
      .map(entry => Game.getObjectById(entry.id))
      .filter((lab): lab is StructureLab => !!lab && !(labsMemory.boosts || []).some(boost => boost.id === lab.id));
    for (const lab of outputLabs) {
      if (
        lab.cooldown > 0 ||
        (lab.mineralType && lab.mineralType !== plan.recipe.product) ||
        (lab.store.getFreeCapacity(plan.recipe.product) || 0) < LAB_REACTION_MINERAL_AMOUNT ||
        (lab.store.getUsedCapacity(RESOURCE_ENERGY) || 0) < LAB_REACTION_ENERGY_AMOUNT
      ) {
        continue;
      }
      const result = lab.runReaction(inputA, inputB);
      if (result !== OK && result !== ERR_TIRED && result !== ERR_NOT_ENOUGH_RESOURCES) {
        const error = `reaction error ${result} for ${plan.recipe.product} in lab ${lab.id}`;
        if (state.lastError !== error) {
          state.lastError = error;
          console.log(`[${this.room.name}] GroundSupport labs ${error}`);
        }
      } else if (result === OK) {
        state.lastError = undefined;
      }
    }
  }

  private ensureProductionLabAssignments(): LabProductionState | null {
    const labsMemory = this.room.memory.data?.labs;
    const configuredPositions = RoomHelper.getRoomConfig(this.room)?.lab;
    if (!labsMemory) return null;
    if (!configuredPositions || configuredPositions.length < 3) {
      this.logLabProductionStatus(labsMemory.production, "inactive: fewer than three configured lab positions");
      return null;
    }

    const configuredLabs = this.room
      .find<StructureLab>(FIND_MY_STRUCTURES, {
        filter: structure =>
          structure.structureType === STRUCTURE_LAB &&
          configuredPositions.some(position => position.x === structure.pos.x && position.y === structure.pos.y)
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    const configuredIds = configuredLabs.map(lab => lab.id);
    let state: LabProductionState | undefined = labsMemory.production;
    const storedInputIds: Id<StructureLab>[] = state?.inputLabIds || [];
    const storedInputA = state ? configuredLabs.find(lab => lab.id === state?.inputLabIds[0]) : undefined;
    const storedInputB = state ? configuredLabs.find(lab => lab.id === state?.inputLabIds[1]) : undefined;
    const stateMatchesLayout =
      !!state &&
      state.version === 1 &&
      state.configuredLabIds.length === configuredIds.length &&
      state.configuredLabIds.every((id, index) => id === configuredIds[index]) &&
      state.inputLabIds[0] !== state.inputLabIds[1] &&
      !!storedInputA &&
      !!storedInputB &&
      configuredLabs.every(
        lab => storedInputIds.includes(lab.id) || this.isLabInReactionRange(lab, storedInputA, storedInputB)
      );

    if (!stateMatchesLayout) {
      const pair = selectLabInputPair(configuredLabs as LabPosition[]);
      if (!pair) {
        if (state) {
          state.activeProduct = undefined;
          state.activeReagents = undefined;
        }
        labsMemory.reagents = [];
        labsMemory.products = [];
        this.logLabProductionStatus(state, "inactive: no input pair reaches every configured output lab");
        return null;
      }
      const inputIds = [pair[0].id, pair[1].id] as [Id<StructureLab>, Id<StructureLab>];
      state = {
        version: 1,
        inputLabIds: inputIds,
        configuredLabIds: configuredIds
      };
      labsMemory.production = state;
    }
    if (!state) return null;

    const productionState = state;
    const inputA = Game.getObjectById(productionState.inputLabIds[0]);
    const inputB = Game.getObjectById(productionState.inputLabIds[1]);
    if (!inputA || !inputB) {
      productionState.activeProduct = undefined;
      productionState.activeReagents = undefined;
      labsMemory.reagents = [];
      labsMemory.products = [];
      this.logLabProductionStatus(productionState, "inactive: configured input labs are unavailable");
      return null;
    }
    labsMemory.products = configuredLabs
      .filter(lab => !productionState.inputLabIds.includes(lab.id))
      .map(lab => ({ id: lab.id }));
    return productionState;
  }

  private isLabInReactionRange(lab: LabPosition, inputA: LabPosition, inputB: LabPosition): boolean {
    const rangeA = Math.max(Math.abs(lab.pos.x - inputA.pos.x), Math.abs(lab.pos.y - inputA.pos.y));
    const rangeB = Math.max(Math.abs(lab.pos.x - inputB.pos.x), Math.abs(lab.pos.y - inputB.pos.y));
    return rangeA <= 2 && rangeB <= 2;
  }

  private getLabStock(inputLabIds: Id<StructureLab>[]): LabStock {
    const stock: LabStock = { available: {}, product: {} };
    const inputIds = new Set(inputLabIds);
    const stores: { store: StoreDefinition; id?: string }[] = [];
    if (this.room.storage) stores.push({ store: this.room.storage.store });
    if (this.room.terminal) stores.push({ store: this.room.terminal.store });
    for (const lab of this.room.find<StructureLab>(FIND_MY_STRUCTURES, {
      filter: structure => structure.structureType === STRUCTURE_LAB
    })) {
      stores.push({ store: lab.store, id: lab.id });
    }

    for (const entry of stores) {
      for (const resourceType in entry.store) {
        const resource = resourceType as ResourceConstant;
        const amount = entry.store.getUsedCapacity(resource) || 0;
        if (amount <= 0) continue;
        stock.available[resource] = (stock.available[resource] || 0) + amount;
        if (!entry.id || !inputIds.has(entry.id as Id<StructureLab>)) {
          stock.product[resource] = (stock.product[resource] || 0) + amount;
        }
      }
    }
    return stock;
  }

  private getProductionLabNeed(): GroundSupportLabNeed | null {
    const labsMemory = this.room.memory.data?.labs;
    const state = labsMemory?.production;
    if (!state?.activeProduct || !state.activeReagents || state.paused || (labsMemory?.boosts || []).length > 0) {
      return null;
    }
    const [reagentA, reagentB] = state.activeReagents;
    const inputLabs = state.inputLabIds.map(id => Game.getObjectById(id));
    const productLabs = (labsMemory.products || []).map(entry => Game.getObjectById(entry.id));

    for (const lab of productLabs) {
      if (!lab) continue;
      const usedEnergy = lab.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
      if (usedEnergy >= LAB_PRODUCT_ENERGY_BUFFER) continue;
      const availableEnergy =
        (this.room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0) +
        (this.room.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) || 0);
      const amount = Math.min(LAB_PRODUCT_ENERGY_BUFFER - usedEnergy, availableEnergy);
      if (amount > 0) return { lab, resource: RESOURCE_ENERGY, amount };
    }

    const inputsHaveLoadedRecipe =
      inputLabs[0]?.mineralType === state.activeReagents[0] &&
      inputLabs[1]?.mineralType === state.activeReagents[1] &&
      (inputLabs[0].store.getUsedCapacity(state.activeReagents[0]) || 0) > 0 &&
      (inputLabs[1].store.getUsedCapacity(state.activeReagents[1]) || 0) > 0;
    if (inputsHaveLoadedRecipe) return null;

    const labTargets: { lab: StructureLab | null; resource: ResourceConstant }[] = [
      ...(inputsHaveLoadedRecipe
        ? []
        : [
            { lab: inputLabs[0], resource: reagentA },
            { lab: inputLabs[1], resource: reagentB }
          ]),
      ...productLabs.map(lab => ({ lab, resource: state.activeProduct as ResourceConstant }))
    ];
    for (const target of labTargets) {
      if (target.lab?.mineralType && target.lab.mineralType !== target.resource) {
        const amount = target.lab.store.getUsedCapacity(target.lab.mineralType) || 0;
        if (amount > 0) return { lab: target.lab, resource: target.lab.mineralType, amount, clear: true };
      }
    }
    if (inputsHaveLoadedRecipe) return null;

    for (let index = 0; index < inputLabs.length; index++) {
      const lab = inputLabs[index];
      const resource = state.activeReagents[index];
      if (!lab) continue;
      const used = lab.store.getUsedCapacity(resource) || 0;
      if (used >= LAB_INPUT_BUFFER) continue;
      const available = this.getResourceStockpile(resource, lab.id);
      const amount = Math.min(LAB_INPUT_BUFFER - used, available);
      if (amount > 0) return { lab, resource, amount };
    }

    return null;
  }

  private supplyLabProductionAction(): void {
    const creep = this.creep;
    const state = this.room.memory.data?.labs?.production;
    const roomEnergy =
      (this.room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0) +
      (this.room.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) || 0);
    if (!creep || !state?.activeProduct || state.paused || roomEnergy < LAB_PRODUCTION_ENERGY_FLOOR) {
      this.clearCreepTask(creep);
      return;
    }

    const need = this.getProductionLabNeed();
    if (!need) {
      this.clearCreepTask(creep);
      return;
    }
    const carried = (Object.keys(creep.store) as ResourceConstant[]).find(
      resource => (creep.store.getUsedCapacity(resource) || 0) > 0
    );
    if (need.clear) {
      if (carried) {
        const destination = this.getResourceDepositTarget(carried);
        if (!destination) {
          this.clearCreepTask(creep);
          return;
        }
        const clearTransferResult = creep.transfer(destination, carried);
        if (clearTransferResult === ERR_NOT_IN_RANGE)
          creep.moveTo(destination, { visualizePathStyle: { stroke: "#00ff00" } });
        else if (clearTransferResult !== OK) this.clearCreepTask(creep);
      } else {
        const clearWithdrawResult = creep.withdraw(
          need.lab,
          need.resource,
          Math.min(need.amount, creep.store.getFreeCapacity() || 0)
        );
        if (clearWithdrawResult === ERR_NOT_IN_RANGE)
          creep.moveTo(need.lab, { visualizePathStyle: { stroke: "#ffaa00" } });
        else if (clearWithdrawResult !== OK) this.clearCreepTask(creep);
      }
      return;
    }
    if (carried && carried !== need.resource) {
      const destination = this.getResourceDepositTarget(carried);
      if (!destination) {
        this.clearCreepTask(creep);
        return;
      }
      const offloadResult = creep.transfer(destination, carried);
      if (offloadResult === ERR_NOT_IN_RANGE) {
        creep.moveTo(destination, { visualizePathStyle: { stroke: "#00ff00" } });
      } else if (offloadResult !== OK) this.clearCreepTask(creep);
      return;
    }
    if (carried === need.resource) {
      const deliverResult = creep.transfer(need.lab, need.resource);
      if (deliverResult === ERR_NOT_IN_RANGE) creep.moveTo(need.lab, { visualizePathStyle: { stroke: "#00ff00" } });
      else if (deliverResult !== OK) this.clearCreepTask(creep);
      return;
    }

    const source = this.getResourceSource(need.resource, need.lab.id, need.resource !== RESOURCE_ENERGY);
    if (!source) {
      this.clearCreepTask(creep);
      return;
    }
    const amount = Math.min(
      need.amount,
      creep.store.getFreeCapacity() || 0,
      source.store.getUsedCapacity(need.resource) || 0
    );
    if (amount <= 0) {
      this.clearCreepTask(creep);
      return;
    }
    const sourceWithdrawResult = creep.withdraw(source, need.resource, amount);
    if (sourceWithdrawResult === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
    } else if (sourceWithdrawResult !== OK) this.clearCreepTask(creep);
  }

  private getResourceStockpile(resource: ResourceConstant, excludeLabId?: Id<StructureLab>): number {
    let total =
      (this.room.storage?.store.getUsedCapacity(resource) || 0) +
      (this.room.terminal?.store.getUsedCapacity(resource) || 0);
    for (const lab of this.room.find<StructureLab>(FIND_MY_STRUCTURES, {
      filter: structure => structure.structureType === STRUCTURE_LAB && structure.id !== excludeLabId
    })) {
      total += lab.store.getUsedCapacity(resource) || 0;
    }
    return total;
  }

  private getResourceSource(
    resource: ResourceConstant,
    excludeLabId?: Id<StructureLab>,
    allowLabSource = true
  ): AnyStoreStructure | null {
    if ((this.room.storage?.store.getUsedCapacity(resource) || 0) > 0 && this.room.storage) {
      return this.room.storage;
    }
    if (this.room.terminal && (this.room.terminal.store.getUsedCapacity(resource) || 0) > 0) {
      return this.room.terminal;
    }
    if (!allowLabSource) return null;
    return (
      this.room.find<StructureLab>(FIND_MY_STRUCTURES, {
        filter: structure =>
          structure.structureType === STRUCTURE_LAB &&
          structure.id !== excludeLabId &&
          (structure.store.getUsedCapacity(resource) || 0) > 0
      })[0] || null
    );
  }

  private getResourceDepositTarget(resource: ResourceConstant): AnyStoreStructure | null {
    if (
      this.room.storage &&
      (this.room.storage.store.getFreeCapacity(resource) || 0) >= (this.creep?.store.getUsedCapacity(resource) || 0)
    ) {
      return this.room.storage;
    }
    return this.room.terminal &&
      (this.room.terminal.store.getFreeCapacity(resource) || 0) >= (this.creep?.store.getUsedCapacity(resource) || 0)
      ? this.room.terminal
      : null;
  }

  private buyMissingLabBaseMineral(
    state: LabProductionState,
    resource: ResourceConstant,
    stock: Partial<Record<ResourceConstant, number>>
  ): void {
    const terminal = this.room.terminal;
    if (!terminal) {
      this.logLabProductionStatus(state, `waiting to buy ${resource}: room has no terminal`);
      return;
    }
    if (state.lastMarketAttempt !== undefined && Game.time - state.lastMarketAttempt < LAB_MARKET_PURCHASE_INTERVAL) {
      return;
    }
    if (terminal.cooldown > 0) {
      this.logLabProductionStatus(state, `waiting to buy ${resource}: terminal cooldown`);
      return;
    }

    state.lastMarketAttempt = Game.time;
    const orders = Game.market
      .getAllOrders(
        candidateOrder =>
          candidateOrder.type === ORDER_SELL &&
          candidateOrder.resourceType === resource &&
          candidateOrder.remainingAmount > 0 &&
          !!candidateOrder.roomName
      )
      .sort((left, right) => left.price - right.price || left.id.localeCompare(right.id));
    const order = orders[0];
    if (!order || !order.roomName || order.price < 0) {
      this.logLabProductionStatus(state, `waiting to buy ${resource}: no eligible sell order`);
      return;
    }
    const orderRoomName = order.roomName;

    const affordableByCredits =
      order.price === 0 ? LAB_MARKET_MAX_PURCHASE : Math.floor(Game.market.credits / order.price);
    const requestedAmount = Math.min(
      LAB_MARKET_MAX_PURCHASE,
      Math.max(LAB_REACTION_MINERAL_AMOUNT, LAB_INPUT_BUFFER - (stock[resource] || 0)),
      order.remainingAmount,
      terminal.store.getFreeCapacity(resource) || 0,
      affordableByCredits
    );
    if (requestedAmount <= 0) {
      this.logLabProductionStatus(state, `waiting to buy ${resource}: no credits or terminal capacity`);
      return;
    }
    const totalEnergy =
      (this.room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0) +
      (terminal.store.getUsedCapacity(RESOURCE_ENERGY) || 0);
    const terminalEnergy = terminal.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
    const amount = getAffordableLabPurchaseAmount(requestedAmount, terminalEnergy, totalEnergy, quantity =>
      Game.market.calcTransactionCost(quantity, this.room.name, orderRoomName)
    );
    if (amount <= 0) {
      this.logLabProductionStatus(state, `waiting to buy ${resource}: transaction would cross energy reserve`);
      return;
    }

    const result = Game.market.deal(order.id, amount, this.room.name);
    if (result === OK) {
      this.logLabProductionStatus(state, `bought ${amount} ${resource} at ${order.price}`);
    } else {
      this.logLabProductionStatus(state, `market purchase of ${resource} failed: ${result}`);
    }
  }

  private logLabProductionStatus(state: LabProductionState | undefined, message: string): void {
    const labsMemory = this.room.memory.data?.labs;
    if (state?.lastStatus === message || labsMemory?.productionStatus === message) return;
    if (state) state.lastStatus = message;
    if (labsMemory) labsMemory.productionStatus = message;
    console.log(`[${this.room.name}] GroundSupport labs ${message}`);
  }

  private clearCreepTask(creep: GroundSupportCreep | null): void {
    if (this.creep) {
      this.creep.memory.task = null;
      this.creep.memory.taskData = null;
    }
  }

  private clearNonEnergyResources(): boolean {
    if (!this.creep) {
      return false;
    }
    for (const resourceType in this.creep.store) {
      const resource = resourceType as ResourceConstant;
      if (resource !== RESOURCE_ENERGY && this.creep.store[resource]! > 0) {
        if (this.room.storage && this.room.storage.store.getFreeCapacity(resource)! >= this.creep.store[resource]!) {
          if (this.creep.transfer(this.room.storage, resource) === ERR_NOT_IN_RANGE) {
            this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: "#ff0000" } });
          }
          return true;
        } else if (
          this.room.terminal &&
          this.room.terminal.store.getFreeCapacity(resource)! >= this.creep.store[resource]!
        ) {
          if (this.creep.transfer(this.room.terminal, resource) === ERR_NOT_IN_RANGE) {
            this.creep.moveTo(this.room.terminal, { visualizePathStyle: { stroke: "#ff0000" } });
          }
          return true;
        }
      }
    }
    return false;
  }

  public transferAll(destination: AnyStoreStructure): ScreepsReturnCode {
    if (!this.creep) {
      return ERR_NOT_FOUND;
    }
    for (const resourceType in this.creep.store) {
      const resource = resourceType as ResourceConstant;
      if (this.creep.store[resource]! > 0) {
        return this.creep.transfer(destination, resource);
      }
    }
    return OK;
  }
}
