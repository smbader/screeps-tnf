import {
  IMPASSABLE_HITS,
  MinHeap,
  SiegeGrid,
  buildExposureMap,
  buildGrid,
  chebyshev,
  getAnchorExposure,
  getFootprint,
  isAnchorClear
} from "./SiegePlanner";
import type { ProbeEstimate, RoomSide, RoomSnapshot, TilePos } from "./SiegeTypes";

export interface ProbeMemberState {
  body: { type: BodyPartConstant; hits: number }[];
  fatigue: number;
  ticksToLive?: number;
}

export interface ProbeEntry {
  side: RoomSide;
  inside: TilePos;
  outside: TilePos;
}

export interface ProbeRoute {
  path: TilePos[];
  targetId: string;
  estimate: ProbeEstimate;
}

const RESERVE_HITS = 800;
const PEAK_WEIGHT = 10000;
const OFFSETS: TilePos[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 }
];

export function probeExposure(snapshot: RoomSnapshot): number[] {
  // An empty tower can be refilled before the next observation.
  const defenders = snapshot.creeps.reduce((sum, creep) => sum + creep.attackDps + creep.rangedDps, 0);
  return buildExposureMap({
    ...snapshot,
    creeps: [],
    structures: snapshot.structures.map(structure =>
      structure.type === "tower" ? { ...structure, energy: 1000 } : structure
    )
  }).map(damage => damage + defenders);
}

export function probeGrid(snapshot: RoomSnapshot, terrain: number[]): SiegeGrid {
  const grid = buildGrid(snapshot, terrain);
  for (const pos of [...(snapshot.obstacles || []), ...snapshot.creeps])
    grid.blockHits[pos.y * 50 + pos.x] = IMPASSABLE_HITS;
  return grid;
}

export function clearProbeAnchor(grid: SiegeGrid, anchor: TilePos): boolean {
  return isAnchorClear(grid, anchor) && getFootprint(anchor).every(tile => grid.terrain[tile.y * 50 + tile.x] === 0);
}

// Model focused fire on each possible victim, including lost HEAL parts. MOVE must remain plain-speed.
export function estimateProbeEscape(
  members: ProbeMemberState[],
  retreat: TilePos[],
  exposure: number[],
  safetyFactor: number
): ProbeEstimate {
  const ticks = retreat.length + 2;
  let minimum = Infinity;
  if (!members.length || !retreat.length)
    return { safe: false, ticks, remainingHits: 0, reason: "no escape formation" };
  for (let victim = 0; victim < members.length; victim++) {
    const bodies = members.map(member => member.body.map(part => ({ ...part })));
    if (members.some(member => member.fatigue > 0 || (member.ticksToLive ?? 1500) <= ticks + 25)) {
      return { safe: false, ticks, remainingHits: 0, reason: "fatigue or lifetime prevents a prompt escape" };
    }
    // One detection tick, the route back, then two exposed border steps.
    const positions = [...retreat, retreat[retreat.length - 1], retreat[retreat.length - 1]];
    for (let tick = 0; tick < positions.length; tick++) {
      let damage = getAnchorExposure(exposure, positions[tick]);
      const body = bodies[victim];
      for (const part of body) {
        const lost = Math.min(damage, part.hits);
        part.hits -= lost;
        damage -= lost;
      }
      if (body.every(part => part.hits <= 0))
        return { safe: false, ticks, remainingHits: 0, reason: "predicted lethal volley" };
      const healing = bodies.map(parts => parts.filter(part => part.type === "heal" && part.hits > 0).length * 12);
      const total =
        tick === 0
          ? 0
          : tick === positions.length - 1
          ? healing[victim] + (members.length === 4 ? Math.min(...healing.filter((_, index) => index !== victim)) : 0)
          : healing.reduce((sum, power) => sum + power, 0);
      let heal = Number.isFinite(total) ? Math.floor(total * safetyFactor) : 0;
      for (const part of body) {
        const restored = Math.min(100 - part.hits, heal);
        part.hits += restored;
        heal -= restored;
      }
      const remaining = body.reduce((sum, part) => sum + part.hits, 0);
      minimum = Math.min(minimum, remaining);
      const mobile = bodies.every(
        parts =>
          parts.filter(part => part.type === "move" && part.hits > 0).length >=
          parts.filter(part => part.type !== "move").length
      );
      if (remaining < RESERVE_HITS || !mobile) {
        return {
          safe: false,
          ticks,
          remainingHits: minimum,
          reason: "escape would lose health reserve or plain-speed movement"
        };
      }
    }
  }
  return { safe: true, ticks, remainingHits: minimum, reason: "focused-fire escape retains health and mobility" };
}

