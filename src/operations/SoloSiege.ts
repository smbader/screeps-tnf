import { getHostileSpawns, towerDamage } from "./SiegePlanner";
import { captureSnapshot } from "./SiegeScanner";
import { isKeeperRoom, keeperSafeTravel } from "./SiegeRouting";
import { keeperHazards, keeperRisk } from "./KeeperTravel";
import { SMALL_SIEGE_BODY } from "./SmallSiege";
import { attackWithMembers, chooseCreepFocus, findStructureAt } from "./SiegeCombat";
import { chooseSoloKite } from "./SoloKiting";
import { planSoloOpportunity } from "./SoloOpportunity";
import type { SiegeMemory, SiegeOptions, TilePos } from "./SiegeTypes";
import {
  moveSiegeCreep,
  recordCreepAction,
  recordSiegeEvent,
  siegePosition,
  travelSiegeCreep
} from "./SiegeDiagnostics";

type SoloEntry = NonNullable<NonNullable<SiegeMemory["solo"]>["entry"]>;

const SIDES: { exit: ExitKey; inward: DirectionConstant; outward: DirectionConstant }[] = [
  { exit: "1", inward: BOTTOM, outward: TOP },
  { exit: "3", inward: LEFT, outward: RIGHT },
  { exit: "5", inward: TOP, outward: BOTTOM },
  { exit: "7", inward: RIGHT, outward: LEFT }
];
const BODY_COST = 1300;
const ENTRY_RETRY_TICKS = 100;
const LAST_STAND_TICKS = 200;
export const SOLO_SIEGE_BODY = SMALL_SIEGE_BODY;
//export const SOLO_SIEGE_BODY = [
//  ...SMALL_SIEGE_BODY.filter(part => part !== "move"),
//  ...SMALL_SIEGE_BODY.filter(part => part === "move")
//];

function positions(exit: ExitKey, coordinate: number): { outside: TilePos; border: TilePos; inside: TilePos } {
  switch (exit) {
    case "1":
      return { outside: { x: coordinate, y: 48 }, border: { x: coordinate, y: 0 }, inside: { x: coordinate, y: 1 } };
    case "3":
      return { outside: { x: 1, y: coordinate }, border: { x: 49, y: coordinate }, inside: { x: 48, y: coordinate } };
    case "5":
      return { outside: { x: coordinate, y: 1 }, border: { x: coordinate, y: 49 }, inside: { x: coordinate, y: 48 } };
    case "7":
      return { outside: { x: 48, y: coordinate }, border: { x: 0, y: coordinate }, inside: { x: 1, y: coordinate } };
  }
}

export class SoloSiege {
  private movementTrace = "hold";
  private attackTrace = "no target in range";

  public update(memory: SiegeMemory, options: SiegeOptions): void {
    if (memory.phase === "COMPLETE" || memory.phase === "ABORTED") return;
    const home = options.homeRoom ? Game.rooms[options.homeRoom] : undefined;
    if (!home?.controller?.my || !home.find(FIND_MY_SPAWNS).length) {
      memory.status = `waiting for an owned spawn in ${options.homeRoom || "the configured home room"}`;
      return;
    }
    if (home.energyCapacityAvailable < BODY_COST) {
      memory.status = `waiting for ${BODY_COST} energy capacity in ${home.name}`;
      return;
    }
    const room = Game.rooms[memory.targetRoom];
    if (room) {
      memory.snapshot = captureSnapshot(room);
      memory.snapshotPersistedAt = Game.time;
    }
    const snapshot = memory.snapshot;
    if (snapshot?.owner && snapshot.owner === home.controller.owner?.username) {
      memory.phase = "ABORTED";
      memory.status = "target is owned by this player";
      console.log(`[Siege ${memory.id}] ${memory.status}`);
      return;
    }
    if (snapshot && snapshot.safeModeEndsAt > Game.time) {
      memory.phase = "PAUSED";
      memory.status = `safe mode until ${snapshot.safeModeEndsAt}`;
      return;
    }
    if (memory.phase === "PAUSED") memory.phase = "PLANNING";
    if (room && snapshot && !getHostileSpawns(snapshot).length) {
      const activeSolo = memory.solo?.name ? Game.creeps[memory.solo.name] : undefined;
      if (memory.solo?.opportunity && activeSolo?.pos.roomName === memory.targetRoom) {
        memory.solo.opportunity = "retreating";
      } else {
        memory.phase = "COMPLETE";
        memory.status = "no hostile spawns remain";
        console.log(`[Siege ${memory.id}] ${memory.status}`);
        return;
      }
    }
    const state = (memory.solo = memory.solo || {});
    if (state.name && !Game.creeps[state.name]) {
      state.name = undefined;
      state.retreating = false;
      state.opportunity = undefined;
      state.lastHits = undefined;
      state.lastRoom = undefined;
      state.entry = undefined;
      memory.wave = (memory.wave || 1) + 1;
    }
    if (memory.phase === "BLOCKED" && Game.time - memory.phaseSince < ENTRY_RETRY_TICKS) return;
    if (!state.entry) {
      state.entry = this.findEntry(home.name, memory);
      if (!state.entry) {
        memory.phase = "BLOCKED";
        memory.phaseSince = Game.time;
        memory.status = "no safe entry with a plain escape tile";
        return;
      }
    }
    if (memory.phase === "BLOCKED" || memory.phase === "PLANNING") memory.phase = "PREPARING";
  }

