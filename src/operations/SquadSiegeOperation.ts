import { Operation } from "../classes/operation";

const SQUAD_NAMES = ["alpha", "bravo", "charlie", "delta", "echo"];
const SQUAD_ROLES: ("healer" | "ranged" | "melee")[] = ["melee", "healer", "healer"];
const BODY_CONFIG: Record<string, BodyPartConstant[]> = {
    healer: [...Array(2).fill(TOUGH), ...Array(24).fill(MOVE), ...Array(22).fill(HEAL)],
    ranged: [...Array(2).fill(TOUGH), ...Array(24).fill(MOVE), ...Array(12).fill(RANGED_ATTACK), ...Array(10).fill(HEAL)],
    melee: [...Array(2).fill(TOUGH), ...Array(24).fill(MOVE), ...Array(12).fill(ATTACK), ...Array(10).fill(HEAL)]
};
const SAFE_TOWER_RANGE = 22;
const SAFE_ENEMY_RANGE = 1;
const BOOSTS: Record<BodyPartConstant, ResourceConstant[]> = {
    [TOUGH]: [RESOURCE_GHODIUM_OXIDE, RESOURCE_GHODIUM_ALKALIDE, RESOURCE_CATALYZED_GHODIUM_ALKALIDE], // GO, GHO2, XGHO2
    [MOVE]: [RESOURCE_ZYNTHIUM_OXIDE, RESOURCE_ZYNTHIUM_ALKALIDE, RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE], // ZO, ZHO2, XZHO2
    [HEAL]: [RESOURCE_LEMERGIUM_OXIDE, RESOURCE_LEMERGIUM_ALKALIDE, RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE], // LO, LHO2, XLHO2
    [RANGED_ATTACK]: [RESOURCE_KEANIUM_OXIDE, RESOURCE_KEANIUM_ALKALIDE, RESOURCE_CATALYZED_KEANIUM_ALKALIDE], // KO, KHO2, XKHO2
    [ATTACK]: [RESOURCE_UTRIUM_HYDRIDE, RESOURCE_UTRIUM_ACID, RESOURCE_CATALYZED_UTRIUM_ACID], // UH, UH2O, XUH2O
    [WORK]: [],
    [CARRY]: [],
    [CLAIM]: []
};

interface SquadMemory {
    activeSquadIndex: number;
    squadAssembled: boolean;
    waypointIndex: number;
    wallTarget?: string;
    towersDepleted?: boolean;
    retreating?: boolean;
    retreatPos?: { x: number; y: number; roomName: string };
    lastSpawnTick?: number;
}

interface Waypoint {
    x: number;
    y: number;
    room: string;
}

export class SquadSiegeOperation extends Operation {
    private readonly squadSize: number;
    private stagingPos: RoomPosition | null = null;
    private wallTarget: Structure | null = null;
    private breached: boolean = false;
    private lastLogTick: number | null = null;
    private readonly logFrequency: number = 10;

    constructor(
        private readonly targetRoom: string,
        private readonly sourceRoom: string,
        private readonly waypoints: Waypoint[]
    ) {
        super();
        this.squadSize = SQUAD_ROLES.length;
    }

    private get squadMemory(): SquadMemory {
        if (!Memory.squadSiege) {
            Memory.squadSiege = {
                activeSquadIndex: 0,
                squadAssembled: false,
                waypointIndex: 0,
                towersDepleted: false,
                retreating: false
            };
        }
        return Memory.squadSiege;
    }

    private get activeSquadId(): string {
        return SQUAD_NAMES[this.squadMemory.activeSquadIndex % SQUAD_NAMES.length];
    }

    private getSquadCreepNames(): string[] {
        return SQUAD_ROLES.map((role, i) =>
            `Siege${role.charAt(0).toUpperCase() + role.slice(1)}_${this.targetRoom}_${this.activeSquadId}_${i}`
        );
    }

    private getLivingSquadCreeps(): Creep[] {
        return this.getSquadCreepNames()
            .map(name => Game.creeps[name])
            .filter((c): c is Creep => !!c);
    }

    private getMissingCreeps(): number[] {
        const room = Game.rooms[this.sourceRoom];
        if (!room) return [];
        const spawns = room.find(FIND_MY_SPAWNS);
        return this.getSquadCreepNames()
            .map((name, i) => {
                const alive = Game.creeps[name];
                const spawning = spawns.some(s => s.spawning?.name === name);
                return (!alive && !spawning) ? i : -1;
            })
            .filter(i => i !== -1);
    }

    private logStatus(msg: string): void {
        if (this.lastLogTick === null || Game.time - this.lastLogTick >= this.logFrequency) {
            console.log(`[SquadSiege:${this.activeSquadId}] ${msg}`);
            this.lastLogTick = Game.time;
        }
    }

    private visualizeCreep(creep: Creep, text: string, color = "yellow", stroke = "black"): void {
        new RoomVisual(creep.room.name).text(
            text,
            creep.pos.x,
            creep.pos.y - 1.2,
            { color, stroke, font: 0.7 }
        );
    }

