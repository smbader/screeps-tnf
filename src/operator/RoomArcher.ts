import { extend } from "lodash";
import { Operator } from "../classes/operator";
import {MapHelper} from "../utils/MapHelper";

interface RoomArcherMemory extends CreepMemory {
    targetRoom: string;
    target?: Id<any> | null;
    waypoint: number | undefined;
}

export class RoomArcherCreep extends Creep {
    memory!: RoomArcherMemory;

    constructor(creepid: any, targetRoom: string) {
        super(creepid);

        const baseMemory: CreepMemory = super.memory;
        this.memory.room = baseMemory.room;
        this.memory.targetRoom = targetRoom;
    }
}

// An operator is a screep who performs an operation.
export class RoomArcher extends Operator {
    creep: RoomArcherCreep | null;
    targetroom: string;
    waypoints?: any[];
    body?: BodyPartConstant[];

    constructor(name: string, room: Room, targetRoom: string, waypoints: string[], body?: BodyPartConstant[]) {
        super(name, room);

        if (Game.creeps[this.name]) {
            this.creep = new RoomArcherCreep(Game.creeps[this.name].id, targetRoom);
        } else {
            this.creep = null;
        }
        this.room = room;
        this.targetroom = targetRoom;
        this.waypoints = waypoints;
        this.body = body;
    }

    actions() {

        // Creep may not exist yet.
        if (!this.creep) {
            return;
        }
        // First objective is to complete waypoints
        if (this.creep.memory.waypoint == undefined || this.creep.memory.waypoint == null) {
            this.creep.memory.waypoint = 0;
        }
        if (this.creep.hits < this.creep.hits) {
            this.creep.heal(this.creep);
        } else {
        // Find the nearest creep that has less than full health
            const damagedCreep = this.creep.pos.findClosestByRange(FIND_MY_CREEPS, {
                filter: (c) => c.hits < c.hitsMax
            });
            if (damagedCreep) {
                this.creep.heal(damagedCreep);
            }
        }


        if (this.creep.memory.waypoint == null)  { this.creep.memory.waypoint = 0; }
        if (this.waypoints != undefined) {
            if (this.waypoints[this.creep.memory.waypoint]) {
                let currentWayPoint = this.waypoints[this.creep.memory.waypoint];
                let wayPointPos = new RoomPosition(currentWayPoint.x, currentWayPoint.y, currentWayPoint.room);
                if ('shard' + currentWayPoint.shard !== Game.shard.name){
                    this.creep.memory.waypoint += 1;
                } else if (this.creep.pos.getRangeTo(wayPointPos) == 0) {
                    this.creep.memory.waypoint += 1;
                } else {
                    this.creep.travelTo(wayPointPos);
                }
                return;
            }
        }

        if (this.creep.memory.targetRoom !== this.creep.room.name) {
            let roomPos = new RoomPosition(25, 25, this.creep.memory.targetRoom)
            if (this.creep.pos.getRangeTo(roomPos) > 20) {
                this.creep.travelTo(roomPos);
            }
            return;
        }


        let target = this.findPriorityTarget(this.creep);

        this.handleKiting(this.creep);

        if (!target) {

            let structure = this.findClosestStructureUnderFlag(this.creep);
            if (!structure) {
                structure = this.getPrioritizedHostileStructures(this.creep.room);
            }
            if (!structure) {
                this.creep.say("👀 No target");
                // Move to within 10 range of nearest tower
                const towers = this.creep.room.find(FIND_STRUCTURES, {
                    filter: s => s.structureType === STRUCTURE_TOWER
                }) as StructureTower[];

                if (towers.length > 0) {
                    const closestTower = this.creep.pos.findClosestByRange(towers);
                    if (closestTower && this.creep.pos.getRangeTo(closestTower) > 10) {
                        this.creep.travelTo(closestTower.pos);
                        return;
                    }
                }
                return;
            } else {
                this.attackStructureWithRanged(this.creep, structure);
                return;
            }
        }


        // Attack logic (mass or single)
        this.attackWithRanged(this.creep, target);

    }