  public supply(memory: SiegeMemory, options: SiegeOptions): void {
    if (["COMPLETE", "ABORTED", "PAUSED", "BLOCKED"].includes(memory.phase)) return;
    const state = memory.solo;
    const home = options.homeRoom ? Game.rooms[options.homeRoom] : undefined;
    if (!state?.entry || !home?.controller?.my || home.energyCapacityAvailable < BODY_COST) return;
    if (state.name && Game.creeps[state.name]) return;
    const spawn = home.find(FIND_MY_SPAWNS).find(candidate => !candidate.spawning);
    if (!spawn) return;
    if (home.energyAvailable < BODY_COST) {
      memory.status = `waiting for energy in ${home.name}: ${home.energyAvailable}/${BODY_COST}`;
      return;
    }
    const name = `siege_solo_${memory.id}_${Game.time}`;
    const result = spawn.spawnCreep(SOLO_SIEGE_BODY, name, {
      memory: { role: "siegeSolo", siegeId: memory.id, room: home.name }
    });
    recordSiegeEvent(memory.id, "spawn", { name, roomName: home.name, body: SOLO_SIEGE_BODY, result });
    if (result === OK) {
      state.name = name;
      memory.status = "spawning solo attacker";
    } else {
      memory.status = `solo spawn failed: ${result}`;
      console.log(`[Siege ${memory.id}] ${memory.status}`);
    }
  }

