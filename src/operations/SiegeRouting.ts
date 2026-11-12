import type { TravelToOptions } from "../utils/Traveler";

export function isKeeperRoom(roomName: string): boolean {
  const match = /^[WE](\d+)[NS](\d+)$/.exec(roomName);
  if (!match) return false;
  const x = Number(match[1]) % 10;
  const y = Number(match[2]) % 10;
  return x >= 4 && x <= 6 && y >= 4 && y <= 6 && !(x === 5 && y === 5);
}

export function keeperSafeTravel(range: number): TravelToOptions {
  return {
    range,
    allowHostile: true,
    useFindRoute: true,
    routeCallback: roomName => (isKeeperRoom(roomName) ? Infinity : 2.5),
    roomCallback: (roomName, matrix) => (isKeeperRoom(roomName) ? false : matrix)
  };
}
