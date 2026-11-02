import type { QuadSlot, TilePos } from "./SiegeTypes";
import { QUAD_SLOTS } from "./SiegeTypes";
import { chebyshev, getFootprint } from "./SiegePlanner";

export interface QuadMember {
  slot: QuadSlot;
  creep: Creep;
}

export type StepResult = "MOVED" | "FATIGUED" | "NOT_FORMED" | "BLOCKED";
export type FileResult = "MOVING" | "WAITING" | "ARRIVED";

export type FileAdvanceResult = "MOVING" | "WAITING" | "BLOCKED" | "DONE" | "OFF_PATH";

const FILE_ORDER: QuadSlot[] = ["A1", "A2", "S1", "S2"];

const DIRECTIONS: Record<string, DirectionConstant> = {
  "0,-1": TOP,
  "1,-1": TOP_RIGHT,
  "1,0": RIGHT,
  "1,1": BOTTOM_RIGHT,
  "0,1": BOTTOM,
  "-1,1": BOTTOM_LEFT,
  "-1,0": LEFT,
  "-1,-1": TOP_LEFT
};

export function getDirection(from: TilePos, to: TilePos): DirectionConstant | null {
  return DIRECTIONS[`${Math.sign(to.x - from.x)},${Math.sign(to.y - from.y)}`] || null;
}

// Room-independent coordinates so tiles on either side of a room border count as adjacent.
function worldXY(pos: RoomPosition): TilePos {
  const match = /^([WE])(\d+)([NS])(\d+)$/.exec(pos.roomName);
  if (!match) return { x: pos.x, y: pos.y };
  const roomX = match[1] === "E" ? Number(match[2]) : -Number(match[2]) - 1;
  const roomY = match[3] === "S" ? Number(match[4]) : -Number(match[4]) - 1;
  return { x: roomX * 50 + pos.x, y: roomY * 50 + pos.y };
}

function worldRange(a: RoomPosition, b: RoomPosition): number {
  const left = worldXY(a);
  const right = worldXY(b);
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function worldDirection(from: RoomPosition, to: RoomPosition): DirectionConstant | null {
  return getDirection(worldXY(from), worldXY(to));
}

const STUCK_TICKS = 4;
const REVERSE_TICKS = 25;
const TRAIL_TICKS = 40;
const DEAD_END_TICKS = 300;

const STALL_TICKS = 8;
const SCATTER_TICKS = 60;

interface FileState {
  sig: string;
  sigSince: number;
  scatterUntil: number;
  rally?: RoomPosition;
  lastKey: string;
  still: number;
  trail: { pos: RoomPosition; tick: number }[];
  deadEnds: { pos: RoomPosition; until: number }[];
  reverseUntil: number;
  reverseTarget?: RoomPosition;
}

const fileStates: Record<string, FileState> = {};

function getFileState(name: string): FileState {
  return (fileStates[name] = fileStates[name] || {
    sig: "",
    sigSince: 0,
    scatterUntil: 0,
    lastKey: "",
    still: 0,
    trail: [],
    deadEnds: [],
    reverseUntil: 0
  });
}

// The closest tile whose neighbourhood is mostly open ground, so a 2x2 quad can stand there without wedging.
function findOpenSpot(room: Room, from: RoomPosition): RoomPosition | undefined {
  const terrain = room.getTerrain();
  const blocked = new Set(
    room
      .find(FIND_STRUCTURES)
      .filter(s => s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_CONTAINER && !(s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my))
      .map(s => `${s.pos.x},${s.pos.y}`)
  );
  const free = (x: number, y: number): boolean => x >= 1 && y >= 1 && x <= 48 && y <= 48 && terrain.get(x, y) !== TERRAIN_MASK_WALL && !blocked.has(`${x},${y}`);
  let best: RoomPosition | undefined;
  let bestRange = Infinity;
  for (let x = Math.max(2, from.x - 12); x <= Math.min(47, from.x + 12); x++) {
    for (let y = Math.max(2, from.y - 12); y <= Math.min(47, from.y + 12); y++) {
      if (!free(x, y)) continue;
      let open = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if ((dx || dy) && free(x + dx, y + dy)) open++;
      const range = Math.max(Math.abs(x - from.x), Math.abs(y - from.y));
      if (open >= 7 && range < bestRange) {
        best = new RoomPosition(x, y, room.name);
        bestRange = range;
      }
    }
  }
  return best;
}

const HOSTILE_ROOM_ROUTE_COST = 25;

// Rooms owned by other players are remembered so travel detours around their bases instead of crossing them.
function noteHostileRooms(): Set<string> {
  const store = Memory as unknown as { siegeHostileRooms?: Record<string, number> };
  const known = (store.siegeHostileRooms = store.siegeHostileRooms || {});
  for (const room of Object.values(Game.rooms)) {
    const controller = room.controller;
    if (controller?.owner && !controller.my) known[room.name] = Game.time;
    else if (controller && !controller.owner && known[room.name]) delete known[room.name];
  }
  return new Set(Object.keys(known));
}

function quadTravel(destinationRoom: string, range: number): TravelToOptions {
  const hostile = noteHostileRooms();
  return {
    range,
    allowHostile: true,
    useFindRoute: true,
    routeCallback: (roomName: string) => (hostile.has(roomName) && roomName !== destinationRoom ? HOSTILE_ROOM_ROUTE_COST : (undefined as unknown as number))
  };
}

function isEdge(pos: RoomPosition): boolean {
  return pos.x === 0 || pos.y === 0 || pos.x === 49 || pos.y === 49;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const result: T[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) result.push([item, ...tail]);
  });
  return result;
}

