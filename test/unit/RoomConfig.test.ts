import { assert } from "chai";
import type { RoomConfig } from "../../src/roomconfigs/RoomConfig";
import { ROOM_CONFIGS } from "../../src/roomconfigs/registry";
import {
  validateRoomConfig,
  validateRoomConfigRegistry,
  validateUniqueRoomConfigNames
} from "../../src/roomconfigs/RoomConfig";
import { mapTemplateConfig } from "../../src/utils/RoomLayoutMapper";

describe("room configuration", () => {
  before(() => {
    Object.assign(global, {
      TOP: 1,
      TOP_RIGHT: 2,
      RIGHT: 3,
      BOTTOM_RIGHT: 4,
      BOTTOM: 5,
      BOTTOM_LEFT: 6,
      LEFT: 7,
      TOP_LEFT: 8
    });
  });

  it("validates every registered room config", () => {
    validateRoomConfigRegistry(ROOM_CONFIGS);
    assert.lengthOf(Object.keys(ROOM_CONFIGS), 53);
  });

  it("rejects duplicate and malformed room names", () => {
    assert.throws(() => validateUniqueRoomConfigNames(["E1N1", "E1N1"]), /duplicate/);
    assert.throws(() => validateUniqueRoomConfigNames(["not-a-room"]), /Invalid room config name/);
  });

  it("rejects incomplete or invalid config values", () => {
    assert.throws(() => validateRoomConfig("E1N1", { shard: "shard1" }), /valid room type/);
    assert.throws(
      () =>
        validateRoomConfig("E1N1", {
          shard: "shard1",
          type: "owned",
          roomtemplate: "unknown"
        }),
      /unsupported template/
    );
    assert.throws(
      () =>
        validateRoomConfig("E1N1", {
          shard: "shard1",
          type: "owned",
          energysources: [{ id: "source", pos: { x: 50, y: 1 } }]
        }),
      /energysources\[0\]\.pos/
    );
  });

  it("maps only declared layout positions and preserves non-position metadata", () => {
    const template: RoomConfig = {
      shard: "shard1",
      type: "owned",
      road: [{ x: 0, y: 0 }],
      energysources: [{ id: "source", pos: { x: 40, y: 41 }, haulers: 2 }],
      field0: {
        levels: [4, 5],
        parkingspot: { x: 1, y: 2 },
        containers: [{ x: 2, y: 3 }]
      }
    };

    const mapped = mapTemplateConfig(template, { x: 10, y: 20 }, 1);

    assert.deepEqual(mapped.road, [{ x: 10, y: 31 }]);
    assert.deepEqual(mapped.field0?.parkingspot, { x: 12, y: 30 });
    assert.deepEqual(mapped.field0?.containers, [{ x: 13, y: 29 }]);
    assert.deepEqual(mapped.field0?.levels, [4, 5]);
    assert.deepEqual(mapped.energysources, template.energysources);
  });
});
