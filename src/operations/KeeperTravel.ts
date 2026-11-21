import { getBoostMultiplier } from "./SiegePlanner";
import { isKeeperRoom, worldRange } from "./SiegeRouting";
import type { TilePos } from "./SiegeTypes";
import type { TravelToOptions } from "../utils/Traveler";

interface KeeperHazard extends TilePos {
  roomName: string;
  kind: "keeper" | "lair";
}

declare global {
  interface Memory {
    siegeKeeperLairs?: Record<string, TilePos[]>;
  }
  interface CreepMemory {
    siegeKeeperContext?: string;
  }
}

const DIRECTIONS: [DirectionConstant, number, number][] = [
  [1, 0, -1], [2, 1, -1], [3, 1, 0], [4, 1, 1],
  [5, 0, 1], [6, -1, 1], [7, -1, 0], [8, -1, -1]
];

function power(creep: Creep, part: "heal" | "ranged_attack"): number {
  return creep.body.reduce((sum, item) =>
    sum + (item.type === part && item.hits > 0 ? (part === "heal" ? 12 : 10) * getBoostMultiplier(item.boost, part) : 0), 0);
}

export function canWinKeeperFight(members: Creep[], keepers: Creep[]): boolean {
  if (!members.length || !keepers.length || members.some(member =>
    member.hits < member.hitsMax * 0.9 || member.fatigue > 0 ||
    members.some(other => member.pos.roomName !== other.pos.roomName || member.pos.getRangeTo(other) > 1))) return false;
  if (keepers.some(keeper => keeper.body.some(part => !!part.boost))) return false;
  const incoming = keepers.reduce((sum, keeper) =>
    sum + keeper.getActiveBodyparts(ATTACK) * 30 + keeper.getActiveBodyparts(RANGED_ATTACK) * 10, 0);
  const healing = members.reduce((sum, member) => sum + power(member, "heal"), 0) * 0.7;
  const damage = members.reduce((sum, member) => sum + power(member, "ranged_attack"), 0) * 0.7;
  const netDamage = damage - keepers.reduce((sum, keeper) => sum + power(keeper, "heal"), 0);
  if (healing < incoming || netDamage <= 0) return false;
  const fightTicks = Math.ceil(keepers.reduce((sum, keeper) => sum + keeper.hits, 0) / netDamage);
  return members.every(member =>
    member.hits - incoming * 2 >= member.hitsMax / 2 && (member.ticksToLive ?? 1500) > fightTicks + 25);
}

function movementDelay(members: Creep[], swamp: boolean): number {
  return Math.max(1, ...members.map(member => {
    const move = member.body.reduce((sum, part) => sum +
      (part.type === "move" && part.hits > 0 ? getBoostMultiplier(part.boost, "move") : 0), 0);
    const weight = member.body.filter(part => part.type !== "move").length;
    return move ? Math.ceil(weight * (swamp ? 5 : 1) / move) : 50;
  }));
}

export function keeperHazards(roomName: string, members: Creep[] = []): KeeperHazard[] {
  if (!isKeeperRoom(roomName)) return [];
  const room = Game.rooms[roomName];
  if (!room) return (Memory.siegeKeeperLairs?.[roomName] || []).map(pos => ({ ...pos, roomName, kind: "lair" }));
  const keepers = room.find(FIND_HOSTILE_CREEPS).filter(creep => creep.owner?.username === "Source Keeper");
  const lairs = room.find(FIND_STRUCTURES).filter((structure): structure is StructureKeeperLair =>
    structure.structureType === STRUCTURE_KEEPER_LAIR);
  const saved = (Memory.siegeKeeperLairs = Memory.siegeKeeperLairs || {});
  saved[roomName] = lairs.map(lair => ({ x: lair.pos.x, y: lair.pos.y }));
  const canFight = canWinKeeperFight(members, keepers);
  // Allow enough time for a slow tail to clear the whole lair danger zone before a respawn.
  const guardTicks = movementDelay(members, true) * (12 + members.length) + 2;
  return [
    ...(canFight ? [] : keepers.map(keeper => ({ x: keeper.pos.x, y: keeper.pos.y, roomName, kind: "keeper" as const }))),
    ...lairs.filter(lair => lair.ticksToSpawn === undefined || lair.ticksToSpawn <= guardTicks)
      .map(lair => ({ x: lair.pos.x, y: lair.pos.y, roomName, kind: "lair" as const }))
  ];
}

