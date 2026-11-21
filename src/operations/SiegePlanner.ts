import type {
  BreachTile,
  FileStep,
  PlanStep,
  PlannerResult,
  QuadMemberMemory,
  QuadPart,
  QuadRole,
  QuadSlot,
  QuadStats,
  RoomSide,
  RoomSnapshot,
  SiegeObjective,
  SnapshotCreep,
  SnapshotStructure,
  TilePos
} from "./SiegeTypes";
import { QUAD_SLOTS, QUAD_SLOT_ROLE } from "./SiegeTypes";

export const ROOM_SIZE = 50;
export const IMPASSABLE_HITS = 1e12;
export const TERRAIN_WALL = 1;
export const TERRAIN_SWAMP = 2;
export const TOWER_MIN_ENERGY = 10;
const TIME_WEIGHT = 1;
const BOOST_COMPOUND_PER_PART = 30;
const LAB_MINERAL_CAPACITY = 3000;

const BODY_PART_COST: Record<string, number> = { move: 50, ranged_attack: 150, heal: 250 };

function repeatPart(part: BodyPartConstant, count: number): BodyPartConstant[] {
  const parts: BodyPartConstant[] = [];
  for (let index = 0; index < count; index++) parts.push(part);
  return parts;
}

export const QUAD_BODIES: Record<QuadRole, BodyPartConstant[]> = {
  attacker: [...repeatPart("move", 10), ...repeatPart("ranged_attack", 40)],
  support: [...repeatPart("move", 10), ...repeatPart("ranged_attack", 16), ...repeatPart("heal", 24)]
};

// Unboosted bodies use one MOVE per other part so the quad never builds up fatigue.
export const LIGHT_QUAD_BODIES: Record<QuadRole, BodyPartConstant[]> = {
  attacker: [...repeatPart("move", 25), ...repeatPart("ranged_attack", 25)],
  support: [...repeatPart("move", 25), ...repeatPart("ranged_attack", 10), ...repeatPart("heal", 15)]
};

export function getQuadBody(slot: QuadSlot, light = false): BodyPartConstant[] {
  return (light ? LIGHT_QUAD_BODIES : QUAD_BODIES)[QUAD_SLOT_ROLE[slot]];
}

export function getBodyCost(body: BodyPartConstant[]): number {
  return body.reduce((total, part) => total + (BODY_PART_COST[part] || 0), 0);
}

export function getSlotCost(slot: QuadSlot, light = false): number {
  return getBodyCost(getQuadBody(slot, light));
}

export function countQuadParts(light = false): Record<QuadPart, number> {
  const counts: Record<QuadPart, number> = { move: 0, ranged_attack: 0, heal: 0 };
  for (const slot of QUAD_SLOTS) {
    for (const part of getQuadBody(slot, light)) {
      if (part in counts) counts[part as QuadPart]++;
    }
  }
  return counts;
}

export const BOOST_TIERS: Record<QuadPart, { compound: string; multiplier: number }[]> = {
  move: [
    { compound: "XZHO2", multiplier: 4 },
    { compound: "ZHO2", multiplier: 3 },
    { compound: "ZO", multiplier: 2 }
  ],
  heal: [
    { compound: "XLHO2", multiplier: 4 },
    { compound: "LHO2", multiplier: 3 },
    { compound: "LO", multiplier: 2 }
  ],
  ranged_attack: [
    { compound: "XKHO2", multiplier: 4 },
    { compound: "KHO2", multiplier: 3 },
    { compound: "KO", multiplier: 2 }
  ]
};

export const REQUIRED_BOOST_PARTS: QuadPart[] = ["move", "heal"];
export const OPTIONAL_BOOST_PARTS: QuadPart[] = ["ranged_attack"];

export function getBoostMultiplier(compound: string | undefined, part: QuadPart): number {
  if (!compound) return 1;
  return BOOST_TIERS[part].find(tier => tier.compound === compound)?.multiplier || 1;
}