    getPrioritizedHostileStructures(room: Room): Structure | null {

        const priorities: StructureConstant[] = [
            STRUCTURE_TOWER,
            STRUCTURE_SPAWN,
            STRUCTURE_STORAGE,
            STRUCTURE_TERMINAL,
            STRUCTURE_EXTENSION,
            STRUCTURE_NUKER,
            STRUCTURE_LAB,
            STRUCTURE_LINK,
            STRUCTURE_OBSERVER,
            STRUCTURE_POWER_SPAWN,
            STRUCTURE_FACTORY,
            STRUCTURE_RAMPART,  // Only if not owned or public
            STRUCTURE_WALL,
            STRUCTURE_EXTRACTOR,
            STRUCTURE_ROAD
        ];

        const hostileStructures = room.find(FIND_STRUCTURES, {
            filter: s =>
                (!s.structureType || s.structureType !== STRUCTURE_CONTROLLER) &&
                !(s.structureType === STRUCTURE_RAMPART && !s.isPublic && !s.my) &&
                !(s.structureType == STRUCTURE_WALL || s.structureType == STRUCTURE_CONTAINER
                    || s.structureType == STRUCTURE_PORTAL || s.structureType == STRUCTURE_ROAD) &&
                !(s.my)

        });

        // Sort by defined priority list
        hostileStructures.sort((a, b) => {
            const ap = priorities.indexOf(a.structureType);
            const bp = priorities.indexOf(b.structureType);
            return (ap === -1 ? Infinity : ap) - (bp === -1 ? Infinity : bp);
        });

        if (hostileStructures.length > 0) {
            return hostileStructures[0];
        } else {
            return null;
        }

    }

    findClosestStructureUnderFlag(creep: Creep): Structure | null {
        // Get all flags in the creep's room
        const flags = Object.values(Game.flags).filter(flag => flag.room?.name === creep.room.name);

        // Gather all structures under flags
        const flaggedStructures: Structure[] = [];
        for (const flag of flags) {
            const structures = flag.pos.lookFor(LOOK_STRUCTURES);
            if (structures.length > 0) {
                flaggedStructures.push(...structures);
            }
        }

        // Return the closest structure, or null if none
        if (flaggedStructures.length === 0) return null;
        return creep.pos.findClosestByPath(flaggedStructures) || null;
    }

    findPriorityTarget(creep: Creep): Creep | null {
        const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);

        if (hostiles.length === 0) return null;

        // Prioritize targets: Healers > Damaged > Others

        const claimer = hostiles.filter(h => h.getActiveBodyparts(CLAIM) > 0);
        if (claimer.length > 0) {
            return creep.pos.findClosestByPath(claimer) || null;
        }

        //const damaged = hostiles.filter(h => h.hits < h.hitsMax);
        //if (damaged.length > 0) {
        //    return creep.pos.findClosestByPath(damaged) || null;
        //}

        //const healers = hostiles.filter(h => h.getActiveBodyparts(HEAL) > 0);
        //if (healers.length > 0) {
        //    return creep.pos.findClosestByPath(healers) || null;
        //}

        return creep.pos.findClosestByPath(hostiles) || null;
    }

    handleKiting(creep: Creep): void {
        let target: Creep | null = null;
        const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length === 0) return;

        // Consider all enemies so archers will kite away from any hostile in the room
        const closestHostile = creep.pos.findClosestByRange(hostiles);
        if (!closestHostile) return;
        target = closestHostile;
        const range = creep.pos.getRangeTo(target);

        console.log(`Range to nearest hostile: ${range}, Hits: ${creep.hits}/${creep.hitsMax}`);

        // If enemy is too close (melee range) or creep is significantly damaged -> flee
        if (range <= 3 || (creep.hitsMax - creep.hits) > 20) {
            // Use all hostiles as goals so PathFinder flees from the group, not a single target
            //const goals = hostiles.map(h => ({ pos: h.pos, range: 4 }));
            let goal:RoomPosition = new RoomPosition(25, 25, creep.room.name);
            let tower = creep.pos.findClosestByRange(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_TOWER
            }) as StructureTower;
            if (tower) {
                goal = tower.pos;
            }

            const goals = [{ pos: goal, range: 4 }];