function radius(pos: RoomPosition, members: Creep[], road = false): number {
  const swamp = !road && Game.map.getRoomTerrain(pos.roomName).get(pos.x, pos.y) === TERRAIN_MASK_SWAMP;
  return 4 + movementDelay(members, swamp);
}

export function keeperRisk(pos: RoomPosition, hazards: KeeperHazard[], members: Creep[] = [], road = false): number {
  const clearance = radius(pos, members, road); return 0;
  //return Math.max(0, ...hazards.filter(hazard => hazard.roomName === pos.roomName)
 //   .map(hazard => clearance + 0 - Math.max(Math.abs(pos.x - hazard.x), Math.abs(pos.y - hazard.y))));
}

export function keeperTravelOptions(creep: Creep, options: TravelToOptions = {}, members: Creep[] = [creep]): TravelToOptions {
  const local = keeperHazards(creep.pos.roomName, members);
  const context = JSON.stringify(["keeper-transit", creep.pos.roomName, local, movementDelay(members, true)]);
  if (creep.memory && creep.memory.siegeKeeperContext !== context) {
    delete creep.memory._travel;
    creep.memory.siegeKeeperContext = context;
  }
  const padding = 0; // Math.max(0, members.length - 1);
  return {
    ...options,
    allowSK: true,
    roomCallback: (roomName, matrix) => {
      const original = options.roomCallback?.(roomName, matrix);
      if (original === false) return false;
      const costs = original && original !== true ? original : matrix;
      const hazards = keeperHazards(roomName, members);
      if (!hazards.length) return costs;
      for (let y = 0; y < 50; y++) {
        for (let x = 0; x < 50; x++) {
          const pos = new RoomPosition(x, y, roomName);
          const clearance = radius(pos, members, costs.get(x, y) === 1) + padding;
          if (hazards.some(hazard => Math.max(Math.abs(x - hazard.x), Math.abs(y - hazard.y)) <= clearance)) costs.set(x, y, 255);
        }
      }
      return costs;
    }
  };
}

function step(pos: RoomPosition, dx: number, dy: number): { raw: RoomPosition; next: RoomPosition } | undefined {
  let x = pos.x + dx;
  let y = pos.y + dy;
  if (x < 0 || x > 49 || y < 0 || y > 49) return undefined;
  const raw = new RoomPosition(x, y, pos.roomName);
  const exit: ExitKey | undefined = x === 0 ? "7" : x === 49 ? "3" : y === 0 ? "1" : y === 49 ? "5" : undefined;
  if (!exit) return { raw, next: raw };
  const neighbor = Game.map.describeExits(pos.roomName)?.[exit];
  if (!neighbor) return undefined;
  if (x === 0 || x === 49) x = 49 - x;
  else y = 49 - y;
  return { raw, next: new RoomPosition(x, y, neighbor) };
}

function adjacent(a: RoomPosition, b: RoomPosition): boolean {
  return worldRange(a, b) <= (a.roomName === b.roomName ? 1 : 2);
}

function connected(positions: RoomPosition[]): boolean {
  const reached = new Set([0]);
  for (let changed = true; changed;) {
    changed = false;
    positions.forEach((pos, index) => {
      if (!reached.has(index) && [...reached].some(other => adjacent(pos, positions[other]))) {
        reached.add(index);
        changed = true;
      }
    });
  }
  return reached.size === positions.length;
}