export function getBoostPartType(compound: string): QuadPart | undefined {
  return (Object.keys(BOOST_TIERS) as QuadPart[]).find(part =>
    BOOST_TIERS[part].some(tier => tier.compound === compound)
  );
}

export interface BoostChoice {
  compound: string;
  required: boolean;
  needed: number;
  stock: number;
}

export interface BoostSelection {
  choices: Partial<Record<QuadPart, BoostChoice>>;
  shortfalls: { compound: string; amount: number }[];
}

// Chooses the best tier already in stock for each part; a missing required boost falls back to tier 3 so it can be bought.
export function chooseBoostCompounds(stock: Record<string, number>): BoostSelection {
  const counts = countQuadParts();
  const choices: Partial<Record<QuadPart, BoostChoice>> = {};
  const shortfalls: { compound: string; amount: number }[] = [];

  for (const part of [...REQUIRED_BOOST_PARTS, ...OPTIONAL_BOOST_PARTS]) {
    const required = REQUIRED_BOOST_PARTS.includes(part);
    const needed = Math.min(LAB_MINERAL_CAPACITY, counts[part] * BOOST_COMPOUND_PER_PART);
    const covered = BOOST_TIERS[part].find(tier => (stock[tier.compound] || 0) >= needed);
    if (covered) {
      choices[part] = { compound: covered.compound, required, needed, stock: stock[covered.compound] || 0 };
    } else if (required) {
      const top = BOOST_TIERS[part][0].compound;
      choices[part] = { compound: top, required, needed, stock: stock[top] || 0 };
      shortfalls.push({ compound: top, amount: needed - (stock[top] || 0) });
    }
  }
  return { choices, shortfalls };
}

export function computeQuadStats(compounds: Partial<Record<QuadPart, string>>, light = false): QuadStats {
  const counts = countQuadParts(light);
  const moveMultiplier = getBoostMultiplier(compounds.move, "move");
  const healMultiplier = getBoostMultiplier(compounds.heal, "heal");
  const rangedMultiplier = getBoostMultiplier(compounds.ranged_attack, "ranged_attack");
  const attackerBody = (light ? LIGHT_QUAD_BODIES : QUAD_BODIES).attacker;
  const attackerNonMove = attackerBody.filter(part => part !== "move").length;
  const moveParts = attackerBody.filter(part => part === "move").length;

  return {
    quadDps: counts.ranged_attack * 10 * rangedMultiplier,
    healPerTick: counts.heal * 12 * healMultiplier,
    plainTicksPerTile: Math.max(1, Math.ceil((attackerNonMove * 2) / (2 * moveParts * moveMultiplier))),
    swampTicksPerTile: Math.max(1, Math.ceil((attackerNonMove * 10) / (2 * moveParts * moveMultiplier)))
  };
}

