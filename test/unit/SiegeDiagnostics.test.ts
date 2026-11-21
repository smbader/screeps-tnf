import { assert } from "chai";
import * as sinon from "sinon";
import {
  beginSiegeDiagnostics,
  finishSiegeDiagnostics,
  moveSiegeCreep,
  observeSiegeDiagnostics,
  recordCreepAction,
  recordSiegeEvent,
  siegeLogCommands,
  travelSiegeCreep
} from "../../src/operations/SiegeDiagnostics";
import { SIEGE_POLICY } from "../../src/operations/SiegeTypes";
import type { SiegeMemory, SiegeOptions, SiegePlan } from "../../src/operations/SiegeTypes";

interface ExportedLog {
  format: string;
  records: { sequence: number; tick: number; siegeId: string; kind: string; data: Record<string, unknown> }[];
  terrain: Record<string, string[]>;
  current: SiegeMemory[];
  retention: { droppedRecords: number };
}

describe("persistent siege diagnostics", () => {
  const constants = {
    TOP: 1,
    TOP_RIGHT: 2,
    RIGHT: 3,
    BOTTOM_RIGHT: 4,
    BOTTOM: 5,
    BOTTOM_LEFT: 6,
    LEFT: 7,
    TOP_LEFT: 8,
    MOVE: "move",
    HEAL: "heal",
    ATTACK: "attack",
    RANGED_ATTACK: "ranged_attack",
    STRUCTURE_ROAD: "road",
    STRUCTURE_CONTAINER: "container",
    STRUCTURE_RAMPART: "rampart",
    STRUCTURE_TOWER: "tower",
    STRUCTURE_CONTROLLER: "controller",
    STRUCTURE_SPAWN: "spawn",
    FIND_STRUCTURES: 1,
    FIND_HOSTILE_CREEPS: 2,
    RESOURCE_ENERGY: "energy",
    EVENT_ATTACK: 1,
    EVENT_HEAL: 6,
    EVENT_OBJECT_DESTROYED: 2,
    OK: 0
  };
  const originals: Record<string, unknown> = {};
  const policy = { ...SIEGE_POLICY, diagnostics: { ...SIEGE_POLICY.diagnostics } };
  const options: SiegeOptions = { id: "log-test", mode: "rcl6", homeRoom: "W17N4", targetRoom: "W19N7" };
  let memory: SiegeMemory;
  let events: EventItem[];
  let roomStructures: object[];
  let creep: Creep;
  let move: sinon.SinonStub;
  let travel: sinon.SinonStub;

  before(() => {
    for (const key of [...Object.keys(constants), "Memory", "Game", "siegeDump"])
      originals[key] = Reflect.get(global, key);
    Object.assign(global, constants);
  });

  beforeEach(() => {
    SIEGE_POLICY.diagnostics = { ...policy.diagnostics };
    SIEGE_POLICY.targets = [options];
    SIEGE_POLICY.enabled = true;
    SIEGE_POLICY.debug = false;
    events = [];
    move = sinon.stub().returns(-11);
    travel = sinon.stub().returns(0);
    memory = {
      id: options.id,
      targetRoom: options.targetRoom,
      phase: "PLANNING",
      phaseSince: 100,
      attempt: 0,
      members: {}
    };
    const tower = {
      id: "tower",
      structureType: "tower",
      pos: { x: 25, y: 25 },
      hits: 3000,
      hitsMax: 3000,
      owner: { username: "enemy" },
      store: { getUsedCapacity: () => 730 },
      effects: []
    };
    roomStructures = [tower, { id: "road", structureType: "road", pos: { x: 2, y: 2 }, hits: 500, hitsMax: 500 }];
    const room = {
      name: options.targetRoom,
      controller: { pos: { x: 20, y: 20 }, owner: { username: "enemy" }, level: 6 },
      find: (kind: number) => (kind === FIND_STRUCTURES ? roomStructures : []),
      getEventLog: () => events
    };
    const position: Partial<RoomPosition> = { x: 1, y: 1, roomName: options.targetRoom, getRangeTo: () => 1 };
    const member: Partial<Creep> = {
      id: "member-id" as Id<Creep>,
      name: "member",
      memory: { role: "siegeQuad", siegeId: options.id },
      hits: 1600,
      hitsMax: 1600,
      fatigue: 0,
      ticksToLive: 1400,
      spawning: false,
      pos: position as RoomPosition,
      body: [
        { type: "move", hits: 100 },
        { type: "heal", hits: 100 }
      ],
      room: room as Room,
      move,
      travelTo: travel,
      heal: sinon.stub().returns(0),
      getActiveBodyparts: (part: string) => (part === HEAL || part === MOVE ? 1 : 0)
    };
    creep = member as Creep;
    Reflect.set(global, "Memory", { sieges: { version: 1, sieges: { [options.id]: memory } } });
    Reflect.set(global, "Game", {
      time: 100,
      shard: { name: "shard-test" },
      creeps: { member: creep },
      rooms: { [options.targetRoom]: room },
      map: { getRoomTerrain: () => ({ get: (x: number, y: number) => (x === y ? 1 : 0) }) }
    });
    siegeLogCommands.clear();
  });

  afterEach(() => {
    sinon.restore();
    siegeLogCommands.clear();
    Object.assign(SIEGE_POLICY, policy, { diagnostics: { ...policy.diagnostics } });
  });

  after(() => {
    for (const key of Object.keys(originals)) {
      if (originals[key] === undefined) Reflect.deleteProperty(global, key);
      else Reflect.set(global, key, originals[key]);
    }
  });

  it("exports probe paths, retreat state and predictions without logging last-hit bookkeeping as a new plan", () => {
    memory.probe = {
      side: "top", outsideRoom: "W19N8", outside: { x: 1, y: 47 }, inside: { x: 1, y: 1 },
      trail: [{ x: 1, y: 1 }], returning: false, lastHits: { member: 1600 },
      estimate: { safe: true, ticks: 3, remainingHits: 960, reason: "safe escape" }
    };
    beginSiegeDiagnostics(memory, options);
    observeSiegeDiagnostics(memory, "update");
    memory.probe.lastHits.member = 1500;
    observeSiegeDiagnostics(memory, "update");
    let exported = JSON.parse(siegeLogCommands.export(options.id)) as ExportedLog;
    assert.lengthOf(exported.records.filter(record => record.kind === "plan"), 1);
    memory.probe.returning = true;
    observeSiegeDiagnostics(memory, "actions");
    exported = JSON.parse(siegeLogCommands.export(options.id)) as ExportedLog;
    const plans = exported.records.filter(record => record.kind === "plan");
    assert.lengthOf(plans, 2);
    assert.deepInclude(plans[1].data.probe, { returning: true, trail: [{ x: 1, y: 1 }], estimate: memory.probe.estimate });
    assert.notProperty(plans[1].data.probe, "lastHits");
  });

  it("keeps older-wave survivors in diagnostics after the active member map switches to a new wave", () => {
    memory.wave = 2;
    memory.probeWaves = [{
      wave: 1, phase: "STAGING", phaseSince: Game.time,
      members: { A1: { name: creep.name, spawnRoom: "W17N4", spawnedAt: 1 } }
    }];
    beginSiegeDiagnostics(memory, options);
    finishSiegeDiagnostics(memory);
    const exported = JSON.parse(siegeLogCommands.export(options.id)) as ExportedLog;
    const frame = exported.records.find(record => record.kind === "tick")!;
    assert.deepInclude((frame.data.members as { name: string; wave: number }[])[0], { name: creep.name, wave: 1 });
    assert.isTrue(exported.records.some(record => record.kind === "member"));
    assert.deepEqual(exported.current[0].probeWaves![0].members, memory.probeWaves[0].members);
  });

  it("samples unchanged pre-healing without dropping attacks hidden by healing", () => {
    memory.members.A1 = { name: creep.name, spawnRoom: "W17N4", spawnedAt: 1 };
    for (let tick = 100; tick <= 106; tick++) {
      Game.time = tick;
      events = [{ event: EVENT_HEAL, objectId: creep.id, data: { targetId: creep.id, amount: 84, healType: 1 } }];
      if (tick === 103) events.push({
        event: EVENT_ATTACK, objectId: "tower", data: { targetId: creep.id, damage: 150, attackType: 1 }
      });
      beginSiegeDiagnostics(memory, options);
      finishSiegeDiagnostics(memory);
    }
    const exported = JSON.parse(siegeLogCommands.export(options.id)) as ExportedLog;
    assert.deepEqual(exported.records.filter(record => record.kind === "tick").map(record => record.tick), [100, 103, 105]);
  });

  function exported(id = options.id): ExportedLog {
    return JSON.parse(siegeLogCommands.export(id)) as ExportedLog;
  }

  function plan(): SiegePlan {
    return {
      snapshotTick: 100,
      objective: "SPAWNS",
      entrySide: "top",
      path: [{ anchor: { x: 1, y: 1 }, exposure: 150, ticks: 1, breach: [] }],
      goalAnchor: { x: 1, y: 1 },
      targetId: "spawn",
      targetPos: { x: 3, y: 3 },
      totalTicks: 1,
      totalBreachHits: 0,
      peakExposure: 150,
      healBudget: 235.2
    };
  }

  it("automatically records orchestrated phases, routes, layouts, action codes and resolved damage", () => {
    const { SiegeOperation } =
      require("../../src/operations/SiegeOperation") as typeof import("../../src/operations/SiegeOperation");
    const { SmallSiege } =
      require("../../src/operations/SmallSiege") as typeof import("../../src/operations/SmallSiege");
    const { healMembers } =
      require("../../src/operations/SiegeCombat") as typeof import("../../src/operations/SiegeCombat");
    sinon.stub(SmallSiege.prototype, "update").callsFake(state => {
      state.phase = "PREPARING";
      state.assaultPlan = plan();
    });
    sinon.stub(SmallSiege.prototype, "supply").callsFake(state => {
      state.members.A1 = { name: creep.name, spawnRoom: options.homeRoom!, spawnedAt: Game.time };
      recordSiegeEvent(state.id, "spawn", { name: creep.name, result: OK });
    });
    sinon.stub(SmallSiege.prototype, "control").callsFake(state => {
      state.phase = "ADVANCING";
      healMembers([{ slot: "A1", creep }]);
      assert.equal(moveSiegeCreep(creep, RIGHT), -11);
    });
    events.push({ event: EVENT_ATTACK, objectId: "tower", data: { targetId: creep.id, damage: 150, attackType: 1 } });
    const operation = new SiegeOperation();
    operation.init();
    operation.roleCall();
    operation.actions();
    const output = exported();
    assert.equal(output.format, "screeps-siege-log");
    assert.includeMembers(
      output.records.map(record => record.kind),
      ["session", "state", "plan", "spawn", "member", "room", "tick"]
    );
    assert.deepEqual(output.records.find(record => record.kind === "plan")!.data.assaultPlan, plan());
    const room = output.records.find(record => record.kind === "room")!;
    assert.deepInclude(room.data.structures, {
      id: "road",
      type: "road",
      x: 2,
      y: 2,
      hits: 500,
      hitsMax: 500
    });
    const frame = output.records.find(record => record.kind === "tick")!;
    assert.deepInclude(frame.data.actions, {
      creep: "member",
      action: "move",
      result: -11,
      detail: { direction: RIGHT }
    });
    assert.deepInclude(frame.data.actions, {
      creep: "member",
      action: "heal",
      result: 0,
      detail: { target: creep.id, targetName: creep.name }
    });
    assert.deepEqual(frame.data.events, [{ roomName: options.targetRoom, tick: 99, events }]);
    assert.lengthOf(output.terrain[options.targetRoom], 50);
    assert.equal(output.terrain[options.targetRoom][0], "1" + "0".repeat(49));
    assert.equal(output.current[0].phase, "ADVANCING");
    assert.equal(move.callCount, 1);
  });

  it("retains errors even when the controller throws and still finishes its diagnostic frame", () => {
    const { SiegeOperation } =
      require("../../src/operations/SiegeOperation") as typeof import("../../src/operations/SiegeOperation");
    const { SmallSiege } =
      require("../../src/operations/SmallSiege") as typeof import("../../src/operations/SmallSiege");
    sinon.stub(SmallSiege.prototype, "update");
    sinon.stub(SmallSiege.prototype, "control").throws(new Error("test attack failure"));
    sinon.stub(console, "log");
    memory.members.A1 = { name: creep.name, spawnRoom: "W17N4", spawnedAt: 1 };
    const operation = new SiegeOperation();
    operation.init();
    operation.actions();
    const records = exported().records;
    const error = records.find(record => record.kind === "error")!;
    assert.equal(error.data.stage, "control");
    assert.include(error.data.message, "test attack failure");
    assert.isTrue(records.some(record => record.kind === "tick"));
  });

  it("copies historic plans and persists records through Memory serialization", () => {
    beginSiegeDiagnostics(memory, options);
    memory.assaultPlan = plan();
    observeSiegeDiagnostics(memory, "update");
    memory.assaultPlan.path[0].anchor.x = 9;
    Memory.siegeLogs = JSON.parse(JSON.stringify(Memory.siegeLogs)) as NonNullable<Memory["siegeLogs"]>;
    Game.time++;
    beginSiegeDiagnostics(memory, options);
    observeSiegeDiagnostics(memory, "update");
    const plans = exported().records.filter(record => record.kind === "plan");
    assert.equal((plans[0].data.assaultPlan as SiegePlan).path[0].anchor.x, 1);
    assert.equal((plans[1].data.assaultPlan as SiegePlan).path[0].anchor.x, 9);
    assert.isAbove(plans[1].sequence, plans[0].sequence);
  });

  it("pages complete room layouts and records explicit position fields", () => {
    roomStructures = Array.from({ length: 101 }, (_, index) => ({
      id: `wall-${index}`,
      structureType: "constructedWall",
      pos: { x: index % 50, y: Math.floor(index / 50) },
      hits: 1000,
      hitsMax: 300000000
    }));
    beginSiegeDiagnostics(memory, options);
    memory.members.A1 = { name: creep.name, spawnRoom: "W17N4", spawnedAt: 1 };
    const destination: Partial<RoomPosition> = {};
    Object.defineProperties(destination, {
      x: { value: 12 },
      y: { value: 13 },
      roomName: { value: "W19N7" }
    });
    travelSiegeCreep(creep, destination as RoomPosition, { range: 1 });
    finishSiegeDiagnostics(memory);
    const records = exported().records;
    const pages = records.filter(record => record.kind === "room");
    assert.lengthOf(pages, 2);
    assert.deepEqual(
      pages.map(page => page.data.page),
      [0, 1]
    );
    assert.isTrue(pages.every(page => page.data.pages === 2));
    assert.equal(
      pages.reduce((count, page) => count + (page.data.structures as unknown[]).length, 0),
      101
    );
    const frame = records.find(record => record.kind === "tick")!;
    assert.deepInclude(frame.data.actions, {
      creep: "member",
      action: "travelTo",
      result: OK,
      detail: { destination: { x: 12, y: 13, roomName: "W19N7" }, range: 1 }
    });
  });

  it("preserves terminal postmortems instead of repeatedly appending empty snapshots", () => {
    beginSiegeDiagnostics(memory, options);
    memory.phase = "COMPLETE";
    finishSiegeDiagnostics(memory);
    const recorded = JSON.stringify(Memory.siegeLogs);
    Game.time += 100;
    beginSiegeDiagnostics(memory, options);
    finishSiegeDiagnostics(memory);
    assert.equal(JSON.stringify(Memory.siegeLogs), recorded);
  });

  it("records the actual boosted body without changing the original member record", () => {
    beginSiegeDiagnostics(memory, options);
    memory.members.A1 = { name: creep.name, spawnRoom: "W17N4", spawnedAt: 1 };
    finishSiegeDiagnostics(memory);
    creep.body[1].boost = "XLHO2";
    Game.time++;
    beginSiegeDiagnostics(memory, options);
    finishSiegeDiagnostics(memory);
    const members = exported().records.filter(record => record.kind === "member");
    assert.lengthOf(members, 2);
    assert.isUndefined((members[0].data.body as BodyPartDefinition[])[1].boost);
    assert.equal((members[1].data.body as BodyPartDefinition[])[1].boost, "XLHO2");
  });

  it("enforces both the shared serialized-size budget and record count while reporting eviction", () => {
    SIEGE_POLICY.diagnostics.maxCharacters = 4096;
    SIEGE_POLICY.diagnostics.maxRecords = 4;
    beginSiegeDiagnostics(memory, options);
    for (let index = 0; index < 30; index++) {
      recordSiegeEvent(memory.id, "sample", { index, text: "x".repeat(1000) });
      assert.isAtMost(JSON.stringify(Memory.siegeLogs).length, 4096);
      assert.isAtMost(Memory.siegeLogs!.records.length, 4);
    }
    assert.isAbove(Memory.siegeLogs!.droppedRecords, 0);
    const remaining = exported().records;
    assert.equal(remaining[remaining.length - 1].data.index, 29);
    assert.isFalse(remaining.some(record => record.kind === "sample" && record.data.index === 0));
    assert.isAbove(exported().retention.droppedRecords, 0);
  });

  it("reports an oversized record explicitly instead of exceeding the Memory limit", () => {
    SIEGE_POLICY.diagnostics.maxCharacters = 2048;
    beginSiegeDiagnostics(memory, options);
    recordSiegeEvent(memory.id, "large-plan", { text: "x".repeat(10000) });
    assert.isAtMost(JSON.stringify(Memory.siegeLogs).length, 2048);
    const records = exported().records;
    assert.equal(records[records.length - 1].kind, "record-too-large");
    assert.equal(records[records.length - 1].data.originalKind, "large-plan");
  });

  it("exports frozen, filterable, reassemblable chunks while the live log keeps rolling", () => {
    beginSiegeDiagnostics(memory, options);
    recordSiegeEvent(memory.id, "payload", { text: 'Unicode \u2603, quotes " and newlines\n'.repeat(200) });
    const other = { ...memory, id: "other", members: {} };
    beginSiegeDiagnostics(other, { ...options, id: other.id });
    recordSiegeEvent(other.id, "other-event", { secretToThisFilter: true });
    const expected = siegeLogCommands.export(memory.id);
    const manifest = JSON.parse(siegeLogCommands.startExport(memory.id)) as { exportId: string; parts: number };
    assert.isAbove(manifest.parts, 1);
    Game.time++;
    recordSiegeEvent(memory.id, "later", { message: "Must not change the frozen export." });
    const chunks: string[] = [];
    for (let index = 0; index < manifest.parts; index++) {
      const chunk = JSON.parse(siegeLogCommands.chunk(index)) as {
        exportId: string;
        index: number;
        parts: number;
        text: string;
      };
      assert.equal(chunk.exportId, manifest.exportId);
      assert.equal(chunk.index, index);
      assert.equal(chunk.parts, manifest.parts);
      chunks.push(chunk.text);
    }
    assert.equal(chunks.join(""), expected);
    assert.isFalse((JSON.parse(chunks.join("")) as ExportedLog).records.some(record => record.siegeId === "other"));
    assert.throws(() => siegeLogCommands.chunk(-1), "out of range");
    assert.throws(() => siegeLogCommands.chunk(manifest.parts), "out of range");
    assert.throws(() => siegeLogCommands.export("missing"), "Unknown siege ID");
  });

  it("clears one siege or all logs without changing operations and invalidates frozen exports", () => {
    beginSiegeDiagnostics(memory, options);
    recordSiegeEvent(memory.id, "event", { value: 1 });
    const other = { ...memory, id: "other", members: {} };
    beginSiegeDiagnostics(other, { ...options, id: other.id });
    recordSiegeEvent(other.id, "event", { value: 2 });
    const operationsBefore = JSON.stringify(Memory.sieges);
    siegeLogCommands.startExport();
    siegeLogCommands.clear(memory.id);
    assert.equal(JSON.stringify(Memory.sieges), operationsBefore);
    assert.isTrue(Memory.siegeLogs!.records.every(record => record.siegeId === other.id));
    assert.throws(() => siegeLogCommands.chunk(0), "No frozen export");
    beginSiegeDiagnostics(memory, options);
    assert.isTrue(Memory.siegeLogs!.records.some(record => record.siegeId === memory.id));
    siegeLogCommands.clear();
    assert.isUndefined(Memory.siegeLogs);
    assert.equal(JSON.stringify(Memory.sieges), operationsBefore);
  });

  it("captures casualties and their previous-tick events even after operation memory drops the member", () => {
    beginSiegeDiagnostics(memory, options);
    memory.members.A1 = { name: creep.name, spawnRoom: "W17N4", spawnedAt: 1 };
    finishSiegeDiagnostics(memory);
    Game.time++;
    delete Game.creeps[creep.name];
    memory.members = {};
    events.push({ event: EVENT_ATTACK, objectId: "tower", data: { targetId: creep.id, damage: 600, attackType: 1 } });
    beginSiegeDiagnostics(memory, options);
    finishSiegeDiagnostics(memory);
    const records = exported().records;
    assert.equal(records.find(record => record.kind === "member-lost")!.data.name, creep.name);
    const frames = records.filter(record => record.kind === "tick");
    assert.deepEqual(frames[frames.length - 1].data.events, [{ roomName: options.targetRoom, tick: 100, events }]);
  });

  it("samples quiet ticks, immediately retains failed actions, and leaves actions unchanged when disabled", () => {
    beginSiegeDiagnostics(memory, options);
    memory.members.A1 = { name: creep.name, spawnRoom: "W17N4", spawnedAt: 1 };
    finishSiegeDiagnostics(memory);
    Game.time = 101;
    beginSiegeDiagnostics(memory, options);
    recordCreepAction(creep, "heal", OK);
    finishSiegeDiagnostics(memory);
    assert.equal(exported().records.filter(record => record.kind === "tick").length, 1);
    Game.time = 102;
    beginSiegeDiagnostics(memory, options);
    moveSiegeCreep(creep, RIGHT);
    finishSiegeDiagnostics(memory);
    const frames = exported().records.filter(record => record.kind === "tick");
    assert.lengthOf(frames, 2);
    assert.equal(frames[1].data.omittedQuietTicks, 1);
    siegeLogCommands.clear();
    SIEGE_POLICY.diagnostics.enabled = false;
    beginSiegeDiagnostics(memory, options);
    assert.equal(moveSiegeCreep(creep, RIGHT), -11);
    assert.equal(travelSiegeCreep(creep, creep.pos, { range: 1 }), OK);
    finishSiegeDiagnostics(memory);
    assert.isUndefined(Memory.siegeLogs);
    assert.isTrue(travel.calledOnceWithExactly(creep.pos, { range: 1 }));
  });
});
