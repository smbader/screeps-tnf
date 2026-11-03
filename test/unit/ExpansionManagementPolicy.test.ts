import {
  ExpansionRoomIntel,
  evaluateExpansionIntel,
  getAcceptableExpansionCandidates,
  getExpansionCandidates
} from "../../src/operations/ExpansionManagementTypes";
import { findBestExpansionLayout } from "../../src/operations/ExpansionLayout";
import { assert } from "chai";

describe("expansion management policy", () => {
  it("finds deterministic reachable candidates within the distance limit", () => {
    const graph: Record<string, string[]> = {
      E1N1: ["E1N2", "E2N1"],
      E1N2: ["E1N1", "E1N3"],
      E2N1: ["E1N1", "E2N2"],
      E1N3: ["E1N2"]
    };

    const candidates = getExpansionCandidates(["E1N1"], roomName => graph[roomName] || [], 2, 10);

    assert.deepEqual(
      candidates.map(candidate => [candidate.roomName, candidate.distance]),
      [
        ["E1N2", 1],
        ["E2N1", 1],
        ["E1N3", 2],
        ["E2N2", 2]
      ]
    );
  });

  it("rejects unsafe, owned, or insufficient-source scouting results", () => {
    const eligible: ExpansionRoomIntel = {
      roomName: "E2N2",
      lastSeen: 100,
      owner: null,
      reservation: "ricane",
      controller: true,
      sources: 2,
      sourceIds: ["source1" as Id<Source>, "source2" as Id<Source>],
      keeperLairs: false,
      hostileCreeps: 0,
      layout: {
        anchor: { x: 10, y: 10 },
        rotation: 0,
        score: 100,
        perimeterRamparts: 48,
        edgeOpeningCount: 2,
        averageTowerOpeningDistance: 5
      }
    };

    assert.isNull(evaluateExpansionIntel(eligible, "ricane", 2));
    assert.equal(evaluateExpansionIntel({ ...eligible, owner: "enemy" }, "ricane", 2), "owned by enemy");
    assert.equal(evaluateExpansionIntel({ ...eligible, reservation: "enemy" }, "ricane", 2), "reserved by enemy");
    assert.equal(evaluateExpansionIntel({ ...eligible, keeperLairs: true }, "ricane", 2), "source keeper room");
    assert.equal(evaluateExpansionIntel({ ...eligible, sources: 1 }, "ricane", 2), "only 1 source(s)");
  });

  it("returns only fresh, acceptable rooms and ranks by sources then distance", () => {
    const candidates = [
      { roomName: "E2N1", homeRoom: "E1N1", distance: 1 },
      { roomName: "E2N2", homeRoom: "E1N1", distance: 2 },
      { roomName: "E2N3", homeRoom: "E1N1", distance: 1 },
      { roomName: "E2N4", homeRoom: "E1N1", distance: 1 }
    ];
    const baseIntel: ExpansionRoomIntel = {
      roomName: "",
      lastSeen: 95,
      owner: null,
      reservation: null,
      controller: true,
      sources: 2,
      sourceIds: ["source1" as Id<Source>, "source2" as Id<Source>],
      keeperLairs: false,
      hostileCreeps: 0,
      layout: {
        anchor: { x: 10, y: 10 },
        rotation: 0,
        score: 100,
        perimeterRamparts: 48,
        edgeOpeningCount: 2,
        averageTowerOpeningDistance: 5
      }
    };

    const acceptable = getAcceptableExpansionCandidates(
      candidates,
      {
        E2N1: { ...baseIntel, roomName: "E2N1", sources: 2 },
        E2N2: { ...baseIntel, roomName: "E2N2", sources: 3 },
        E2N3: { ...baseIntel, roomName: "E2N3", lastSeen: 10 },
        E2N4: { ...baseIntel, roomName: "E2N4", layout: undefined }
      },
      100,
      "ricane",
      2,
      20
    );

    assert.deepEqual(
      acceptable.map(entry => entry.candidate.roomName),
      ["E2N2", "E2N1"]
    );
  });

  it("chooses a deterministic, in-bounds template placement from terrain and exits", () => {
    const globalNames = ["FIND_SOURCES", "FIND_MINERALS", "TERRAIN_MASK_WALL"];
    const previousGlobals = globalNames.map(name => ({
      name,
      descriptor: Object.getOwnPropertyDescriptor(global, name)
    }));
    Object.defineProperty(global, "FIND_SOURCES", { configurable: true, value: 1 });
    Object.defineProperty(global, "FIND_MINERALS", { configurable: true, value: 2 });
    Object.defineProperty(global, "TERRAIN_MASK_WALL", { configurable: true, value: 1 });

    try {
      const room = {
        getTerrain: () => ({ get: () => 0 }),
        controller: { pos: { x: 25, y: 25 } },
        find: () => []
      } as unknown as Room;
      const first = findBestExpansionLayout(room);
      const second = findBestExpansionLayout(room);

      assert.isNotNull(first);
      if (!first) throw new Error("Expected a valid default layout");
      assert.deepEqual(first, second);
      assert.isAtLeast(first.anchor.x, 1);
      assert.isAtMost(first.anchor.x, 37);
      assert.isAtLeast(first.anchor.y, 1);
      assert.isAtMost(first.anchor.y, 37);
      assert.isAtLeast(first.rotation, 0);
      assert.isAtMost(first.rotation, 3);
      assert.equal(first.edgeOpeningCount, 4);
    } finally {
      for (const { name, descriptor } of previousGlobals) {
        if (descriptor) Object.defineProperty(global, name, descriptor);
        else Reflect.deleteProperty(global, name);
      }
    }
  });
});