export function chebyshev(a: TilePos, b: TilePos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function towerDamage(range: number): number {
  if (range <= 5) return 600;
  if (range >= 20) return 150;
  return 600 - (range - 5) * 30;
}

export function isTowerActive(structure: SnapshotStructure): boolean {
  return structure.type === "tower" && structure.hostile && (structure.energy || 0) >= TOWER_MIN_ENERGY;
}

export function threatDpsAt(tile: TilePos, creeps: SnapshotCreep[]): number {
  let total = 0;
  for (const creep of creeps) {
    const range = chebyshev(tile, creep);
    if (range <= 2) total += creep.attackDps;
    if (range <= 4) total += creep.rangedDps;
  }
  return total;
}

export function buildExposureMap(snapshot: RoomSnapshot): number[] {
  const exposure: number[] = new Array(ROOM_SIZE * ROOM_SIZE).fill(0);
  const towers = snapshot.owner ? snapshot.structures.filter(isTowerActive) : [];
  const armed = snapshot.creeps.filter(creep => creep.attackDps > 0 || creep.rangedDps > 0);

  for (let y = 0; y < ROOM_SIZE; y++) {
    for (let x = 0; x < ROOM_SIZE; x++) {
      let total = 0;
      for (const tower of towers) total += towerDamage(chebyshev({ x, y }, tower));
      if (armed.length) total += threatDpsAt({ x, y }, armed);
      exposure[y * ROOM_SIZE + x] = total;
    }
  }
  return exposure;
}

export function getFootprint(anchor: TilePos): TilePos[] {
  return [
    { x: anchor.x, y: anchor.y },
    { x: anchor.x + 1, y: anchor.y },
    { x: anchor.x, y: anchor.y + 1 },
    { x: anchor.x + 1, y: anchor.y + 1 }
  ];
}

export function getAnchorExposure(exposure: number[], anchor: TilePos): number {
  let worst = 0;
  for (const tile of getFootprint(anchor)) {
    worst = Math.max(worst, exposure[tile.y * ROOM_SIZE + tile.x]);
  }
  return worst;
}

export interface SiegeGrid {
  terrain: ArrayLike<number>;
  blockHits: number[];
}

const PASSABLE_STRUCTURE_TYPES = new Set(["road", "container"]);

export function buildGrid(snapshot: RoomSnapshot, terrain: ArrayLike<number>): SiegeGrid {
  const blockHits: number[] = new Array(ROOM_SIZE * ROOM_SIZE).fill(0);
  for (const structure of snapshot.structures) {
    if (PASSABLE_STRUCTURE_TYPES.has(structure.type)) continue;
    const index = structure.y * ROOM_SIZE + structure.x;
    blockHits[index] = Math.min(IMPASSABLE_HITS, blockHits[index] + structure.hits);
  }
  return { terrain, blockHits };
}

function tileIndex(tile: TilePos): number {
  return tile.y * ROOM_SIZE + tile.x;
}

function isTileWalkableTerrain(grid: SiegeGrid, tile: TilePos): boolean {
  return (grid.terrain[tileIndex(tile)] & TERRAIN_WALL) === 0;
}

export function isAnchorInBounds(anchor: TilePos): boolean {
  return anchor.x >= 1 && anchor.y >= 1 && anchor.x <= ROOM_SIZE - 3 && anchor.y <= ROOM_SIZE - 3;
}

export function isAnchorPassable(grid: SiegeGrid, anchor: TilePos): boolean {
  if (!isAnchorInBounds(anchor)) return false;
  return getFootprint(anchor).every(
    tile => isTileWalkableTerrain(grid, tile) && grid.blockHits[tileIndex(tile)] < IMPASSABLE_HITS
  );
}

export function isAnchorClear(grid: SiegeGrid, anchor: TilePos): boolean {
  return isAnchorPassable(grid, anchor) && getFootprint(anchor).every(tile => grid.blockHits[tileIndex(tile)] <= 0);
}

function getAnchorMoveTicks(grid: SiegeGrid, anchor: TilePos, stats: QuadStats): number {
  const swamp = getFootprint(anchor).some(tile => (grid.terrain[tileIndex(tile)] & TERRAIN_SWAMP) !== 0);
  return swamp ? stats.swampTicksPerTile : stats.plainTicksPerTile;
}

export function getBreachTiles(grid: SiegeGrid, from: TilePos | undefined, to: TilePos): BreachTile[] {
  const cleared = new Set((from ? getFootprint(from) : []).map(tileIndex));
  const tiles: BreachTile[] = [];
  for (const tile of getFootprint(to)) {
    const index = tileIndex(tile);
    if (cleared.has(index)) continue;
    if (grid.blockHits[index] > 0) tiles.push({ x: tile.x, y: tile.y, hits: grid.blockHits[index] });
  }
  return tiles;
}

// Each barrier tile costs its kill time plus a tick to retarget, so thick layers lose to thin ones.
function getBreachTicks(tiles: BreachTile[], quadDps: number): number {
  return tiles.reduce((total, tile) => total + Math.ceil(tile.hits / Math.max(1, quadDps)) + 1, 0);
}

export class MinHeap {
  private items: { cost: number; node: number }[] = [];

  public get size(): number {
    return this.items.length;
  }

  public push(cost: number, node: number): void {
    this.items.push({ cost, node });
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].cost <= this.items[index].cost) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  public pop(): { cost: number; node: number } | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      this.items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.items.length && this.items[left].cost < this.items[smallest].cost) smallest = left;
        if (right < this.items.length && this.items[right].cost < this.items[smallest].cost) smallest = right;
        if (smallest === index) break;
        [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
        index = smallest;
      }
    }
    return top;
  }
}