  public control(memory: SiegeMemory, options: SiegeOptions): void {
    const state = memory.solo;
    const creep = state?.name ? Game.creeps[state.name] : undefined;
    if (!state?.entry || !creep || creep.spawning || memory.phase === "COMPLETE" || memory.phase === "ABORTED") return;
    const entry = state.entry;
    const inTarget = creep.pos.roomName === memory.targetRoom;
    this.movementTrace = "hold";
    this.attackTrace = creep.getActiveBodyparts(RANGED_ATTACK) > 0 ? "no target in range" : "no active ranged parts";
    const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
    const attacked = creep.room
      .getEventLog()
      .some(event => event.event === EVENT_ATTACK && event.data.targetId === creep.id);
    const lostHits =
      state.lastRoom === creep.pos.roomName && state.lastHits !== undefined && creep.hits < state.lastHits;
    state.lastHits = creep.hits;
    state.lastRoom = creep.pos.roomName;
    const healResult = creep.getActiveBodyparts(HEAL) > 0 ? creep.heal(creep) : "no active heal";
    if (typeof healResult === "number") recordCreepAction(creep, "heal", healResult, { target: creep.id });
    const lastStand =
      creep.ticksToLive !== undefined &&
      creep.ticksToLive <= LAST_STAND_TICKS &&
      creep.getActiveBodyparts(RANGED_ATTACK) > 0;
    if (!lastStand || memory.phase === "PAUSED") this.fire(creep, inTarget, hostiles);
    const nearby = hostiles.filter(hostile => creep.pos.getRangeTo(hostile) <= 5);
    try {
      if (memory.phase === "PAUSED") {
        state.retreating = true;
        if (inTarget) this.retreat(memory, creep, entry);
        else if (options.homeRoom && creep.pos.roomName !== options.homeRoom) {
          this.travel(memory, creep, new RoomPosition(25, 25, options.homeRoom), 20);
        }
        return;
      }
      if (!inTarget && isKeeperRoom(creep.pos.roomName) &&
        (creep.pos.roomName !== entry.roomName)) {
        memory.status = "keeper-room transit: bypassing unsafe fights";
        this.travel(memory, creep, new RoomPosition(entry.outside.x, entry.outside.y, entry.roomName), 1);
        return;
      }
      if (lastStand) {
        state.opportunity = undefined;
        this.lastStand(memory, creep, entry, hostiles);
        return;
      }
      if (!inTarget && state.opportunity) {
        state.opportunity = undefined;
        state.retreating = true;
      }
      if (
        inTarget &&
        !this.onExit(creep.pos) &&
        (state.opportunity || (!state.retreating && creep.getActiveBodyparts(RANGED_ATTACK) > 0))
      ) {
        if (this.opportunity(memory, creep, entry, hostiles, healResult === OK)) return;
      }
      if (inTarget && (attacked || lostHits || creep.hits < creep.hitsMax)) state.retreating = true;
      if (inTarget && state.retreating) {
        memory.status = "attacked; retreating to heal";
        this.retreat(memory, creep, entry);
        return;
      }
      const activeTower =
        !memory.snapshot ||
        memory.snapshot.structures.some(
          structure =>
            structure.hostile &&
            structure.type === "tower" &&
            (structure.energy === undefined || structure.energy >= 10)
        );
      if (
        inTarget &&
        activeTower &&
        nearby.some(hostile => hostile.getActiveBodyparts(ATTACK) > 0 && creep.pos.getRangeTo(hostile) <= 3)
      ) {
        state.retreating = true;
        memory.status = "melee threat with active or unknown towers; retreating";
        this.retreat(memory, creep, entry);
        return;
      }
      if (!inTarget || !this.onExit(creep.pos)) {
        const kite = chooseSoloKite(creep, nearby);
        if (kite.action !== "none" && !(this.onExit(creep.pos) && kite.detail === "maintaining ranged distance 3")) {
          memory.status = `kiting: ${kite.detail}`;
          this.movementTrace = kite.detail;
          if (kite.direction) this.move(memory, creep, kite.direction);
          return;
        }
      }
      if (!inTarget) {
        if (creep.pos.roomName === entry.roomName && this.onExit(creep.pos)) {
          const interior = new RoomPosition(
            Math.max(1, Math.min(48, creep.pos.x)),
            Math.max(1, Math.min(48, creep.pos.y)),
            entry.roomName
          );
          memory.status = "leaving staging-room border";
          this.moveToExact(memory, creep, interior);
          return;
        }
        if (creep.hits < creep.hitsMax && creep.getActiveBodyparts(HEAL) === 0) {
          this.recycle(memory, creep, options.homeRoom);
          return;
        }
        if (creep.pos.roomName !== entry.roomName) {
          memory.status = "travelling to solo entry";
          this.travel(memory, creep, new RoomPosition(entry.outside.x, entry.outside.y, entry.roomName), 1);
          return;
        }
        if (creep.hits < creep.hitsMax) {
          state.retreating = true;
          memory.status = "healing outside target";
          return;
        }
        state.retreating = false;
        if (creep.pos.x !== entry.outside.x || creep.pos.y !== entry.outside.y) {
          memory.status = "moving to staging probe position";
          this.moveToExact(memory, creep, new RoomPosition(entry.outside.x, entry.outside.y, entry.roomName));
          return;
        }
        memory.status = "probing tower";
        this.move(memory, creep, entry.inward);
        return;
      }
      if (this.onExit(creep.pos)) {
        memory.status = "entering target room";
        this.move(memory, creep, entry.inward);
        return;
      }
      const snapshot = memory.snapshot;
      if (!snapshot || activeTower) {
        memory.status = "probing within one step of exit";
        const inside = new RoomPosition(entry.inside.x, entry.inside.y, memory.targetRoom);
        if (!creep.pos.isEqualTo(inside)) this.moveToExact(memory, creep, inside);
        return;
      }
      const spawn = creep.room
        .find(FIND_HOSTILE_STRUCTURES)
        .find(structure => structure.structureType === STRUCTURE_SPAWN);
      if (!spawn) {
        memory.status = "waiting for live spawn confirmation";
        return;
      }
      memory.phase = "ASSAULT";
      memory.status = "attacking spawn";
      if (creep.pos.getRangeTo(spawn) > 3) this.travel(memory, creep, spawn.pos, 3);
    } finally {
      if (inTarget || nearby.length || attacked || lostHits) {
        const threats = nearby
          .map(hostile => {
            const range = creep.pos.getRangeTo(hostile);
            return `${hostile.id}@${hostile.pos.x},${hostile.pos.y}:range=${range},attack=${hostile.getActiveBodyparts(
              ATTACK
            )},ranged=${hostile.getActiveBodyparts(RANGED_ATTACK)},heal=${hostile.getActiveBodyparts(HEAL)}`;
          })
          .join("|");
        const towers = inTarget
          ? (memory.snapshot?.structures || [])
              .filter(structure => structure.hostile && structure.type === "tower")
              .map(tower => `${tower.id}:${tower.energy === undefined ? "unknown" : tower.energy}`)
              .join("|")
          : "not in target";
        console.log(
          `[Siege ${memory.id}] combat tick=${Game.time} creep=${creep.name} room=${creep.pos.roomName}` +
            ` pos=${creep.pos.x},${creep.pos.y} hits=${creep.hits}/${creep.hitsMax} fatigue=${creep.fatigue}` +
            ` ttl=${creep.ticksToLive === undefined ? "unknown" : creep.ticksToLive}` +
            ` phase=${memory.phase} attacked=${String(attacked)} lostHits=${String(lostHits)} retreat=${String(
              !!state.retreating
            )}` +
            ` parts=move:${creep.getActiveBodyparts(MOVE)},ranged:${creep.getActiveBodyparts(
              RANGED_ATTACK
            )},heal:${creep.getActiveBodyparts(HEAL)}` +
            ` heal=${healResult} threats=[${threats || "none"}] towers=[${towers || "none"}]` +
            ` attack="${this.attackTrace}" decision="${memory.status || "none"}" movement="${this.movementTrace}"`
        );
      }
    }
  }

