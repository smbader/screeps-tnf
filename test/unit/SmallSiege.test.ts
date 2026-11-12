import { assert } from "chai";
import * as sinon from "sinon";
import type { SiegeMemory, SiegeOptions } from "../../src/operations/SiegeTypes";

describe("RCL 4 siege lifecycle", () => {
  const values: Record<string, unknown> = {
    TOP: 1,
    TOP_RIGHT: 2,
    RIGHT: 3,
    BOTTOM_RIGHT: 4,
    BOTTOM: 5,
    BOTTOM_LEFT: 6,
    LEFT: 7,
    TOP_LEFT: 8,
    STRUCTURE_ROAD: "road",
    STRUCTURE_CONTAINER: "container",
    STRUCTURE_RAMPART: "rampart",
    STRUCTURE_SPAWN: "spawn",
    STRUCTURE_TOWER: "tower",
    STRUCTURE_CONTROLLER: "controller",
    RESOURCE_ENERGY: "energy",
    MOVE: "move",
    ATTACK: "attack",
    HEAL: "heal",
    RANGED_ATTACK: "ranged_attack",
    FIND_MY_SPAWNS: 1,
    FIND_HOSTILE_CREEPS: 2,
    FIND_HOSTILE_STRUCTURES: 3,
    FIND_STRUCTURES: 4,
    LOOK_STRUCTURES: "structure",
    TERRAIN_MASK_WALL: 1,
    OK: 0,
    ERR_NOT_ENOUGH_ENERGY: -6,
    RoomPosition: class {
      public constructor(public x: number, public y: number, public roomName: string) {}
      public getRangeTo(target: { x?: number; y?: number; pos?: { x: number; y: number } }): number {
        const pos = target.pos || target;
        return Math.max(Math.abs(this.x - pos.x!), Math.abs(this.y - pos.y!));
      }
    }
  };
  const original: Record<string, unknown> = {};
  let SmallSiege: typeof import("../../src/operations/SmallSiege").SmallSiege;
  let body: BodyPartConstant[];
  let memory: SiegeMemory;
  let calls: { parts: BodyPartConstant[]; name: string }[];
  const options: SiegeOptions = { id: "test", mode: "rcl4", homeRoom: "W17N4", targetRoom: "W18N7" };

  before(() => {
    for (const key of [...Object.keys(values), "Game"]) original[key] = Reflect.get(global, key);
    Object.assign(global, values);
    const module = require("../../src/operations/SmallSiege") as typeof import("../../src/operations/SmallSiege");
    SmallSiege = module.SmallSiege;
    body = module.SMALL_SIEGE_BODY;
  });

  beforeEach(() => {
    calls = [];
    const spawn = {
      spawning: null,
      spawnCreep: (parts: BodyPartConstant[], name: string): number => {
        calls.push({ parts, name });
        return 0;
      }
    };
    const home = {
      name: "W17N4",
      controller: { my: true, owner: { username: "me" } },
      energyAvailable: 1300,
      energyCapacityAvailable: 1300,
      find: (kind: number): object[] => (kind === 1 ? [spawn] : [])
    };
    Reflect.set(global, "Game", {
      time: 1000,
      creeps: {},
      rooms: { W17N4: home },
      map: {
        describeExits: () => ({ "1": "W18N6", "3": "W17N7" }),
        findRoute: () => [],
        getRoomTerrain: () => ({ get: () => 0 })
      }
    });
    memory = {
      id: "test",
      targetRoom: "W18N7",
      phase: "PLANNING",
      phaseSince: 0,
      attempt: 0,
      members: {}
    };
  });

  after(() => {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) Reflect.deleteProperty(global, key);
      else Reflect.set(global, key, original[key]);
    }
  });

  function cacheIntel(): void {
    memory.snapshot = {
      roomName: "W18N7",
      tick: 1000,
      owner: "enemy",
      level: 4,
      safeModeEndsAt: 0,
      safeModeCooldownEndsAt: 0,
      controller: { x: 25, y: 25 },
      structures: [
        { id: "spawn", x: 26, y: 25, type: "spawn", hits: 5000, hostile: true },
        { id: "tower", x: 25, y: 25, type: "tower", hits: 3000, hostile: true, energy: 1000 }
      ],
      creeps: []
    };
  }

  it("requests a scout and continues spawning while the scout travels", () => {
    const operation = new SmallSiege();
    operation.update(memory, options);
    operation.supply(memory, options);
    assert.equal(memory.status, "scouting target; preparing quad");
    assert.lengthOf(calls, 1);
    assert.deepEqual(calls[0].parts, ["move"]);
    assert.equal(memory.scoutName, calls[0].name);
    const game = Reflect.get(global, "Game");
    game.creeps[memory.scoutName!] = { spawning: false };
    operation.supply(memory, options);
    assert.deepEqual(calls[1].parts, body);
  });

  it("uses old cached intel without waiting for another scout", () => {
    cacheIntel();
    const game = Reflect.get(global, "Game");
    game.time = 2000;
    const operation = new SmallSiege();
    operation.update(memory, options);
    operation.supply(memory, options);
    assert.isDefined(memory.drainAnchor);
    assert.isDefined(memory.smallSiegeEntry);
    assert.deepEqual(calls[0].parts, body);
    assert.equal(memory.snapshot!.tick, 1000);
  });

  it("sends a complete quad toward the target before scout intel arrives", () => {
    const game = Reflect.get(global, "Game");
    game.map.findRoute = () => [{ room: "W17N5" }, { room: "W17N6" }, { room: "W18N7" }];
    const room = { name: "W17N4", find: () => [] };
    const Position = Reflect.get(global, "RoomPosition");
    for (const slot of ["A1", "A2", "S1", "S2"] as const) {
      const name = `member-${slot}`;
      game.creeps[name] = {
        name,
        room,
        pos: new Position(25, 25, "W17N4"),
        spawning: false,
        getActiveBodyparts: () => 0
      };
      memory.members[slot] = { name, spawnRoom: "W17N4", spawnedAt: 1 };
    }
    const QuadController = require("../../src/operations/QuadController").QuadController;
    const move = sinon.stub(QuadController.prototype, "moveFile").returns("ARRIVED");
    try {
      new SmallSiege().control(memory, options);
      assert.equal(move.callCount, 1);
      assert.equal(move.firstCall.args[0].roomName, "W17N6");
      assert.include(memory.status, "toward target");
      new SmallSiege().control(memory, options);
      assert.equal(move.secondCall.args[0].roomName, "W18N7");
    } finally {
      move.restore();
    }
  });

  it("uses the cached entry when there is no target vision", () => {
    cacheIntel();
    const game = Reflect.get(global, "Game");
    game.time = 2000;
    const room = { name: "W17N4", find: () => [] };
    const Position = Reflect.get(global, "RoomPosition");
    for (const slot of ["A1", "A2", "S1", "S2"] as const) {
      const name = `member-${slot}`;
      game.creeps[name] = {
        name,
        room,
        pos: new Position(25, 25, "W17N4"),
        spawning: false,
        getActiveBodyparts: () => 0
      };
      memory.members[slot] = { name, spawnRoom: "W17N4", spawnedAt: 1 };
    }
    const operation = new SmallSiege();
    operation.update(memory, options);
    const QuadController = require("../../src/operations/QuadController").QuadController;
    const move = sinon.stub(QuadController.prototype, "moveFile").returns("ARRIVED");
    try {
      operation.control(memory, options);
      assert.equal(move.firstCall.args[0].roomName, memory.smallSiegeEntry!.roomName);
      assert.isTrue(memory.smallSiegeEntryReady);
      operation.control(memory, options);
      assert.equal(move.secondCall.args[0].roomName, "W18N7");
      assert.equal(move.secondCall.args[0].x, memory.drainAnchor!.x);
    } finally {
      move.restore();
    }
  });

  it("does not declare victory from an old snapshot with no spawns", () => {
    cacheIntel();
    memory.snapshot!.structures = [];
    Reflect.get(global, "Game").time = 2000;
    new SmallSiege().update(memory, options);
    assert.notEqual(memory.phase, "COMPLETE");
  });

  it("uses cached intel and spawns an affordable mixed quad member", () => {
    cacheIntel();
    const operation = new SmallSiege();
    operation.update(memory, options);
    operation.supply(memory, options);
    assert.equal(memory.phase, "PREPARING");
    assert.isDefined(memory.drainAnchor);
    assert.deepEqual(calls[0].parts, body);
    const costs: Record<string, number> = { tough: 10, move: 50, ranged_attack: 150, heal: 250 };
    assert.equal(
      body.reduce((sum, part) => sum + costs[part], 0),
      1300
    );
    assert.equal(body.filter(part => part === "heal").length * 4 * 12, 144);
    assert.equal(body.filter(part => part === "ranged_attack").length * 4 * 10, 80);
    const move = body.filter(part => part === "move").length;
    const weight = body.length - move;
    assert.equal(move, 5);
    assert.equal(weight, 5);
    assert.equal(Math.max(0, weight * 2 - move * 2), 0);
    assert.equal(Math.ceil((weight * 5) / move), 5);
  });

  it("caches a scout's live snapshot including tower energy", () => {
    const game = Reflect.get(global, "Game");
    const spawn = { id: "s", pos: { x: 26, y: 25 }, structureType: "spawn", hits: 5000, owner: { username: "enemy" } };
    const tower = {
      id: "t",
      pos: { x: 25, y: 25 },
      structureType: "tower",
      hits: 3000,
      owner: { username: "enemy" },
      store: { getUsedCapacity: () => 730 }
    };
    game.rooms.W18N7 = {
      name: "W18N7",
      controller: { owner: { username: "enemy" }, level: 4, pos: { x: 20, y: 20 } },
      find: (kind: number) => (kind === 4 ? [spawn, tower] : [])
    };
    new SmallSiege().update(memory, options);
    assert.equal(memory.snapshot?.tick, 1000);
    assert.equal(memory.snapshot?.structures.find(item => item.id === "t")?.energy, 730);
    assert.equal(memory.phase, "PREPARING");
  });

  it("keeps retrying after more than the standard siege attempt limit", () => {
    cacheIntel();
    memory.attempt = 99;
    memory.members.A1 = { name: "dead", spawnRoom: "W17N4", spawnedAt: 1 };
    new SmallSiege().update(memory, options);
    assert.equal(memory.phase, "PREPARING");
    assert.equal(memory.wave, 2);
    assert.deepEqual(memory.members, {});
  });

  it("does not spawn during safe mode", () => {
    cacheIntel();
    memory.snapshot!.safeModeEndsAt = 1200;
    const operation = new SmallSiege();
    operation.update(memory, options);
    operation.supply(memory, options);
    assert.equal(memory.phase, "PAUSED");
    assert.lengthOf(calls, 0);
  });

  it("executes a feasible tower objective rather than discarding it", () => {
    cacheIntel();
    memory.phase = "STAGING";
    memory.drainAnchor = { x: 1, y: 1 };
    const game = Reflect.get(global, "Game");
    const tower = { id: "tower", structureType: "tower", pos: { x: 3, y: 3 } };
    const room = {
      name: "W18N7",
      find: (kind: number) => (kind === 3 ? [tower] : []),
      lookForAt: () => [tower]
    };
    game.rooms.W18N7 = room;
    game.getObjectById = () => tower;
    const Position = Reflect.get(global, "RoomPosition");
    const attacks: string[] = [];
    (["A1", "A2", "S1", "S2"] as const).forEach((slot, index) => {
      const name = `member-${slot}`;
      game.creeps[name] = {
        name,
        pos: new Position(1 + (index % 2), 1 + Math.floor(index / 2), "W18N7"),
        room,
        spawning: false,
        fatigue: 0,
        hits: 1000,
        hitsMax: 1000,
        body: body.map(type => ({ type, hits: 100 })),
        getActiveBodyparts: (part: string) => (part === "heal" ? 20 : part === "ranged_attack" ? 2 : 5),
        heal: () => 0,
        rangedAttack: (target: { id: string }) => {
          attacks.push(target.id);
          return 0;
        }
      };
      memory.members[slot] = { name, spawnRoom: "W17N4", spawnedAt: 1 };
    });
    const planner = require("../../src/operations/SiegePlanner");
    const plan = {
      snapshotTick: 1000,
      objective: "TOWERS",
      path: [{ anchor: { x: 1, y: 1 }, exposure: 150, ticks: 0, breach: [] }],
      goalAnchor: { x: 1, y: 1 },
      targetId: "tower",
      targetPos: { x: 3, y: 3 },
      totalTicks: 1,
      totalBreachHits: 0,
      peakExposure: 150,
      healBudget: 672
    };
    const stub = sinon.stub(planner, "planSiege").returns({ feasible: true, plan });
    try {
      const operation = new SmallSiege();
      operation.control(memory, options);
      assert.equal(memory.assaultPlan?.objective, "TOWERS");
      operation.control(memory, options);
      assert.include(attacks, "tower");
      assert.isDefined(memory.assaultPlan);
    } finally {
      stub.restore();
    }
  });

  it("drains an active tower, attacks when it empties, and stops if it refills", () => {
    cacheIntel();
    memory.phase = "STAGING";
    memory.drainAnchor = { x: 1, y: 1 };
    const game = Reflect.get(global, "Game");
    const hostileStructures: { id: string; structureType: string; pos: { x: number; y: number } }[] = [];
    const room = {
      name: "W18N7",
      find: (kind: number) => (kind === 3 ? hostileStructures : []),
      lookForAt: (_kind: string, x: number, y: number) =>
        hostileStructures.filter(structure => structure.pos.x === x && structure.pos.y === y)
    };
    game.rooms.W18N7 = room;
    const Position = Reflect.get(global, "RoomPosition");
    const slots = ["A1", "A2", "S1", "S2"] as const;
    const attacks: string[] = [];
    slots.forEach((slot, index) => {
      const name = `member-${slot}`;
      const pos = new Position(1 + (index % 2), 1 + Math.floor(index / 2), "W18N7");
      game.creeps[name] = {
        name,
        pos,
        room,
        spawning: false,
        fatigue: 0,
        hits: body.length * 100,
        hitsMax: body.length * 100,
        body: body.map(type => ({ type, hits: 100 })),
        getActiveBodyparts: (part: string) => body.filter(type => type === part).length,
        heal: () => 0,
        rangedAttack: (target: { id: string }) => {
          attacks.push(target.id);
          return 0;
        }
      };
      memory.members[slot] = { name, spawnRoom: "W17N4", spawnedAt: 1 };
    });
    const operation = new SmallSiege();
    operation.control(memory, options);
    assert.include(memory.status, "draining tower");
    assert.isUndefined(memory.assaultPlan);

    memory.snapshot!.structures[1].energy = 0;
    game.time += 25;
    operation.control(memory, options);
    assert.equal(memory.assaultPlan?.objective, "SPAWNS");

    memory.snapshot!.structures[1].energy = 100;
    game.time++;
    operation.control(memory, options);
    assert.isUndefined(memory.assaultPlan);
    assert.include(memory.status, "route no longer safe");

    hostileStructures.push({ id: "tower", structureType: "tower", pos: { x: 25, y: 25 } });
    hostileStructures.push({ id: "spawn", structureType: "spawn", pos: { x: 3, y: 3 } });
    operation.control(memory, options);
    assert.include(attacks, "spawn");
  });
});