export interface PlanTarget {
  id: string;
  x: number;
  y: number;
}

export interface PlannerInput {
  snapshot: RoomSnapshot;
  terrain: ArrayLike<number>;
  stats: QuadStats;
  safetyFactor: number;
  entrySides?: RoomSide[];
  startAnchor?: TilePos;
}

const NEIGHBOR_OFFSETS: TilePos[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 }
];

// The quad crosses narrow gaps and barriers single file, so entry is planned one tile at a time.
const FILE_STEP_PENALTY = 0.5;
const FORM_UP_TICKS = 4;

interface FileSearch {
  dist: number[];
  previous: number[];
  seedSide: Record<number, RoomSide>;
  seeds: number;
  lowestExposure: number;
}

function getTileTicks(grid: SiegeGrid, tile: TilePos, stats: QuadStats): number {
  const index = tileIndex(tile);
  const move = (grid.terrain[index] & TERRAIN_SWAMP) !== 0 ? stats.swampTicksPerTile : stats.plainTicksPerTile;
  const hits = grid.blockHits[index];
  return move + (hits > 0 ? Math.ceil(hits / Math.max(1, stats.quadDps)) + 1 : 0);
}

function searchFileEntries(
  grid: SiegeGrid,
  exposure: number[],
  stats: QuadStats,
  budget: number,
  sides: RoomSide[]
): FileSearch {
  const nodeCount = ROOM_SIZE * ROOM_SIZE;
  const search: FileSearch = {
    dist: new Array(nodeCount).fill(Infinity),
    previous: new Array(nodeCount).fill(-1),
    seedSide: {},
    seeds: 0,
    lowestExposure: Infinity
  };
  const heap = new MinHeap();
  const last = ROOM_SIZE - 1;
  const stepCost = (tile: TilePos): number =>
    getTileTicks(grid, tile, stats) * (exposure[tileIndex(tile)] + TIME_WEIGHT) + FILE_STEP_PENALTY;

  for (let y = 0; y < ROOM_SIZE; y++) {
    for (let x = 0; x < ROOM_SIZE; x++) {
      const side: RoomSide | undefined = x === 0 ? "left" : x === last ? "right" : y === 0 ? "top" : y === last ? "bottom" : undefined;
      if (!side || !sides.includes(side)) continue;
      const tile = { x, y };
      if (!isTileWalkableTerrain(grid, tile) || grid.blockHits[tileIndex(tile)] > 0) continue;
      search.lowestExposure = Math.min(search.lowestExposure, exposure[tileIndex(tile)]);
      if (exposure[tileIndex(tile)] > budget) continue;
      const index = tileIndex(tile);
      search.dist[index] = stepCost(tile);
      search.seedSide[index] = side;
      search.seeds++;
      heap.push(search.dist[index], index);
    }
  }

  for (let current = heap.pop(); current; current = heap.pop()) {
    if (current.cost > search.dist[current.node]) continue;
    const from = { x: current.node % ROOM_SIZE, y: Math.floor(current.node / ROOM_SIZE) };
    for (const offset of NEIGHBOR_OFFSETS) {
      const to = { x: from.x + offset.x, y: from.y + offset.y };
      if (to.x < 1 || to.y < 1 || to.x > last - 1 || to.y > last - 1) continue;
      const index = tileIndex(to);
      if (!isTileWalkableTerrain(grid, to) || grid.blockHits[index] >= IMPASSABLE_HITS || exposure[index] > budget) continue;
      const cost = current.cost + stepCost(to);
      if (cost < search.dist[index]) {
        search.dist[index] = cost;
        search.previous[index] = current.node;
        heap.push(cost, index);
      }
    }
  }
  return search;
}

