import { Operator } from "../classes/operator";
import { RoomHelper } from "../utils/RoomHelper";

const DEPOSIT_MARKET_RESOURCES: DepositConstant[] = ["mist", "biomass", "metal", "silicon"];

export class GroundSupportCreep extends Creep {
    memory!: CreepMemory & {
        task?: string | null;
        taskData?: any;
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

        if (!this.creep || !this.room.storage) {
            // display debug information
            return;
        }

        // Update room values
        this.roomValues = RoomHelper.getRoomValues(this.room);

        // Run creep actions, if not working a task find one.
        if (this.creep.memory.task) {
            console.log (`${this.creep.name} working on task ${this.creep.memory.task}`);

            try {
                switch (this.creep.memory.task) {
                    case 'FILL_STORAGE_FROM_TERMINAL': this.fillStorageAction(); break;
                    case 'FILL_TERMINAL_FROM_STORAGE': this.fillTerminalAction(); break;
                    case 'OFFLOAD_SOURCE_LINK_1': this.offloadSourceLink1Action(); break;
                    case 'OFFLOAD_SOURCE_LINK_2': this.offloadSourceLink2Action(); break;
                    case 'FILL_FIELD_LINK_1': this.fillFieldLink1Action(); break;
                    case 'FILL_FIELD_LINK_2': this.fillFieldLink2Action(); break;
                    case 'FILL_CONTROLLER_LINK': this.fillControllerLinkAction(); break;
                    case 'FILL_TOWERS_CRITICAL': this.fillTowerAction(); break;
                    case 'FILL_TOWERS': this.fillTowerAction(); break;
                    case 'FILL_POWER_SPAWW_ENERGY': this.fillPowerSpawnEnergyAction(); break;
                    case 'FILL_POWER_SPAWN_POWER': this.fillPowerSpawnPowerAction(); break;
                    case 'FILL_TERMINAL_RESOURCES_FROM_STORAGE': this.fillTerminalResourcesFromStorageAction(); break;
                    case 'OFFLOAD_DEPOSIT_RESOURCES_TO_TERMINAL': this.offloadDepositResourcesToTerminalAction(); break;

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
                // Before new task, return to parking spot
                const parkingSpot = this.roomValues.chemist.parking;
                if (this.creep.pos.x !== parkingSpot.x || this.creep.pos.y !== parkingSpot.y) {
                    this.creep.moveTo(new RoomPosition(parkingSpot.x, parkingSpot.y, this.room.name), { visualizePathStyle: { stroke: '#ffffff' } });
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
            this.creep.memory.task = 'FILL_STORAGE_FROM_TERMINAL';
            return;
        }

        // 01. Room storage has excess energy, look to distribute it
        if (this.roomStorageHighCheck()) {
            console.log(`${this.room.name} GroundSupport 01: Storage level.`);
            this.creep.memory.task = 'FILL_TERMINAL_FROM_STORAGE';
            return;
        }

        // 02. Room terminal needs energy
        if (this.roomTerminalLowCheck()) {
            console.log(`${this.room.name} GroundSupport 02: Terminal level.`);
            this.creep.memory.task = 'FILL_TERMINAL_FROM_STORAGE';
            return;
        }

        // 03. Room terminal has excess energy
        if (this.roomTerminalHighCheck()) {
            console.log(`${this.room.name} GroundSupport 03: Terminal level.`);
            this.creep.memory.task = 'FILL_STORAGE_FROM_TERMINAL';
            return;
        }

        // 04. Fill field link 1
        if (this.fieldLink1Check()) {
            console.log(`${this.room.name} GroundSupport 04. Field Link 1 level.`);
            this.creep.memory.task = 'FILL_FIELD_LINK_1';
            return;
        }

        // 05. Offload source link 1
        if (this.sourceLink1Check()) {
            console.log(`${this.room.name} GroundSupport 05. Source Link 1 level.`);
            this.creep.memory.task = 'OFFLOAD_SOURCE_LINK_1';
            return;
        }

        // 06. Fill field link 2
        if (this.fieldLink2Check()) {
            console.log(`${this.room.name} GroundSupport 06. Field Link 2 level.`);
            this.creep.memory.task = 'FILL_FIELD_LINK_2';
            return;
        }

        // 07. Offload source link 2
        if (this.sourceLink2Check()) {
            console.log(`${this.room.name} GroundSupport 07. Source Link 2 level.`);
            this.creep.memory.task = 'OFFLOAD_SOURCE_LINK_2';
            return;
        }

        // 08. Fill controller link
        if (this.controllerLinkCheck()) {
            console.log(`${this.room.name} GroundSupport 08. Controller Link level.`);
            this.creep.memory.task = 'FILL_CONTROLLER_LINK';
            return;
        }

        // 09. Fill critically low towers
        if (this.towerCriticalCheck()) {
            console.log(`${this.room.name} GroundSupport 09. Tower levels critical.`);
            this.creep.memory.task = 'FILL_TOWERS_CRITICAL';
            return;
        }

        // Fill labs

        // 11. Fill power spawns
        if (this.powerSpawnEnergyCheck()) {
            console.log(`${this.room.name} GroundSupport 11. Power Spawn energy low.`);
            this.creep.memory.task = 'FILL_POWER_SPAWW_ENERGY';
            return;
        }
        if (this.powerSpawnPowerCheck()) {
            console.log(`${this.room.name} GroundSupport 11. Power Spawn power low.`);
            this.creep.memory.task = 'FILL_POWER_SPAWN_POWER';
            return;
        }

        // Fill nuker



        // 15. Fill critically low towers
        if (this.towerCheck()) {
            console.log(`${this.room.name} GroundSupport 15. Tower levels.`);
            this.creep.memory.task = 'FILL_TOWERS';
            return;
        }

        if (this.depositResourcesNeedMarketCheck()) {
            this.creep.memory.task = 'OFFLOAD_DEPOSIT_RESOURCES_TO_TERMINAL';
            return;
        }

        // 16. Room terminal low resource check (non-energy)
        if (this.roomTerminalResourceLowCheck()) {
            console.log(`${this.room.name} GroundSupport 16: Resource Low.`);
            this.creep.memory.task = 'FILL_TERMINAL_RESOURCES_FROM_STORAGE';
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

        if (this.clearNonEnergyResources()) { return; }

        // If creep is empty, go get energy from terminal
        if (this.creep.store.getUsedCapacity() === 0) {
            if (this.creep.withdraw(this.room.terminal, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                this.creep.moveTo(this.room.terminal, { visualizePathStyle: { stroke: '#ffaa00' } });
            }
            return;
        }

        // If creep is full or has some energy, go fill storage
        if (this.creep.store.getUsedCapacity() > 0) {
            let result = this.transferAll(this.room.storage);
            if (result === ERR_NOT_IN_RANGE) {
                this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: '#00ff00' } });
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
            if (this.room.terminal && this.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) < 50000 && this.room.terminal.store.getFreeCapacity() > 10000) {
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

        if (this.clearNonEnergyResources()) { return; }

        // If creep is empty, go get energy from storage
        if (this.creep.store.getUsedCapacity() === 0) {
            if (this.creep.withdraw(this.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: '#ffaa00' } });
            }
            return;
        }

        // If creep is full or has some energy, go fill terminal
        if (this.creep.store.getUsedCapacity() > 0) {
            let result = this.transferAll(this.room.terminal);
            if (result === ERR_NOT_IN_RANGE) {
                this.creep.moveTo(this.room.terminal, { visualizePathStyle: { stroke: '#00ff00' } });
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
        let fieldLink1 =  this.room.find<StructureLink>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK &&
                s.pos.x === fieldLinkPos.x &&
                s.pos.y === fieldLinkPos.y
        })[0] || null;
        if (!fieldLink1) {
            return false;
        }

        const linkField1 = fieldLink1.store.getUsedCapacity(RESOURCE_ENERGY);
        return (linkField1 <= 100);
    }

    private fillFieldLink1Action(): void {
        if (!this.creep || !this.room.storage || !this.roomValues) {
            return;
        }

        if (this.clearNonEnergyResources()) { return; }

        let fieldLinkPos = this.roomValues.fieldLinks[0];
        let fieldLink1 =  this.room.find<StructureLink>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK &&
                s.pos.x === fieldLinkPos.x &&
                s.pos.y === fieldLinkPos.y
        })[0] || null;
        if (!fieldLink1) {
            return;
        }
        if (this.room.storage && this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 800) {
            this.clearCreepTask(this.creep);
            return;
        }

        const storageLink =  this.room.find<StructureLink>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK &&
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
                    this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            }

