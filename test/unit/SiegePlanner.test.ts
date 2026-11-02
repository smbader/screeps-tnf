import { assert } from "chai";
import {
  assessThreats,
  assignSpawnRooms,
  buildExposureMap,
  buildGrid,
  chooseBoostCompounds,
  computeQuadStats,
  evaluateFeasibility,
  findKiteAnchor,
  getBodyCost,
  getFootprint,
  getHostileSpawns,
  isAnchorClear,
  planSiege,
  QUAD_BODIES,
  ROOM_SIZE,
  towerDamage
} from "../../src/operations/SiegePlanner";
import type { RoomSnapshot, SnapshotCreep, SnapshotStructure } from "../../src/operations/SiegeTypes";

const T3 = { move: "XZHO2", heal: "XLHO2", ranged_attack: "XKHO2" };

function openTerrain(): number[] {
  return new Array(ROOM_SIZE * ROOM_SIZE).fill(0);
}

function structure(type: string, x: number, y: number, hits: number, energy?: number): SnapshotStructure {
  return { id: `${type}-${x}-${y}`, x, y, type, hits, hostile: true, energy };
}

function snapshot(structures: SnapshotStructure[], creeps: SnapshotCreep[] = []): RoomSnapshot {
  return {
    roomName: "E1N1",
    tick: 100,
    owner: "enemy",
    level: 8,
    safeModeEndsAt: 0,
    safeModeCooldownEndsAt: 0,
    structures,
    creeps
  };
}

function plan(structures: SnapshotStructure[], stats = computeQuadStats(T3)) {
  return planSiege({ snapshot: snapshot(structures), terrain: openTerrain(), stats, safetyFactor: 0.7 });
}

