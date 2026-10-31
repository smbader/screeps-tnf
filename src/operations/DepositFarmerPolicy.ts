import type { DepositSightingMemory } from "./DepositFarmerTypes";

const ROOM_SCAN_DISTANCE = 10;
const ROOM_COORDINATES = /^([WE])(\d+)([NS])(\d+)$/;

export function getObserverCandidateRooms(
  homeRoom: string,
  getNeighbors: (roomName: string) => string[] | null,
  maxDistance = ROOM_SCAN_DISTANCE
): string[] {
  const queue: { roomName: string; distance: number }[] = [{ roomName: homeRoom, distance: 0 }];
  const visited = new Set<string>([homeRoom]);
  const candidates: string[] = [];

  for (const current of queue) {
    if (current.distance >= maxDistance) continue;

    const neighbors = getNeighbors(current.roomName);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (visited.has(neighbor) || !ROOM_COORDINATES.test(neighbor)) continue;
      visited.add(neighbor);
      candidates.push(neighbor);
      queue.push({ roomName: neighbor, distance: current.distance + 1 });
    }
  }

  return candidates;
}

export function isDepositOpportunityViable(
  sighting: DepositSightingMemory,
  homeRoom: string,
  now: number,
  getLinearDistance: (fromRoom: string, toRoom: string) => number,
  maxSightingAge = 500,
  minimumRemainingLifetime = 300
): boolean {
  const sightingAge = Math.max(0, now - sighting.lastSeen);
  if (sightingAge > maxSightingAge) return false;

  const distance = getLinearDistance(homeRoom, sighting.roomName);
  if (!Number.isFinite(distance) || distance < 0) return false;

  const remainingLifetime = sighting.ticksToDecay - sightingAge - Math.max(0, sighting.cooldown - sightingAge);
  const minimumLifetime = distance * 100 + minimumRemainingLifetime;
  return remainingLifetime > minimumLifetime;
}