  private findEntry(home: string, memory: SiegeMemory): SoloEntry | undefined {
    const exits = Game.map.describeExits(memory.targetRoom);
    const targetTerrain = Game.map.getRoomTerrain(memory.targetRoom);
    let best: { entry: SoloEntry; score: number } | undefined;
    for (const side of SIDES) {
      const roomName = exits && exits[side.exit];
      if (!roomName) continue;
      const route =
        home === roomName
          ? []
          : Game.map.findRoute(home, roomName, {
              routeCallback: () => 1
            });
      if (!Array.isArray(route)) continue;
      const neighborTerrain = Game.map.getRoomTerrain(roomName);
      for (let coordinate = 1; coordinate <= 48; coordinate++) {
        const tiles = positions(side.exit, coordinate);
        const otherBorder = {
          x: side.exit === "3" ? 0 : side.exit === "7" ? 49 : coordinate,
          y: side.exit === "1" ? 49 : side.exit === "5" ? 0 : coordinate
        };
        if (
          targetTerrain.get(tiles.inside.x, tiles.inside.y) !== 0 ||
          targetTerrain.get(tiles.border.x, tiles.border.y) === TERRAIN_MASK_WALL ||
          neighborTerrain.get(otherBorder.x, otherBorder.y) === TERRAIN_MASK_WALL ||
          neighborTerrain.get(tiles.outside.x, tiles.outside.y) !== 0
        )
          continue;
        if (
          memory.snapshot?.structures.some(
            s => s.x === tiles.inside.x && s.y === tiles.inside.y && s.type !== "road" && s.type !== "container"
          )
        )
          continue;
        const exposure = (memory.snapshot?.structures || [])
          .filter(s => s.hostile && s.type === "tower" && (s.energy || 0) >= 10)
          .reduce(
            (sum, tower) =>
              sum + towerDamage(Math.max(Math.abs(tower.x - tiles.inside.x), Math.abs(tower.y - tiles.inside.y))),
            0
          );
        const score = exposure * 100 + route.length;
        if (!best || score < best.score)
          best = {
            score,
            entry: {
              roomName,
              outside: tiles.outside,
              inside: tiles.inside,
              inward: side.inward,
              outward: side.outward
            }
          };
      }
    }
    return best?.entry;
  }

  private onExit(pos: RoomPosition): boolean {
    return pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49;
  }