function isGoalAnchor(anchor: TilePos, target: TilePos): boolean {
  return getFootprint(anchor).every(tile => {
    const range = chebyshev(tile, target);
    return range >= 1 && range <= 3;
  });
}

function planToTargets(
  input: PlannerInput,
  grid: SiegeGrid,
  exposure: number[],
  objective: SiegeObjective,
  targets: PlanTarget[]
): PlannerResult {
  const reasons: string[] = [];
  if (!targets.length) return { feasible: false, reasons: [`${objective}: no targets`] };

  const { stats, safetyFactor } = input;
  const budget = stats.healPerTick * safetyFactor;
  const nodeCount = ROOM_SIZE * ROOM_SIZE;
  const dist: number[] = new Array(nodeCount).fill(Infinity);
  const previous: number[] = new Array(nodeCount).fill(-1);
  const heap = new MinHeap();

  const withinBudget = (anchor: TilePos): boolean => getAnchorExposure(exposure, anchor) <= budget;
  const nodeToAnchor = (node: number): TilePos => ({ x: node % ROOM_SIZE, y: Math.floor(node / ROOM_SIZE) });

  let startCount = 0;
  let fileSearch: FileSearch | undefined;
  const startTile: Record<number, number> = {};
  if (input.startAnchor) {
    dist[tileIndex(input.startAnchor)] = 0;
    heap.push(0, tileIndex(input.startAnchor));
    startCount = 1;
  } else {
    fileSearch = searchFileEntries(grid, exposure, stats, budget, input.entrySides || ["top", "right", "bottom", "left"]);
    // The file ends at the first fully clear 2x2 block, where the quad re-forms.
    for (let y = 1; y <= ROOM_SIZE - 3; y++) {
      for (let x = 1; x <= ROOM_SIZE - 3; x++) {
        const anchor = { x, y };
        if (!isAnchorClear(grid, anchor) || !withinBudget(anchor)) continue;
        let bestTile = -1;
        let bestDist = Infinity;
        for (const tile of getFootprint(anchor)) {
          const value = fileSearch.dist[tileIndex(tile)];
          if (value < bestDist) {
            bestDist = value;
            bestTile = tileIndex(tile);
          }
        }
        if (bestTile < 0) continue;
        const node = tileIndex(anchor);
        dist[node] = bestDist + FORM_UP_TICKS * (getAnchorExposure(exposure, anchor) + TIME_WEIGHT);
        startTile[node] = bestTile;
        heap.push(dist[node], node);
        startCount++;
      }
    }
  }
  if (!startCount) {
    const detail = !fileSearch?.seeds
      ? fileSearch && fileSearch.lowestExposure < Infinity
        ? `lowest entry exposure ${Math.round(fileSearch.lowestExposure)}/tick exceeds heal budget ${Math.round(budget)}/tick`
        : "no open exit tiles on the room border"
      : "no open area to form up within the heal budget";
    return { feasible: false, reasons: [`${objective}: no entry point (${detail})`] };
  }

  for (let current = heap.pop(); current; current = heap.pop()) {
    if (current.cost > dist[current.node]) continue;
    const from = nodeToAnchor(current.node);
    const fromExposure = getAnchorExposure(exposure, from);
    for (const offset of NEIGHBOR_OFFSETS) {
      const to = { x: from.x + offset.x, y: from.y + offset.y };
      if (!isAnchorPassable(grid, to) || !withinBudget(to)) continue;
      const breach = getBreachTiles(grid, from, to);
      const breachTicks = getBreachTicks(breach, stats.quadDps);
      const moveTicks = getAnchorMoveTicks(grid, to, stats);
      const cost =
        current.cost +
        breachTicks * (fromExposure + TIME_WEIGHT) +
        moveTicks * (getAnchorExposure(exposure, to) + TIME_WEIGHT);
      const node = tileIndex(to);
      if (cost < dist[node]) {
        dist[node] = cost;
        previous[node] = current.node;
        heap.push(cost, node);
      }
    }
  }

  let best: { node: number; target: PlanTarget; cost: number } | undefined;
  for (const target of targets) {
    const hits = Math.min(IMPASSABLE_HITS, grid.blockHits[tileIndex(target)]) || 1;
    const attackTicks = Math.ceil(hits / Math.max(1, stats.quadDps));
    for (let y = Math.max(1, target.y - 4); y <= Math.min(ROOM_SIZE - 3, target.y + 3); y++) {
      for (let x = Math.max(1, target.x - 4); x <= Math.min(ROOM_SIZE - 3, target.x + 3); x++) {
        const node = y * ROOM_SIZE + x;
        if (dist[node] === Infinity || !isGoalAnchor({ x, y }, target)) continue;
        const cost = dist[node] + attackTicks * (getAnchorExposure(exposure, { x, y }) + TIME_WEIGHT);
        if (!best || cost < best.cost) best = { node, target, cost };
      }
    }
  }
  if (!best) {
    reasons.push(`${objective}: no route within the heal budget (${Math.round(budget)}/tick)`);
    return { feasible: false, reasons };
  }

  const nodes: number[] = [];
  for (let node = best.node; node !== -1; node = previous[node]) nodes.push(node);
  nodes.reverse();

  const file: FileStep[] = [];
  let entrySide: RoomSide | undefined;
  if (fileSearch) {
    const tiles: number[] = [];
    for (let tile = startTile[nodes[0]]; tile !== -1; tile = fileSearch.previous[tile]) tiles.push(tile);
    tiles.reverse();
    entrySide = fileSearch.seedSide[tiles[0]];
    for (const tile of tiles) file.push({ x: tile % ROOM_SIZE, y: Math.floor(tile / ROOM_SIZE), hits: grid.blockHits[tile] });
  }
  const fileTicks = file.reduce((total, tile) => total + getTileTicks(grid, tile, stats), 0) + (file.length ? FORM_UP_TICKS : 0);

  const path: PlanStep[] = [];
  let totalTicks = 0;
  let totalBreachHits = file.reduce((total, tile) => total + tile.hits, 0);
  let peakExposure = file.reduce((peak, tile) => Math.max(peak, exposure[tileIndex(tile)]), 0);
  nodes.forEach((node, index) => {
    const anchor = nodeToAnchor(node);
    const breach = index === 0 ? [] : getBreachTiles(grid, nodeToAnchor(nodes[index - 1]), anchor);
    const ticks =
      index === 0 ? fileTicks : getAnchorMoveTicks(grid, anchor, stats) + getBreachTicks(breach, stats.quadDps);
    const stepExposure = getAnchorExposure(exposure, anchor);
    totalTicks += ticks;
    totalBreachHits += breach.reduce((total, tile) => total + tile.hits, 0);
    peakExposure = Math.max(peakExposure, stepExposure);
    path.push({ anchor, exposure: stepExposure, ticks, breach });
  });

  return {
    feasible: true,
    plan: {
      snapshotTick: input.snapshot.tick,
      objective,
      entrySide,
      file: file.length ? file : undefined,
      path,
      goalAnchor: path[path.length - 1].anchor,
      targetId: best.target.id,
      targetPos: { x: best.target.x, y: best.target.y },
      totalTicks,
      totalBreachHits,
      peakExposure,
      healBudget: budget
    }
  };
}

