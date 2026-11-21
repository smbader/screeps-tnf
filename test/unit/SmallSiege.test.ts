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
    FIND_SOURCES: 5,
    FIND_MINERALS: 6,
    FIND_CREEPS: 7,
    FIND_POWER_CREEPS: 8,
    EVENT_ATTACK: 1,
    LOOK_STRUCTURES: "structure",
    LOOK_CREEPS: "creep",
    LOOK_POWER_CREEPS: "powerCreep",
    TERRAIN_MASK_WALL: 1,
    OK: 0,
    ERR_NOT_ENOUGH_ENERGY: -6,
    ERR_NO_PATH: -2,
    ERR_TIRED: -11,
    ERR_BUSY: -4,
    RoomPosition: class {
      public constructor(public x: number, public y: number, public roomName: string) {}
      public getRangeTo(target: { x?: number; y?: number; pos?: { x: number; y: number } }): number {
        const pos = target.pos || target;
        return Math.max(Math.abs(this.x - pos.x!), Math.abs(this.y - pos.y!));
      }
      public isEqualTo(target: { x: number; y: number; roomName: string }): boolean {
        return this.x === target.x && this.y === target.y && this.roomName === target.roomName;
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
    for (const key of [...Object.keys(values), "Game", "Memory"]) original[key] = Reflect.get(global, key);
    Object.assign(global, values);
    const module = require("../../src/operations/SmallSiege") as typeof import("../../src/operations/SmallSiege");
    SmallSiege = module.SmallSiege;
    body = module.SMALL_SIEGE_BODY;
  });

  beforeEach(() => {
    Reflect.set(global, "Memory", {});
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

  describe("hostile-aware scout routing", () => {
    function setupScout() {
      const game = Reflect.get(global, "Game");
      const travel = sinon.stub().returns(OK);
      const scoutMemory: CreepMemory = { role: "siegeScout", _travel: { path: "old-dangerous-path" } };
      const scout: Partial<Creep> = {
        name: "scout", memory: scoutMemory, spawning: false,
        pos: new RoomPosition(45, 39, "W20N6"), travelTo: travel
      };
      memory.scoutName = "scout";
      game.creeps.scout = scout;
      const safeRoute = [
        { exit: TOP, room: "W20N7" }, { exit: RIGHT, room: "W19N7" }, { exit: RIGHT, room: "W18N7" }
      ];
      const route = sinon.stub().returns(safeRoute);
      game.map.findRoute = route;
      Reflect.set(global, "Memory", {
        rooms: { W19N6: { owner: "enemy" }, W18N7: { owner: "enemy" }, W17N4: { owner: "me" } }
      });
      return { game, scout, scoutMemory, travel, route, safeRoute };
    }

    it("detours around the logged W19N6 death room using cached ownership and records the route", () => {
      const { travel, route, scoutMemory } = setupScout();
      const diagnostics = require("../../src/operations/SiegeDiagnostics") as typeof import("../../src/operations/SiegeDiagnostics");
      diagnostics.beginSiegeDiagnostics(memory, options);
      new SmallSiege().control(memory, options);
      assert.isTrue(route.calledOnce);
      const routeOptions = route.firstCall.args[2] as RouteOptions;
      assert.equal(routeOptions.routeCallback!("W19N6", "W20N6"), Infinity);
      assert.isFinite(routeOptions.routeCallback!("W16N6", "W17N6"));
      assert.isFinite(routeOptions.routeCallback!("W18N7", "W19N7"));
      assert.isFinite(routeOptions.routeCallback!("W17N4", "W18N4"));
      assert.isUndefined(scoutMemory._travel);
      assert.deepEqual(memory.scoutRoute?.rooms, ["W20N7", "W19N7", "W18N7"]);
      assert.deepEqual(memory.scoutRoute?.avoidedRooms, ["W19N6"]);
      assert.deepInclude(Memory.siegeLogs?.records.find(record => record.kind === "scout-route")?.data, {
        avoidedRooms: ["W19N6"], rooms: ["W20N7", "W19N7", "W18N7"], result: OK
      });
      const travelOptions = travel.firstCall.args[1] as import("../../src/utils/Traveler").TravelToOptions;
      const matrix = {} as CostMatrix;
      assert.strictEqual(travelOptions.roomCallback!("W19N6", matrix), false);
      assert.strictEqual(travelOptions.roomCallback!("W20N8", matrix), false);
      assert.strictEqual(travelOptions.roomCallback!("W18N7", matrix), matrix);
    });

    it("invalidates a cached path when another transit room becomes hostile, but keeps an unchanged route", () => {
      const { game, scoutMemory, route } = setupScout();
      const operation = new SmallSiege();
      operation.control(memory, options);
      scoutMemory._travel = { path: "cached-safe-route" };
      game.time++;
      operation.control(memory, options);
      assert.isTrue(route.calledOnce);
      assert.isDefined(scoutMemory._travel);
      game.rooms.W19N7 = { name: "W19N7", controller: { owner: { username: "enemy" } } };
      route.returns([
        { exit: TOP, room: "W20N7" }, { exit: TOP, room: "W20N8" },
        { exit: RIGHT, room: "W19N8" }, { exit: RIGHT, room: "W18N8" }, { exit: BOTTOM, room: "W18N7" }
      ]);
      operation.control(memory, options);
      assert.isTrue(route.calledTwice);
      assert.isUndefined(scoutMemory._travel);
      assert.isTrue(memory.scoutRoute?.avoidedRooms.includes("W19N7"));
      delete game.rooms.W19N7;
      game.time++;
      operation.control(memory, options);
      assert.isTrue(route.calledTwice);
      assert.isTrue(memory.scoutRoute?.avoidedRooms.includes("W19N7"));
    });

    it("holds on a blocked map route instead of falling back through hostiles, and retries later", () => {
      const { game, route, travel, scoutMemory } = setupScout();
      route.returns(ERR_NO_PATH);
      const operation = new SmallSiege();
      operation.control(memory, options);
      assert.isFalse(travel.called);
      assert.isUndefined(scoutMemory._travel);
      assert.include(memory.status, "scout route blocked");
      game.time++;
      operation.control(memory, options);
      assert.isTrue(route.calledOnce);
      game.time += 100;
      operation.control(memory, options);
      assert.isTrue(route.calledTwice);
      assert.isFalse(travel.called);
    });

    it("allows escape from the scout's current hostile room and clears ownership when visibly safe", () => {
      const { game, scout, route } = setupScout();
      scout.pos = new RoomPosition(49, 39, "W19N6");
      game.rooms.W19N6 = { name: "W19N6", controller: { owner: { username: "enemy" } } };
      const operation = new SmallSiege();
      operation.control(memory, options);
      const routeOptions = route.firstCall.args[2] as RouteOptions;
      assert.isFinite(routeOptions.routeCallback!("W19N6", "W20N6"));
      assert.isDefined(Memory.siegeHostileRooms?.W19N6);
      game.rooms.W19N6.controller = { my: true, owner: { username: "me" } };
      operation.control(memory, options);
      assert.isUndefined(Memory.siegeHostileRooms?.W19N6);
    });

    it("surfaces tile-path failures and discards the failed cached route before retrying", () => {
      const { travel, route, scoutMemory } = setupScout();
      travel.returns(ERR_NO_PATH);
      const operation = new SmallSiege();
      operation.control(memory, options);
      assert.include(memory.status, "scout travel from W20N6 to W18N7 failed: -2");
      assert.isUndefined(scoutMemory._travel);
      assert.isUndefined(memory.scoutRoute);
      travel.returns(OK);
      operation.control(memory, options);
      assert.isTrue(route.calledTwice);
    });
  });

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

  describe("RCL 6 sustainable mode", () => {
    let rcl6Body: BodyPartConstant[];
    const rcl6Options: SiegeOptions = { ...options, mode: "rcl6" };

    beforeEach(() => {
      rcl6Body = require("../../src/operations/SmallSiege").RCL6_SIEGE_BODY;
      const home = Reflect.get(global, "Game").rooms.W17N4;
      home.energyAvailable = home.energyCapacityAvailable = 2300;
    });

    function setupQuad() {
      cacheIntel();
      memory.phase = "STAGING";
      memory.drainAnchor = { x: 1, y: 1 };
      memory.smallSiegeEntry = { roomName: "W18N6", pos: { x: 1, y: 48 } };
      const game = Reflect.get(global, "Game");
      const hostiles: Creep[] = [];
      const structures: Structure[] = [];
      const obstacles: Structure[] = [];
      const room = {
        name: "W18N7",
        find: (kind: number) =>
          kind === FIND_HOSTILE_CREEPS ? hostiles : kind === FIND_HOSTILE_STRUCTURES ? structures : [],
        getTerrain: () => ({ get: () => 0 }),
        lookForAt: (kind: string, x: number, y: number) =>
          kind === LOOK_STRUCTURES
            ? [...structures, ...obstacles].filter(structure => structure.pos.x === x && structure.pos.y === y)
            : []
      };
      game.rooms.W18N7 = room;
      game.getObjectById = (id: string) => structures.find(structure => structure.id === id);
      const members = (["A1", "A2", "S1", "S2"] as const).map((slot, index) => {
        const name = `rcl6-${slot}`;
        const creep = {
            id: name,
          name,
          pos: new RoomPosition(1 + (index % 2), 1 + Math.floor(index / 2), "W18N7"),
          room,
          spawning: false,
          fatigue: 0,
          hits: 1600,
          hitsMax: 1600,
          body: rcl6Body.map(type => ({ type, hits: 100 })),
          getActiveBodyparts: (part: string) => creep.body.filter(item => item.type === part && item.hits > 0).length,
          heal: sinon.stub().returns(OK),
          rangedAttack: sinon.stub().returns(OK),
          move: sinon.stub().returns(OK),
          travelTo: sinon.stub().returns(OK)
        };
        game.creeps[name] = creep;
        memory.members[slot] = { name, spawnRoom: "W17N4", spawnedAt: 1 };
        return { slot, creep };
      });
      return { game, members, hostiles, structures, obstacles, room };
    }

    it("spawns a 2300-energy, plain-speed quad with 336 healing and 40 ranged DPS", () => {
      cacheIntel();
      const operation = new SmallSiege();
      operation.update(memory, rcl6Options);
      operation.supply(memory, rcl6Options);
      assert.equal(memory.phase, "PREPARING");
      assert.deepEqual(calls[0].parts, rcl6Body);
      const planner =
        require("../../src/operations/SiegePlanner") as typeof import("../../src/operations/SiegePlanner");
      assert.equal(planner.getBodyCost(calls[0].parts), 2300);
      assert.equal(rcl6Body.filter(part => part === HEAL).length * 4 * 12, 336);
      assert.equal(rcl6Body.filter(part => part === RANGED_ATTACK).length * 4 * 10, 40);
      const move = rcl6Body.filter(part => part === MOVE).length;
      assert.equal(Math.ceil((rcl6Body.length - move) / move), 1);
      assert.equal(Math.ceil((5 * (rcl6Body.length - move)) / move), 5);
      assert.isDefined(memory.smallSiegeEntryPath);
      const budget = 336 * 0.7;
      assert.isAtMost(planner.towerDamage(18), budget);
      assert.isAbove(planner.towerDamage(17), budget);
      assert.isAbove(2 * planner.towerDamage(20), budget);
      assert.isAbove(planner.towerDamage(3), 336);
    });

    it("scouts without spawning combat members on missing or stale intel", () => {
      const operation = new SmallSiege();
      operation.update(memory, rcl6Options);
      operation.supply(memory, rcl6Options);
      assert.deepEqual(calls[0].parts, [MOVE]);
      Reflect.get(global, "Game").creeps[memory.scoutName!] = { spawning: false };
      operation.supply(memory, rcl6Options);
      assert.lengthOf(calls, 1);
      cacheIntel();
      Reflect.get(global, "Game").time += 501;
      operation.update(memory, rcl6Options);
      operation.supply(memory, rcl6Options);
      assert.lengthOf(calls, 1);
      assert.include(memory.status, "fresh scout intel");
    });

    it("does not commit energy to an unsustainable two-tower entry", () => {
      cacheIntel();
      memory.snapshot!.structures.push({ ...memory.snapshot!.structures[1], id: "tower2", x: 26 });
      const operation = new SmallSiege();
      operation.update(memory, rcl6Options);
      operation.supply(memory, rcl6Options);
      assert.equal(memory.phase, "BLOCKED");
      assert.include(memory.status, "no sustainable entry");
      assert.lengthOf(calls, 0);
    });

    it("holds the complete quad at sustainable single-tower range while healing", () => {
      const { members } = setupQuad();
      members[0].creep.hits -= 150;
      new SmallSiege().control(memory, rcl6Options);
      assert.equal(memory.phase, "STAGING");
      assert.include(memory.status, "draining tower");
      assert.isUndefined(memory.assaultPlan);
      const focusedHealing = members.reduce(
        (sum, member) => sum + (member.creep.heal.calledWith(members[0].creep) ? 84 : 0),
        0
      );
      assert.isAtLeast(focusedHealing, 150);
      members.forEach(member => assert.isFalse(member.creep.move.called));
    });

    it("sustains repeated focused tower fire without degrading healing or breaking formation", () => {
      const { game, members } = setupQuad();
      const operation = new SmallSiege();
      for (let tick = 0; tick < 100; tick++) {
        operation.control(memory, rcl6Options);
        const healing = members.map(target =>
          members.reduce((sum, healer) => {
            const action = healer.creep.heal.lastCall;
            return sum + (action && action.args[0] === target.creep ? healer.creep.getActiveBodyparts(HEAL) * 12 : 0);
          }, 0)
        );
        members.forEach((member, index) => {
          member.creep.hits = Math.min(1600, member.creep.hits + healing[index] - (index === 0 ? 150 : 0));
          let damage = 1600 - member.creep.hits;
          for (const part of member.creep.body) {
            part.hits = Math.max(0, 100 - damage);
            damage = Math.max(0, damage - 100);
          }
          member.creep.heal.resetHistory();
          assert.isAtLeast(member.creep.hits, 1200);
          assert.equal(member.creep.getActiveBodyparts(HEAL), 7);
          assert.isFalse(member.creep.move.called);
        });
        assert.notEqual(memory.phase, "RETREATING");
        game.time++;
      }
    });

    it("withdraws rather than holding when another tower activates or a member is lost", () => {
      const { members } = setupQuad();
      memory.snapshot!.structures.push({ ...memory.snapshot!.structures[1], id: "tower2", x: 26 });
      const Controller = require("../../src/operations/QuadController").QuadController;
      const move = sinon.stub(Controller.prototype, "moveFile").returns("MOVING");
      try {
        const operation = new SmallSiege();
        operation.control(memory, rcl6Options);
        assert.equal(memory.phase, "RETREATING");
        assert.equal(move.firstCall.args[0].roomName, "W18N6");
        memory.snapshot!.structures.pop();
        memory.phase = "STAGING";
        delete Reflect.get(global, "Game").creeps[members[0].creep.name];
        operation.control(memory, rcl6Options);
        assert.equal(memory.phase, "RETREATING");
        assert.equal(move.callCount, 2);
      } finally {
        move.restore();
      }
    });

    it("never overwrites hostile-creep focus with a breach attack", () => {
      const { members, hostiles, structures } = setupQuad();
      const enemy = {
        id: "enemy",
        hits: 100,
        hitsMax: 100,
        pos: new RoomPosition(3, 3, "W18N7"),
        body: [{ type: HEAL, hits: 100 }]
      } as Creep;
      hostiles.push(enemy);
      structures.push({
        id: "wall",
        structureType: STRUCTURE_RAMPART,
        pos: new RoomPosition(3, 2, "W18N7")
      } as Structure);
      memory.assaultPlan = {
        snapshotTick: 1000,
        objective: "SPAWNS",
        path: [
          { anchor: { x: 1, y: 1 }, exposure: 150, ticks: 0, breach: [] },
          { anchor: { x: 2, y: 1 }, exposure: 150, ticks: 1, breach: [{ x: 3, y: 2, hits: 1000 }] }
        ],
        goalAnchor: { x: 2, y: 1 },
        targetId: "wall",
        targetPos: { x: 3, y: 2 },
        totalTicks: 26,
        totalBreachHits: 1000,
        peakExposure: 150,
        healBudget: 235.2
      };
      new SmallSiege().control(memory, rcl6Options);
      for (const member of members) {
        assert.equal(member.creep.rangedAttack.callCount, 1);
        assert.strictEqual(member.creep.rangedAttack.firstCall.args[0], enemy);
      }
    });

    it("abandons a refilled-tower route without scattering back to an old drain anchor", () => {
      const { members } = setupQuad();
      memory.drainAnchor = { x: 10, y: 1 };
      memory.assaultPlan = {
        snapshotTick: 999,
        objective: "SPAWNS",
        path: Array.from({ length: 23 }, (_, index) => ({
          anchor: { x: index + 1, y: index + 1 },
          exposure: 0,
          ticks: 1,
          breach: []
        })),
        goalAnchor: { x: 23, y: 23 },
        targetId: "spawn",
        targetPos: { x: 26, y: 25 },
        totalTicks: 23,
        totalBreachHits: 0,
        peakExposure: 0,
        healBudget: 235.2
      };
      new SmallSiege().control(memory, rcl6Options);
      assert.isUndefined(memory.assaultPlan);
      assert.equal(memory.phase, "STAGING");
      assert.deepEqual(memory.drainAnchor, { x: 1, y: 1 });
      members.forEach(member => {
        assert.isFalse(member.creep.move.called);
        assert.isFalse(member.creep.travelTo.called);
      });
    });

    it("honors the configured combat-wipe limit instead of spawning indefinitely", () => {
      cacheIntel();
      const policy = require("../../src/operations/SiegeTypes").SIEGE_POLICY;
      memory.attempt = policy.maxQuadAttempts - 1;
      memory.members.A1 = { name: "dead", spawnRoom: "W17N4", spawnedAt: 1 };
      memory.lastMinTtl = 800;
      const operation = new SmallSiege();
      operation.update(memory, rcl6Options);
      operation.supply(memory, rcl6Options);
      assert.equal(memory.phase, "ABORTED");
      assert.lengthOf(calls, 0);
    });

    it("keeps healing after the spawns are cleared without purchasing another wave", () => {
      const { game, members } = setupQuad();
      game.rooms.W18N7.controller = {
        owner: { username: "enemy" }, level: 6, pos: { x: 25, y: 25 }
      };
      const operation = new SmallSiege();
      operation.update(memory, rcl6Options);
      assert.isTrue(memory.spawnsCleared);
      assert.notEqual(memory.phase, "COMPLETE");
      operation.control(memory, rcl6Options);
      members.forEach(member => assert.isTrue(member.creep.heal.called));
      delete game.creeps[members[0].creep.name];
      operation.supply(memory, rcl6Options);
      assert.lengthOf(calls, 0);
      game.creeps = {};
      operation.update(memory, rcl6Options);
      assert.equal(memory.phase, "COMPLETE");
    });

    it("moves all four in lock step and holds everyone for fatigue, immobility, or a new blocker", () => {
      const { members, obstacles } = setupQuad();
      const Controller = require("../../src/operations/QuadController").QuadController;
      const quad = new Controller(members);
      const from = { x: 1, y: 1 };
      const to = { x: 2, y: 1 };
      members[2].creep.fatigue = 1;
      assert.equal(quad.stepTo(from, to), "FATIGUED");
      members.forEach(member => assert.isFalse(member.creep.move.called));
      members[2].creep.fatigue = 0;
      obstacles.push({ structureType: STRUCTURE_SPAWN, pos: new RoomPosition(3, 1, "W18N7") } as Structure);
      assert.equal(quad.stepTo(from, to), "BLOCKED");
      obstacles.pop();
      members[0].creep.body.filter(part => part.type === MOVE).forEach(part => (part.hits = 0));
      assert.equal(quad.stepTo(from, to), "BLOCKED");
      members[0].creep.body.forEach(part => (part.hits = 100));
      assert.equal(quad.stepTo(from, { x: 3, y: 1 }), "BLOCKED");
      members.forEach(member => assert.isFalse(member.creep.move.called));
      assert.equal(quad.stepTo(from, to), "MOVED");
      members.forEach(member => assert.isTrue(member.creep.move.calledOnceWithExactly(RIGHT)));
    });

    it("follows the recorded border path and forms a complete block without free-pathing across the room", () => {
      const { game, members } = setupQuad();
      const neighbor = {
        name: "W18N8",
        find: () => [],
        lookForAt: () => [],
        getTerrain: () => ({ get: () => 0 })
      };
      game.rooms.W18N8 = neighbor;
      memory.phase = "TRANSIT";
      memory.smallSiegeEntry = { roomName: "W18N8", pos: { x: 1, y: 48 } };
      memory.smallSiegeEntryReady = true;
      memory.smallSiegeEntryPath = [
        { x: 1, y: 0 },
        { x: 1, y: 1 }
      ];
      members.forEach((member, index) => {
        member.creep.pos = new RoomPosition(1, 48 - index, "W18N8");
        member.creep.room = neighbor;
        member.creep.travelTo.callsFake((target: RoomPosition) => {
          // Model only catch-up to the preceding member at this north-side border.
          assert.equal(target.roomName === "W18N7" || target.roomName === "W18N8", true);
          member.creep.move(BOTTOM);
          return OK;
        });
      });
      const operation = new SmallSiege();
      const offsets: Record<number, [number, number]> = {
        1: [0, -1],
        2: [1, -1],
        3: [1, 0],
        4: [1, 1],
        5: [0, 1],
        6: [-1, 1],
        7: [-1, 0],
        8: [-1, -1]
      };
      const Controller = require("../../src/operations/QuadController").QuadController;
      for (let tick = 0; tick < 20 && !new Controller(members).isFormedAt({ x: 1, y: 1 }); tick++) {
        operation.control(memory, rcl6Options);
        for (const { creep } of members) {
          if (!creep.move.called) continue;
          const [dx, dy] = offsets[creep.move.lastCall.args[0]];
          let x = creep.pos.x + dx;
          let y = creep.pos.y + dy;
          let roomName = creep.pos.roomName;
          if (roomName === "W18N8" && y === 49) {
            y = 0;
            roomName = "W18N7";
          }
          creep.pos = new RoomPosition(x, y, roomName);
          creep.room = game.rooms[roomName];
          creep.move.resetHistory();
        }
        game.time++;
      }
      assert.isTrue(new Controller(members).isFormedAt({ x: 1, y: 1 }));
      assert.isTrue(members.every(member => member.creep.pos.roomName === "W18N7"));
      assert.notEqual(memory.phase, "RETREATING");
    });

    describe("opt-in two-tower probing", () => {
      const probeOptions: SiegeOptions = { ...rcl6Options, strategy: "probe" };

      function setupProbe() {
        const fixture = setupQuad();
        const probeBody: BodyPartConstant[] = require("../../src/operations/SmallSiege").RCL6_PROBE_BODY;
        const events: EventItem[] = [];
        Object.assign(fixture.room, { getEventLog: () => events });
        fixture.game.rooms.W18N8 = {
          name: "W18N8", find: () => [], lookForAt: () => [], getTerrain: () => ({ get: () => 0 })
        };
        fixture.members.forEach(({ creep }) => {
          creep.body = probeBody.map(type => ({ type, hits: 100 }));
        });
        memory.probe = {
          side: "top", outsideRoom: "W18N8", outside: { x: 1, y: 47 }, inside: { x: 1, y: 1 },
          returning: false, lastHits: {}, trail: [{ x: 1, y: 1 }]
        };
        memory.snapshot!.structures.push({ ...memory.snapshot!.structures[1], id: "tower2", x: 26 });
        return { ...fixture, events, probeBody };
      }

      function setupFleet() {
        const fixture = setupProbe();
        delete fixture.game.rooms.W18N7;
        fixture.game.map.describeExits = () => ({ "1": "W18N8", "3": "W17N7", "5": "W18N6", "7": "W19N7" });
        const Fleet = require("../../src/operations/ProbeSiege").ProbeSiege as typeof import("../../src/operations/ProbeSiege").ProbeSiege;
        return { ...fixture, fleet: new Fleet() };
      }

      it("never replaces a deployed wave and queues a separate wave only after its second loss", () => {
        const { members, game, fleet } = setupFleet();
        members.forEach(({ creep }, index) => { creep.pos = new RoomPosition(20 + index % 2, 20 + Math.floor(index / 2), "W17N4"); });
        fleet.update(memory, probeOptions);
        assert.isTrue(memory.probeLaunched);
        delete game.creeps[members[0].creep.name];
        fleet.update(memory, probeOptions);
        fleet.supply(memory, probeOptions);
        assert.lengthOf(calls, 0);
        assert.lengthOf(memory.probeWaves!, 0);
        const oldMembers = memory.members;
        const oldEntry = memory.probe!;
        delete game.creeps[members[1].creep.name];
        fleet.update(memory, probeOptions);
        assert.equal(memory.wave, 2);
        assert.strictEqual(memory.probeWaves![0].members, oldMembers);
        assert.isFalse(memory.probeLaunched);
        assert.deepEqual(memory.members, {});
        assert.notEqual(memory.probe!.outside.x, oldEntry.outside.x);
        assert.notEqual(memory.probe!.outside.x, oldEntry.outside.x + 1);
        fleet.supply(memory, probeOptions);
        assert.lengthOf(calls, 1);
        assert.equal(calls[0].parts.length, 16);
        assert.isTrue(Object.values(oldMembers).every(member => !calls.some(call => call.name === member!.name)));
      });

      it("launches a full new wave without waiting for older survivors and can overlap another generation", () => {
        const { members, game, fleet } = setupFleet();
        members.forEach(({ creep }, index) => { creep.pos = new RoomPosition(20 + index % 2, 20 + Math.floor(index / 2), "W17N4"); });
        fleet.update(memory, probeOptions);
        delete game.creeps[members[0].creep.name];
        delete game.creeps[members[1].creep.name];
        fleet.update(memory, probeOptions);
        const newcomers: string[] = [];
        for (let index = 0; index < 4; index++) {
          game.time++;
          fleet.supply(memory, probeOptions);
          const name = calls[calls.length - 1].name;
          newcomers.push(name);
          game.creeps[name] = {
            ...members[0].creep, name, id: name, spawning: false,
            pos: new RoomPosition(20 + index % 2, 20 + Math.floor(index / 2), "W17N4")
          };
          fleet.update(memory, probeOptions);
        }
        assert.isTrue(memory.probeLaunched);
        assert.equal(memory.wave, 2);
        assert.lengthOf(memory.probeWaves!, 1);
        fleet.control(memory, probeOptions);
        assert.equal(memory.phase, "TRANSIT");
        delete game.creeps[newcomers[0]];
        delete game.creeps[newcomers[1]];
        fleet.update(memory, probeOptions);
        assert.equal(memory.wave, 3);
        assert.deepEqual(memory.probeWaves!.map(wave => wave.wave), [1, 2]);
        delete game.creeps[members[2].creep.name];
        delete game.creeps[members[3].creep.name];
        fleet.update(memory, probeOptions);
        assert.deepEqual(memory.probeWaves!.map(wave => wave.wave), [2]);
      });

      it("continues safe home assembly of the next wave while a replacement scout refreshes stale intel", () => {
        const { members, game, fleet } = setupFleet();
        fleet.update(memory, probeOptions);
        delete game.creeps[members[0].creep.name];
        delete game.creeps[members[1].creep.name];
        game.time += 501;
        fleet.update(memory, probeOptions);
        fleet.supply(memory, probeOptions);
        assert.deepEqual(calls[0].parts, [MOVE]);
        game.creeps[memory.scoutName!] = { spawning: true };
        fleet.supply(memory, probeOptions);
        assert.equal(calls[1].parts.length, 16);
        assert.isFalse(memory.probeLaunched);
      });

      it("replays the logged split squad: rejects hostile staging and moves the trailing survivor despite stale intel", () => {
        const { members, game, fleet } = setupFleet();
        memory.phase = "TRANSIT";
        memory.probe = {
          side: "left", inside: { x: 1, y: 20 }, outside: { x: 47, y: 20 },
          outsideRoom: "W19N7", trail: [], returning: false, lastHits: {}
        };
        game.time += 551;
        Reflect.set(global, "Memory", { rooms: { W19N7: { owner: "enemy" } } });
        members[0].creep.pos = new RoomPosition(43, 20, "W20N6");
        members[1].creep.pos = new RoomPosition(43, 21, "W20N6");
        members[2].creep.pos = new RoomPosition(33, 25, "W18N4");
        delete game.creeps[members[3].creep.name];
        fleet.update(memory, probeOptions);
        fleet.control(memory, probeOptions);
        assert.isUndefined(memory.probe);
        assert.isTrue(memory.probeLaunched);
        assert.include(memory.status, "regrouping");
        assert.isTrue(members[2].creep.travelTo.calledOnce);
        assert.equal(members[2].creep.travelTo.firstCall.args[0].roomName, "W20N6");
        assert.isFalse(members[0].creep.move.called);
        assert.isFalse(members[1].creep.move.called);
      });

      it("rejects cached hostile staging rooms even when they are not visible", () => {
        cacheIntel();
        Reflect.set(global, "Memory", { rooms: { W18N6: { owner: "enemy" }, W17N7: { owner: "enemy" } } });
        new SmallSiege().update(memory, probeOptions);
        assert.equal(memory.phase, "BLOCKED");
        assert.isUndefined(memory.probe);
      });

      it("lets a cohesive surviving pair re-enter against one tower, but rejects its two-tower escape", () => {
        const { members } = setupProbe();
        const Controller = require("../../src/operations/QuadController").QuadController;
        const Probe = require("../../src/operations/QuadProbe").QuadProbe;
        const survivors = members.slice(0, 2);
        survivors.forEach(({ creep }, index) => { creep.pos = new RoomPosition(1 + index, 47, "W18N8"); });
        memory.probe!.trail = [];
        new Probe().control(memory, new Controller(survivors, true), true);
        assert.isFalse(memory.probe!.estimate!.safe);
        survivors.forEach(({ creep }) => assert.isFalse(creep.move.called));
        memory.snapshot!.structures = memory.snapshot!.structures.filter(structure => structure.id !== "tower2");
        new Probe().control(memory, new Controller(survivors, true), true);
        assert.isTrue(memory.probe!.estimate!.safe);
        survivors.forEach(({ creep }) => assert.isTrue(creep.move.calledOnceWithExactly(BOTTOM)));
      });

      it("does not strand older waves when the newest wave finishes cleanup", () => {
        const { members, game, fleet } = setupFleet();
        fleet.update(memory, probeOptions);
        delete game.creeps[members[0].creep.name];
        delete game.creeps[members[1].creep.name];
        fleet.update(memory, probeOptions);
        memory.spawnsCleared = true;
        fleet.update(memory, probeOptions);
        assert.equal(memory.phase, "CLEANUP");
        assert.lengthOf(memory.probeWaves!, 1);
        delete game.creeps[members[2].creep.name];
        delete game.creeps[members[3].creep.name];
        fleet.update(memory, probeOptions);
        assert.equal(memory.phase, "COMPLETE");
      });

      it("spawns a probe at a two-tower entrance without changing the normal RCL6 entry limit", () => {
        cacheIntel();
        memory.snapshot!.structures.push({ ...memory.snapshot!.structures[1], id: "tower2", x: 26 });
        const operation = new SmallSiege();
        operation.update(memory, probeOptions);
        operation.supply(memory, probeOptions);
        assert.isDefined(memory.probe);
        assert.equal(memory.phase, "PREPARING");
        assert.lengthOf(calls, 1);
        assert.equal(calls[0].parts[0], RANGED_ATTACK);
        assert.deepEqual(calls[0].parts.slice(-8), new Array(8).fill(MOVE));
      });

      it("can bait structures in a freshly scouted room without a spawn", () => {
        cacheIntel();
        memory.snapshot!.structures = memory.snapshot!.structures.filter(structure => structure.type !== "spawn");
        const operation = new SmallSiege();
        operation.update(memory, probeOptions);
        operation.supply(memory, probeOptions);
        assert.lengthOf(calls, 1);
        assert.equal(calls[0].parts.length, 16);
      });

      it("does not spawn a replacement before the surviving members withdraw", () => {
        const { members, game } = setupProbe();
        delete game.creeps[members[0].creep.name];
        new SmallSiege().supply(memory, probeOptions);
        assert.lengthOf(calls, 0);
      });

      it("withdraws on attack events even at full health and does not issue a competing travel order", () => {
        const { members, events } = setupProbe();
        events.push({
          event: EVENT_ATTACK, objectId: "tower",
          data: { targetId: members[0].creep.id, damage: 150, attackType: 1 }
        });
        new SmallSiege().control(memory, probeOptions);
        assert.isTrue(memory.probe!.returning);
        assert.equal(memory.retreatReason, "incoming attack observed");
        members.forEach(({ creep }) => {
          assert.isTrue(creep.move.calledOnceWithExactly(TOP));
          assert.isFalse(creep.travelTo.called);
        });
      });

      it("does not react to a scout's attack event and preserves armed-creep attack priority", () => {
        const { members, events, hostiles, structures, game } = setupProbe();
        events.push({ event: EVENT_ATTACK, objectId: "tower", data: { targetId: "scout", damage: 150, attackType: 1 } });
        const enemy = {
          id: "enemy", hits: 100, hitsMax: 100, pos: new RoomPosition(3, 3, "W18N7"),
          body: [{ type: HEAL, hits: 100 }]
        } as Creep;
        hostiles.push(enemy);
        structures.push({ id: "extension", hits: 100, structureType: "extension", pos: new RoomPosition(3, 2, "W18N7") } as Structure);
        game.getObjectById = () => structures[0];
        memory.probe!.targetId = "extension";
        new SmallSiege().control(memory, probeOptions);
        assert.isFalse(memory.probe!.returning);
        members.forEach(({ creep }) => assert.isTrue(creep.rangedAttack.calledOnceWithExactly(enemy)));
      });

      it("records only observed movement and retreats if the observed return route becomes blocked", () => {
        const { members } = setupProbe();
        memory.snapshot!.structures.push({ id: "bait", x: 2, y: 5, type: "extension", hits: 100, hostile: true });
        const operation = new SmallSiege();
        operation.control(memory, probeOptions);
        assert.lengthOf(memory.probe!.trail, 1);
        assert.isTrue(members.every(({ creep }) => creep.move.called));
        operation.control(memory, probeOptions);
        assert.lengthOf(memory.probe!.trail, 1);
        members.forEach(({ creep }) => { creep.pos.y++; });
        operation.control(memory, probeOptions);
        assert.deepEqual(memory.probe!.trail, [{ x: 1, y: 1 }, { x: 1, y: 2 }]);
        memory.snapshot!.obstacles = [{ x: 1, y: 1 }];
        operation.control(memory, probeOptions);
        assert.isTrue(memory.probe!.returning);
        assert.equal(memory.retreatReason, "recorded escape route blocked");
      });

      it("runs entry, event-triggered border withdrawal and healing through the real probe controller", () => {
        const { members, game, events } = setupProbe();
        memory.probe!.trail = [];
        members.forEach(({ creep }, index) => {
          creep.pos = new RoomPosition(1 + index % 2, 47 + Math.floor(index / 2), "W18N8");
          creep.room = game.rooms.W18N8;
        });
        const operation = new SmallSiege();
        const tick = (): void => {
          operation.control(memory, probeOptions);
          members.forEach(({ creep }) => {
            assert.isFalse(creep.travelTo.called);
            const direction = creep.move.lastCall?.args[0];
            assert.isTrue(direction === undefined || direction === TOP || direction === BOTTOM);
            let y = creep.pos.y + (direction === TOP ? -1 : direction === BOTTOM ? 1 : 0);
            let roomName = creep.pos.roomName;
            if (roomName === "W18N8" && y === 49) { roomName = "W18N7"; y = 0; }
            else if (roomName === "W18N7" && y === 0) { roomName = "W18N8"; y = 49; }
            creep.pos = new RoomPosition(creep.pos.x, y, roomName);
            creep.room = game.rooms[roomName];
            creep.move.resetHistory();
          });
          events.length = 0;
          game.time++;
        };
        tick();
        events.push({ event: EVENT_ATTACK, objectId: "tower", data: { targetId: members[0].creep.id, damage: 150, attackType: 1 } });
        tick();
        assert.isTrue(memory.probe!.returning);
        tick();
        assert.isTrue(members.every(({ creep }) => creep.pos.roomName === "W18N8" && creep.pos.y < 49));
        members[0].creep.hits = 1599;
        tick();
        assert.isTrue(memory.probe!.returning);
        members[0].creep.hits = 1600;
        tick();
        assert.isFalse(memory.probe!.returning);
      });

      it("waits for all four to heal fully outside before resetting, and stays paused for safe mode", () => {
        const { members } = setupProbe();
        members.forEach(({ creep }, index) => {
          creep.pos = new RoomPosition(1 + index % 2, 47 + Math.floor(index / 2), "W18N8");
        });
        memory.probe!.returning = true;
        members[3].creep.hits = 1599;
        const operation = new SmallSiege();
        operation.control(memory, probeOptions);
        assert.isTrue(memory.probe!.returning);
        members[3].creep.hits = 1600;
        memory.snapshot!.safeModeEndsAt = Game.time + 100;
        operation.control(memory, probeOptions);
        assert.isTrue(memory.probe!.returning);
        assert.equal(memory.phase, "PAUSED");
        memory.snapshot!.safeModeEndsAt = 0;
        operation.control(memory, probeOptions);
        assert.isFalse(memory.probe!.returning);
        assert.deepEqual(memory.probe!.trail, []);
        members.forEach(({ creep }) => assert.isFalse(creep.move.called));
      });

      it("withdraws survivors together and waits outside for replacement members", () => {
        const { members, game } = setupProbe();
        delete game.creeps[members[0].creep.name];
        const operation = new SmallSiege();
        operation.control(memory, probeOptions);
        assert.isTrue(memory.probe!.returning);
        members.slice(1).forEach(({ creep }) => assert.isTrue(creep.move.calledOnceWithExactly(TOP)));
        members.slice(1).forEach(({ creep }, index) => {
          creep.pos = new RoomPosition(1 + index % 2, 47 + Math.floor(index / 2), "W18N8");
        });
        operation.control(memory, probeOptions);
        assert.equal(memory.phase, "PREPARING");
        assert.include(memory.status, "replacement");
      });

      it("tracks a depleted quad across multiple retreat steps, including loss before the first trail observation", () => {
        const { members, game } = setupProbe();
        delete game.creeps[members[0].creep.name];
        const operation = new SmallSiege();
        memory.probe!.trail = [];
        operation.control(memory, probeOptions);
        assert.isTrue(members.slice(1).every(({ creep }) => creep.move.calledOnceWithExactly(TOP)));
        memory.probe!.trail = [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }];
        members.slice(1).forEach(({ creep }) => { creep.pos.y += 2; });
        for (let tick = 0; tick < 3; tick++) {
          members.forEach(({ creep }) => creep.move.resetHistory());
          operation.control(memory, probeOptions);
          assert.lengthOf(memory.probe!.trail, 3 - tick);
          members.slice(1).forEach(({ creep }) => {
            assert.isTrue(creep.move.calledOnceWithExactly(TOP));
            creep.pos.y--;
          });
        }
      });

      it("holds the complete block when a retreat step is fatigued or occupied", () => {
        const { members, obstacles } = setupProbe();
        members.forEach(({ creep }) => { creep.pos.y += 1; });
        memory.probe!.trail.push({ x: 1, y: 2 });
        memory.probe!.returning = true;
        members[0].creep.fatigue = 1;
        new SmallSiege().control(memory, probeOptions);
        members.forEach(({ creep }) => assert.isFalse(creep.move.called));
        members[0].creep.fatigue = 0;
        obstacles.push({ structureType: STRUCTURE_SPAWN, pos: new RoomPosition(1, 1, "W18N7") } as Structure);
        new SmallSiege().control(memory, probeOptions);
        members.forEach(({ creep }) => {
          assert.isFalse(creep.move.called);
          assert.isFalse(creep.travelTo.called);
        });
      });

      it("never scatters a stalled tight file or moves anyone while a follower is fatigued", () => {
        const { members, game } = setupProbe();
        const Controller = require("../../src/operations/QuadController").QuadController;
        members.forEach(({ creep }, index) => { creep.pos = new RoomPosition(10, 10 + index, "W18N8"); });
        const quad = new Controller(members, true, "W18N7");
        for (let tick = 0; tick < 70; tick++) {
          quad.moveFile(new RoomPosition(20, 20, "W18N8"), 0);
          game.time++;
        }
        members.slice(1).forEach(({ creep }) => assert.isFalse(creep.travelTo.called));
        assert.equal(members[0].creep.travelTo.lastCall.args[1].routeCallback("W18N7"), Infinity);
        members.forEach(({ creep }) => { creep.move.resetHistory(); creep.travelTo.resetHistory(); });
        members[3].creep.fatigue = 1;
        quad.moveFile(members[0].creep.pos, 0);
        members.forEach(({ creep }) => {
          assert.isFalse(creep.move.called);
          assert.isFalse(creep.travelTo.called);
        });
        members[3].creep.fatigue = 0;
        members[3].creep.pos.y++;
        quad.moveFile(new RoomPosition(20, 20, "W18N8"), 0);
        assert.isFalse(members[0].creep.travelTo.called);
      });

      for (const side of ["top", "right", "bottom", "left"] as const) {
        for (const memberCount of [2, 3, 4]) {
        for (const entrySteps of [1, 2, 3]) {
          it(`${side} border: ${memberCount} members withdraw together after ${entrySteps} entry steps`, () => {
            const { members: fullMembers, game } = setupProbe();
            const members = fullMembers.slice(0, memberCount);
            const Controller = require("../../src/operations/QuadController").QuadController;
            const vertical = side === "top" || side === "bottom";
            const positive = side === "top" || side === "left";
            const outsideRoom = { top: "W18N8", right: "W17N7", bottom: "W18N6", left: "W19N7" }[side];
            const outside = vertical ? { x: 10, y: positive ? 47 : 1 } : { x: positive ? 47 : 1, y: 10 };
            const inside = vertical ? { x: 10, y: positive ? 1 : 47 } : { x: positive ? 1 : 47, y: 10 };
            members.forEach(({ creep }, index) => {
              creep.pos = new RoomPosition(outside.x + index % 2, outside.y + Math.floor(index / 2), outsideRoom);
            });
            const offsets: Record<number, [number, number]> = {
              1: [0, -1], 2: [1, -1], 3: [1, 0], 4: [1, 1],
              5: [0, 1], 6: [-1, 1], 7: [-1, 0], 8: [-1, -1]
            };
            const step = (entering: boolean): void => {
              assert.equal(new Controller(members).crossBorder("W18N7", outsideRoom, side, entering, () => false, memberCount < 4), "MOVED");
              members.forEach(({ creep }) => {
                const direction = creep.move.lastCall?.args[0];
                const [dx, dy] = direction ? offsets[direction] : [0, 0];
                let x = creep.pos.x + dx;
                let y = creep.pos.y + dy;
                let roomName = creep.pos.roomName;
                const portal = roomName === "W18N7" ? positive ? 0 : 49 : positive ? 49 : 0;
                if ((vertical ? y : x) === portal) {
                  if (vertical) y = 49 - y;
                  else x = 49 - x;
                  roomName = roomName === "W18N7" ? outsideRoom : "W18N7";
                }
                creep.pos = new RoomPosition(x, y, roomName);
                creep.move.resetHistory();
              });
              assert.equal(new Set(members.map(({ creep }) => `${creep.pos.roomName}:${creep.pos.x}:${creep.pos.y}`)).size, memberCount);
              const projected = members.map(({ creep }) => {
                const coordinate = vertical ? creep.pos.y : creep.pos.x;
                return creep.pos.roomName === "W18N7" ? positive ? coordinate : 49 - coordinate : positive ? coordinate - 49 : -coordinate;
              });
              assert.isAtMost(Math.max(...projected) - Math.min(...projected), 1);
              game.time++;
            };
            for (let tick = 0; tick < entrySteps; tick++) step(true);
            if (entrySteps === 3) assert.isTrue(new Controller(members).isFormedAt(inside, memberCount < 4));
            for (let tick = 0; tick < 3 && !members.every(({ creep }) =>
              creep.pos.roomName === outsideRoom && creep.pos.x > 0 && creep.pos.x < 49 && creep.pos.y > 0 && creep.pos.y < 49); tick++) step(false);
            assert.isTrue(new Controller(members).isFormedAt(outside, memberCount < 4));
            assert.isTrue(members.every(({ creep }) => creep.pos.roomName === outsideRoom));
          });
        }
        }
      }
    });
  });
});