  private opportunity(
    memory: SiegeMemory,
    creep: Creep,
    entry: SoloEntry,
    hostiles: Creep[],
    healingAvailable: boolean
  ): boolean {
    const state = memory.solo!;
    const structures = creep.room.find(FIND_HOSTILE_STRUCTURES);
    const spawn = structures
      .filter(structure => structure.structureType === STRUCTURE_SPAWN)
      .sort((left, right) => creep.pos.getRangeTo(left) - creep.pos.getRangeTo(right))[0];
    const towers = structures.filter(
      (structure): structure is StructureTower => structure.structureType === STRUCTURE_TOWER
    );
    if (
      !state.opportunity &&
      (!spawn ||
        creep.pos.getRangeTo(spawn) > 8 ||
        !towers.some(tower => tower.store.getUsedCapacity(RESOURCE_ENERGY) >= 10))
    ) {
      return false;
    }
    const armed = hostiles.some(
      hostile => hostile.getActiveBodyparts(ATTACK) > 0 || hostile.getActiveBodyparts(RANGED_ATTACK) > 0
    );
    if (state.opportunity === "attacking" && (!spawn || armed || creep.getActiveBodyparts(RANGED_ATTACK) === 0)) {
      state.opportunity = "retreating";
    }
    if (!state.opportunity && armed) return false;
    const exit = new RoomPosition(entry.inside.x, entry.inside.y, memory.targetRoom);
    if (state.opportunity === "retreating" && creep.pos.isEqualTo(exit)) {
      memory.status = "opportunity: exiting to heal";
      this.move(memory, creep, entry.outward);
      return true;
    }
    const plan = planSoloOpportunity(
      creep,
      spawn || towers[0],
      exit,
      towers,
      state.opportunity !== "retreating",
      healingAvailable
    );
    if (!state.opportunity && !plan.safe) {
      this.movementTrace = `opportunity declined: ${plan.detail}`;
      return false;
    }
    if (!plan.safe && state.opportunity === "attacking") {
      state.opportunity = "retreating";
      state.retreating = true;
      const escape = planSoloOpportunity(creep, spawn || towers[0], exit, towers, false, healingAvailable);
      memory.status = `opportunity: retreating; ${plan.detail}; ${escape.detail}`;
      if (escape.direction) this.move(memory, creep, escape.direction);
      else this.retreat(memory, creep, entry);
      return true;
    }
    if (state.opportunity === "retreating") {
      memory.status = `opportunity: retreating; ${plan.detail}`;
      if (plan.direction) this.move(memory, creep, plan.direction);
      else this.retreat(memory, creep, entry);
      return true;
    }
    state.opportunity = "attacking";
    memory.status = `opportunity: ${plan.direction ? "approaching spawn" : "firing on spawn"}; ${plan.detail}`;
    if (plan.direction) this.move(memory, creep, plan.direction);
    return true;
  }

  private lastStand(memory: SiegeMemory, creep: Creep, entry: SoloEntry, hostiles: Creep[]): void {
    memory.phase = "ASSAULT";
    memory.solo!.retreating = false;
    if (creep.pos.roomName !== memory.targetRoom) {
      this.fire(creep, false, hostiles);
      if (creep.pos.roomName === entry.roomName && this.onExit(creep.pos)) {
        memory.status = "last stand: leaving staging-room border";
        this.moveToExact(
          memory,
          creep,
          new RoomPosition(
            Math.max(1, Math.min(48, creep.pos.x)),
            Math.max(1, Math.min(48, creep.pos.y)),
            entry.roomName
          )
        );
      } else if (creep.pos.roomName !== entry.roomName) {
        memory.status = "last stand: travelling to entry";
        this.travel(memory, creep, new RoomPosition(entry.outside.x, entry.outside.y, entry.roomName), 1);
      } else if (creep.pos.x !== entry.outside.x || creep.pos.y !== entry.outside.y) {
        memory.status = "last stand: approaching entry";
        this.moveToExact(memory, creep, new RoomPosition(entry.outside.x, entry.outside.y, entry.roomName));
      } else {
        memory.status = "last stand: entering target";
        this.move(memory, creep, entry.inward);
      }
      return;
    }

    const structures = creep.room.find(FIND_HOSTILE_STRUCTURES);
    const byRange = (left: Structure, right: Structure): number =>
      creep.pos.getRangeTo(left) - creep.pos.getRangeTo(right);
    const spawns = structures.filter(structure => structure.structureType === STRUCTURE_SPAWN).sort(byRange);
    const otherStructures = structures.filter(structure => structure.structureType !== STRUCTURE_SPAWN).sort(byRange);
    const inRange = [...spawns, ...otherStructures].find(structure => creep.pos.getRangeTo(structure) <= 3);
    if (inRange) {
      const target = findStructureAt(creep.room, inRange.pos.x, inRange.pos.y) || inRange;
      const result = creep.rangedAttack(target);
      recordCreepAction(creep, "rangedAttack", result, {
        target: target.id,
        pos: siegePosition(target.pos),
        hits: target.hits
      });
      this.attackTrace = `ranged attack ${target.id}: ${result}`;
    } else {
      this.fire(creep, true, hostiles);
    }
    if (this.onExit(creep.pos)) {
      memory.status = "last stand: entering target room";
      this.move(memory, creep, entry.inward);
      return;
    }
    for (const structure of [...spawns, ...otherStructures]) {
      if (creep.pos.getRangeTo(structure) <= 3) {
        memory.status = `last stand: attacking ${structure.structureType} ${structure.id}`;
        return;
      }
      memory.status = `last stand: approaching ${structure.structureType} ${structure.id}`;
      const result = this.travel(memory, creep, structure.pos, 3);
      if (result !== ERR_NO_PATH) return;
    }
    memory.status = structures.length
      ? "last stand: no reachable hostile structures"
      : "last stand: no hostile structures";
  }

