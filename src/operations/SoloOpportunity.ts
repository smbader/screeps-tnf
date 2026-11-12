import { getDirection } from "./QuadController";
import { towerDamage } from "./SiegePlanner";

export interface OpportunityPlan {
  direction?: DirectionConstant;
  safe: boolean;
  detail: string;
}

const HEALTH_RESERVE = 100;

export function planSoloOpportunity(
  creep: Creep,
  spawn: Structure,
  exit: RoomPosition,
  towers: StructureTower[],
  advancing: boolean,
  healingAvailable: boolean
): OpportunityPlan {
  const room = creep.room;
  if (towers.some(tower => tower.effects && tower.effects.length > 0)) {
    return { safe: false, detail: "tower effects prevent reliable damage estimate" };
  }
  const matrix = new PathFinder.CostMatrix();
  for (let coordinate = 0; coordinate < 50; coordinate++) {
    matrix.set(coordinate, 0, 255);
    matrix.set(coordinate, 49, 255);
    matrix.set(0, coordinate, 255);
    matrix.set(49, coordinate, 255);
  }
  for (const structure of room.find(FIND_STRUCTURES)) {
    if (
      OBSTACLE_OBJECT_TYPES.some(type => type === structure.structureType) ||
      (structure.structureType === STRUCTURE_RAMPART && !structure.my && !structure.isPublic)
    )
      matrix.set(structure.pos.x, structure.pos.y, 255);
  }
  for (const occupant of [...room.find(FIND_CREEPS), ...room.find(FIND_POWER_CREEPS)]) {
    if (occupant.id !== creep.id) matrix.set(occupant.pos.x, occupant.pos.y, 255);
  }
  for (const obstacle of [...room.find(FIND_SOURCES), ...room.find(FIND_MINERALS), ...room.find(FIND_DEPOSITS)]) {
    matrix.set(obstacle.pos.x, obstacle.pos.y, 255);
  }
  for (const site of room.find(FIND_CONSTRUCTION_SITES)) {
    if (site.structureType !== STRUCTURE_ROAD && site.structureType !== STRUCTURE_CONTAINER) {
      matrix.set(site.pos.x, site.pos.y, 255);
    }
  }
  const search = (from: RoomPosition, to: RoomPosition, range: number): PathFinderPath =>
    PathFinder.search(
      from,
      { pos: to, range },
      {
        maxRooms: 1,
        plainCost: 2,
        swampCost: 10,
        roomCallback: roomName => (roomName === room.name ? matrix : false)
      }
    );
  const approach = advancing ? search(creep.pos, spawn.pos, 3) : { path: [], incomplete: false };
  if (approach.incomplete) return { safe: false, detail: "no path to spawn firing range" };
  const firingPosition = approach.path.length ? approach.path[approach.path.length - 1] : creep.pos;
  const escape = search(firingPosition, exit, 0);
  if (escape.incomplete) return { safe: false, detail: "no path back to entry" };
  const terrain = room.getTerrain();
  const path = [...approach.path, ...escape.path];
  const positions = [creep.pos, ...path, exit];
  const damage = positions.reduce((worst, pos) => {
    const total = towers.reduce((sum, tower) => sum + towerDamage(pos.getRangeTo(tower)), 0);
    return Math.max(worst, total);
  }, 0);
  const weight = creep.body.filter(part => part.type !== MOVE).length;
  const moveParts = creep.getActiveBodyparts(MOVE);
  if (!moveParts) return { safe: false, detail: "no active MOVE parts" };
  let slowestMoves = moveParts;
  let previousMoves = 0;
  const escapeDirection =
    !advancing && escape.path[0] ? getDirection(creep.pos, escape.path[0]) || undefined : undefined;
  let ticks = 0;
  let remaining = 0;
  for (;;) {
    ticks =
      Math.ceil(creep.fatigue / (2 * slowestMoves)) +
      path.reduce((total, pos) => {
        const factor = terrain.get(pos.x, pos.y) === TERRAIN_MASK_SWAMP ? 10 : 2;
        return total + Math.max(1, Math.ceil((weight * factor) / (2 * slowestMoves)));
      }, 0) +
      2;
    const parts = creep.body.map(part => ({ type: part.type, hits: part.hits }));
    for (let tick = 0; tick < ticks; tick++) {
      let incoming = damage;
      for (const part of parts) {
        const loss = Math.min(part.hits, incoming);
        part.hits -= loss;
        incoming -= loss;
        if (!incoming) break;
      }
      remaining = parts.reduce((sum, part) => sum + part.hits, 0);
      if (remaining <= 0)
        return {
          safe: false,
          direction: escapeDirection,
          detail: `estimated lethal damage: ${ticks} ticks at ${damage}/tick`
        };
      let healing = healingAvailable ? parts.filter(part => part.type === HEAL && part.hits > 0).length * 12 : 0;
      for (const part of parts) {
        const restored = Math.min(100 - part.hits, healing);
        part.hits += restored;
        healing -= restored;
        if (!healing) break;
      }
      const activeMoves = parts.filter(part => part.type === MOVE && part.hits > 0).length;
      if (!activeMoves)
        return {
          safe: false,
          direction: escapeDirection,
          detail: `estimated loss of mobility after ${tick + 1} ticks`
        };
      slowestMoves = Math.min(slowestMoves, activeMoves);
    }
    const assumedMoves = moveParts;
    if (slowestMoves === assumedMoves || slowestMoves === previousMoves) break;
    previousMoves = slowestMoves;
  }
  const safe = remaining > HEALTH_RESERVE && (creep.ticksToLive === undefined || creep.ticksToLive > ticks);
  const next = advancing ? approach.path[0] : escape.path[0];
  return {
    safe,
    direction: next ? getDirection(creep.pos, next) || undefined : undefined,
    detail: `estimate ticks=${ticks} towerDmg=${damage}/tick finalHits=${remaining} reserve=${HEALTH_RESERVE}`
  };
}