function toTargets(structures: SnapshotStructure[]): PlanTarget[] {
  return structures.map(structure => ({ id: structure.id, x: structure.x, y: structure.y }));
}

export function getHostileSpawns(snapshot: RoomSnapshot): SnapshotStructure[] {
  return snapshot.structures.filter(structure => structure.type === "spawn" && structure.hostile);
}

export function getCleanupStages(snapshot: RoomSnapshot): SnapshotStructure[][] {
  const hostile = snapshot.structures.filter(structure => structure.hostile && structure.hits < IMPASSABLE_HITS);
  const isBarrier = (structure: SnapshotStructure): boolean =>
    structure.type === "rampart" || structure.type === "constructedWall";
  return [
    hostile.filter(structure => structure.type === "tower"),
    hostile.filter(structure => structure.type !== "tower" && !isBarrier(structure)),
    hostile.filter(structure => structure.type === "rampart")
  ];
}

export function planSiege(input: PlannerInput): PlannerResult {
  const grid = buildGrid(input.snapshot, input.terrain);
  const exposure = buildExposureMap(input.snapshot);
  const reasons: string[] = [];

  const spawns = getHostileSpawns(input.snapshot);
  if (spawns.length) {
    const spawnPlan = planToTargets(input, grid, exposure, "SPAWNS", toTargets(spawns));
    if (spawnPlan.feasible) return spawnPlan;
    reasons.push(...spawnPlan.reasons);

    const towers = input.snapshot.owner ? input.snapshot.structures.filter(isTowerActive) : [];
    const towerPlan = planToTargets(input, grid, exposure, "TOWERS", toTargets(towers));
    if (towerPlan.feasible) return towerPlan;
    reasons.push(...towerPlan.reasons);
    return { feasible: false, reasons };
  }

  for (const stage of getCleanupStages(input.snapshot)) {
    if (!stage.length) continue;
    const cleanupPlan = planToTargets(input, grid, exposure, "CLEANUP", toTargets(stage));
    if (cleanupPlan.feasible) return cleanupPlan;
    reasons.push(...cleanupPlan.reasons);
  }

  // Final check: the controller must be reachable, breaching whatever still blocks the way.
  const controller = input.snapshot.controller;
  if (controller) {
    const controllerPlan = planToTargets(input, grid, exposure, "CONTROLLER", [
      { id: "controller", x: controller.x, y: controller.y }
    ]);
    if (controllerPlan.feasible) return controllerPlan;
    reasons.push(...controllerPlan.reasons);
  }
  return { feasible: false, reasons: reasons.length ? reasons : ["CLEANUP: nothing left to destroy"] };
}