describe("siege planner", () => {
  it("costs the quad bodies as specified", () => {
    assert.equal(QUAD_BODIES.attacker.length, 50);
    assert.equal(QUAD_BODIES.support.length, 50);
    assert.equal(getBodyCost(QUAD_BODIES.attacker), 6500);
    assert.equal(getBodyCost(QUAD_BODIES.support), 8900);
  });

  it("computes ticks per tile with and without MOVE boosts", () => {
    const plain = computeQuadStats({});
    assert.equal(plain.plainTicksPerTile, 4);
    assert.equal(plain.swampTicksPerTile, 20);
    const boosted = computeQuadStats(T3);
    assert.equal(boosted.plainTicksPerTile, 1);
    assert.equal(boosted.swampTicksPerTile, 5);
    assert.equal(boosted.healPerTick, 2304);
    assert.equal(boosted.quadDps, 4480);
  });

  it("scales tower damage by range", () => {
    assert.equal(towerDamage(3), 600);
    assert.equal(towerDamage(20), 150);
    assert.equal(towerDamage(12), 390);
  });

  it("ignores towers without energy in the exposure map", () => {
    const map = buildExposureMap(snapshot([structure("tower", 25, 25, 3000, 0)]));
    assert.equal(Math.max(...map), 0);
  });

  it("plans a route to a spawn in an open room", () => {
    const result = plan([structure("spawn", 25, 25, 5000)]);
    assert.isTrue(result.feasible);
    if (!result.feasible) return;
    assert.equal(result.plan.objective, "SPAWNS");
    assert.isDefined(result.plan.entrySide);
    const goalTiles = getFootprint(result.plan.goalAnchor);
    for (const tile of goalTiles) {
      assert.isAtMost(Math.max(Math.abs(tile.x - 25), Math.abs(tile.y - 25)), 3);
    }
  });

  it("breaches a wall ring two tiles wide", () => {
    const ring: SnapshotStructure[] = [];
    for (let offset = -4; offset <= 4; offset++) {
      ring.push(structure("constructedWall", 25 + offset, 21, 1000));
      ring.push(structure("constructedWall", 25 + offset, 29, 1000));
      ring.push(structure("constructedWall", 21, 25 + offset, 1000));
      ring.push(structure("constructedWall", 29, 25 + offset, 1000));
    }
    const result = plan([structure("spawn", 25, 25, 5000), ...ring]);
    assert.isTrue(result.feasible);
    if (!result.feasible) return;
    const breached = result.plan.path.reduce((total, step) => total + step.breach.length, 0);
    assert.isAtLeast(breached, 2);
    assert.isAbove(result.plan.totalBreachHits, 0);
  });

  it("prefers the cheaper breach over a shorter, stronger one", () => {
    const structures: SnapshotStructure[] = [structure("spawn", 25, 25, 5000)];
    for (let offset = -4; offset <= 4; offset++) {
      structures.push(structure("rampart", 25 + offset, 21, 5_000_000));
      structures.push(structure("rampart", 25 + offset, 29, 5_000_000));
      structures.push(structure("rampart", 29, 25 + offset, 5_000_000));
      if (Math.abs(offset) > 1) structures.push(structure("rampart", 21, 25 + offset, 5_000_000));
    }
    for (const y of [24, 25, 26]) structures.push(structure("rampart", 21, y, 1000));
    const result = plan(structures);
    assert.isTrue(result.feasible);
    if (!result.feasible) return;
    assert.isBelow(result.plan.totalBreachHits, 100000);
  });

  it("never starts inside ramparts on the entry tiles", () => {
    const structures: SnapshotStructure[] = [structure("spawn", 25, 25, 5000)];
    for (let y = 1; y <= 48; y++) {
      structures.push(structure("rampart", 1, y, 1000));
      structures.push(structure("rampart", 2, y, 1000));
    }
    const result = plan(structures);
    assert.isTrue(result.feasible);
    if (!result.feasible) return;
    const [entry] = result.plan.path;
    assert.isTrue(isAnchorClear(buildGrid(snapshot(structures), openTerrain()), entry.anchor));
  });

  it("passes a one-thick rampart line single file", () => {
    const terrain = openTerrain();
    for (let y = 0; y < ROOM_SIZE; y++) {
      for (let x = 0; x < ROOM_SIZE; x++) {
        if (x < 20 || x > 30 || y > 20) terrain[y * ROOM_SIZE + x] = 1;
      }
    }
    const structures: SnapshotStructure[] = [structure("spawn", 25, 15, 5000)];
    for (let x = 20; x <= 30; x++) {
      structures.push(structure("rampart", x, 3, 10_000_000));
      structures.push(structure("rampart", x, 4, 10_000_000));
    }
    const result = planSiege({ snapshot: snapshot(structures), terrain, stats: computeQuadStats({}, true), safetyFactor: 0.7 });
    assert.isTrue(result.feasible);
    if (!result.feasible) return;
    assert.isDefined(result.plan.file);
    assert.equal(result.plan.totalBreachHits, 20_000_000);
    assert.equal(result.plan.entrySide, "top");
  });

  it("falls back to the nearest tower when the spawn route is not survivable", () => {
    const structures = [
      structure("spawn", 10, 25, 5000),
      structure("tower", 12, 24, 3000, 1000),
      structure("tower", 12, 25, 3000, 1000),
      structure("tower", 12, 26, 3000, 1000),
      structure("tower", 40, 25, 3000, 1000)
    ];
    const result = plan(structures);
    assert.isTrue(result.feasible);
    if (!result.feasible) return;
    assert.equal(result.plan.objective, "TOWERS");
    assert.isAtMost(result.plan.peakExposure, result.plan.healBudget);
  });

  it("reports infeasible when every approach exceeds the heal budget", () => {
    const structures = [
      structure("spawn", 25, 25, 5000),
      structure("tower", 24, 24, 3000, 1000),
      structure("tower", 26, 24, 3000, 1000),
      structure("tower", 24, 26, 3000, 1000),
      structure("tower", 26, 26, 3000, 1000)
    ];
    const result = plan(structures);
    assert.isFalse(result.feasible);
  });

  it("switches to cleanup once no spawns remain", () => {
    const result = plan([structure("extension", 25, 25, 1000), structure("tower", 40, 40, 3000, 0)]);
    assert.isTrue(result.feasible);
    if (!result.feasible) return;
    assert.equal(result.plan.objective, "CLEANUP");
    assert.equal(getHostileSpawns(snapshot([])).length, 0);
  });

  it("breaches toward the controller once nothing else is left", () => {
    const ring: SnapshotStructure[] = [];
    for (let offset = -6; offset <= 6; offset++) {
      ring.push(structure("constructedWall", 25 + offset, 19, 1000));
      ring.push(structure("constructedWall", 25 + offset, 31, 1000));
      ring.push(structure("constructedWall", 19, 25 + offset, 1000));
      ring.push(structure("constructedWall", 31, 25 + offset, 1000));
    }
    ring.push({ ...structure("controller", 25, 25, 1e12), hostile: false });
    const snap = { ...snapshot(ring), controller: { x: 25, y: 25 } };
    const result = planSiege({ snapshot: snap, terrain: openTerrain(), stats: computeQuadStats(T3), safetyFactor: 0.7 });
    assert.isTrue(result.feasible);
    if (!result.feasible) return;
    assert.equal(result.plan.objective, "CONTROLLER");
    assert.isAbove(result.plan.totalBreachHits, 0);
  });

  it("ignores towers in an unowned room", () => {
    const snap = snapshot([structure("tower", 25, 25, 3000, 1000)]);
    delete snap.owner;
    assert.equal(Math.max(...buildExposureMap(snap)), 0);
  });

  it("finds a lower exposure anchor to kite toward", () => {
    const snap = snapshot([structure("tower", 25, 25, 3000, 1000)]);
    const grid = buildGrid(snap, openTerrain());
    const exposure = buildExposureMap(snap);
    const kite = findKiteAnchor(grid, exposure, { x: 24, y: 24 }, [], 6);
    assert.isNotNull(kite);
    assert.isBelow(kite!.score, 600);
  });

  it("chooses kill, kite or retreat for armed hostile creeps", () => {
    const stats = computeQuadStats(T3);
    const creep: SnapshotCreep = {
      id: "c1",
      x: 10,
      y: 10,
      hits: 5000,
      hitsMax: 5000,
      attackDps: 300,
      rangedDps: 0,
      healPerTick: 0
    };
    assert.equal(assessThreats(stats, 0.7, 0, [creep], false).action, "KILL");
    assert.equal(assessThreats(stats, 0.7, 1600, [creep], true).action, "KITE");
    const healer = { ...creep, healPerTick: 100000 };
    assert.equal(assessThreats(stats, 0.7, 0, [healer], false).action, "RETREAT");
  });

  it("selects boost tiers and reports tier 3 shortfalls", () => {
    const empty = chooseBoostCompounds({});
    assert.deepEqual(empty.shortfalls, [
      { compound: "XZHO2", amount: 1200 },
      { compound: "XLHO2", amount: 1440 }
    ]);
    const partial = chooseBoostCompounds({ ZHO2: 2000, XLHO2: 5000, XKHO2: 4000 });
    assert.equal(partial.choices.move!.compound, "ZHO2");
    assert.equal(partial.choices.heal!.compound, "XLHO2");
    assert.equal(partial.choices.ranged_attack!.compound, "XKHO2");
    assert.lengthOf(partial.shortfalls, 0);
  });

  it("spawns from the closest rooms and spills over when spawns run out", () => {
    const assignment = assignSpawnRooms([
      { name: "A", distance: 1, spawnCount: 3, capacity: 12900 },
      { name: "B", distance: 2, spawnCount: 3, capacity: 12900 },
      { name: "C", distance: 1, spawnCount: 3, capacity: 5000 }
    ]);
    assert.isNotNull(assignment);
    const counts = Object.values(assignment!).reduce<Record<string, number>>((result, room) => {
      result[room!] = (result[room!] || 0) + 1;
      return result;
    }, {});
    assert.deepEqual(counts, { A: 3, B: 1 });
    assert.isNull(assignSpawnRooms([{ name: "C", distance: 1, spawnCount: 3, capacity: 5000 }]));
  });

  it("rejects plans that exceed the creep lifetime", () => {
    const reasons = evaluateFeasibility({
      plan: { totalTicks: 900 },
      travelTicks: 400,
      spawnTicks: 300,
      creepLifetime: 1500,
      margin: 150
    });
    assert.lengthOf(reasons, 1);
    assert.lengthOf(
      evaluateFeasibility({ plan: { totalTicks: 200 }, travelTicks: 400, spawnTicks: 300, creepLifetime: 1500, margin: 150 }),
      0
    );
  });

  it("lets a multi-wave siege exceed one creep lifetime but not the trip", () => {
    const base = { plan: { totalTicks: 28600 }, travelTicks: 400, spawnTicks: 300, creepLifetime: 1500, margin: 150 };
    assert.lengthOf(evaluateFeasibility(base), 1);
    assert.lengthOf(evaluateFeasibility({ ...base, multiWave: true }), 0);
    assert.lengthOf(evaluateFeasibility({ ...base, travelTicks: 1400, multiWave: true }), 1);
  });
});
