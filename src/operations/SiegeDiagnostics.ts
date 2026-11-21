import { SIEGE_POLICY } from "./SiegeTypes";
import { keeperTravelOptions, planKeeperEvasion } from "./KeeperTravel";
import type { ProbeMemory, SiegeMemory, SiegeOptions } from "./SiegeTypes";
import type { TravelToOptions } from "../utils/Traveler";

interface SiegeLogRecord {
  sequence: number;
  tick: number;
  siegeId: string;
  kind: string;
  roomName?: string;
  data: unknown;
}

interface SiegeLogMemory {
  version: 1;
  nextSequence: number;
  droppedRecords: number;
  recordCharacters: number;
  records: SiegeLogRecord[];
}

interface ActionRecord {
  creep: string;
  action: string;
  result: number;
  detail?: unknown;
}

interface Trace {
  tick: number;
  actions: ActionRecord[];
  state?: string;
  plan?: string;
  hits?: string;
  changed: boolean;
  phase?: string;
  phaseChanged: boolean;
  members: Map<string, { id: string; hits: number; ttl?: number; roomName: string; bodySignature: string }>;
  rooms: Map<string, number>;
  omittedTicks: number;
}

const traces = new Map<string, Trace>();
const ROOT_OVERHEAD = 512;
const EXPORT_CHUNK_SIZE = 3000;
let frozenExport: { id: string; text: string; parts: number } | undefined;
let exportCounter = 0;

declare global {
  interface Memory {
    siegeLogs?: SiegeLogMemory;
  }
  // eslint-disable-next-line no-var
  var siegeLog: typeof siegeLogCommands;
}

function logMemory(): SiegeLogMemory {
  if (!Memory.siegeLogs) {
    Memory.siegeLogs = { version: 1, nextSequence: 1, droppedRecords: 0, recordCharacters: 0, records: [] };
    traces.clear();
  }
  return Memory.siegeLogs;
}

function recordSize(record: SiegeLogRecord): number {
  return JSON.stringify(record).length + 1;
}

function append(siegeId: string, kind: string, data: unknown, roomName?: string): void {
  if (!SIEGE_POLICY.diagnostics.enabled) return;
  const log = logMemory();
  const record: SiegeLogRecord = {
    sequence: log.nextSequence++,
    tick: Game.time,
    siegeId,
    kind,
    roomName,
    data: JSON.parse(JSON.stringify(data === undefined ? null : data)) as unknown
  };
  const budget = Math.max(1024, SIEGE_POLICY.diagnostics.maxCharacters) - ROOT_OVERHEAD;
  if (recordSize(record) > budget) {
    const characters = recordSize(record);
    record.kind = "record-too-large";
    record.data = { originalKind: kind, characters, message: "Payload omitted to preserve the log size limit." };
    log.droppedRecords++;
  }
  log.records.push(record);
  log.recordCharacters += recordSize(record);
  while (log.records.length > Math.max(1, SIEGE_POLICY.diagnostics.maxRecords) || log.recordCharacters > budget) {
    const removed = log.records.shift();
    if (!removed) break;
    log.recordCharacters -= recordSize(removed);
    log.droppedRecords++;
  }
}

export function beginSiegeDiagnostics(memory: SiegeMemory, options: SiegeOptions): void {
  if (!SIEGE_POLICY.diagnostics.enabled) return;
  logMemory();
  let trace = traces.get(memory.id);
  if (!trace) {
    trace = {
      tick: Game.time,
      actions: [],
      changed: true,
      phaseChanged: true,
      members: new Map(),
      rooms: new Map(),
      omittedTicks: 0
    };
    traces.set(memory.id, trace);
    append(memory.id, "session", {
      options,
      policy: SIEGE_POLICY,
      message: "Diagnostics started or runtime reloaded."
    });
  }
  if (trace.tick !== Game.time) {
    trace.tick = Game.time;
    trace.actions = [];
    trace.changed = false;
    trace.phaseChanged = false;
  }
}

export function recordSiegeEvent(siegeId: string, kind: string, data: unknown): void {
  if (SIEGE_POLICY.diagnostics.enabled && traces.has(siegeId)) append(siegeId, kind, data);
}

