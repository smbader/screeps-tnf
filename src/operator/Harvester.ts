import { Operator } from "../classes/operator";
import { MapHelper } from "../utils/MapHelper";

// An operator is a screep who performs an operation.
export class Harvester extends Operator {

    memory: {
        sourceid?: any,
        roomname?: string,
        name?: string,
        parkingSpot?: RoomPosition;
        targetroom: string;
    }

    creep: Creep;
    source: Source;
    targetroom: Room;

    constructor (name:string, room:Room, sourceid:any, targetRoom:Room) {
        super(name, room);

        this.memory = {
            targetroom: targetRoom.name,
        };
        this.memory.name = name;
        this.memory.sourceid = sourceid;
        this.memory.roomname = room.name;

        this.source = Game.getObjectById(sourceid) as Source;
        this.memory.parkingSpot = new RoomPosition(targetRoom.memory.sources[sourceid].container.x, targetRoom.memory.sources[sourceid].container.y, targetRoom.name);

        this.creep = Game.creeps[this.name];
        this.room = room;
        this.targetroom = targetRoom;
    }

    actions() {

        // Creep may not exist yet.
        if (!this.creep) { return; }
        if (!this.memory.parkingSpot) { return; }

        let containerFull = false;

        // If not in parking spot, go to parking spot.  Do no other actions.
        if (this.creep.pos.x != this.memory.parkingSpot.x || this.creep.pos.y != this.memory.parkingSpot.y) {
            this.creep.travelTo(this.memory.parkingSpot);
            return;
        }

        // Find links that are close.
        let links = this.creep.room.find<StructureLink>(FIND_STRUCTURES, {
            filter: (structure) => {
                return structure.pos.getRangeTo(this.creep) < 3
                    && structure.structureType == STRUCTURE_LINK;
            }});

        let container:StructureContainer | null = null;

        // If there aren't links and we need a container, see if we have one.
        if ((links.length == 0 && this.targetroom.controller && this.targetroom.controller?.level > 2) || (this.targetroom.memory.config.type == "remote")) {

            // Look for parking spot container.
            container = this.memory.parkingSpot.findClosestByRange<StructureContainer>(FIND_STRUCTURES, {
                filter: structure => structure.structureType == STRUCTURE_CONTAINER
                    && structure.pos.x == this.memory.parkingSpot?.x
                    && structure.pos.y == this.memory.parkingSpot?.y
            });

            if (!container) {
                // Look for construction site.
                let constructionSite = this.memory.parkingSpot.lookFor(LOOK_CONSTRUCTION_SITES);

                if (constructionSite.length > 0) {
                    this.creep.harvest(this.source);
                    this.creep.build(constructionSite[0]);
                    this.creep.say('🔨');
                    // We're working on a container. Stop working here.
                    return;
                } else {
                    if (this.targetroom.createConstructionSite(this.memory.parkingSpot.x, this.memory.parkingSpot.y, STRUCTURE_CONTAINER) == OK) {
                        console.log(`    ` + this.name + `: Planning Container`);
                    } else {
                        console.log(`    ` + this.name + `: Can not construct container`);
                    }
                }
            }
        }

        let result = this.creep.harvest(this.source);
        if (result == ERR_NOT_ENOUGH_RESOURCES && links.length > 0) {

            // Look for parking spot container.
            container = this.memory.parkingSpot.findClosestByRange<StructureContainer>(FIND_STRUCTURES, {
                filter: structure => structure.structureType == STRUCTURE_CONTAINER
                    && structure.pos.x == this.memory.parkingSpot?.x
                    && structure.pos.y == this.memory.parkingSpot?.y
                    && structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0
            });
            if (container) {
                this.creep.withdraw(container, RESOURCE_ENERGY);
            } else {
                // Look on the ground.
                let droppedResources = this.creep.room.find(FIND_DROPPED_RESOURCES, {
                    filter: (resource) => {
                        return resource.resourceType === RESOURCE_ENERGY && this.creep.pos.inRangeTo(resource.pos, 1);
                    }
                });
                this.creep.pickup(droppedResources[0]);
            }

            // Look for parking spot container.
            container = this.memory.parkingSpot.findClosestByRange<StructureContainer>(FIND_STRUCTURES, {
                filter: structure => structure.structureType == STRUCTURE_CONTAINER
                    && structure.pos.x == this.memory.parkingSpot?.x
                    && structure.pos.y == this.memory.parkingSpot?.y
            });

            if (container && container.hits < container.hitsMax * 0.95) {
                this.creep.say('🛠️');
                this.creep.repair(container);
                return;
            }
        }

        if (links.length > 0) {
            let link = links[0];
            let linkFull = (link.store.getFreeCapacity(RESOURCE_ENERGY) < 10);

            if (linkFull) {

            } else {
                this.creep.transfer(link, RESOURCE_ENERGY);
            }

        } else {
            let containerFull = (container && container.store.getFreeCapacity(RESOURCE_ENERGY) < 10)

            if (container &&
                ((containerFull && container.hits < container.hitsMax * 0.95) ||
                    (!containerFull && container.hits < container.hitsMax * 0.05))
            ) {
                this.creep.say('🛠️');
                this.creep.repair(container);
            } else {
                this.creep.drop(RESOURCE_ENERGY);
            }
        }

    }

}
