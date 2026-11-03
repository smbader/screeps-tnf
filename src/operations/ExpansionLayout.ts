import type { RoomLayout, RoomPositionConfig } from "../roomconfigs/RoomConfig";
import { ricaneroom } from "../utils/ricaneroom";

export interface ExpansionLayoutRecommendation {
  anchor: RoomPositionConfig;
  rotation: number;
  score: number;
  perimeterRamparts: number;
  edgeOpeningCount: number;
  averageTowerOpeningDistance: number;
}

interface ExitOpening {
  positions: RoomPositionConfig[];
}

function getExitOpenings(isWall: (x: number, y: number) => boolean): ExitOpening[] {
  const openings: ExitOpening[] = [];
  const edges: RoomPositionConfig[][] = [
    Array.from({ length: 50 }, (_, x) => ({ x, y: 0 })),
    Array.from({ length: 50 }, (_, x) => ({ x, y: 49 })),
    Array.from({ length: 50 }, (_, y) => ({ x: 0, y })),
    Array.from({ length: 50 }, (_, y) => ({ x: 49, y }))
  ];

  for (const edge of edges) {
    let current: RoomPositionConfig[] = [];
    for (const position of edge) {
      if (isWall(position.x, position.y)) {
        if (current.length > 0) openings.push({ positions: current });
        current = [];
      } else {
        current.push(position);
      }
    }
    if (current.length > 0) openings.push({ positions: current });
  }
  return openings;
}

function distance(left: RoomPositionConfig, right: RoomPositionConfig): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function rotateLocal(position: RoomPositionConfig, rotation: number): RoomPositionConfig {
  switch (rotation) {
    case 1:
      return { x: position.y, y: 11 - position.x };
    case 2:
      return { x: 11 - position.x, y: 11 - position.y };
    case 3:
      return { x: 11 - position.y, y: position.x };
    default:
      return position;
  }
}

function getClosestTowerDistanceToOpening(
  towers: RoomPositionConfig[],
  anchor: RoomPositionConfig,
  opening: ExitOpening
): number {
  const first = opening.positions[0];
  const last = opening.positions[opening.positions.length - 1];
  const horizontal = first.y === last.y;
  const start = horizontal ? Math.min(first.x, last.x) : Math.min(first.y, last.y);
  const end = horizontal ? Math.max(first.x, last.x) : Math.max(first.y, last.y);
  let closest = 50;

  for (const tower of towers) {
    const x = anchor.x + tower.x;
    const y = anchor.y + tower.y;
    const nearestX = horizontal ? Math.max(start, Math.min(end, x)) : first.x;
    const nearestY = horizontal ? first.y : Math.max(start, Math.min(end, y));
    closest = Math.min(closest, distance({ x, y }, { x: nearestX, y: nearestY }));
  }

  return closest;
}

function getPerimeterRampartEstimate(anchor: RoomPositionConfig, isWall: (x: number, y: number) => boolean): number {
  let exposedTiles = 0;
  const minX = anchor.x - 1;
  const maxX = anchor.x + 12;
  const minY = anchor.y - 1;
  const maxY = anchor.y + 12;

  for (let x = minX; x <= maxX; x++) {
    for (const y of [minY, maxY]) {
      if (x >= 0 && x < 50 && y >= 0 && y < 50 && !isWall(x, y)) exposedTiles++;
    }
  }
  for (let y = minY + 1; y < maxY; y++) {
    for (const x of [minX, maxX]) {
      if (x >= 0 && x < 50 && y >= 0 && y < 50 && !isWall(x, y)) exposedTiles++;
    }
  }
  return exposedTiles;
}

function getCriticalPositions(layout: RoomLayout): RoomPositionConfig[] {
  const positions: RoomPositionConfig[] = [];
  for (const spawn of layout.spawns || []) positions.push(spawn);
  for (const position of [
    layout.storage,
    layout.storagelink,
    layout.controllerLink,
    layout.powerSpawn,
    layout.terminal,
    layout.nuker,
    layout.factory,
    layout.observer
  ]) {
    if (position) positions.push(position);
  }
  for (const tower of layout.towers || []) positions.push(tower);
  for (const lab of layout.lab || []) positions.push(lab);
  return positions;
}