export function recordSiegeError(siegeId: string, stage: string, error: unknown): void {
  recordSiegeEvent(siegeId, "error", {
    stage,
    message: String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
}

export function recordCreepAction(creep: Creep, action: string, result: number, detail?: unknown): void {
  if (!SIEGE_POLICY.diagnostics.enabled) return;
  const id = creep.memory?.siegeId;
  const trace = id ? traces.get(id) : undefined;
  if (trace && trace.tick === Game.time) trace.actions.push({ creep: creep.name, action, result, detail });
}

export function siegePosition(pos: RoomPosition): { x: number; y: number; roomName: string } {
  return { x: pos.x, y: pos.y, roomName: pos.roomName };
}

export function moveSiegeCreep(creep: Creep, direction: DirectionConstant): CreepMoveReturnCode {
  const result = creep.move(direction);
  recordCreepAction(creep, "move", result, { direction });
  return result;
}

export function travelSiegeCreep(
  creep: Creep,
  destination: RoomPosition,
  options?: TravelToOptions,
  companions?: Creep[]
): ReturnType<Creep["travelTo"]> {
  if (!companions) {
    const evasion = planKeeperEvasion([creep], destination, roomName =>
      roomName === creep.pos.roomName || (options?.routeCallback?.(roomName) !== Infinity &&
        options?.roomCallback?.(roomName, new PathFinder.CostMatrix()) !== false));
    if (evasion) {
      const result = evasion.moves[0] ? moveSiegeCreep(creep, evasion.moves[0].direction) : ERR_NO_PATH;
      recordCreepAction(creep, "keeper-evade", result, { blocked: evasion.blocked, destination: siegePosition(destination) });
      return result;
    }
  }
  const result = creep.travelTo(destination, keeperTravelOptions(creep, options, companions || [creep]));
  recordCreepAction(creep, "travelTo", result, { destination: siegePosition(destination), range: options?.range });
  return result;
}

function probePlan(probe: ProbeMemory | undefined): Omit<ProbeMemory, "lastHits"> | undefined {
  if (!probe) return undefined;
  return {
    side: probe.side,
    outsideRoom: probe.outsideRoom,
    outside: probe.outside,
    inside: probe.inside,
    trail: probe.trail,
    returning: probe.returning,
    targetId: probe.targetId,
    plan: probe.plan,
    estimate: probe.estimate
  };
}

export function observeSiegeDiagnostics(memory: SiegeMemory, stage: string): void {
  const trace = traces.get(memory.id);
  if (!SIEGE_POLICY.diagnostics.enabled || !trace) return;
  const state = {
    phase: memory.phase,
    status: memory.status,
    attempt: memory.attempt,
    wave: memory.wave,
    blockedReason: memory.blockedReason,
    retreatReason: memory.retreatReason,
    spawnsCleared: memory.spawnsCleared,
    members: memory.members,
    probeLaunched: memory.probeLaunched,
    probeWaves: memory.probeWaves?.map(wave => ({
      wave: wave.wave,
      phase: wave.phase,
      members: wave.members,
      status: wave.status,
      retreatReason: wave.retreatReason
    })),
    solo: memory.solo?.name
  };
  const stateJson = JSON.stringify(state);
  if (trace.phase !== memory.phase) {
    trace.phaseChanged = true;
    trace.phase = memory.phase;
  }
  if (trace.state !== stateJson) {
    append(memory.id, "state", { stage, ...state });
    trace.state = stateJson;
    trace.changed = true;
  }
  const plan = {
    plan: memory.plan,
    assaultPlan: memory.assaultPlan,
    gatherRoom: memory.gatherRoom,
    gatherAnchor: memory.gatherAnchor,
    drainAnchor: memory.drainAnchor,
    entry: memory.smallSiegeEntry,
    entryPath: memory.smallSiegeEntryPath,
    soloEntry: memory.solo?.entry,
    scoutRoute: memory.scoutRoute,
    probe: probePlan(memory.probe),
    probeWaves: memory.probeWaves?.map(wave => ({ wave: wave.wave, probe: probePlan(wave.probe) })),
    boostCompounds: memory.boostCompounds
  };
  const planJson = JSON.stringify(plan);
  if (trace.plan !== planJson) {
    append(memory.id, "plan", plan, memory.targetRoom);
    trace.plan = planJson;
    trace.changed = true;
  }
}

function captureRoom(siegeId: string, room: Room): void {
  const controller = room.controller;
  const structures = room.find(FIND_STRUCTURES).map(structure => {
    const owned = structure as OwnedStructure;
    return {
      id: structure.id,
      type: structure.structureType,
      x: structure.pos.x,
      y: structure.pos.y,
      hits: structure.hits,
      hitsMax: structure.hitsMax,
      my: owned.my,
      owner: owned.owner?.username,
      energy:
        structure.structureType === STRUCTURE_TOWER ? structure.store.getUsedCapacity(RESOURCE_ENERGY) : undefined,
      public: structure.structureType === STRUCTURE_RAMPART ? structure.isPublic : undefined,
      effects: structure.effects
    };
  });
  const hostiles = room.find(FIND_HOSTILE_CREEPS).map(creep => ({
    id: creep.id,
    owner: creep.owner.username,
    pos: siegePosition(creep.pos),
    hits: creep.hits,
    hitsMax: creep.hitsMax,
    body: creep.body
  }));
  const pages = Math.max(1, Math.ceil(structures.length / 100), Math.ceil(hostiles.length / 10));
  for (let page = 0; page < pages; page++) {
    append(
      siegeId,
      "room",
      {
        snapshotTick: Game.time,
        page,
        pages,
        controller: controller
          ? {
              pos: siegePosition(controller.pos),
              owner: controller.owner?.username,
              level: controller.level,
              safeMode: controller.safeMode,
              safeModeCooldown: controller.safeModeCooldown
            }
          : undefined,
        structures: structures.slice(page * 100, (page + 1) * 100),
        hostiles: hostiles.slice(page * 10, (page + 1) * 10)
      },
      room.name
    );
  }
}

export function finishSiegeDiagnostics(memory: SiegeMemory): void {
  const trace = traces.get(memory.id);
  if (!SIEGE_POLICY.diagnostics.enabled || !trace) return;
  observeSiegeDiagnostics(memory, "actions");
  if (!trace.changed && !trace.actions.length && (memory.phase === "COMPLETE" || memory.phase === "ABORTED")) return;
  const ids = new Set<string>([...trace.members.values()].map(member => member.id));
  const previousRooms = [...trace.members.values()].map(member => member.roomName);
  const names = new Set([
    ...Object.values(memory.members).map(member => member?.name),
    memory.solo?.name,
    memory.scoutName,
    ...trace.members.keys()
  ]);
  const waveNumbers = new Map<string, number>();
  for (const wave of [{ wave: memory.wave, members: memory.members }, ...(memory.probeWaves || [])]) {
    for (const member of Object.values(wave.members)) {
      if (!member) continue;
      names.add(member.name);
      if (wave.wave !== undefined) waveNumbers.set(member.name, wave.wave);
    }
  }
  const creeps: Creep[] = [];
  for (const name of names) {
    if (!name) continue;
    const creep = Game.creeps[name];
    const previous = trace.members.get(name);
    if (!creep) {
      if (previous) {
        append(memory.id, "member-lost", {
          name,
          lastObserved: previous,
          note: "Absent from Game.creeps; not necessarily killed."
        });
        trace.members.delete(name);
        trace.changed = true;
      }
      continue;
    }
    creeps.push(creep);
    const bodySignature = JSON.stringify(creep.body.map(part => [part.type, part.boost]));
    if (!previous || previous.bodySignature !== bodySignature) {
      append(memory.id, "member", {
        name,
        id: creep.id,
        role: creep.memory.role,
        slot: creep.memory.slot,
        pos: siegePosition(creep.pos),
        body: creep.body,
        spawning: creep.spawning
      });
      trace.changed = true;
    }
    trace.members.set(name, {
      id: creep.id,
      hits: creep.hits,
      ttl: creep.ticksToLive,
      roomName: creep.pos.roomName,
      bodySignature
    });
    ids.add(creep.id);
  }
  const roomNames = new Set([memory.targetRoom, ...creeps.map(creep => creep.pos.roomName), ...previousRooms]);
  const events: { roomName: string; tick: number; events: EventItem[] }[] = [];
  for (const roomName of roomNames) {
    const room = Game.rooms[roomName];
    if (!room) continue;
    const previous = trace.rooms.get(roomName);
    if (
      previous === undefined ||
      trace.phaseChanged ||
      Game.time - previous >= SIEGE_POLICY.diagnostics.snapshotInterval
    ) {
      captureRoom(memory.id, room);
      trace.rooms.set(roomName, Game.time);
    }
    const relevant = room
      .getEventLog()
      .filter(
        event =>
          ids.has(event.objectId) ||
          (event.data && "targetId" in event.data && ids.has(event.data.targetId)) ||
          (roomName === memory.targetRoom && event.event === EVENT_OBJECT_DESTROYED)
      );
    if (relevant.length) events.push({ roomName, tick: Game.time - 1, events: relevant });
  }
  const members = creeps.map(creep => ({
    name: creep.name,
    wave: waveNumbers.get(creep.name),
    pos: siegePosition(creep.pos),
    hits: creep.hits,
    hitsMax: creep.hitsMax,
    fatigue: creep.fatigue,
    ttl: creep.ticksToLive,
    spawning: creep.spawning,
    activeParts: creep.body
      .filter(part => part.hits > 0)
      .reduce<Partial<Record<BodyPartConstant, number>>>((parts, part) => {
        parts[part.type] = (parts[part.type] || 0) + 1;
        return parts;
      }, {})
  }));
  const hits = JSON.stringify(members.map(member => [member.name, member.hits]));
  if (creeps.length || trace.actions.length || events.length) {
    if (
      trace.changed ||
      events.some(roomEvents => roomEvents.events.some(event => event.event !== EVENT_HEAL)) ||
      hits !== trace.hits ||
      trace.actions.some(action => action.result !== OK) ||
      Game.time % Math.max(1, SIEGE_POLICY.diagnostics.sampleInterval) === 0
    ) {
      append(memory.id, "tick", {
        phase: memory.phase,
        pathIndex: memory.pathIndex,
        members,
        actions: trace.actions,
        events,
        omittedQuietTicks: trace.omittedTicks
      });
      trace.omittedTicks = 0;
    } else trace.omittedTicks++;
  }
  trace.hits = hits;
  trace.actions = [];
}

function validateId(id?: string): void {
  if (id === undefined) return;
  if (typeof id !== "string" || !id.length) throw new Error("Provide a siege ID, or omit it to select all sieges.");
  if (
    !Memory.siegeLogs?.records.some(record => record.siegeId === id) &&
    !Memory.sieges?.sieges[id] &&
    !SIEGE_POLICY.targets.some(target => target.id === id)
  ) {
    throw new Error(`Unknown siege ID: ${id}`);
  }
}

function exportLog(id?: string): string {
  validateId(id);
  const log = Memory.siegeLogs;
  const records = (log?.records || []).filter(record => id === undefined || record.siegeId === id);
  const current = Object.values(Memory.sieges?.sieges || {}).filter(memory => id === undefined || memory.id === id);
  const options = SIEGE_POLICY.targets.filter(target => id === undefined || target.id === id);
  const roomNames = new Set([
    ...records.map(record => record.roomName),
    ...current.map(memory => memory.targetRoom),
    ...options.map(target => target.targetRoom)
  ]);
  const terrain: Record<string, string[]> = {};
  for (const roomName of roomNames) {
    if (!roomName) continue;
    const roomTerrain = Game.map.getRoomTerrain(roomName);
    terrain[roomName] = Array.from({ length: 50 }, (_, y) =>
      Array.from({ length: 50 }, (__, x) => String(roomTerrain.get(x, y))).join("")
    );
  }
  return JSON.stringify({
    format: "screeps-siege-log",
    version: 1,
    exportedAt: Game.time,
    shard: Game.shard?.name,
    siegeId: id,
    retention: { droppedRecords: log?.droppedRecords || 0, scope: "all sieges" },
    settings: SIEGE_POLICY.diagnostics,
    options,
    current,
    terrain,
    records
  });
}

export const siegeLogCommands = {
  status(): string {
    const log = Memory.siegeLogs;
    return JSON.stringify({
      enabled: SIEGE_POLICY.diagnostics.enabled,
      scope: "all sieges",
      characters: log ? JSON.stringify(log).length : 0,
      maxCharacters: SIEGE_POLICY.diagnostics.maxCharacters,
      records: log?.records.length || 0,
      droppedRecords: log?.droppedRecords || 0,
      oldestTick: log?.records[0]?.tick,
      newestTick: log?.records[log.records.length - 1]?.tick,
      siegeIds: [...new Set(log?.records.map(record => record.siegeId) || [])]
    });
  },
  export: exportLog,
  startExport(id?: string): string {
    const text = exportLog(id);
    frozenExport = { id: `${Game.time}-${++exportCounter}`, text, parts: Math.ceil(text.length / EXPORT_CHUNK_SIZE) };
    return JSON.stringify({
      exportId: frozenExport.id,
      parts: frozenExport.parts,
      characters: text.length,
      command: "siegeLog.chunk(0)",
      note: "Read indices 0 through parts-1. Frozen until cleared, replaced, or runtime reloads."
    });
  },
  chunk(index: number): string {
    if (!frozenExport) throw new Error("No frozen export. Run siegeLog.startExport(id) first.");
    if (!Number.isInteger(index) || index < 0 || index >= frozenExport.parts)
      throw new Error("Export chunk index out of range.");
    return JSON.stringify({
      format: "screeps-siege-log-chunk",
      exportId: frozenExport.id,
      index,
      parts: frozenExport.parts,
      text: frozenExport.text.slice(index * EXPORT_CHUNK_SIZE, (index + 1) * EXPORT_CHUNK_SIZE)
    });
  },
  clear(id?: string): string {
    validateId(id);
    const log = Memory.siegeLogs;
    const before = log?.records.length || 0;
    if (id === undefined) {
      delete Memory.siegeLogs;
      traces.clear();
    } else {
      if (log) {
        log.records = log.records.filter(record => record.siegeId !== id);
        log.recordCharacters = log.records.reduce((sum, record) => sum + recordSize(record), 0);
      }
      traces.delete(id);
    }
    frozenExport = undefined;
    return JSON.stringify({
      cleared: before - (Memory.siegeLogs?.records.length || 0),
      siegeId: id,
      note: "Diagnostics only; siege operations are unchanged. Recording resumes next tick if enabled."
    });
  }
};

global.siegeLog = siegeLogCommands;
