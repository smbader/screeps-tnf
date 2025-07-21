import internal from "stream";

type SupplyStructure = StructureExtension | StructureSpawn | StructureTower | StructureLab;

export var MapHelper = {

    getOpenSpacesInRangeOfStructure: function(place: {pos: RoomPosition}, range:number): RoomPosition[] {
        return this.getOpenSpacesInRange(place.pos, range);
    },
    getOpenSpacesInRange: function(pos: RoomPosition, range:number): RoomPosition[] {
        let openRoomPositions: RoomPosition[] = [];

        for(let x:number = (0 - range); x <= range; x++) {

            let evalX = (pos.x + x);
            if (evalX <= 0 || evalX >= 49) { continue; }

            for (let y:number = (0 - range); y <= range; y++) {

                let evalY = (pos.y + y);
                if (evalY <= 0 || evalY >= 49) { continue; }

                let position = new RoomPosition(evalX, evalY, pos.roomName);
                let terrain = position.lookFor(LOOK_TERRAIN)[0];
                if (terrain == "wall") { continue; }
                if (position.lookFor(LOOK_STRUCTURES).length > 0) { continue };

                openRoomPositions.push(position);
            }
        }

        return openRoomPositions;
    },

    loadWorld: function () {

        for (var roomid in Game.rooms) {
            let room = Game.rooms[roomid];

            if (!room) {
                continue;
            }

            // Check for memory and last cache time
            if (room.memory) {
                if (room.memory.cacheTime + 100 > Game.time) {
                    // Cache still valid
                    //continue;
                }
            }
            if (room.controller) {
                room.memory.owner = room.controller?.owner?.username ? room.controller?.owner?.username : '';

                let sources = room.find(FIND_SOURCES);
                for (let source of sources) {
                    if (!room.memory.sources) {
                        room.memory.sources = {};
                    }

                    if (!room.memory.sources[source.id]) {
                        room.memory.sources[source.id] = {
                            x: source.pos.x,
                            y: source.pos.y,
                            container: {
                                x: -1,
                                y: -1,
                                id: '',
                            },
                        };
                    }

                    if (room.memory.sources[source.id].container.x == -1) {
                        let parkingSpots = MapHelper.getOpenSpacesInRangeOfStructure(source, 1);
                        let bestSpot = source.pos;
                        let pickupSpots = 0;

                        for (let parkingSpot of parkingSpots) {
                            let cPickupSpots = MapHelper.getOpenSpacesInRange(parkingSpot, 1).length;
                            if (cPickupSpots > pickupSpots) {
                                pickupSpots = cPickupSpots;
                                bestSpot = parkingSpot;
                            }
                        }
                        room.memory.sources[source.id].container.x = bestSpot.x;
                        room.memory.sources[source.id].container.y = bestSpot.y;
                    }
                    var targets = room.find<StructureContainer>(FIND_STRUCTURES, {
                        filter: (structure) => {
                            return structure.pos.x === room.memory.sources[source.id].container.x &&
                                   structure.pos.y === room.memory.sources[source.id].container.y &&
                                   structure.structureType == STRUCTURE_CONTAINER;
                        }
                    });
                    if (targets?.length > 0) {
                        room.memory.sources[source.id].container.id = targets[0].id;
                    }

                }
            }
        }
    },

    getClosestEmpty: function(creep:Creep): any {

        let target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: function(object:SupplyStructure) {
                return (
                    (object.structureType == STRUCTURE_TOWER || object.structureType == STRUCTURE_EXTENSION || object.structureType == STRUCTURE_SPAWN) &&
                    (object.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
                );
            }
        });

        return target;
    }
}