            // If creep is full or has some energy, go fill storage link
            if (this.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                let result = this.transferAll(storageLink);
                if (result === ERR_NOT_IN_RANGE) {
                    this.creep.moveTo(storageLink, { visualizePathStyle: { stroke: '#00ff00' } });
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
        let sourceLink1 =  this.room.find<StructureLink>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK &&
                s.pos.x === energysource.linkpos.x &&
                s.pos.y === energysource.linkpos.y
        })[0] || null;
        if (!sourceLink1) {
            return false;
        }

        let linkSource1 = sourceLink1.store.getUsedCapacity(RESOURCE_ENERGY);
        return (linkSource1 >= 650);
    }

    private offloadSourceLink1Action(): void {
        if (!this.creep || !this.room.storage || !this.roomValues) {
            return;
        }

        if (this.clearNonEnergyResources()) { return; }

        const sourceLink1 =  this.room.find<StructureLink>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK &&
                s.pos.x === this.roomValues.energysources[0].linkpos.x &&
                s.pos.y === this.roomValues.energysources[0].linkpos.y
        })[0] || null;
        if (!sourceLink1) {
            return;
        }

        const storageLink =  this.room.find<StructureLink>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK &&
                s.pos.x === this.roomValues.storagelink.x &&
                s.pos.y === this.roomValues.storagelink.y
        })[0] || null;
        if (!storageLink) {
            return;
        }

        // If the storage has capacity greater than the source link, transfer the energy.

        // Otherwise empty the storage link into storage first.
        if (storageLink.store.getFreeCapacity(RESOURCE_ENERGY) >= sourceLink1.store.getUsedCapacity(RESOURCE_ENERGY) && sourceLink1.store.getUsedCapacity(RESOURCE_ENERGY) > 100) {
            // Transfer.
            sourceLink1.transferEnergy(storageLink, sourceLink1.store.getUsedCapacity(RESOURCE_ENERGY));
            this.clearCreepTask(this.creep);
        } else {
            // Unload storage links
            if (this.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
                if (this.creep.withdraw(storageLink, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    this.creep.moveTo(storageLink, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            } else {
                // If creep is full or has some energy, go fill storage link
                let result = this.transferAll(this.room.storage);
                if (result === ERR_NOT_IN_RANGE) {
                    this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: '#00ff00' } });
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
        let fieldLink2 =  this.room.find<StructureLink>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK &&
                s.pos.x === fieldLinkPos.x &&
                s.pos.y === fieldLinkPos.y
        })[0] || null;
        if (!fieldLink2) {
            return false;
        }

        const linkField2 = fieldLink2.store.getUsedCapacity(RESOURCE_ENERGY);
        return (linkField2 <= 100);
    }

    private fillFieldLink2Action(): void {
        if (!this.creep || !this.room.storage || !this.roomValues) {
            return;
        }

        if (this.clearNonEnergyResources()) { return; }

        let fieldLinkPos = this.roomValues.fieldLinks[1];
        let fieldLink2 =  this.room.find<StructureLink>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK &&
                s.pos.x === fieldLinkPos.x &&
                s.pos.y === fieldLinkPos.y
        })[0] || null;
        if (!fieldLink2) {
            return;
        }
        if (this.room.storage && this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 800) {
            this.clearCreepTask(this.creep);
            return;
        }

        const storageLink =  this.room.find<StructureLink>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK &&
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
                    this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            }

            // If creep is full or has some energy, go fill storage link
            if (this.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                let result = this.transferAll(storageLink);
                if (result === ERR_NOT_IN_RANGE) {
                    this.creep.moveTo(storageLink, { visualizePathStyle: { stroke: '#00ff00' } });
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
            filter: (structure) => {
                return structure.structureType === STRUCTURE_LINK &&
                    structure.pos.x === energysource.linkpos.x &&
                    structure.pos.y === energysource.linkpos.y;
            }
        })[0] as StructureLink | undefined;
        if (!sourceLink2) {
            return false;
        }

        let linkSource2 = sourceLink2.store.getUsedCapacity(RESOURCE_ENERGY);
        return (linkSource2 >= 650);
    }

    private offloadSourceLink2Action(): void {
        if (!this.creep || !this.room.storage || !this.roomValues) {
            return;
        }

        if (this.clearNonEnergyResources()) { return; }

        const sourceLink2 =  this.room.find<StructureLink>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK &&
                s.pos.x === this.roomValues.energysources[1].linkpos.x &&
                s.pos.y === this.roomValues.energysources[1].linkpos.y
        })[0] || null;
        if (!sourceLink2) {
            return;
        }

        const storageLink =  this.room.find<StructureLink>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK &&
                s.pos.x === this.roomValues.storagelink.x &&
                s.pos.y === this.roomValues.storagelink.y
        })[0] || null;
        if (!storageLink) {
            return;
        }

        // If the storage has capacity greater than the source link, transfer the energy.

        // Otherwise empty the storage link into storage first.
        if (storageLink.store.getFreeCapacity(RESOURCE_ENERGY) >= sourceLink2.store.getUsedCapacity(RESOURCE_ENERGY) && sourceLink2.store.getUsedCapacity(RESOURCE_ENERGY) > 100) {
            // Transfer.
            sourceLink2.transferEnergy(storageLink, sourceLink2.store.getUsedCapacity(RESOURCE_ENERGY));
            this.clearCreepTask(this.creep);
        } else {
            // Unload storage links
            if (this.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
                if (this.creep.withdraw(storageLink, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    this.creep.moveTo(storageLink, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            } else {
                // If creep is full or has some energy, go fill storage link
                let result = this.transferAll(this.room.storage);
                if (result === ERR_NOT_IN_RANGE) {
                    this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: '#00ff00' } });
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
            filter: (structure) => {
                return structure.structureType === STRUCTURE_LINK &&
                    structure.pos.x === this.roomValues.controllerLink.x &&
                    structure.pos.y === this.roomValues.controllerLink.y;
            }
        })[0] as StructureLink | undefined;
        if (!controllerLink) {
            return false;
        }

        const linkController = controllerLink.store.getUsedCapacity(RESOURCE_ENERGY);
        return (linkController <= 100);
    }

    private fillControllerLinkAction(): void {
        if (!this.creep || !this.room.storage || !this.roomValues) {
            return;
        }

        if (this.clearNonEnergyResources()) { return; }

        let controllerLink = this.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_LINK &&
                    structure.pos.x === this.roomValues.controllerLink.x &&
                    structure.pos.y === this.roomValues.controllerLink.y;
            }
        })[0] as StructureLink | undefined;
        if (!controllerLink) {
            return;
        }

        const storageLink =  this.room.find<StructureLink>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK &&
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
                    this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            }

            // If creep is full or has some energy, go fill storage link
            if (this.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                let result = this.transferAll(storageLink);
                if (result === ERR_NOT_IN_RANGE) {
                    this.creep.moveTo(storageLink, { visualizePathStyle: { stroke: '#00ff00' } });
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
            if (towerEnergy <= (0.2 * towerCapacity)) {
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
            filter: s => s.structureType === STRUCTURE_TOWER &&
                s.store.getFreeCapacity(RESOURCE_ENERGY) > 200
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

        if (this.clearNonEnergyResources()) { return; }

        if (this.room.storage && this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 800) {
            this.clearCreepTask(this.creep);
            return;
        }

        const towers = this.room.find<StructureTower>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_TOWER &&
                s.store.getFreeCapacity(RESOURCE_ENERGY) > 200
        });

        for (const tower of towers) {
            const towerEnergy = tower.store.getUsedCapacity(RESOURCE_ENERGY);
            const towerCapacity = tower.store.getCapacity(RESOURCE_ENERGY);
            if ((towerEnergy <= (0.2 * towerCapacity) && this.creep.memory.task === 'FILL_TOWERS_CRITICAL') ||
                (this.creep.memory.task === 'FILL_TOWERS')) {
                // Need to fill this tower.
                // If creep is empty, go get energy from storage
                if (this.creep.store.getUsedCapacity() === 0) {
                    if (this.creep.withdraw(this.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: '#ffaa00' } });
                    }
                    return;
                }

                // If creep is full or has some energy, go fill tower
                if (this.creep.store.getUsedCapacity() > 0) {
                    let result = this.transferAll(tower);
                    if (result === ERR_NOT_IN_RANGE) {
                        this.creep.moveTo(tower, { visualizePathStyle: { stroke: '#00ff00' } });
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
            if (psEnergy <= (0.2 * psCapacity)) {
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
                    this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            }

            // If creep is full or has some energy, go fill power spawn
            if (this.creep.store.getUsedCapacity() > 0) {
                let result = this.transferAll(powerSpawn);
                if (result === ERR_NOT_IN_RANGE) {
                    this.creep.moveTo(powerSpawn, { visualizePathStyle: { stroke: '#00ff00' } });
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
            if (psPower <= (0.2 * psCapacity)) {
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
                    this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: '#00ff00' } });
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
                        this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: '#ffaa00' } });
                    }
                    return;
                }

                // Then terminal
                if (this.room.terminal && this.room.terminal.store.getUsedCapacity(RESOURCE_POWER) > 0) {
                    if (this.creep.withdraw(this.room.terminal, RESOURCE_POWER) === ERR_NOT_IN_RANGE) {
                        this.creep.moveTo(this.room.terminal, { visualizePathStyle: { stroke: '#ffaa00' } });
                    }
                    return;
                }
            }

            // If creep is full or has some power, go fill power spawn
            if (this.creep.store.getUsedCapacity(RESOURCE_POWER) > 0) {
                let result = this.transferAll(powerSpawn);
                if (result === ERR_NOT_IN_RANGE) {
                    this.creep.moveTo(powerSpawn, { visualizePathStyle: { stroke: '#00ff00' } });
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
                            this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: '#ffaa00' } });
                        }
                        return;
                    }

                    // If creep is full or has some energy, go fill terminal
                    if (this.creep.store.getUsedCapacity() > 0) {
                        let result = this.transferAll(this.room.terminal);
                        if (result === ERR_NOT_IN_RANGE) {
                            this.creep.moveTo(this.room.terminal, { visualizePathStyle: { stroke: '#00ff00' } });
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
                (storage.store.getUsedCapacity(resource) || 0) > 0 &&
                (terminal.store.getFreeCapacity(resource) || 0) > 0
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
                        (storage.store.getUsedCapacity(candidate) || 0) > 0 &&
                        (terminal.store.getFreeCapacity(candidate) || 0) > 0
                ));
        if (!resource) {
            this.clearCreepTask(creep);
            return;
        }

        if (carriedResource) {
            const target =
                terminal && (terminal.store.getFreeCapacity(resource) || 0) > 0 ? terminal : storage;
            const result = creep.transfer(target, resource);
            if (result === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { visualizePathStyle: { stroke: '#00ff00' } });
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
            creep.moveTo(storage, { visualizePathStyle: { stroke: '#ffaa00' } });
        } else if (withdrawalResult !== OK) {
            console.log(`[${this.room.name}] GroundSupport could not withdraw ${resource}: ${withdrawalResult}`);
            this.clearCreepTask(creep);
        }
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
                        this.creep.moveTo(this.room.storage, { visualizePathStyle: { stroke: '#ff0000' } });
                    }
                    return true;
                } else if (this.room.terminal && this.room.terminal.store.getFreeCapacity(resource)! >= this.creep.store[resource]!) {
                    if (this.creep.transfer(this.room.terminal, resource) === ERR_NOT_IN_RANGE) {
                        this.creep.moveTo(this.room.terminal, { visualizePathStyle: { stroke: '#ff0000' } });
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
