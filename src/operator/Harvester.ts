import { Operator } from "../classes/operator";
import { MapHelper } from "../utils/MapHelper";
import {GroundSupportCreep} from "./GroundSupport";
import { RoomHelper } from "../utils/RoomHelper";

interface HarvesterMemory extends CreepMemory {
    sourceid?: Id<Source>;
    roomname?: string;
    name?: string;
    parkingSpot?: RoomPosition;
    targetroom: string;
    containerId?: Id<StructureContainer>;
    linkId?: Id<StructureLink>;
    lastContainerCheck?: number;
    lastLinkCheck?: number;
}

export class HarvesterCreep extends Creep {
    memory!: HarvesterMemory;

    constructor(creepid: any) {
        super(creepid);
    }
}

// An operator is a screep who performs an operation.
export class Harvester extends Operator {

    source: Source;
    creep: HarvesterCreep | null;
    targetroom: Room;

    constructor(name: string, room: Room, sourceid: Id<Source>, targetRoom: Room) {
        super(name, room);

        if (Game.creeps[this.name]) {
            this.creep = new HarvesterCreep(Game.creeps[this.name].id);

            if (this.creep?.memory == null) {
                this.creep.memory = {} as HarvesterMemory;
            }
            this.creep.memory.targetroom = targetRoom.name;
            this.creep.memory.name = name;
            this.creep.memory.sourceid = sourceid;
            this.creep.memory.roomname = room.name;

            this.creep.memory.parkingSpot = new RoomPosition(targetRoom.memory.sources[sourceid].container.x, targetRoom.memory.sources[sourceid].container.y, targetRoom.name);

        } else {
            this.creep = null;
        }

        this.room = room;
        this.targetroom = targetRoom;
        this.source = Game.getObjectById(sourceid) as Source;
    }

    actions() {
        if (!this.creep || this.creep == null) return;
        if (!this.creep.memory.parkingSpot) return;
        const parkingspot = this.creep.memory.parkingSpot;

        // Step 1: Parking logic (most common case, short-circuit fast)
        if (!this.creep.pos.isEqualTo(this.creep.memory.parkingSpot)) {
            this.creep.travelTo(this.creep.memory.parkingSpot);
            return;
        }

        if (this.creep.room.storage && this.creep.room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) > 900000) {
            return;
        }

        // Step 2: Find container/link, but cache their IDs in memory
        let container: StructureContainer | null = null;
        let link: StructureLink | null = null;

        // Only search for container every 10 ticks
        if (!this.creep.memory.containerId || !Game.getObjectById(this.creep.memory.containerId) || Game.time % 50 === 0) {
            container = this.creep.room.find<StructureContainer>(FIND_STRUCTURES, {
                filter: s =>
                    s.structureType === STRUCTURE_CONTAINER &&
                    s.pos.isEqualTo(parkingspot)
            })[0] as StructureContainer | null;
            if (container) this.creep.memory.containerId = container.id;
        } else {
            container = Game.getObjectById(this.creep.memory.containerId) as StructureContainer | null;
        }

        // Only search for link every 10 ticks
        if (!this.creep.memory.linkId || !Game.getObjectById(this.creep.memory.linkId) || Game.time % 50 === 0) {
            let x = this.creep.memory.parkingSpot!.x;
            let y = this.creep.memory.parkingSpot!.y;
            link = this.creep.room.find<StructureLink>(FIND_STRUCTURES, {
                filter: s =>
                    s.structureType === STRUCTURE_LINK &&
                    s.pos.getRangeTo(x, y) < 3
            })[0] as StructureLink | null;
            if (link) this.creep.memory.linkId = link.id;
        } else {
            link = Game.getObjectById(this.creep.memory.linkId) as StructureLink | null;
        }

        // Step 3: Build container if needed (only remote or no link)
        if (
            (!link && this.targetroom.controller && this.targetroom.controller.level > 2) ||
            (RoomHelper.getRoomConfig(this.targetroom)?.type === "remote")
        ) {
            if (!container) {
                // Look for construction site at parking
                const constructionSites = this.creep.memory.parkingSpot!.lookFor(LOOK_CONSTRUCTION_SITES);
                if (constructionSites.length > 0) {
                    this.creep.harvest(this.source);
                    if (this.creep.store[RESOURCE_ENERGY] > 0) {
                        this.creep.build(constructionSites[0]);
                        this.creep.say('🔨');
                    }
                    return;
                } else {
                    // Try to create container (only once every 50 ticks)
                    if (Game.time % 50 === 0) {
                        const result = this.targetroom.createConstructionSite(
                            this.creep.memory.parkingSpot!.x,
                            this.creep.memory.parkingSpot!.y,
                            STRUCTURE_CONTAINER
                        );
                        if (result === OK) {
                            console.log(`${this.name}: Planning Container`);
                        }
                    }
                }
            }
        }

        // Step 4: Harvest logic
        const harvestResult = this.creep.harvest(this.source);

        // Step 5: If harvest is not possible, get energy from container, ground, etc.
        if (harvestResult === ERR_NOT_ENOUGH_RESOURCES) {
            // Withdraw from container if available
            if (container && container.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                this.creep.withdraw(container, RESOURCE_ENERGY);
            } else {
                // Pickup dropped energy (only search if not done recently)
                if (!this.creep.memory.lastContainerCheck || Game.time > this.creep.memory.lastContainerCheck + 5) {
                    const dropped = this.creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
                        filter: r => r.resourceType === RESOURCE_ENERGY
                    });
                    if (dropped.length > 0) {
                        this.creep.pickup(dropped[0]);
                    }
                    this.creep.memory.lastContainerCheck = Game.time;
                }
            }

            // Optionally repair container if damaged (only every 50 ticks)
            if (
                container &&
                container.hits < container.hitsMax * 0.95 &&
                Game.time % 50 === 0
            ) {
                this.creep.say('🛠️');
                this.creep.repair(container);
                return;
            }
        }

        // Step 6: Transfer energy to link/container (use cached IDs and only do if not full)
        if (link) {
            if (link.store.getFreeCapacity(RESOURCE_ENERGY) > 10) {
                this.creep.transfer(link, RESOURCE_ENERGY);
            }
        } else if (container) {
            if (container.store.getFreeCapacity(RESOURCE_ENERGY) > 10) {
                this.creep.transfer(container, RESOURCE_ENERGY);
            } else {
                // Optionally repair container if damaged (only every 50 ticks)
                if (
                    container.hits < container.hitsMax * 0.95 &&
                    Game.time % 50 === 0
                ) {
                    this.creep.say('🛠️');
                    this.creep.repair(container);
                    return;
                }
            }
        } else {
            // No container or link, drop energy
            this.creep.drop(RESOURCE_ENERGY);
        }
    }
}