export class QuadController {
  public readonly members: QuadMember[];

  public constructor(members: QuadMember[]) {
    this.members = [...members].sort((left, right) => FILE_ORDER.indexOf(left.slot) - FILE_ORDER.indexOf(right.slot));
  }

  public get creeps(): Creep[] {
    return this.members.map(member => member.creep);
  }

  public get isComplete(): boolean {
    return this.members.length === QUAD_SLOTS.length;
  }

  public anyFatigued(): boolean {
    return this.members.some(member => member.creep.fatigue > 0);
  }

  public minHitsFraction(): number {
    return Math.min(...this.members.map(member => member.creep.hits / member.creep.hitsMax));
  }

  public roomName(): string | null {
    const rooms = new Set(this.members.map(member => member.creep.pos.roomName));
    return rooms.size === 1 ? this.members[0].creep.pos.roomName : null;
  }

  // The top-left tile of the 2x2 block when all four members form one, otherwise null.
  public getAnchor(): TilePos | null {
    if (!this.isComplete || !this.roomName()) return null;
    const xs = this.members.map(member => member.creep.pos.x);
    const ys = this.members.map(member => member.creep.pos.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    if (Math.max(...xs) - x !== 1 || Math.max(...ys) - y !== 1) return null;
    const tiles = new Set(this.members.map(member => `${member.creep.pos.x},${member.creep.pos.y}`));
    return tiles.size === 4 ? { x, y } : null;
  }

  public isFormedAt(anchor: TilePos): boolean {
    const current = this.getAnchor();
    return !!current && current.x === anchor.x && current.y === anchor.y;
  }

  // Moves every member toward a tile of the footprint using the cheapest assignment so members never fight over tiles.
  public formUp(roomName: string, anchor: TilePos): boolean {
    if (this.isFormedAt(anchor) && this.roomName() === roomName) return true;
    const footprint = getFootprint(anchor);
    const inRoom = this.members.filter(member => member.creep.pos.roomName === roomName);
    const assigned = new Map<string, TilePos>();

    let bestCost = Infinity;
    let best: TilePos[] = [];
    for (const order of permutations(footprint)) {
      let cost = 0;
      inRoom.forEach((member, index) => {
        cost += chebyshev(member.creep.pos, order[index]);
      });
      if (cost < bestCost) {
        bestCost = cost;
        best = order;
      }
    }
    inRoom.forEach((member, index) => assigned.set(member.creep.name, best[index]));

    for (const member of this.members) {
      const tile = assigned.get(member.creep.name) || footprint[0];
      if (member.creep.pos.roomName === roomName && member.creep.pos.x === tile.x && member.creep.pos.y === tile.y) {
        continue;
      }
      member.creep.travelTo(new RoomPosition(tile.x, tile.y, roomName), quadTravel(roomName, 0));
    }
    return false;
  }

  // Moves the whole block one anchor step; nobody moves unless everyone can.
  public stepTo(from: TilePos, to: TilePos): StepResult {
    if (!this.isFormedAt(from)) return "NOT_FORMED";
    if (this.anyFatigued()) return "FATIGUED";

    const direction = getDirection(from, to);
    if (!direction) return "BLOCKED";
    const room = this.members[0].creep.room;
    const quadNames = new Set(this.members.map(member => member.creep.name));

    for (const tile of getFootprint(to)) {
      const occupants = room.lookForAt(LOOK_CREEPS, tile.x, tile.y);
      if (occupants.some(creep => !quadNames.has(creep.name))) return "BLOCKED";
    }

    for (const member of this.members) member.creep.move(direction);
    return "MOVED";
  }

  // Walks the whole quad single file along explicit tiles; DONE once the leader reaches the last tile.
  public advanceFile(file: RoomPosition[], isBlocked: (pos: RoomPosition) => boolean): FileAdvanceResult {
    const [leader, ...followers] = this.members;
    if (!leader || !file.length) return "OFF_PATH";
    const index = file.findIndex(pos => pos.isEqualTo(leader.creep.pos));
    if (index === -1 && (leader.creep.pos.roomName !== file[0].roomName || leader.creep.pos.getRangeTo(file[0]) > 1)) {
      return "OFF_PATH";
    }
    if (index === file.length - 1) return "DONE";

    const next = file[index + 1];
    let ahead = leader.creep;
    let tight = true;
    for (const follower of followers) {
      if (worldRange(follower.creep.pos, ahead.pos) > 1) {
        tight = false;
        follower.creep.travelTo(ahead.pos, quadTravel(ahead.pos.roomName, 1));
      }
      ahead = follower.creep;
    }
    if (isBlocked(next)) return "BLOCKED";
    if (!tight || this.anyFatigued()) return "WAITING";

    const direction = worldDirection(leader.creep.pos, next);
    if (direction) leader.creep.move(direction);
    ahead = leader.creep;
    for (const follower of followers) {
      const followDirection = worldDirection(follower.creep.pos, ahead.pos);
      if (followDirection) follower.creep.move(followDirection);
      ahead = follower.creep;
    }
    return "MOVING";
  }

  // When no member has moved for several ticks the quad is wedged: break formation and regroup at an open tile.
  private detectStall(state: FileState): boolean {
    const signature = this.members.map(member => `${member.creep.pos.roomName}:${member.creep.pos.x},${member.creep.pos.y}`).join("|");
    if (signature !== state.sig) {
      state.sig = signature;
      state.sigSince = Game.time;
      return false;
    }
    if (Game.time - state.sigSince < STALL_TICKS) return false;

    const leader = this.members[0].creep;
    const room = leader.room;
    state.rally = findOpenSpot(room, leader.pos);
    state.scatterUntil = Game.time + SCATTER_TICKS;
    state.sigSince = Game.time;
    for (const member of this.members.slice(1)) {
      state.deadEnds.push({ pos: member.creep.pos, until: Game.time + DEAD_END_TICKS });
    }
    state.trail = [];
    state.reverseUntil = 0;
    return !!state.rally && this.scatter(state);
  }

  // Every member heads for the rally tile on its own; the one nearest the exit leaves first and the rest follow into the freed tiles.
  private scatter(state: FileState): boolean {
    const rally = state.rally;
    if (!rally) return false;
    if (this.members.every(member => worldRange(member.creep.pos, rally) <= 3 && member.creep.pos.roomName === rally.roomName)) {
      state.scatterUntil = 0;
      state.sigSince = Game.time;
      return false;
    }
    for (const member of this.members) {
      if (member.creep.pos.roomName === rally.roomName && member.creep.pos.getRangeTo(rally) <= 2) continue;
      member.creep.travelTo(rally, { range: 2, allowHostile: true, ignoreCreeps: false });
    }
    return true;
  }

  // Counts ticks where the moving leader stays put and starts a reversal once it is clearly boxed in.
  private trackProgress(state: FileState, leader: Creep): void {
    const key = `${leader.pos.roomName}:${leader.pos.x},${leader.pos.y}`;
    if (key === state.lastKey) {
      state.still++;
    } else {
      state.still = 0;
      state.lastKey = key;
      state.trail.push({ pos: leader.pos, tick: Game.time });
    }
    if (state.still < STUCK_TICKS || state.trail.length < 2) return;

    state.deadEnds.push({ pos: leader.pos, until: Game.time + DEAD_END_TICKS });
    state.reverseTarget = state.trail[0].pos;
    state.reverseUntil = Game.time + REVERSE_TICKS;
    state.still = 0;
    state.trail = [];
    state.lastKey = "";
  }

  // Single file travel: the leader paths normally and every other member steps into the tile of the one ahead.
  // If the leader makes no progress, the chain reverses: the tail leads back along the trail and everyone shifts the same way.
  public moveFile(destination: RoomPosition, destinationRange: number): FileResult {
    const original = this.members[0];
    if (!original) return "WAITING";
    const state = getFileState(original.creep.name);
    state.trail = state.trail.filter(tile => Game.time - tile.tick <= TRAIL_TICKS);

    if (state.scatterUntil > Game.time && state.rally) {
      if (this.scatter(state)) return "WAITING";
    }

    let reversing = state.reverseUntil > Game.time && !!state.reverseTarget;
    const order = reversing ? [...this.members].reverse() : this.members;
    const [leader, ...followers] = order;
    const target = reversing ? state.reverseTarget! : destination;
    const range = reversing ? 0 : destinationRange;

    if (reversing && leader.creep.pos.isEqualTo(target)) {
      state.reverseUntil = 0;
      state.still = 0;
      reversing = false;
    }

    const leaderInRoom = leader.creep.pos.roomName === target.roomName;
    if (!reversing && leaderInRoom && leader.creep.pos.getRangeTo(target) <= range && !isEdge(leader.creep.pos)) {
      let ahead = leader.creep;
      let tight = true;
      for (const follower of followers) {
        if (worldRange(follower.creep.pos, ahead.pos) > 1) {
          follower.creep.travelTo((follower.creep.pos.roomName === ahead.pos.roomName ? ahead : leader.creep).pos, quadTravel(target.roomName, 1));
          tight = false;
        }
        ahead = follower.creep;
      }
      return tight ? "ARRIVED" : "WAITING";
    }

    if (this.anyFatigued()) {
      state.sigSince = Game.time;
      return "WAITING";
    }
    if (this.detectStall(state)) return "WAITING";

    let chainTight = true;
    let ahead = leader.creep;
    for (const follower of followers) {
      if (worldRange(follower.creep.pos, ahead.pos) > 2) {
        chainTight = false;
      }
      ahead = follower.creep;
    }

    const leaderMoves = chainTight || isEdge(leader.creep.pos);
    if (leaderMoves) {
      const options = quadTravel(target.roomName, range);
      if (!reversing) {
        options.obstacles = state.deadEnds.filter(tile => tile.until > Game.time).map(tile => ({ pos: tile.pos }));
        this.trackProgress(state, leader.creep);
      }
      leader.creep.travelTo(target, options);
    }

    ahead = leader.creep;
    for (const follower of followers) {
      if (worldRange(follower.creep.pos, ahead.pos) <= 1) {
        if (leaderMoves) {
          const direction = worldDirection(follower.creep.pos, ahead.pos);
          if (direction) follower.creep.move(direction);
        }
      } else {
        follower.creep.travelTo((follower.creep.pos.roomName === ahead.pos.roomName ? ahead : leader.creep).pos, quadTravel(target.roomName, 1));
      }
      ahead = follower.creep;
    }
    return leaderMoves ? "MOVING" : "WAITING";
  }
}
