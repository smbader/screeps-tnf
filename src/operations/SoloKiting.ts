import { getDirection } from "./QuadController";

export interface KiteDecision {
  action: "move" | "hold" | "none";
  direction?: DirectionConstant;
  detail: string;
}

export function chooseSoloKite(creep: Creep, hostiles: Creep[]): KiteDecision {
  const melee = hostiles.filter(hostile => hostile.getActiveBodyparts(ATTACK) > 0);
  if (!melee.length) return { action: "none", detail: "no active melee threats" };
  const distance = (x: number, y: number): number =>
    Math.min(...melee.map(hostile => Math.max(Math.abs(x - hostile.pos.x), Math.abs(y - hostile.pos.y))));
  const current = distance(creep.pos.x, creep.pos.y);
  const onBorder = creep.pos.x === 0 || creep.pos.x === 49 || creep.pos.y === 0 || creep.pos.y === 49;
  if (current > 3) return { action: "none", detail: `nearest melee range=${current}; outside kite range` };
  if (current === 3) return { action: "hold", detail: "maintaining ranged distance 3" };

  const terrain = creep.room.getTerrain();
  let best: { x: number; y: number; range: number; swamp: boolean } | undefined;
  let checked = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const x = creep.pos.x + dx;
      const y = creep.pos.y + dy;
      if (x < 1 || y < 1 || x > 48 || y > 48) continue;
      const ground = terrain.get(x, y);
      if (ground === TERRAIN_MASK_WALL) continue;
      const structures = creep.room.lookForAt(LOOK_STRUCTURES, x, y);
      if (
        structures.some(
          structure =>
            OBSTACLE_OBJECT_TYPES.some(type => type === structure.structureType) ||
            (structure.structureType === STRUCTURE_RAMPART &&
              !(structure as StructureRampart).my &&
              !(structure as StructureRampart).isPublic)
        )
      )
        continue;
      if (creep.room.lookForAt(LOOK_CREEPS, x, y).length || creep.room.lookForAt(LOOK_POWER_CREEPS, x, y).length)
        continue;
      if (
        creep.room.lookForAt(LOOK_SOURCES, x, y).length ||
        creep.room.lookForAt(LOOK_MINERALS, x, y).length ||
        creep.room.lookForAt(LOOK_DEPOSITS, x, y).length
      )
        continue;
      checked++;
      const range = distance(x, y);
      const swamp = ground === TERRAIN_MASK_SWAMP;
      if (range < current || (range === current && !onBorder)) continue;
      if (!best || range > best.range || (range === best.range && best.swamp && !swamp)) {
        best = { x, y, range, swamp };
      }
    }
  }
  if (!best)
    return { action: "hold", detail: `melee range=${current}; no separating step among ${checked} open tiles` };
  const direction = getDirection(creep.pos, best);
  if (!direction) return { action: "hold", detail: "no direction for kite step" };
  return {
    action: "move",
    direction,
    detail: `melee range=${current}->${best.range}; step=${best.x},${best.y} terrain=${best.swamp ? "swamp" : "plain"}`
  };
}