    private visualizeTarget(target: RoomPosition | RoomObject, color = "red", label = "TARGET"): void {
        const pos = target instanceof RoomPosition ? target : target.pos;
        if (Game.rooms[pos.roomName]) {
            new RoomVisual(pos.roomName).circle(pos, { radius: 0.7, fill: "transparent", stroke: color });
            new RoomVisual(pos.roomName).text(label, pos.x, pos.y + 0.5, { color, font: 0.7 });
        }
    }

    private allAtRally(): boolean {
        if (!this.waypoints.length) return false;
        const rally = new RoomPosition(this.waypoints[0].x, this.waypoints[0].y, this.waypoints[0].room);
        const creeps = this.getLivingSquadCreeps();
        return creeps.length === this.squadSize && creeps.every(c => c.pos.getRangeTo(rally) <= 3);
    }

    private allSquadDead(): boolean {
        const room = Game.rooms[this.sourceRoom];
        if (!room) return false;
        const names = this.getSquadCreepNames();
        return !names.some(n => Game.creeps[n]) &&
            !room.find(FIND_MY_SPAWNS).some(s => s.spawning && names.includes(s.spawning.name));
    }

    private setBoostsInRoomMemory(): void {
        const room = Game.rooms[this.sourceRoom];
        if (!room || !room.memory.data) return;

        const boosts: ResourceConstant[] = [];
        for (const role of SQUAD_ROLES) {
            const body = BODY_CONFIG[role];
            for (const part of body) {
                if (BOOSTS[part]) {
                    boosts.push(...BOOSTS[part]);
                }
            }
        }

        const uniqueBoosts = Array.from(new Set(boosts)).sort((a, b) => {
            const tierA = a.includes("X") ? 3 : a.includes("O") || a.includes("H") ? 2 : 1;
            const tierB = b.includes("X") ? 3 : b.includes("O") || b.includes("H") ? 2 : 1;
            return tierB - tierA;
        });

        const labs = room.find(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LAB
        }) as StructureLab[];

        if (!labs.length) {
            this.logStatus("No labs available in source room for boosts.");
            return;
        }

        const boostAssignments: { id: Id<StructureLab>; component: ResourceConstant }[] = [];
        for (let i = 0; i < Math.min(uniqueBoosts.length, labs.length); i++) {
            boostAssignments.push({
                id: labs[i].id,
                component: uniqueBoosts[i]
            });
        }