function getAllLayoutPositions(layout: RoomLayout): RoomPositionConfig[] {
  const positions = getCriticalPositions(layout);
  for (const position of [
    ...(layout.road || []),
    ...(layout.rampart || []),
    ...(layout.fieldLinks || []),
    ...(layout.field0Links || []),
    ...(layout.fieldContainers || []),
    ...(layout.containers || []),
    ...(layout.sources || [])
  ]) {
    positions.push(position);
  }
  for (const field of [layout.field0, layout.field1, layout.field2, layout.field3, layout.field4, layout.field5]) {
    if (!field) continue;
    if (field.spawn) positions.push(field.spawn);
    if (field.parkingspot) positions.push(field.parkingspot);
    positions.push(...(field.sources || []), ...(field.containers || []));
  }
  if (layout.chemist?.parking) positions.push(layout.chemist.parking);
  if (layout.chemist?.spawn) positions.push(layout.chemist.spawn);
  if (layout.spawn) positions.push(layout.spawn);
  if (layout.parking) positions.push(layout.parking);
  if (layout.parkingspot) positions.push(layout.parkingspot);
  return positions;
}

export function findBestExpansionLayout(
  room: Room,
  template: RoomLayout = ricaneroom.getConfig()
): ExpansionLayoutRecommendation | null {
  const terrain = room.getTerrain();
  const isWall = (x: number, y: number): boolean =>
    x < 0 || x >= 50 || y < 0 || y >= 50 || terrain.get(x, y) === TERRAIN_MASK_WALL;
  const openings = getExitOpenings(isWall);
  const controller = room.controller?.pos;
  const sources = room.find(FIND_SOURCES);
  const minerals = room.find(FIND_MINERALS);
  const localCriticalPositions = getCriticalPositions(template);
  const localPositions = getAllLayoutPositions(template);
  const localSpawns = template.spawns || [];
  const localTowers = template.towers || [];
  let best: ExpansionLayoutRecommendation | null = null;

  for (let rotation = 0; rotation < 4; rotation++) {
    const rotatedCriticalPositions = localCriticalPositions.map(position => rotateLocal(position, rotation));
    const rotatedPositions = localPositions.map(position => rotateLocal(position, rotation));
    const rotatedSpawns = localSpawns.map(position => rotateLocal(position, rotation));
    const rotatedTowers = localTowers.map(position => rotateLocal(position, rotation));

    for (let anchorX = 1; anchorX <= 37; anchorX++) {
      for (let anchorY = 1; anchorY <= 37; anchorY++) {
        const anchor = { x: anchorX, y: anchorY };
        if (rotatedPositions.some(position => isWall(anchor.x + position.x, anchor.y + position.y))) continue;
        if (
          rotatedCriticalPositions.some(
            position =>
              sources.some(
                source => source.pos.x === anchor.x + position.x && source.pos.y === anchor.y + position.y
              ) ||
              minerals.some(
                mineral => mineral.pos.x === anchor.x + position.x && mineral.pos.y === anchor.y + position.y
              ) ||
              (controller && controller.x === anchor.x + position.x && controller.y === anchor.y + position.y)
          )
        ) {
          continue;
        }

        const perimeterRamparts = getPerimeterRampartEstimate(anchor, isWall);
        const towerExitDistances = openings.map(opening => {
          return getClosestTowerDistanceToOpening(rotatedTowers, anchor, opening);
        });
        const averageTowerOpeningDistance =
          towerExitDistances.length > 0
            ? towerExitDistances.reduce((total, value) => total + value, 0) / towerExitDistances.length
            : 0;
        const minimumControllerDistance =
          controller && rotatedSpawns.length > 0
            ? Math.min(
                ...rotatedSpawns.map(spawn => distance({ x: anchor.x + spawn.x, y: anchor.y + spawn.y }, controller))
              )
            : 0;
        const score =
          perimeterRamparts * 4 +
          averageTowerOpeningDistance * 2 +
          Math.max(0, openings.length - 1) * 20 +
          minimumControllerDistance;
        const candidate: ExpansionLayoutRecommendation = {
          anchor,
          rotation,
          score,
          perimeterRamparts,
          edgeOpeningCount: openings.length,
          averageTowerOpeningDistance
        };

        if (
          !best ||
          candidate.score < best.score ||
          (candidate.score === best.score &&
            (candidate.anchor.x < best.anchor.x ||
              (candidate.anchor.x === best.anchor.x &&
                (candidate.anchor.y < best.anchor.y || candidate.rotation < best.rotation))))
        ) {
          best = candidate;
        }
      }
    }
  }

  return best;
}