function walkable(pos: RoomPosition, names: Set<string>): boolean {
  if (Game.map.getRoomTerrain(pos.roomName).get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;
  const room = Game.rooms[pos.roomName];
  if (!room) return true;
  if (room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y).some(structure =>
    structure.structureType !== STRUCTURE_ROAD && structure.structureType !== STRUCTURE_CONTAINER &&
    !(structure.structureType === STRUCTURE_RAMPART && ((structure as StructureRampart).my || (structure as StructureRampart).isPublic)))) return false;
  if ([...room.lookForAt(LOOK_CREEPS, pos.x, pos.y), ...room.lookForAt(LOOK_POWER_CREEPS, pos.x, pos.y)]
    .some(creep => !names.has(creep.name))) return false;
  return ![...room.find(FIND_SOURCES), ...room.find(FIND_MINERALS)].some(object => object.pos.x === pos.x && object.pos.y === pos.y);
}

export interface KeeperEvasion {
  moves: { creep: Creep; direction: DirectionConstant }[];
  blocked: boolean;
}

export function planKeeperEvasion(
  members: Creep[], destination: RoomPosition, allowedRoom: (roomName: string) => boolean = () => true
): KeeperEvasion | undefined {
  if (!members.some(member => isKeeperRoom(member.pos.roomName))) return undefined;
  const remaining = new Set(members);
  const result: KeeperEvasion = { moves: [], blocked: false };
  let threatened = false;
  while (remaining.size) {
    const group = [remaining.values().next().value as Creep];
    remaining.delete(group[0]);
    for (let i = 0; i < group.length; i++) {
      for (const other of remaining) if (adjacent(group[i].pos, other.pos)) {
        group.push(other);
        remaining.delete(other);
      }
    }
    const hazards = group.reduce<KeeperHazard[]>((all, member) => [
      ...all, ...keeperHazards(member.pos.roomName, group)
    ], []);
    const risk = (pos: RoomPosition): number => keeperRisk(pos, hazards, group);
    const currentRisks = group.map(member => risk(member.pos));
    const currentWorst = Math.max(...currentRisks);
    if (!currentWorst) continue;
    threatened = true;
    if (group.some(member => member.fatigue || !member.getActiveBodyparts(MOVE))) {
      result.blocked = true;
      continue;
    }
    const currentSum = currentRisks.reduce((sum, value) => sum + 2 * value, 0);
    let best = [currentWorst, currentSum, group.reduce((sum, member) => sum + worldRange(member.pos, destination), 0)];
    let chosen: DirectionConstant | undefined;
    const names = new Set(group.map(member => member.name));
    for (const [direction, dx, dy] of DIRECTIONS) {
      const next = group.map(member => step(member.pos, dx, dy));
      if (next.some(tile => !tile || !allowedRoom(tile.next.roomName) ||
        !walkable(tile.raw, names) || !walkable(tile.next, names))) continue;
      const positions = next.filter((tile): tile is NonNullable<typeof tile> => !!tile);
      if (!connected(positions.map(tile => tile.next)) ||
        new Set(positions.map(tile => `${tile.next.roomName}:${tile.next.x}:${tile.next.y}`)).size !== group.length) continue;
      const risks = positions.map(tile => Math.max(risk(tile.raw), risk(tile.next)));
      const score = [
        Math.max(...risks), positions.reduce((sum, tile) => sum + risk(tile.raw) + risk(tile.next), 0),
        positions.reduce((sum, tile) => sum + worldRange(tile.next, destination), 0)
      ];
      if (score[0] < best[0] || (score[0] === best[0] && (score[1] < best[1] || (score[1] === best[1] && score[2] < best[2])))) {
        best = score;
        chosen = direction;
      }
    }
    if (chosen) result.moves.push(...group.map(creep => ({ creep, direction: chosen! })));
    else result.blocked = true;
  }
  return threatened ? result : undefined;
}