        room.memory.data.labs = room.memory.data.labs || {};
        room.memory.data.labs.boosts = boostAssignments;
        this.logStatus(`Set Room.memory.data.labs.boosts to [${boostAssignments.map(b => `${b.component} in lab ${b.id}`).join(", ")}]`);
    }

    private clearBoostsFromRoomMemory(): void {
        const room = Game.rooms[this.sourceRoom];
        if (!room || !room.memory.data || !room.memory.data.labs) return;
        room.memory.data.labs.boosts = [];
        this.logStatus("Cleared Room.memory.data.labs.boosts");
    }

    private findBestBreachWall(room: Room, fromPos: RoomPosition): Structure | null {
        const spawns = room.find(FIND_HOSTILE_SPAWNS);
        if (!spawns.length) return null;

        let bestTarget: Structure | null = null;
        let minHits = Infinity;

        for (const spawn of spawns) {
            const path = PathFinder.search(
                fromPos,
                { pos: spawn.pos, range: 1 },
                {
                    roomCallback: () => new PathFinder.CostMatrix(),
                    maxOps: 4000,
                    maxRooms: 1,
                    heuristicWeight: 1.2
                }
            );

            const blockers = path.path
                .map(pos => room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y))
                .reduce((acc, structs) => acc.concat(structs), [])
                .filter(s => s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART);

            for (const block of blockers) {
                if (block.hits < minHits) {
                    minHits = block.hits;
                    bestTarget = block;
                }
            }
        }

        if (bestTarget) {
            this.logStatus(`Selected breach wall/rampart at (${bestTarget.pos.x},${bestTarget.pos.y}) hits: ${bestTarget.hits}`);
            this.visualizeTarget(bestTarget, "orange", "BREACH");
        }
        return bestTarget;
    }

    private areTowersDepleted(): boolean {
        const targetRoom = Game.rooms[this.targetRoom];
        if (!targetRoom) return true;
        const towers = targetRoom.find(FIND_HOSTILE_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_TOWER && (s as StructureTower).store[RESOURCE_ENERGY] > 50
        });
        return towers.length === 0;
    }

    private findSafeStagingPos(creeps: Creep[]): RoomPosition | null {
        const targetRoom = Game.rooms[this.targetRoom];
        if (!targetRoom) return null;

        const towers = targetRoom.find(FIND_HOSTILE_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_TOWER && (s as StructureTower).store[RESOURCE_ENERGY] > 50
        });

        if (!towers.length) return null;

        const leader = creeps[0];
        if (!leader) return null;

        const safePos = PathFinder.search(
            leader.pos,
            towers.map(t => ({ pos: t.pos, range: SAFE_TOWER_RANGE })),
            {
                flee: true,
                maxRooms: 1,
                roomCallback: (roomName: string) => {
                    const room = Game.rooms[roomName];
                    if (!room) return false;
                    const costs = new PathFinder.CostMatrix();
                    room.find(FIND_STRUCTURES).forEach(struct => {
                        if (struct.structureType !== STRUCTURE_ROAD && struct.structureType !== STRUCTURE_CONTAINER &&
                            (struct.structureType !== STRUCTURE_RAMPART || !struct.my)) {
                            costs.set(struct.pos.x, struct.pos.y, 255);
                        }
                    });
                    room.find(FIND_CREEPS).forEach(c => {
                        costs.set(c.pos.x, c.pos.y, 255);
                    });
                    return costs;
                }
            }
        ).path[0];

        return safePos ? new RoomPosition(safePos.x, safePos.y, safePos.roomName) : null;
    }

    private findNearestExit(creep: Creep): RoomPosition | null {
        const targetRoom = Game.rooms[this.targetRoom];
        if (!targetRoom || creep.room.name !== this.targetRoom) return null;

        const exitDirs = Game.map.describeExits(this.targetRoom);
        if (!exitDirs) return null;

        const exits: { x: number; y: number; roomName: string }[] = [];
        const directions: ExitKey[] = ["7", "3", "1", "5"];
        for (const dir of directions) {
            const roomName = exitDirs[dir];
            if (roomName) {
                if (dir === "7") exits.push({ x: 0, y: creep.pos.y, roomName });
                if (dir === "3") exits.push({ x: 49, y: creep.pos.y, roomName });
                if (dir === "1") exits.push({ x: creep.pos.x, y: 0, roomName });
                if (dir === "5") exits.push({ x: creep.pos.x, y: 49, roomName });
            }
        }

        if (!exits.length) return null;

        let closestExit: RoomPosition | null = null;
        let minRange = Infinity;

        for (const exit of exits) {
            const pos = new RoomPosition(exit.x, exit.y, this.targetRoom);
            const range = creep.pos.getRangeTo(pos);
            if (range < minRange) {
                minRange = range;
                closestExit = pos;
            }
        }

        if (!closestExit) return null;

        const retreatRoom = exits.find(e => e.x === closestExit!.x && e.y === closestExit!.y && e.roomName !== this.targetRoom)?.roomName;
        if (!retreatRoom) return null;

        const exitDir = creep.room.findExitTo(retreatRoom);
        let retreatX = closestExit.x;
        let retreatY = closestExit.y;
        if (exitDir === FIND_EXIT_LEFT) retreatX = 49;
        else if (exitDir === FIND_EXIT_RIGHT) retreatX = 0;
        else if (exitDir === FIND_EXIT_TOP) retreatY = 49;
        else if (exitDir === FIND_EXIT_BOTTOM) retreatY = 0;

        return new RoomPosition(retreatX, retreatY, retreatRoom);
    }

    private findSafestExitPath(creep: Creep): RoomPosition[] | null {
        const targetRoom = Game.rooms[this.targetRoom];
        if (!targetRoom || creep.room.name !== this.targetRoom) return null;

        const exitDirs = Game.map.describeExits(this.targetRoom);
        if (!exitDirs) return null;

        const exits: RoomPosition[] = [];
        const directions: ExitKey[] = ["7", "3", "1", "5"];
        for (const dir of directions) {
            if (exitDirs[dir]) {
                if (dir === "7") exits.push(new RoomPosition(0, creep.pos.y, this.targetRoom));
                if (dir === "3") exits.push(new RoomPosition(49, creep.pos.y, this.targetRoom));
                if (dir === "1") exits.push(new RoomPosition(creep.pos.x, 0, this.targetRoom));
                if (dir === "5") exits.push(new RoomPosition(creep.pos.x, 49, this.targetRoom));
            }
        }

        if (!exits.length) return null;

        const towers = targetRoom.find(FIND_HOSTILE_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_TOWER && (s as StructureTower).store[RESOURCE_ENERGY] > 0
        }) as StructureTower[];

        const enemies = targetRoom.find(FIND_HOSTILE_CREEPS, {
            filter: c => c.body.some(part => part.type === ATTACK || part.type === RANGED_ATTACK)
        });

        let closestExit: RoomPosition | null = null;
        let minRange = Infinity;

        for (const exit of exits) {
            const range = creep.pos.getRangeTo(exit);
            if (range < minRange) {
                minRange = range;
                closestExit = exit;
            }
        }

        if (!closestExit) return null;

        const path = PathFinder.search(
            creep.pos,
            { pos: closestExit, range: 0 },
            {
                maxRooms: 1,
                roomCallback: (roomName: string) => {
                    if (roomName !== this.targetRoom) return false;
                    const costs = new PathFinder.CostMatrix();

                    targetRoom.find(FIND_STRUCTURES).forEach(struct => {
                        if (struct.structureType !== STRUCTURE_ROAD && struct.structureType !== STRUCTURE_CONTAINER &&
                            (struct.structureType !== STRUCTURE_RAMPART || !struct.my)) {
                            costs.set(struct.pos.x, struct.pos.y, 255);
                        }
                    });

                    targetRoom.find(FIND_CREEPS).forEach(c => {
                        if (c.id !== creep.id) costs.set(c.pos.x, c.pos.y, 255);
                    });

                    towers.forEach(tower => {
                        for (let dx = -SAFE_TOWER_RANGE; dx <= SAFE_TOWER_RANGE; dx++) {
                            for (let dy = -SAFE_TOWER_RANGE; dy <= SAFE_TOWER_RANGE; dy++) {
                                const x = tower.pos.x + dx;
                                const y = tower.pos.y + dy;
                                if (x >= 0 && x < 50 && y >= 0 && y < 50) {
                                    if (Math.abs(dx) <= SAFE_TOWER_RANGE && Math.abs(dy) <= SAFE_TOWER_RANGE) {
                                        costs.set(x, y, 255);
                                    }
                                }
                            }
                        }
                    });

                    enemies.forEach(enemy => {
                        for (let dx = -SAFE_ENEMY_RANGE; dx <= SAFE_ENEMY_RANGE; dx++) {
                            for (let dy = -SAFE_ENEMY_RANGE; dy <= SAFE_ENEMY_RANGE; dy++) {
                                const x = enemy.pos.x + dx;
                                const y = enemy.pos.y + dy;
                                if (x >= 0 && x < 50 && y >= 0 && y < 50) {
                                    if (Math.abs(dx) <= SAFE_ENEMY_RANGE && Math.abs(dy) <= SAFE_ENEMY_RANGE) {
                                        costs.set(x, y, 255);
                                    }
                                }
                            }
                        }
                    });

                    for (let x = 0; x < 50; x++) {
                        for (let y = 0; y < 50; y++) {
                            if (costs.get(x, y) === 255) continue;
                            const pos = new RoomPosition(x, y, roomName);
                            const minTowerRange = Math.min(...towers.map(t => t.pos.getRangeTo(pos)));
                            const currentRange = Math.min(...towers.map(t => t.pos.getRangeTo(creep.pos)));
                            if (minTowerRange < currentRange && minTowerRange <= SAFE_TOWER_RANGE) {
                                costs.set(x, y, Math.max(costs.get(x, y), 50));
                            }
                        }
                    }

                    return costs;
                },
                plainCost: 2,
                swampCost: 10,
                maxOps: 4000,
                heuristicWeight: 1.2
            }
        );

        if (path.incomplete) {
            this.logStatus(`No safe path to exit at (${closestExit.x},${closestExit.y}).`);
            return null;
        }

        this.logStatus(`Found safe path to exit at (${closestExit.x},${closestExit.y}).`);
        return path.path;
    }

    private findBoostLab(creep: Creep): { lab: StructureLab; part: BodyPartConstant } | null {
        const room = Game.rooms[this.sourceRoom];
        if (!room) return null;

        const labs = room.find(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LAB && s.mineralType && s.store[s.mineralType] >= 30
        }) as StructureLab[];

        const boostedParts = new Set(creep.memory.boostedParts || []);
        const bodyParts = new Set(creep.body.map(part => part.type).filter(part => !boostedParts.has(part)));

        for (const part of bodyParts) {
            const boosts = BOOSTS[part] || [];
            for (const boost of boosts.slice().reverse()) {
                const lab = labs.find(l => l.mineralType === boost);
                if (lab) {
                    const path = creep.pos.findPathTo(lab.pos, {
                        maxOps: 1000,
                        ignoreCreeps: true,
                        range: 1
                    });
                    if (path.length > 0) {
                        return { lab, part };
                    }
                }
            }
        }
        return null;
    }

    private boostCreep(creep: Creep): boolean {
        const boostInfo = this.findBoostLab(creep);
        if (!boostInfo) {
            const bodyParts = new Set(creep.body.map(part => part.type));
            creep.memory.boostedParts = Array.from(bodyParts);
            this.logStatus(`No suitable lab or path for ${creep.name}. Skipping remaining boosts.`);
            return false;
        }

        const { lab, part } = boostInfo;
        if (creep.pos.getRangeTo(lab) > 1) {
            creep.travelTo(lab.pos);
            this.visualizeCreep(creep, `Boost ${part}`, "purple");
            return true;
        }

        const result = lab.boostCreep(creep);
        if (result === OK) {
            creep.memory.boostedParts = creep.memory.boostedParts || [];
            creep.memory.boostedParts.push(part);
            this.logStatus(`Boosted ${creep.name}'s ${part} with ${lab.mineralType} at lab (${lab.pos.x},${lab.pos.y})`);
            this.visualizeCreep(creep, `Boosted ${part}`, "purple");
            return true;
        }
        return false;
    }

    public roleCall(): void {
        if (this.squadMemory.squadAssembled) return;

        const room = Game.rooms[this.sourceRoom];
        if (!room) return;
        const spawns = room.find(FIND_MY_SPAWNS);
        if (!spawns.length) return;

        const missing = this.getMissingCreeps();
        const usedSpawns = new Set<string>();

        for (const i of missing) {
            const name = this.getSquadCreepNames()[i];
            const role = SQUAD_ROLES[i];
            const spawn = spawns.find(s => !s.spawning && !usedSpawns.has(s.name));
            if (!spawn) break;

            usedSpawns.add(spawn.name);
            const result = spawn.spawnCreep(BODY_CONFIG[role], name, {
                memory: {
                    squadId: this.activeSquadId,
                    role,
                    operation: "squad_siege",
                    waypoint: 0,
                    room: spawn.room.name,
                    working: false,
                    boostedParts: [] as BodyPartConstant[]
                }
            });

            if (result === OK) {
                this.squadMemory.lastSpawnTick = Game.time;
                this.setBoostsInRoomMemory();
                this.logStatus(`Spawning ${role} '${name}' at ${spawn.name}`);
            } else {
                this.logStatus(`Awaiting spawn ${role} '${name}' at ${spawn.name}`);
            }
        }
    }

    private healSquad(): void {
        const creeps = this.getLivingSquadCreeps();
        for (const creep of creeps) {
            if (!creep.body.some(part => part.type === HEAL)) continue;

            // Find the most injured creep in range (including self)
            const injured = creeps
                .filter(c => c.hits < c.hitsMax)
                .sort((a, b) => (a.hits / a.hitsMax) - (b.hits / b.hitsMax))[0];

            if (injured) {
                const range = creep.pos.getRangeTo(injured);
                if (range <= 1) {
                    creep.heal(injured);
                    this.visualizeCreep(creep, `Heal ${injured.name}`, "lime");
                } else if (range <= 3) {
                    creep.rangedHeal(injured);
                    this.visualizeCreep(creep, `Ranged Heal ${injured.name}`, "lime");
                }
                // Move closer if out of range
                if (range > 3) {
                    creep.travelTo(injured.pos, { maxRooms: 1 });
                    this.visualizeCreep(creep, `Move to ${injured.name}`, "green");
                }
            } else {
                // Self-heal if no one else needs it
                //creep.heal(creep);
                this.visualizeCreep(creep, "Self-heal", "yellow");
            }
        }
    }

    private shouldRetreat(): boolean {
        const creeps = this.getLivingSquadCreeps();
        return creeps.some(c => c.hits < c.hitsMax * 0.5);
    }

    private allFullyHealed(): boolean {
        const creeps = this.getLivingSquadCreeps();
        return creeps.every(c => c.hits === c.hitsMax);
    }

    private retreatSquad(): void {
        const creeps = this.getLivingSquadCreeps();
        if (!creeps.length) return;

        if (!this.squadMemory.retreatPos) {
            const leader = creeps[0];
            const retreatPos = this.findNearestExit(leader);
            if (!retreatPos) {
                this.logStatus("No valid retreat exit found. Defaulting to source room.");
                this.squadMemory.retreatPos = { x: 25, y: 25, roomName: this.sourceRoom };
            } else {
                this.squadMemory.retreatPos = { x: retreatPos.x, y: retreatPos.y, roomName: retreatPos.roomName };
            }
            this.logStatus(`Squad retreating to (${this.squadMemory.retreatPos.x},${this.squadMemory.retreatPos.y},${this.squadMemory.retreatPos.roomName})`);
        }

        const retreatPos = new RoomPosition(this.squadMemory.retreatPos.x, this.squadMemory.retreatPos.y, this.squadMemory.retreatPos.roomName);
        const leader = creeps[0];

        creeps.forEach(creep => {
            if (creep.pos.getRangeTo(retreatPos) > 1) {
                if (creep === leader) {
                    const path = this.findSafestExitPath(creep);
                    if (path && path.length > 0) {
                        creep.travelTo(path[0]);
                        this.visualizeCreep(creep, "Safe Retreat", "blue");
                    } else {
                        creep.travelTo(retreatPos);
                        this.visualizeCreep(creep, "Retreat", "blue");
                    }
                } else {
                    creep.travelTo(leader.pos);
                    this.visualizeCreep(creep, "FormUp", "gray");
                }
            }
        });

        this.healSquad();

        if (this.allFullyHealed()) {
            this.squadMemory.retreating = false;
            delete this.squadMemory.retreatPos;
            this.logStatus("Squad fully healed. Resuming mission.");
        } else {
            this.logStatus(`Retreating to (${retreatPos.x},${retreatPos.y},${retreatPos.roomName}) and healing.`);
            this.visualizeTarget(retreatPos, "blue", "RETREAT");
        }
    }

    private moveToWaypoint(): boolean {
        const { waypointIndex } = this.squadMemory;
        if (!this.waypoints || waypointIndex >= this.waypoints.length) return false;

        const wp = this.waypoints[waypointIndex];
        const wpPos = new RoomPosition(wp.x, wp.y, wp.room);
        const creeps = this.getLivingSquadCreeps();

        if (creeps.every(c => c.pos.getRangeTo(wpPos) <= 1)) {
            this.squadMemory.waypointIndex++;
            return true;
        }

        creeps.forEach(creep => {
            if (creep.pos.getRangeTo(wpPos) > 1) {
                creep.travelTo(wpPos);
                this.visualizeCreep(creep, `WP${waypointIndex}`, "aqua");
            }
        });
        this.logStatus(`Moving to waypoint ${waypointIndex} (${wp.x},${wp.y},${wp.room})`);
        return true;
    }

    private moveToTargetRoom(): boolean {
        const creeps = this.getLivingSquadCreeps();
        if (creeps.every(c => c.room.name === this.targetRoom)) return false;

        const targetPos = new RoomPosition(25, 25, this.targetRoom);
        const leader = creeps[0];
        creeps.forEach(creep => {
            if (creep === leader) {
                creep.travelTo(targetPos);
                this.visualizeCreep(creep, "Advance", "white");
            } else {
                creep.travelTo(leader.pos);
                this.visualizeCreep(creep, "FormUp", "gray");
            }
        });
        this.logStatus("Moving to target room");
        return true;
    }

    private waitForTowersDepleted(): boolean {
        if (this.squadMemory.towersDepleted) return false;

        const creeps = this.getLivingSquadCreeps();
        if (!creeps.every(c => c.room.name === this.targetRoom)) return false;

        if (this.areTowersDepleted()) {
            this.squadMemory.towersDepleted = true;
            this.logStatus("All towers depleted. Proceeding with attack.");
            return false;
        }

        const safePos = this.findSafeStagingPos(creeps);
        if (!safePos) {
            this.logStatus("No safe position found. Proceeding cautiously.");
            return false;
        }

        const leader = creeps[0];
        creeps.forEach(creep => {
            if (creep.pos.getRangeTo(safePos) > 1) {
                creep.travelTo(creep === leader ? safePos : leader.pos);
                this.visualizeCreep(creep, creep === leader ? "Safe Pos" : "FormUp", creep === leader ? "blue" : "gray");
            }
        });
        this.logStatus(`Holding at safe position (${safePos.x},${safePos.y}) until towers are depleted.`);
        this.visualizeTarget(safePos, "blue", "SAFE");
        return true;
    }

    private attackHostiles(): boolean {
        const creeps = this.getLivingSquadCreeps();
        const target = creeps[0]?.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
        if (!target) return false;

        creeps.forEach(creep => {
            // Skip if low health or squad needs healing
            const squadNeedsHealing = creeps.some(c => c.hits < c.hitsMax * 0.75);
            if (creep.hits < creep.hitsMax * 0.75 || squadNeedsHealing) {
                this.logStatus(`${creep.name} skipping attack due to low health (${creep.hits}/${creep.hitsMax}) or squad healing needed`);
                return;
            }

            if (creep.memory.role === "melee") {
                this.handleKiting(creep, target);
                if (creep.pos.getRangeTo(target) <= 1) {
                    creep.attack(target);
                    this.logStatus(`${creep.name} attacking hostile ${target.id} at range 1`);
                    this.visualizeCreep(creep, "Melee Attack", "red");
                }
            } else if (creep.memory.role === "ranged") {
                this.handleKiting(creep, target);
                this.attackWithRanged(creep, target);
            }
        });
        return true;
    }

    private breachWall(): boolean {
        const targetRoom = Game.rooms[this.targetRoom];
        if (!targetRoom) return false;

        if (!this.wallTarget && this.squadMemory.wallTarget) {
            this.wallTarget = Game.getObjectById<Structure>(this.squadMemory.wallTarget as Id<Structure>);
        }
        if (!this.wallTarget) {
            const rallyPos = this.getLivingSquadCreeps()[0]?.pos || new RoomPosition(25, 25, targetRoom.name);
            this.wallTarget = this.findBestBreachWall(targetRoom, rallyPos);
            if (this.wallTarget) this.squadMemory.wallTarget = this.wallTarget.id;
        }

        if (!this.wallTarget || this.wallTarget.hits === 0) {
            this.breached = true;
            delete this.squadMemory.wallTarget;
            this.logStatus("Wall breached or no wall target. Proceeding to structures.");
            return false;
        }

        this.logStatus(`Breaching wall at (${this.wallTarget.pos.x},${this.wallTarget.pos.y}) hits: ${this.wallTarget.hits}`);
        this.visualizeTarget(this.wallTarget, "orange", "BREACH");

        const creeps = this.getLivingSquadCreeps();
        const leader = creeps[0];
        creeps.forEach(creep => {
            // Skip if low health or squad needs healing
            const squadNeedsHealing = creeps.some(c => c.hits < c.hitsMax * 0.75);
            if (creep.hits < creep.hitsMax * 0.75 || squadNeedsHealing) {
                this.logStatus(`${creep.name} skipping breach due to low health (${creep.hits}/${creep.hitsMax}) or squad healing needed`);
                if (creep !== leader) {
                    creep.travelTo(leader.pos);
                    this.visualizeCreep(creep, "FormUp", "gray");
                }
                return;
            }

            if (creep.memory.role === "melee") {
                const range = creep.pos.getRangeTo(this.wallTarget!.pos);
                if (range > 1) {
                    creep.travelTo(creep === leader ? this.wallTarget!.pos : leader.pos);
                    this.visualizeCreep(creep, creep === leader ? "Breach" : "FormUp", creep === leader ? "orange" : "gray");
                } else {
                    // Alternate attack and heal based on tick
                    if (Game.time % 2 === 0) {
                        creep.attack(this.wallTarget!);
                        this.logStatus(`${creep.name} attacking wall at (${this.wallTarget!.pos.x},${this.wallTarget!.pos.y})`);
                        this.visualizeCreep(creep, "Melee Breach", "red");
                    } else {
                        const injured = creeps.find(c => c.hits < c.hitsMax && creep.pos.getRangeTo(c) <= 1);
                        if (injured) {
                            creep.heal(injured);
                            this.visualizeCreep(creep, `Heal ${injured.name}`, "lime");
                        } else {
                            creep.heal(creep);
                            this.visualizeCreep(creep, "Self-heal", "yellow");
                        }
                    }
                }
            } else {
                // Healers follow leader
                creep.travelTo(leader.pos);
                this.visualizeCreep(creep, "FormUp", "gray");
            }
        });
        return true;
    }

    private attackStructures(): void {
        const targetRoom = Game.rooms[this.targetRoom];
        if (!targetRoom) return;

        const structures = [
            ...targetRoom.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }),
            ...targetRoom.find(FIND_HOSTILE_SPAWNS),
            ...targetRoom.find(FIND_HOSTILE_STRUCTURES, {
                filter: s => s.structureType !== STRUCTURE_CONTROLLER && s.structureType !== STRUCTURE_TOWER && s.structureType !== STRUCTURE_SPAWN && s.structureType !== STRUCTURE_RAMPART
            })
        ];

        if (!structures.length) {
            this.logStatus("No hostile structures found.");
            return;
        }

        const target = structures[0];
        this.logStatus(`Attacking ${target.structureType} at (${target.pos.x},${target.pos.y}) hits: ${target.hits}`);
        this.visualizeTarget(target, "red", "ATTACK");

        const creeps = this.getLivingSquadCreeps();
        const leader = creeps[0];
        creeps.forEach(creep => {
            // Skip if low health or squad needs healing
            const squadNeedsHealing = creeps.some(c => c.hits < c.hitsMax * 0.75);
            if (creep.hits < creep.hitsMax * 0.75 || squadNeedsHealing) {
                this.logStatus(`${creep.name} skipping attack due to low health (${creep.hits}/${creep.hitsMax}) or squad healing needed`);
                if (creep !== leader) {
                    creep.travelTo(leader.pos);
                    this.visualizeCreep(creep, "FormUp", "gray");
                }
                return;
            }

            if (creep.memory.role === "melee") {
                const range = creep.pos.getRangeTo(target);
                if (range > 1) {
                    creep.travelTo(creep === leader ? target.pos : leader.pos);
                    this.visualizeCreep(creep, creep === leader ? "Advance" : "FormUp", creep === leader ? "red" : "gray");
                } else {
                    // Alternate attack and heal based on tick
                    if (Game.time % 2 === 0) {
                        creep.attack(target);
                        this.logStatus(`${creep.name} attacking ${target.structureType} at (${target.pos.x},${target.pos.y})`);
                        this.visualizeCreep(creep, "Melee Attack", "red");
                    } else {
                        const injured = creeps.find(c => c.hits < c.hitsMax && creep.pos.getRangeTo(c) <= 1);
                        if (injured) {
                            creep.heal(injured);
                            this.visualizeCreep(creep, `Heal ${injured.name}`, "lime");
                        } else {
                            creep.heal(creep);
                            this.visualizeCreep(creep, "Self-heal", "yellow");
                        }
                    }
                }
            } else {
                // Healers follow leader
                creep.travelTo(leader.pos);
                this.visualizeCreep(creep, "FormUp", "gray");
            }
        });
    }

    private handleKiting(creep: Creep, target: Creep): void {
        if (creep.hits < creep.hitsMax * 0.75) {
            if (this.squadMemory.retreatPos) {
                const retreatPos = new RoomPosition(this.squadMemory.retreatPos.x, this.squadMemory.retreatPos.y, this.squadMemory.retreatPos.roomName);
                creep.travelTo(retreatPos);
                creep.say("🚪 Retreat");
            }
            return;
        }

        const range = creep.pos.getRangeTo(target);
        if (range <= 1) {
            const fleePath = PathFinder.search(
                creep.pos,
                [{ pos: target.pos, range: 2 }],
                {
                    flee: true,
                    maxRooms: 1,
                    roomCallback: (roomName: string) => {
                        const room = Game.rooms[roomName];
                        if (!room) return false;
                        const costs = new PathFinder.CostMatrix();
                        room.find(FIND_STRUCTURES).forEach(struct => {
                            if (struct.structureType !== STRUCTURE_ROAD && struct.structureType !== STRUCTURE_CONTAINER &&
                                (struct.structureType !== STRUCTURE_RAMPART || !struct.my)) {
                                costs.set(struct.pos.x, struct.pos.y, 255);
                            }
                        });
                        room.find(FIND_CREEPS).forEach(c => {
                            if (c.id !== creep.id) costs.set(c.pos.x, c.pos.y, 255);
                        });
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
            if (fleePath.path.length > 0) {
                creep.travelTo(fleePath.path[0]);
                creep.say("🚪 Kite");
            }
        } else if (range > 2) {
            creep.moveTo(target.pos, { reusePath: 3, maxRooms: 1 });
            creep.say("➡️ Close in");
        }
    }

    private attackWithRanged(creep: Creep, target: Creep): void {
        if (creep.hits < creep.hitsMax * 0.75) return;
        const enemiesInRange = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3);
        if (enemiesInRange.length > 2) {
            creep.rangedMassAttack();
            creep.say("💥 AoE!");
        } else if (creep.pos.getRangeTo(target) <= 3) {
            creep.rangedAttack(target);
            creep.say("🎯 Shoot");
        }
    }

    private boostSquad(): boolean {
        let boosting = false;
        for (const creep of this.getLivingSquadCreeps()) {
            const bodyParts = new Set(creep.body.map(part => part.type));
            const boostedParts = new Set(creep.memory.boostedParts || []);
            if (bodyParts.size > boostedParts.size && this.boostCreep(creep)) {
                boosting = true;
            }
        }
        return boosting;
    }

    actions(): void {
        if (this.allSquadDead()) {
            this.squadMemory.squadAssembled = false;
            this.squadMemory.activeSquadIndex = (this.squadMemory.activeSquadIndex + 1) % SQUAD_NAMES.length;
            this.squadMemory.waypointIndex = 0;
            this.squadMemory.towersDepleted = false;
            this.squadMemory.retreating = false;
            delete this.squadMemory.retreatPos;
            delete this.squadMemory.lastSpawnTick;
            this.clearBoostsFromRoomMemory();
            this.wallTarget = null;
            this.breached = false;
            delete this.squadMemory.wallTarget;
            this.logStatus(`Squad ${this.activeSquadId} destroyed. Rotating to next squad.`);
            return;
        }

        if (this.squadMemory.lastSpawnTick && Game.time <= this.squadMemory.lastSpawnTick + 50) {
            this.setBoostsInRoomMemory();
        } else if (!this.boostSquad()) {
            const allBoosted = this.getLivingSquadCreeps().every(creep => {
                const bodyParts = new Set(creep.body.map(part => part.type));
                const boostedParts = new Set(creep.memory.boostedParts || []);
                return bodyParts.size === boostedParts.size;
            });
            if (allBoosted) {
                this.clearBoostsFromRoomMemory();
                delete this.squadMemory.lastSpawnTick;
            }
        }

        if (this.shouldRetreat() && !this.squadMemory.retreating) {
            this.squadMemory.retreating = true;
            delete this.squadMemory.retreatPos;
            this.logStatus("Squad below 50% health. Initiating retreat.");
        }

        if (this.squadMemory.retreating) {
            this.retreatSquad();
            return;
        }

        this.healSquad();

        if (this.boostSquad()) return;

        if (!this.squadMemory.squadAssembled) {
            if (!this.waypoints.length) {
                this.logStatus("No rally point/waypoints set.");
                return;
            }
            this.getLivingSquadCreeps().forEach(creep => {
                const rally = new RoomPosition(this.waypoints[0].x, this.waypoints[0].y, this.waypoints[0].room);
                if (creep.pos.getRangeTo(rally) > 1) {
                    creep.travelTo(rally);
                    this.visualizeCreep(creep, "Rally", "white");
                }
            });
            if (this.allAtRally()) {
                this.squadMemory.squadAssembled = true;
                this.squadMemory.waypointIndex = 1;
                this.logStatus("Squad rallied and assembled. Beginning mission.");
            } else {
                this.logStatus("Waiting for full squad at rally...");
            }
            return;
        }

        if (this.moveToWaypoint()) return;
        if (this.moveToTargetRoom()) return;
        if (this.waitForTowersDepleted()) return;
        //if (this.attackHostiles()) return;
        //if (this.breachWall()) return;
        this.attackStructures();
    }
}
