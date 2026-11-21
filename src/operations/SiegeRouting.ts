import type { TravelToOptions } from "../utils/Traveler";

declare global {
  interface Memory {
    siegeHostileRooms?: Record<string, number>;
  }
}

export function noteHostileRooms(): Set<string> {
  const known = (Memory.siegeHostileRooms = Memory.siegeHostileRooms || {});
  const ownedNames = new Set<string>();
  for (const room of Object.values(Game.rooms)) {
    const owner = room.controller?.my && room.controller.owner?.username;
    if (owner) ownedNames.add(owner);
  }
  // MapHelper retains ownership after vision is lost, including rooms a scout died in.
  if (ownedNames.size) {
    for (const [roomName, intel] of Object.entries(Memory.rooms || {})) {
      if (intel.owner && !ownedNames.has(intel.owner) && known[roomName] === undefined) {
        known[roomName] = intel.cacheTime || Game.time;
      }
    }
  }
  for (const room of Object.values(Game.rooms)) {
    const controller = room.controller;
    if (controller?.owner && !controller.my) known[room.name] = Game.time;
    else if (controller && (controller.my || !controller.owner)) delete known[room.name];
  }
  return new Set(Object.keys(known));
}

export function isKeeperRoom(roomName: string): boolean {
  const match = /^[WE](\d+)[NS](\d+)$/.exec(roomName);
  if (!match) return false;
  const x = Number(match[1]) % 10;
  const y = Number(match[2]) % 10;
  return x >= 4 && x <= 6 && y >= 4 && y <= 6 && !(x === 5 && y === 5);
}

export function worldXY(pos: RoomPosition): { x: number; y: number } {
  const match = /^([WE])(\d+)([NS])(\d+)$/.exec(pos.roomName);
  if (!match) return { x: pos.x, y: pos.y };
  const roomX = match[1] === "E" ? Number(match[2]) : -Number(match[2]) - 1;
  const roomY = match[3] === "S" ? Number(match[4]) : -Number(match[4]) - 1;
  return { x: roomX * 50 + pos.x, y: roomY * 50 + pos.y };
}

export function worldRange(a: RoomPosition, b: RoomPosition): number {
  const left = worldXY(a);
  const right = worldXY(b);
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

export function keeperSafeTravel(range: number): TravelToOptions {
  return {
    range,
    allowHostile: true,
    allowSK: true,
    useFindRoute: true,
    routeCallback: () => 2.5,
    roomCallback: (_roomName, matrix) => matrix
  };
}