  private retreat(memory: SiegeMemory, creep: Creep, entry: SoloEntry): void {
    if (this.onExit(creep.pos)) {
      this.movementTrace = "hold on target border during retreat";
      return;
    }
    if (creep.pos.x === entry.inside.x && creep.pos.y === entry.inside.y) {
      this.move(memory, creep, entry.outward);
    } else {
      this.travel(memory, creep, new RoomPosition(entry.outside.x, entry.outside.y, entry.roomName), 0);
    }
  }

  private fire(creep: Creep, inTarget: boolean, hostiles: Creep[]): void {
    const members = [{ slot: "A1" as const, creep }];
    const structures = inTarget ? creep.room.find(FIND_HOSTILE_STRUCTURES) : [];
    const spawn = structures.find(
      structure => structure.structureType === STRUCTURE_SPAWN && creep.pos.getRangeTo(structure) <= 3
    );
    const target = spawn ? findStructureAt(creep.room, spawn.pos.x, spawn.pos.y) || spawn : null;
    attackWithMembers(
      members,
      chooseCreepFocus(hostiles, members) || target,
      hostiles,
      structures,
      (_member, action, result) => {
        this.attackTrace = `${action}: ${result}`;
      }
    );
  }

  private move(memory: SiegeMemory, creep: Creep, direction: DirectionConstant): void {
    const result = moveSiegeCreep(creep, direction);
    this.movementTrace += ` move direction=${direction} result=${result}`;
    if (result !== OK && result !== ERR_TIRED && result !== ERR_BUSY) memory.status = `solo move failed: ${result}`;
  }

  private moveToExact(memory: SiegeMemory, creep: Creep, pos: RoomPosition): void {
    const result = creep.moveTo(pos, { range: 0, maxRooms: 1 });
    recordCreepAction(creep, "moveTo", result, { destination: siegePosition(pos), range: 0 });
    this.movementTrace = `moveTo ${pos.roomName}:${pos.x},${pos.y} result=${result}`;
    if (result !== OK && result !== ERR_TIRED && result !== ERR_BUSY) memory.status = `solo move failed: ${result}`;
  }

  private recycle(memory: SiegeMemory, creep: Creep, homeRoom: string | undefined): void {
    const home = homeRoom ? Game.rooms[homeRoom] : undefined;
    const spawn = home?.find(FIND_MY_SPAWNS)[0];
    if (!spawn) {
      memory.status = "cannot heal; waiting for a home spawn to recycle";
      return;
    }
    memory.status = "returning to recycle: no active healing parts";
    if (creep.pos.roomName !== spawn.pos.roomName || creep.pos.getRangeTo(spawn) > 1) {
      this.travel(memory, creep, spawn.pos, 1);
      return;
    }
    const result = spawn.recycleCreep(creep);
    if (result !== OK && result !== ERR_BUSY) memory.status = `solo recycle failed: ${result}`;
  }

  private travel(memory: SiegeMemory, creep: Creep, pos: RoomPosition, range: number): ReturnType<Creep["travelTo"]> {
    const result = travelSiegeCreep(creep, pos, keeperSafeTravel(range));
    this.movementTrace = `travel ${pos.roomName}:${pos.x},${pos.y} range=${range} result=${result}`;
    if (result !== OK && result !== ERR_TIRED && result !== ERR_BUSY) memory.status = `solo travel failed: ${result}`;
    return result;
  }
}