export interface KiteResult {
  anchor: TilePos;
  path: TilePos[];
  score: number;
}

// Searches clear anchors near the quad for the position with the lowest tower and creep exposure, preferring tiles that keep the primary threat in range 3.
export function findKiteAnchor(
  grid: SiegeGrid,
  exposure: number[],
  current: TilePos,
  threats: SnapshotCreep[],
  maxSteps: number
): KiteResult | null {
  const primary = threats[0];
  const scoreOf = (anchor: TilePos): number => {
    let score = getAnchorExposure(exposure, anchor);
    if (primary) {
      const range = Math.min(...getFootprint(anchor).map(tile => chebyshev(tile, primary)));
      if (range > 3) score += (range - 3) * 25;
    }
    return score;
  };

  const startScore = scoreOf(current);
  const visited = new Map<number, { previous: number; steps: number }>();
  visited.set(tileIndex(current), { previous: -1, steps: 0 });
  const queue: TilePos[] = [current];
  let best: { anchor: TilePos; score: number } | null = null;

  for (let head = 0; head < queue.length; head++) {
    const anchor = queue[head];
    const steps = visited.get(tileIndex(anchor))!.steps;
    if (steps >= maxSteps) continue;
    for (const offset of NEIGHBOR_OFFSETS) {
      const next = { x: anchor.x + offset.x, y: anchor.y + offset.y };
      const index = tileIndex(next);
      if (visited.has(index) || !isAnchorClear(grid, next)) continue;
      visited.set(index, { previous: tileIndex(anchor), steps: steps + 1 });
      queue.push(next);
      const score = scoreOf(next) + (steps + 1) * 2;
      if (!best || score < best.score) best = { anchor: next, score };
    }
  }

  if (!best || best.score >= startScore - 5) return null;

  const path: TilePos[] = [];
  for (let index = tileIndex(best.anchor); index !== -1; index = visited.get(index)!.previous) {
    path.push({ x: index % ROOM_SIZE, y: Math.floor(index / ROOM_SIZE) });
  }
  path.reverse();
  return { anchor: best.anchor, path, score: best.score };
}