export function chooseProbeEntry(
  snapshot: RoomSnapshot,
  terrain: number[],
  sides: RoomSide[],
  canEnter: (side: RoomSide, coordinate: number) => boolean,
  members: ProbeMemberState[],
  safetyFactor: number
): ProbeEntry | undefined {
  if (snapshot.structures.some(structure => structure.type === "tower" && structure.hasEffects)) return undefined;
  const grid = probeGrid(snapshot, terrain);
  const exposure = probeExposure(snapshot);
  let best: ProbeEntry | undefined;
  let lowest = Infinity;
  for (const side of sides) {
    for (let coordinate = 1; coordinate <= 47; coordinate++) {
      if (!canEnter(side, coordinate) || !canEnter(side, coordinate + 1)) continue;
      const horizontal = side === "top" || side === "bottom";
      const inside = horizontal
        ? { x: coordinate, y: side === "top" ? 1 : 47 }
        : { x: side === "left" ? 1 : 47, y: coordinate };
      const outside = horizontal
        ? { x: coordinate, y: side === "top" ? 47 : 1 }
        : { x: side === "left" ? 47 : 1, y: coordinate };
      if (!clearProbeAnchor(grid, inside)) continue;
      const border = [coordinate, coordinate + 1].map(along =>
        horizontal ? { x: along, y: side === "top" ? 0 : 49 } : { x: side === "left" ? 0 : 49, y: along }
      );
      if (border.some(tile => terrain[tile.y * 50 + tile.x] !== 0 || grid.blockHits[tile.y * 50 + tile.x] > 0))
        continue;
      const damage = Math.max(
        getAnchorExposure(exposure, inside),
        ...border.map(tile => exposure[tile.y * 50 + tile.x])
      );
      if (damage >= lowest || !estimateProbeEscape(members, [inside], exposure, safetyFactor).safe) continue;
      best = { side, inside, outside };
      lowest = damage;
    }
  }
  return best;
}

export function planProbe(
  snapshot: RoomSnapshot,
  grid: SiegeGrid,
  trail: TilePos[],
  members: ProbeMemberState[],
  safetyFactor: number,
  returnTo?: TilePos
): ProbeRoute | undefined {
  const start = trail[trail.length - 1];
  if (!start) return undefined;
  if (!returnTo && snapshot.structures.some(structure => structure.type === "tower" && structure.hasEffects))
    return undefined;
  const exposure = probeExposure(snapshot);
  const previous = new Map<number, number>();
  const costs = new Map<number, number>();
  const steps = new Map<number, number>();
  const heap = new MinHeap();
  const key = (tile: TilePos): number => tile.y * 50 + tile.x;
  const startKey = key(start);
  costs.set(startKey, getAnchorExposure(exposure, start) * PEAK_WEIGHT);
  steps.set(startKey, 0);
  previous.set(startKey, -1);
  heap.push(costs.get(startKey)!, startKey);
  const pathTo = (node: number): TilePos[] => {
    const path: TilePos[] = [];
    for (let index = node; index !== -1; index = previous.get(index)!)
      path.push({ x: index % 50, y: Math.floor(index / 50) });
    return path.reverse();
  };
  const targets = [
    ...snapshot.structures.filter(structure => structure.hostile && structure.type !== "controller"),
    ...snapshot.creeps
  ].sort((a, b) => a.hits - b.hits || a.id.localeCompare(b.id));
  let best: ProbeRoute | undefined;
  let bestCost = Infinity;
  for (let current = heap.pop(); current; current = heap.pop()) {
    if (current.cost !== costs.get(current.node)) continue;
    const anchor = { x: current.node % 50, y: Math.floor(current.node / 50) };
    const path = pathTo(current.node);
    const escape = [...trail.slice(0, -1), ...path].reverse();
    const estimate = estimateProbeEscape(members, escape, exposure, safetyFactor);
    if (!returnTo && !estimate.safe) continue;
    const target = targets.find(candidate => getFootprint(anchor).every(tile => chebyshev(tile, candidate) <= 3));
    if (returnTo && chebyshev(anchor, returnTo) === 0) return { path, targetId: "", estimate };
    if (!returnTo && target) {
      const cost = getAnchorExposure(exposure, anchor) * PEAK_WEIGHT * PEAK_WEIGHT + current.cost;
      if (cost < bestCost) {
        bestCost = cost;
        best = { path, targetId: target.id, estimate };
      }
    }
    for (const offset of OFFSETS) {
      const next = { x: anchor.x + offset.x, y: anchor.y + offset.y };
      if (!clearProbeAnchor(grid, next)) continue;
      const distance = steps.get(current.node)! + 1;
      const cost =
        Math.max(Math.floor(current.cost / PEAK_WEIGHT), getAnchorExposure(exposure, next)) * PEAK_WEIGHT + distance;
      const index = key(next);
      if (cost >= (costs.get(index) ?? Infinity)) continue;
      costs.set(index, cost);
      steps.set(index, distance);
      previous.set(index, current.node);
      heap.push(cost, index);
    }
  }
  return best;
}
