import { Operation } from "../classes/operation";

/**
 * SquadSiegeOperation for Screeps with static squad ID and rally logic.
 * - The first waypoint is the rally point.
 * - Only spawn new squad after all previous squad members have died.
 * - While rally in progress (not all members at rally), continue spawning missing squad members.
 * - Once all reach rally, mark squad as assembled and proceed.
 * - No more spawning until all squad members die, then rotate to next squad ID.
 * - All creeps with HEAL parts heal every tick.
 */
const squadNames = ["alpha", "bravo", "charlie", "delta", "echo"]; // Add more as needed

function getSquadMemory() {
    if (!Memory.squadSiege) {
        Memory.squadSiege = {
            activeSquadIndex: 0,
            squadAssembled: false,
            waypointIndex: 0,
        };
    }
    return Memory.squadSiege;
}

export class SquadSiegeOperation extends Operation {
    squadRoles: ("healer" | "ranged" | "melee")[];
    targetRoom: string;
    sourceRoom: string;
    waypoints: { x: number, y: number, room: string }[];
    squadSize: number;
    stagingPos: RoomPosition | null;
    wallTarget: Structure | null;
    breached: boolean;
    logFrequency: number;
    lastLogTick: number | null;

    constructor(targetRoom: string, sourceRoom: string, waypoints: { x: number, y: number, room: string }[]) {
        super();
        this.squadRoles = ["ranged", "ranged", "ranged"];
        this.targetRoom = targetRoom;
        this.sourceRoom = sourceRoom;
        this.waypoints = waypoints;
        this.squadSize = this.squadRoles.length;
        this.stagingPos = null;
        this.wallTarget = null;
        this.breached = false;
        this.logFrequency = 10;
        this.lastLogTick = null;
    }

    get activeSquadId(): string {
        const memory = getSquadMemory();
        return squadNames[memory.activeSquadIndex % squadNames.length];
    }

    getSquadCreepNames(): string[] {
        return this.squadRoles.map((role, i) =>
            `Siege${role.charAt(0).toUpperCase() + role.slice(1)}_${this.targetRoom}_${this.activeSquadId}_${i}`
        );
    }

    getLivingSquadCreeps(): Creep[] {
        return this.getSquadCreepNames()
            .map(name => Game.creeps[name])
            .filter(c => !!c) as Creep[];
    }

    getCreepsNotSpawnedOrSpawning(): number[] {
        const room = Game.rooms[this.sourceRoom];
        if (!room) return [];
        const spawns = room.find(FIND_MY_SPAWNS) || [];
        return this.getSquadCreepNames()
            .map((name, i) => {
                const alive = Game.creeps[name];
                const spawning = spawns.some(s => s.spawning && s.spawning.name === name);
                return (!alive && !spawning) ? i : -1;
            })
            .filter(i => i !== -1);
    }

    private logSquadStatus(msg: string) {
        if (this.lastLogTick === null || Game.time - this.lastLogTick >= this.logFrequency) {
            console.log(`[SquadSiege:${this.activeSquadId}] ${msg}`);
            this.lastLogTick = Game.time;
        }
    }

    private squadVisual(text: string, color = "yellow", stroke = "black") {
        for (const creep of this.getLivingSquadCreeps()) {
            if (creep && creep.room) {
                new RoomVisual(creep.room.name).text(
                    text,
                    creep.pos.x,
                    creep.pos.y - 1.2,
                    { color, stroke, font: 0.7 }
                );
            }
        }
    }

    private targetVisual(target: RoomPosition | RoomObject, color = "red", label = "TARGET") {
        let pos: RoomPosition = (target instanceof RoomPosition) ? target : (target as RoomObject).pos;
        if (pos && Game.rooms[pos.roomName]) {
            new RoomVisual(pos.roomName).circle(pos, { radius: 0.7, fill: "transparent", stroke: color });
            new RoomVisual(pos.roomName).text(label, pos.x, pos.y + 0.5, { color, font: 0.7 });
        }
    }