export interface ThreatAssessment {
  action: "NONE" | "KILL" | "KITE" | "RETREAT";
  threats: SnapshotCreep[];
  incoming: number;
  budget: number;
  killTicks: number;
}

export function assessThreats(
  stats: QuadStats,
  safetyFactor: number,
  anchorExposure: number,
  threats: SnapshotCreep[],
  hasKiteOption: boolean
): ThreatAssessment {
  const budget = stats.healPerTick * safetyFactor;
  if (!threats.length) return { action: "NONE", threats, incoming: anchorExposure, budget, killTicks: 0 };

  const threatDps = threats.reduce((total, creep) => total + creep.attackDps + creep.rangedDps, 0);
  const threatHeal = threats.reduce((total, creep) => total + creep.healPerTick, 0);
  const threatHits = threats.reduce((total, creep) => total + creep.hits, 0);
  const netDps = stats.quadDps - threatHeal;
  const canKill = netDps > 0;
  const killTicks = canKill ? Math.ceil(threatHits / netDps) : Infinity;
  const incoming = anchorExposure + threatDps;
  const sustainable = incoming <= budget;

  let action: ThreatAssessment["action"];
  if (canKill && sustainable) action = "KILL";
  else if (hasKiteOption) action = "KITE";
  else if (canKill) action = "KILL";
  else action = "RETREAT";
  return { action, threats, incoming, budget, killTicks };
}

export interface SpawnRoomCandidate {
  name: string;
  distance: number;
  spawnCount: number;
  capacity: number;
}

// Assigns each slot to the closest room that can afford it and still has a free spawn for it.
export function assignSpawnRooms(
  candidates: SpawnRoomCandidate[],
  slots: QuadSlot[] = QUAD_SLOTS,
  light = false
): Partial<Record<QuadSlot, string>> | null {
  const ordered = [...candidates].sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name));
  const used: Record<string, number> = {};
  const assignment: Partial<Record<QuadSlot, string>> = {};

  for (const slot of slots) {
    const cost = getSlotCost(slot, light);
    const room = ordered.find(candidate => candidate.capacity >= cost && (used[candidate.name] || 0) < candidate.spawnCount);
    if (!room) return null;
    used[room.name] = (used[room.name] || 0) + 1;
    assignment[slot] = room.name;
  }
  return assignment;
}

export interface FeasibilityInput {
  plan: { totalTicks: number };
  travelTicks: number;
  spawnTicks: number;
  creepLifetime: number;
  margin: number;
  // When true the siege may span several quads, so the plan only has to be reachable within one lifetime.
  multiWave?: boolean;
}

export function evaluateFeasibility(input: FeasibilityInput): string[] {
  const reasons: string[] = [];
  const planTicks = input.multiWave ? 0 : input.plan.totalTicks;
  const total = input.spawnTicks + input.travelTicks + planTicks;
  const available = input.creepLifetime - input.margin;
  if (input.multiWave && total >= available) {
    reasons.push(`quad cannot reach the target within its lifetime (${total} ticks of travel, ${available} available)`);
  } else if (total > available) {
    reasons.push(`lifetime budget exceeded (${total} ticks needed, ${available} available)`);
  }
  return reasons;
}

export function getMissingMembers(members: Partial<Record<QuadSlot, QuadMemberMemory>>, alive: (name: string) => boolean): QuadSlot[] {
  return QUAD_SLOTS.filter(slot => !members[slot] || !alive(members[slot]!.name));
}
