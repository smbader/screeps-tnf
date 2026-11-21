import { assert } from "chai";
import {
  chooseProbeEntry,
  clearProbeAnchor,
  estimateProbeEscape,
  planProbe,
  probeExposure,
  probeGrid
} from "../../src/operations/QuadProbePlanner";
import type { ProbeMemberState } from "../../src/operations/QuadProbePlanner";
import type { RoomSnapshot } from "../../src/operations/SiegeTypes";

describe("quad probe escape planning", () => {
  let snapshot: RoomSnapshot;
  let terrain: number[];
  let members: ProbeMemberState[];

  beforeEach(() => {
    terrain = new Array<number>(2500).fill(0);
    snapshot = {
      roomName: "W18N7",
      tick: 1000,
      owner: "enemy",
      level: 6,
      safeModeEndsAt: 0,
      safeModeCooldownEndsAt: 0,
      controller: { x: 25, y: 25 },
      structures: [
        { id: "tower1", x: 25, y: 25, type: "tower", hits: 3000, hostile: true, energy: 1000 },
        { id: "tower2", x: 26, y: 25, type: "tower", hits: 3000, hostile: true, energy: 0 },
        { id: "spawn", x: 26, y: 26, type: "spawn", hits: 5000, hostile: true }
      ],
      creeps: []
    };
    const body: BodyPartConstant[] = [
      "ranged_attack",
      ...new Array<BodyPartConstant>(7).fill("heal"),
      ...new Array<BodyPartConstant>(8).fill("move")
    ];
    members = Array.from({ length: 4 }, () => ({
      body: body.map(type => ({ type, hits: 100 })),
      fatigue: 0,
      ticksToLive: 1200
    }));
  });

  it("admits a low-exposure two-tower entry while reserving 800 hits and treating empty towers as loaded", () => {
    const entry = chooseProbeEntry(snapshot, terrain, ["top"], () => true, members, 0.7);
    assert.isDefined(entry);
    assert.equal(probeExposure(snapshot)[51], 300);
    const estimate = estimateProbeEscape(members, [entry!.inside], probeExposure(snapshot), 0.7);
    assert.isTrue(estimate.safe);
    assert.isAtLeast(estimate.remainingHits, 800);
    assert.equal(estimate.ticks, 3);
    assert.isFalse(
      estimateProbeEscape(
        members,
        Array.from({ length: 20 }, (_, x) => ({ x: 20 - x, y: 1 })),
        probeExposure(snapshot),
        0.7
      ).safe
    );
  });

  it("rejects narrow, swamp, blocked, powered and high-fire entrances", () => {
    assert.isUndefined(chooseProbeEntry(snapshot, terrain, ["top"], (_, x) => x === 1, members, 0.7));
    const swamp = terrain.map(() => 2);
    assert.isUndefined(chooseProbeEntry(snapshot, swamp, ["top"], () => true, members, 0.7));
    snapshot.obstacles = Array.from({ length: 50 }, (_, x) => ({ x, y: 1 }));
    assert.isUndefined(chooseProbeEntry(snapshot, terrain, ["top"], () => true, members, 0.7));
    snapshot.obstacles = [];
    snapshot.structures[0].hasEffects = true;
    assert.isUndefined(chooseProbeEntry(snapshot, terrain, ["top"], () => true, members, 0.7));
    snapshot.structures[0].hasEffects = false;
    snapshot.structures[0].x = snapshot.structures[1].x = 2;
    snapshot.structures[0].y = snapshot.structures[1].y = 4;
    assert.isUndefined(chooseProbeEntry(snapshot, terrain, ["top"], (_, x) => x <= 2, members, 0.7));
  });

  it("rejects fatigue, damaged movement, inadequate lifetime and depleted healing", () => {
    const escape = [{ x: 1, y: 1 }];
    const exposure = probeExposure(snapshot);
    members[0].fatigue = 1;
    assert.isFalse(estimateProbeEscape(members, escape, exposure, 0.7).safe);
    members[0].fatigue = 0;
    members[0].ticksToLive = 20;
    assert.isFalse(estimateProbeEscape(members, escape, exposure, 0.7).safe);
    members[0].ticksToLive = 1200;
    members[0].body[members[0].body.length - 1].hits = 0;
    assert.isFalse(estimateProbeEscape(members, escape, exposure, 0.7).safe);
    members.forEach(member =>
      member.body.forEach(part => {
        part.hits = part.type === "heal" ? 0 : 100;
      })
    );
    assert.isFalse(estimateProbeEscape(members, escape, exposure, 0.7).safe);
  });

  it("prefers a farther low-exposure target and refuses unsafe advances", () => {
    snapshot.structures[0].x = snapshot.structures[1].x = 13;
    snapshot.structures[0].y = snapshot.structures[1].y = 20;
    snapshot.structures.push(
      { id: "dangerous", x: 9, y: 20, type: "extension", hits: 100, hostile: true },
      { id: "safe", x: 1, y: 30, type: "extension", hits: 100, hostile: true }
    );
    // Planning from healthy, tower-free intel is not permission to approach a loaded tower.
    const route = planProbe(snapshot, probeGrid(snapshot, terrain), [{ x: 1, y: 1 }], members, 0.7);
    assert.isUndefined(route);
    snapshot.structures[0].x = 13;
    snapshot.structures[0].y = 10;
    snapshot.structures = snapshot.structures.filter(
      structure => structure.id !== "spawn" && structure.id !== "tower2"
    );
    snapshot.structures.find(structure => structure.id === "safe")!.y = 30;
    snapshot.structures.find(structure => structure.id === "dangerous")!.x = 5;
    snapshot.structures.find(structure => structure.id === "dangerous")!.y = 25;
    const safer = planProbe(snapshot, probeGrid(snapshot, terrain), [{ x: 1, y: 25 }], members, 0.7);
    assert.equal(safer?.targetId, "safe");
    assert.isTrue(safer?.estimate.safe);
  });

  it("blocks natural obstacles and budgets mobile defenders even away from their current positions", () => {
    snapshot.obstacles = [{ x: 2, y: 1 }];
    assert.isFalse(clearProbeAnchor(probeGrid(snapshot, terrain), { x: 1, y: 1 }));
    snapshot.creeps.push({
      id: "guard",
      x: 40,
      y: 40,
      hits: 1000,
      hitsMax: 1000,
      attackDps: 300,
      rangedDps: 0,
      healPerTick: 0
    });
    assert.equal(probeExposure(snapshot)[51], 600);
    assert.isFalse(estimateProbeEscape(members, [{ x: 1, y: 1 }], probeExposure(snapshot), 0.7).safe);
  });
});