    private allSquadAtRally(): boolean {
        if (!this.waypoints || this.waypoints.length === 0) return false;
        const rally = new RoomPosition(this.waypoints[0].x, this.waypoints[0].y, this.waypoints[0].room);
        const creeps = this.getLivingSquadCreeps();
        return creeps.length === this.squadSize &&
            creeps.every(c => c.pos.getRangeTo(rally) <= 3);
    }

    private allSquadDead(): boolean {
        const room = Game.rooms[this.sourceRoom];
        if (!room) return false;
        const names = this.getSquadCreepNames();
        const anyAlive = names.some(n => Game.creeps[n]);
        const anySpawning = room.find(FIND_MY_SPAWNS).some(s => s.spawning && names.includes(s.spawning.name));
        return (!anyAlive && !anySpawning);
    }

    private findBestBreachWall(room: Room, fromPos: RoomPosition): Structure | null {

        const spawns = room.find(FIND_HOSTILE_SPAWNS);
        if (!spawns.length) return null;
        let blockers: Structure[] = [];

        for (const spawn of spawns) {
            const ret = PathFinder.search(
                fromPos,
                { pos: spawn.pos, range: 1 },
                {
                    roomCallback: rname => {
                        if (rname !== room.name) return false;
                        const costs = new PathFinder.CostMatrix();
                        room.find(FIND_STRUCTURES).forEach(struct => {
                            //if (struct.structureType === STRUCTURE_WALL || struct.structureType === STRUCTURE_RAMPART) {
                            //    costs.set(struct.pos.x, struct.pos.y, 255); // Block walls/ramparts
                            //}
                        });
                        return costs;
                    },
                    maxOps: 4000,
                    maxRooms: 1,
                    heuristicWeight: 1.2
                }
            );
            // Find the first wall/rampart along the path
            for (const step of ret.path) {
                const blocks = room.lookForAt(LOOK_STRUCTURES, step.x, step.y)
                    .filter(s => s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART);
                blockers.push(...blocks);
            }
        }

        // Pick the wall/rampart with the lowest hits
        let bestTarget: Structure | null = null;
        let minHits = Infinity;
        for (const block of blockers) {
            if (block.hits < minHits) {
                minHits = block.hits;
                bestTarget = block;
            }
        }
        if (bestTarget) {
            this.logSquadStatus(`Selected breach wall/rampart at (${bestTarget.pos.x},${bestTarget.pos.y}) hits: ${bestTarget.hits}`);
            this.targetVisual(bestTarget, "orange", "BREACH");
        }
        return bestTarget;

    }

    // SPAWN LOGIC: Only spawn if squad not yet assembled and not all alive
    roleCall() {
        const memory = getSquadMemory();
        if (memory.squadAssembled) return; // No spawning allowed once assembled

        const room = Game.rooms[this.sourceRoom];
        if (!room) return;
        const spawns = room.find(FIND_MY_SPAWNS) || [];
        if (spawns.length === 0) return;

        // Try to spawn each missing squad member up to available spawns
        const missing = this.getCreepsNotSpawnedOrSpawning();
        let usedSpawns: Set<string> = new Set();
        for (let i of missing) {
            const name = this.getSquadCreepNames()[i];
            const role = this.squadRoles[i];

            const spawn = spawns.find(s => !s.spawning && !usedSpawns.has(s.name));
            if (!spawn) break;
            usedSpawns.add(spawn.name);

            let body: BodyPartConstant[];
            if (role === "healer") {
                /*body = [
                    ...Array(10).fill(TOUGH),
                    ...Array(16).fill(MOVE),
                    ...Array(22).fill(HEAL)
                ];*/
                body = [
                    ...Array(2).fill(TOUGH),
                    ...Array(24).fill(MOVE),
                    ...Array(22).fill(HEAL)
                ];
            } else if (role === "ranged") {
                /*body = [
                    ...Array(10).fill(TOUGH),
                    ...Array(16).fill(MOVE),
                    ...Array(12).fill(RANGED_ATTACK),
                    ...Array(10).fill(HEAL)
                ];*/
                body = [
                    ...Array(2).fill(TOUGH),
                    ...Array(24).fill(MOVE),
                    ...Array(12).fill(RANGED_ATTACK),
                    ...Array(10).fill(HEAL)
                ];
            } else {
                body = [
                    ...Array(10).fill(TOUGH),
                    ...Array(12).fill(MOVE),
                    ...Array(12).fill(ATTACK),
                    ...Array(10).fill(HEAL)
                ];
            }
            const result = spawn.spawnCreep(body, name, {
                memory: {
                    squadId: this.activeSquadId,
                    role,
                    operation: "squad_siege",
                    waypoint: 0,
                    room: spawn.room.name,
                    working: false
                }
            });
            if (result === OK) {
                console.log(`[SquadSiege:${this.activeSquadId}] Spawning ${role} '${name}' at spawn ${spawn.name}`);
            } else {
                console.log(`[SquadSiege:${this.activeSquadId}] Awaiting Spawn ${role} '${name}' at spawn ${spawn.name}`);
            }
        }
    }

