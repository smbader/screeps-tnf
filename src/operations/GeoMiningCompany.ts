import { Operation } from "../classes/operation";
import { Geologist } from "../operator/Geologist";
import { RoomHelper } from "../utils/RoomHelper";

export class GeoMiningCompany extends Operation {
    public operationOperators: Geologist[];

    public constructor() {
        super();
        this.operationOperators = [];
    }

    public init() {
        // Only consider owned, eligible rooms with spawns and sufficient controller level
        const myRooms = Object.values(Game.rooms).filter(room =>
            room.controller?.owner?.username === "ricane" &&
            (!room.memory.config.shard || room.memory.config.shard === Game.shard.name) &&
            room.controller.level >= 7 &&
            room.find(FIND_MY_SPAWNS).length > 0
        );

        for (const room of myRooms) {
            const name = "Geo_" + room.name;
            if (!this.operationOperators.find(op => op.name === name)) {
                this.operationOperators.push(new Geologist(name, room));
            }
        }
    }

    public roleCall() {
        for (const operator of this.operationOperators) {
            if (!(operator instanceof Geologist)) continue;
            const creep = Game.creeps[operator.name];
            if (creep) continue; // Already alive

            const room = operator.room;
            if (!(room.memory.nextTrade && (room.memory.nextTrade - 30) < Game.time)) continue;

            const mineral = room.find(FIND_MINERALS)[0];
            if (!mineral) continue;
            if (mineral.mineralAmount === 0 && mineral.ticksToRegeneration && mineral.ticksToRegeneration > 0) continue;
            // Only spawn if the room has less than 100k of this resource.
            const resourceType = mineral.mineralType;
            const storedAmount =
                (room.storage?.store?.[resourceType] || 0) +
                (room.terminal?.store?.[resourceType] || 0);
            if (storedAmount >= 100000) continue;

            // Ensure extractor exists
            const hasExtractor = mineral.pos.lookFor(LOOK_STRUCTURES)
                .some(s => s.structureType === STRUCTURE_EXTRACTOR);
            if (!hasExtractor) {
                mineral.pos.createConstructionSite(STRUCTURE_EXTRACTOR);
                continue;
            }

            // Find a spawn and direction
            const spawns = room.find(FIND_MY_SPAWNS);
            if (spawns.length === 0) continue;

            const spawn = spawns[0];
            let spawnDirection = [TOP, TOP_LEFT, LEFT, BOTTOM_LEFT, BOTTOM, BOTTOM_RIGHT, RIGHT, TOP_RIGHT];
            const cfg = RoomHelper.getRoomConfig(room);
            for (const spawnconfig of (cfg && cfg.spawns) || []) {
                if (spawnconfig.x === spawn.pos.x && spawnconfig.y === spawn.pos.y) {
                    if (spawnconfig.direction) spawnDirection = [spawnconfig.direction];
                    break;
                }
            }

            // Calculate number of WORK parts
            const workParts = Math.min(10, Math.max(1, Math.floor((room.energyCapacityAvailable - 200) / 200)));
            const body: BodyPartConstant[] = [];
            for (let i = 0; i < workParts; i++) {
                body.push(WORK, CARRY, MOVE);
            }
            spawn.spawnCreep(body, operator.name, { directions: spawnDirection });
        }
    }

    public actions() {
        // Run actions for all operators
        for (const operator of this.operationOperators) {
            operator.actions();
        }
    }
}
