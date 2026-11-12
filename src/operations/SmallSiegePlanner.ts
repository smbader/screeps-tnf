import {
  buildExposureMap,
  buildGrid,
  getAnchorExposure,
  getFootprint,
  isAnchorClear,
  ROOM_SIZE,
  TERRAIN_WALL
} from "./SiegePlanner";
import type { RoomSide, RoomSnapshot, TilePos } from "./SiegeTypes";

// Find a clear formation reachable single-file from an allowed room exit.
export interface DrainEntry {
  anchor: TilePos;
  side: RoomSide;
  entry: TilePos;
}

export function chooseDrainEntry(
  snapshot: RoomSnapshot,
  terrain: ArrayLike<number>,
  allowedSides: RoomSide[],
  canEnter: (side: RoomSide, coordinate: number) => boolean = () => true
): DrainEntry | undefined {
  const grid = buildGrid(snapshot, terrain);
  const exposure = buildExposureMap(snapshot);
  const visited = new Uint8Array(ROOM_SIZE * ROOM_SIZE);
  const seeds: { side: RoomSide; entry: TilePos }[] = [];
  const seedFor = new Int32Array(ROOM_SIZE * ROOM_SIZE).fill(-1);
  const queue: number[] = [];
  const push = (x: number, y: number, seedIndex: number): void => {
    if (x < 0 || y < 0 || x >= ROOM_SIZE || y >= ROOM_SIZE) return;
    const index = y * ROOM_SIZE + x;
    if (visited[index] || terrain[index] === TERRAIN_WALL || grid.blockHits[index] > 0) return;
    visited[index] = 1;
    seedFor[index] = seedIndex;
    queue.push(index);
  };
  const seed = (x: number, y: number, side: RoomSide): void => {
    const index = seeds.length;
    seeds.push({ side, entry: { x, y } });
    push(x, y, index);
  };
  for (let i = 1; i < ROOM_SIZE - 1; i++) {
    if (allowedSides.includes("top") && canEnter("top", i)) seed(i, 0, "top");
    if (allowedSides.includes("bottom") && canEnter("bottom", i)) seed(i, ROOM_SIZE - 1, "bottom");
    if (allowedSides.includes("left") && canEnter("left", i)) seed(0, i, "left");
    if (allowedSides.includes("right") && canEnter("right", i)) seed(ROOM_SIZE - 1, i, "right");
  }
  for (const index of queue) {
    const x = index % ROOM_SIZE;
    const y = Math.floor(index / ROOM_SIZE);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx || dy) push(x + dx, y + dy, seedFor[index]);
      }
    }
  }
  let best: DrainEntry | undefined;
  let bestExposure = Infinity;
  let bestExitDistance = Infinity;
  for (let y = 1; y <= ROOM_SIZE - 3; y++) {
    for (let x = 1; x <= ROOM_SIZE - 3; x++) {
      const anchor = { x, y };
      if (!isAnchorClear(grid, anchor) || !getFootprint(anchor).every(tile => visited[tile.y * ROOM_SIZE + tile.x])) {
        continue;
      }
      const damage = getAnchorExposure(exposure, anchor);
      const distances: number[] = [];
      if (allowedSides.includes("top")) distances.push(y);
      if (allowedSides.includes("bottom")) distances.push(ROOM_SIZE - 2 - y);
      if (allowedSides.includes("left")) distances.push(x);
      if (allowedSides.includes("right")) distances.push(ROOM_SIZE - 2 - x);
      const exitDistance = Math.min(...distances);
      if (damage < bestExposure || (damage === bestExposure && exitDistance < bestExitDistance)) {
        const origin = seeds[seedFor[y * ROOM_SIZE + x]];
        best = { anchor, side: origin.side, entry: origin.entry };
        bestExposure = damage;
        bestExitDistance = exitDistance;
      }
    }
  }
  return best;
}
