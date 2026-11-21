import { assert } from "chai";
import { chooseDrainEntry } from "../../src/operations/SmallSiegePlanner";
import { buildExposureMap, getAnchorExposure, getFootprint, ROOM_SIZE } from "../../src/operations/SiegePlanner";
import { isKeeperRoom, keeperSafeTravel } from "../../src/operations/SiegeRouting";
import type { RoomSnapshot } from "../../src/operations/SiegeTypes";

function snapshot(): RoomSnapshot {
  return {
    roomName: "W18N7",
    tick: 1,
    owner: "enemy",
    level: 4,
    safeModeEndsAt: 0,
    safeModeCooldownEndsAt: 0,
    controller: { x: 25, y: 25 },
    structures: [
      { id: "tower", type: "tower", x: 25, y: 25, hits: 3000, hostile: true, energy: 1000 },
      { id: "spawn", type: "spawn", x: 26, y: 25, hits: 5000, hostile: true }
    ],
    creeps: []
  };
}

describe("RCL 4 siege planning", () => {
  it("finds a reachable 2x2 position at minimum tower exposure", () => {
    const terrain = new Array(ROOM_SIZE * ROOM_SIZE).fill(0);
    const room = snapshot();
    const entry = chooseDrainEntry(room, terrain, ["top", "left"]);
    assert.isDefined(entry);
    assert.equal(getAnchorExposure(buildExposureMap(room), entry!.anchor), 150);
    assert.equal(getFootprint(entry!.anchor).length, 4);
    assert.include(["top", "left"], entry!.side);
  });

  it("rejects inaccessible positions and exits", () => {
    const terrain = new Array(ROOM_SIZE * ROOM_SIZE).fill(1);
    for (let x = 20; x <= 25; x++) {
      for (let y = 0; y <= 10; y++) terrain[y * ROOM_SIZE + x] = 0;
    }
    assert.isDefined(chooseDrainEntry(snapshot(), terrain, ["top"]));
    assert.isUndefined(chooseDrainEntry(snapshot(), terrain, ["bottom"]));
    assert.isUndefined(chooseDrainEntry(snapshot(), terrain, []));
    assert.isUndefined(chooseDrainEntry(snapshot(), terrain, ["top"], () => false));
  });

  it("admits a distant single tower but rejects two towers for an unboosted RCL6 entry", () => {
    const terrain = new Array(ROOM_SIZE * ROOM_SIZE).fill(0);
    const room = snapshot();
    const entry = chooseDrainEntry(room, terrain, ["top"], () => true, 168);
    assert.isDefined(entry);
    const exposure = buildExposureMap(room);
    assert.isAtMost(getAnchorExposure(exposure, entry!.anchor), 168);
    assert.deepEqual(entry!.path[0], entry!.entry);
    assert.deepEqual(entry!.path[entry!.path.length - 1], entry!.anchor);
    for (const tile of entry!.path) assert.isAtMost(exposure[tile.y * ROOM_SIZE + tile.x], 168);
    room.structures.push({ ...room.structures[0], id: "tower2", x: 26 });
    assert.isUndefined(chooseDrainEntry(room, terrain, ["top"], () => true, 168));
  });

  it("rejects a safe drain position when reaching it requires crossing excessive tower fire", () => {
    const terrain = new Array(ROOM_SIZE * ROOM_SIZE).fill(1);
    // A one-wide corridor passes the tower before reaching the only clear 2x2.
    for (let y = 0; y <= 48; y++) terrain[y * ROOM_SIZE + 20] = 0;
    for (const y of [47, 48]) terrain[y * ROOM_SIZE + 21] = 0;
    const room = snapshot();
    assert.isDefined(chooseDrainEntry(room, terrain, ["top"]));
    assert.isUndefined(chooseDrainEntry(room, terrain, ["top"], () => true, 168));
  });

  it("forbids keeper rooms even when they are visible or routing fails", () => {
    assert.isTrue(isKeeperRoom("W16N4"));
    assert.isTrue(isKeeperRoom("E4S6"));
    assert.isFalse(isKeeperRoom("W15N5"));
    assert.isFalse(isKeeperRoom("W17N4"));
    assert.isFalse(isKeeperRoom("W18N7"));
    const options = keeperSafeTravel(1);
    assert.equal(options.routeCallback!("W16N4"), Infinity);
    assert.isFalse(options.roomCallback!("W16N4", {} as CostMatrix));
    const matrix = {} as CostMatrix;
    assert.strictEqual(options.roomCallback!("W18N4", matrix), matrix);
  });
});