    actions() {
        const memory = getSquadMemory();

        // --- RESET FOR NEXT SQUAD ---
        if (this.allSquadDead()) {
            memory.squadAssembled = false;
            memory.activeSquadIndex = (memory.activeSquadIndex + 1) % squadNames.length;
            memory.waypointIndex = 0;
            this.wallTarget = null;
            this.breached = false;
            this.logSquadStatus(`Squad ${this.activeSquadId} destroyed. Rotating to next squad.`);
        }

        // --- Universal healing: All creeps with HEAL parts heal every tick ---
        for (const creep of this.getLivingSquadCreeps()) {
            if (creep.body.some(part => part.type === HEAL)) {
                // Find the most injured squadmate in range 1, else heal self
                let injured = this.getLivingSquadCreeps().find(c => c && c.hits < c.hitsMax && creep.pos.getRangeTo(c) <= 1);
                if (injured && injured.name !== creep.name) {
                    creep.heal(injured);
                    //this.squadVisual(`Heal ${injured.name}`, "lime");
                } else {
                    creep.heal(creep);
                    //this.squadVisual(`Self-heal`, "yellow");
                }
            }
        }

        // --- RALLY LOGIC ---
        if (!memory.squadAssembled) {
            // Move every living squad member to rally point
            if (this.waypoints && this.waypoints.length > 0) {
                const rally = new RoomPosition(this.waypoints[0].x, this.waypoints[0].y, this.waypoints[0].room);
                for (const creep of this.getLivingSquadCreeps()) {
                    if (creep.pos.getRangeTo(rally) > 1) {
                        creep.travelTo(rally);
                        //this.squadVisual("Rally", "white");
                    }
                }
                if (this.allSquadAtRally()) {
                    Memory.squadSiege.squadAssembled = true;
                    memory.waypointIndex = 1;
                    this.logSquadStatus("Squad rallied and assembled. Beginning mission.");
                } else {
                    this.logSquadStatus("Waiting for full squad at rally...");
                    return;
                }
            } else {
                this.logSquadStatus("No rally point/waypoints set.");
                return;
            }
        }

        // --- SQUAD MISSION LOGIC ---
        const livingCreeps = this.getLivingSquadCreeps();

        // Move along waypoints (after rally)
        let waypointIndex = memory.waypointIndex; // skip rally, start from second waypoint
        while (this.waypoints && waypointIndex < this.waypoints.length) {
            const wp = this.waypoints[waypointIndex];
            const wpPos = new RoomPosition(wp.x, wp.y, wp.room);
            const allAtWaypoint = livingCreeps.every(c => c.pos.getRangeTo(wpPos) <= 1);
            if (!allAtWaypoint) {
                for (const creep of livingCreeps) {
                    if (creep.pos.getRangeTo(wpPos) > 1) {
                        creep.travelTo(wpPos);
                        //this.squadVisual(`WP${waypointIndex}`, "aqua");
                    }
                }
                this.logSquadStatus(`Squad moving to waypoint ${waypointIndex} (${wp.x},${wp.y},${wp.room})`);
                return;
            } else {
                memory.waypointIndex++;
                return;
            }
        }

        // If not in target room, move squad there
        let allInTarget = livingCreeps.every(c => c.room.name === this.targetRoom);
        for (const c of livingCreeps) {
            console.log(c.room.name + ' ' + this.targetRoom);
        }

        if (!allInTarget) {
            this.logSquadStatus("Squad moving to target room");
            for (const creep of livingCreeps) {
                //if (creep.room.name !== this.targetRoom) {
                    let leader = livingCreeps[0];
                    if (creep.name !== leader.name && leader) {
                        //creep.travelTo(leader.pos);
                        console.log(creep.name + ' entering target room: ' + creep.travelTo(new RoomPosition(17, 45, this.targetRoom)));
                        this.squadVisual("FormUp", "gray");
                    } else {
                        console.log(creep.name + ' entering target room: ' + creep.travelTo(new RoomPosition(17, 45, this.targetRoom)));
                        this.squadVisual("Advance", "white");
                    }
                //}
            }
            return;
        }

        //let target = this.findPriorityTarget(livingCreeps[0]);
        let target = livingCreeps[0].pos.findClosestByPath(FIND_HOSTILE_CREEPS);
        console.log('target: ' + JSON.stringify(target));
        if (target) {
            //this.squadVisual("T:" + target.name, "white");
            for (const creep of this.getLivingSquadCreeps()) {
                let leader = livingCreeps[0];
                //if (creep.name !== leader.name && leader) {
                //    creep.travelTo(leader.pos);
                //} else {
                    // Movement logic (kite or approach)
                    this.handleKiting(creep, target);
                //}
                //if (creep.body.some(part => part.type === RANGED_ATTACK)) {
                    // Attack logic (mass or single)
                    this.attackWithRanged(creep, target);
                //}
            }
            return;
        }

        // Breach logic
        let targetRoomObj = Game.rooms[this.targetRoom];
        this.wallTarget = Game.getObjectById<Structure>(memory.wallTarget);
        console.log('this.wallTarget ' + this.wallTarget);
        if (targetRoomObj && !this.wallTarget) {
            const rallyOrCurrent = this.getLivingSquadCreeps()[0]?.pos || new RoomPosition(25,25, targetRoomObj.name);
            console.log('rallyOrCurrent ' + rallyOrCurrent);
            this.wallTarget = this.findBestBreachWall(targetRoomObj, rallyOrCurrent);
            console.log('this.wallTarget ' + this.wallTarget);
            if (this.wallTarget) {
                Memory.squadSiege.wallTarget = this.wallTarget.id;
                this.breached = false;
            }
        }

        // Breach not yet complete
        if (this.wallTarget && this.wallTarget.hits > 0) {
            this.logSquadStatus(`Squad breaching wall/rampart at (${this.wallTarget.pos.x},${this.wallTarget.pos.y}) hits: ${this.wallTarget.hits}`);
            this.targetVisual(this.wallTarget, "orange", "BREACH");
            let pos = this.wallTarget.pos;
            for (const creep of livingCreeps) {
                if (creep.pos.getRangeTo(pos) > 3) {
                    let leader = livingCreeps[0];
                    if (creep.name !== leader.name && leader) {
                        creep.travelTo(leader.pos);
                        this.squadVisual("FormUp", "gray");
                    } else {
                        creep.travelTo(pos);
                        this.squadVisual("Breach", "orange");
                    }
                } else {
                    if (creep.memory.role === "ranged" && creep.pos.getRangeTo(pos) <= 3) {
                        creep.rangedAttack(this.wallTarget);
                        this.squadVisual("Ranged Fire", "red");
                    }
                    if (creep.memory.role === "melee" && creep.pos.getRangeTo(pos) === 1) {
                        creep.attack(this.wallTarget);
                        this.squadVisual("Melee", "red");
                    }
                }
            }
            return;
        }

        // Breach complete, attack in survival order
        this.breached = true;
        let structuresToAttack: any[] = [];
        if (targetRoomObj) {
            let towers = targetRoomObj.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER });
            let spawns = targetRoomObj.find(FIND_HOSTILE_SPAWNS);
            let others = targetRoomObj.find(FIND_HOSTILE_STRUCTURES, {
                filter: s => s.structureType !== STRUCTURE_TOWER && s.structureType !== STRUCTURE_SPAWN
                    && s.structureType !== STRUCTURE_RAMPART
            });
            structuresToAttack = [...towers, ...spawns, ...others];
        }

        if (structuresToAttack.length) {
            let firstTarget = structuresToAttack[0];
            if (firstTarget) {
                this.logSquadStatus(`Squad attacking structure: ${firstTarget.structureType} at (${firstTarget.pos.x},${firstTarget.pos.y}) hits: ${firstTarget.hits}`);
                this.targetVisual(firstTarget, "red", "ATTACK");
            }
            for (const creep of livingCreeps) {
                let target = creep.pos.findClosestByRange(structuresToAttack);
                if (target) {
                    if (creep.pos.getRangeTo(target) > 1)
                        creep.travelTo(target);
                    else if (creep.memory.role === "ranged")
                        creep.rangedAttack(target);
                    else if (creep.memory.role === "melee")
                        creep.attack(target);
                    this.squadVisual(`Attack ${target.structureType}`, "red");
                }
            }
        }

    }


    findPriorityTarget(creep: Creep): Creep | null {
        let hostile = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
        return hostile;
        /*
        const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);

        if (hostiles.length === 0) return null;

        // Prioritize targets: Healers > Damaged > Others
        const healers = hostiles.filter(h => h.getActiveBodyparts(HEAL) > 0);
        console.log(healers.length);
        if (healers.length > 0) {
            console.log(JSON.stringify(creep.pos.findClosestByPath(healers)));
            return healers[0];
        }

        const damaged = hostiles.filter(h => h.hits < h.hitsMax);
        if (damaged.length > 0) {
            return creep.pos.findClosestByPath(damaged);
        }

        return creep.pos.findClosestByPath(hostiles);*/
    }

    handleKiting(creep: Creep, target: Creep): void {
        const range = creep.pos.getRangeTo(target);

        // If enemy is too close (melee range)
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
                            costs.set(x, 0, 255);     // Top edge
                            costs.set(x, 49, 255);    // Bottom edge
                        }
                        for (let y = 0; y < 50; y++) {
                            costs.set(0, y, 255);     // Left edge
                            costs.set(49, y, 255);    // Right edge
                        }

                        return costs;
                    }
                }
            );

            if (fleePath.path.length > 0) {
                creep.move(creep.pos.getDirectionTo(fleePath.path[0]));
                creep.say("🚪 Kite");
            }
        }
        // If out of range to shoot, move closer
        else if (range > 2) {
            creep.moveTo(target, {
                visualizePathStyle: { stroke: "#ffaa00" },
                reusePath: 3,
                maxRooms: 1
            });
            creep.say("➡️ Close in");
        }
        // Otherwise (range 2–3): stay in position
    }

    attackWithRanged(creep: Creep, target: Creep): void {
        const enemiesInRange = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3);

        if (enemiesInRange.length > 2) {
            const result = creep.rangedMassAttack();
            if (result === OK) {
                creep.say("💥 AoE!");
            }
        } else if (creep.pos.getRangeTo(target) <= 3) {
            const result = creep.rangedAttack(target);
            if (result === OK) {
                creep.say("🎯 Shoot");
            } else if (result === ERR_NOT_IN_RANGE) {
                creep.travelTo(target.pos);
            }
        }
    }
}