/*
            const fleePath = PathFinder.search(
                creep.pos,
                goals,
                {
                    flee: true,
                    maxRooms: 1,
                    roomCallback: (roomName: string) => {
                        const room = Game.rooms[roomName];
                        if (!room) return false;

                        const costs = new PathFinder.CostMatrix();

                        // Treat non-walkable structures as walls
                        room.find(FIND_STRUCTURES).forEach(struct => {
                            if (
                                struct.structureType !== STRUCTURE_ROAD &&
                                struct.structureType !== STRUCTURE_CONTAINER &&
                                (struct.structureType !== STRUCTURE_RAMPART || !struct.my)
                            ) {
                                costs.set(struct.pos.x, struct.pos.y, 255);
                            }
                        });

                        // Avoid other creeps
                        room.find(FIND_CREEPS).forEach(c => {
                            if (c.id !== creep.id) {
                                costs.set(c.pos.x, c.pos.y, 255);
                            }
                        });

                        // Penalize room edges to prevent leaving the room
                        for (let x = 0; x < 50; x++) {
                            costs.set(x, 0, 255);
                            costs.set(x, 49, 255);
                        }
                        for (let y = 0; y < 50; y++) {
                            costs.set(0, y, 255);
                            costs.set(49, y, 255);
                        }

                        return costs;
                    }
                }
            );

 */
            const fleePath = PathFinder.search(
                creep.pos,
                goals,
                {
                    // Path to the tower (don't use flee:true — goal is the tower)
                    maxRooms: 1,
                    roomCallback: (roomName: string) => {
                        const room = Game.rooms[roomName];
                        if (!room) return false;

                        const costs = new PathFinder.CostMatrix();

                        // Treat non-walkable structures as walls
                        room.find(FIND_STRUCTURES).forEach(struct => {
                            if (
                                struct.structureType !== STRUCTURE_ROAD &&
                                struct.structureType !== STRUCTURE_CONTAINER &&
                                (struct.structureType !== STRUCTURE_RAMPART || !struct.my)
                            ) {
                                costs.set(struct.pos.x, struct.pos.y, 255);
                            }
                        });

                        // Avoid other creeps
                        room.find(FIND_CREEPS).forEach(c => {
                            if (c.id !== creep.id) {
                                costs.set(c.pos.x, c.pos.y, 255);
                            }
                        });

                        // Penalize tiles near hostiles so the path prefers routes away from enemies
                        hostiles.forEach(h => {
                            for (let dx = -3; dx <= 3; dx++) {
                                for (let dy = -3; dy <= 3; dy++) {
                                    const x = h.pos.x + dx;
                                    const y = h.pos.y + dy;
                                    if (x >= 0 && x < 50 && y >= 0 && y < 50) {
                                        costs.set(x, y, 254);
                                    }
                                }
                            }
                        });

                        // Penalize room edges to prevent leaving the room
                        for (let x = 0; x < 50; x++) {
                            costs.set(x, 0, 255);
                            costs.set(x, 49, 255);
                        }
                        for (let y = 0; y < 50; y++) {
                            costs.set(0, y, 255);
                            costs.set(49, y, 255);
                        }

                        return costs;
                    }
                }
            );

            console.log(`${creep.name} Flee path length: ${fleePath.path.length}, Cost: ${fleePath.cost}`);
            if (fleePath.path.length > 0) {
                // Prefer steps that also move toward a tower (if present) while increasing distance from hostiles.
                const towers = creep.room.find(FIND_STRUCTURES, {
                    filter: s => s.structureType === STRUCTURE_TOWER
                }) as StructureTower[];

                let chosenStep = fleePath.path[0];

                if (towers.length > 0) {
                    const currentTowerDist = Math.min(...towers.map(t => creep.pos.getRangeTo(t.pos)));
                    const currentHostileDist = Math.min(...hostiles.map(h => creep.pos.getRangeTo(h.pos)));

                    const lookAhead = Math.min(4, fleePath.path.length);
                    for (let i = 0; i < lookAhead; i++) {
                        const step = fleePath.path[i];
                        const stepPos = new RoomPosition(step.x, step.y, step.roomName);
                        const stepTowerDist = Math.min(...towers.map(t => stepPos.getRangeTo(t.pos)));
                        const stepHostileDist = Math.min(...hostiles.map(h => stepPos.getRangeTo(h.pos)));

                        // prefer steps that don't reduce distance to hostiles and that get closer to a tower
                        if (stepHostileDist >= currentHostileDist && stepTowerDist <= currentTowerDist) {
                            chosenStep = step;
                            break;
                        }
                    }
                }

                creep.move(creep.pos.getDirectionTo(new RoomPosition(chosenStep.x, chosenStep.y, chosenStep.roomName)));
                creep.say("🚪 Kite");
            }
        }
        // If out of range to shoot, move closer to nearest hostile (maintain engagement range)
        else if (range >= 4) {
            // If the target is in the first 3 squares of the room, don't chase
            let rand = Math.floor(Math.random() * 6);
            if (target.pos.x <= rand || target.pos.x >= (50 - rand) || target.pos.y <= rand || target.pos.y >= (50 - rand)) {
                creep.say("👀 At edge");
                return;
            }
            creep.moveTo(target, {
                visualizePathStyle: { stroke: "#ffaa00" },
                reusePath: 3,
                maxRooms: 1
            });
            creep.say("➡️ Close in");
        }
        // Otherwise (range 2–3): hold position
    }

    attackWithRanged(creep: Creep, target: Creep): void {
        const enemiesInRange = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3);

        if (creep.pos.getRangeTo(target) <= 3) {
            const result = creep.rangedAttack(target);
            if (result === OK) {
                creep.say("🎯 Shoot");
            }
        }
    }

    attackStructureWithRanged(creep: Creep, target: Structure): void {

        if (creep.pos.getRangeTo(target) <= 3) {
            const result = creep.rangedAttack(target);
            if (result === OK) {
                creep.say("🎯 Shoot");
            } else {
                creep.say(result + '');
            }
        } else {
            creep.say("➡️ Close in");
            creep.travelTo(target.pos);
        }
    }


}
