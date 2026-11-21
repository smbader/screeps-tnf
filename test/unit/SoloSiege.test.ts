import { assert } from "chai";
import type { SiegeMemory, SiegeOptions } from "../../src/operations/SiegeTypes";

describe("solo siege", () => {
  const globals: Record<string, unknown> = {
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
    STRUCTURE_SPAWN: "spawn",
    STRUCTURE_TOWER: "tower",
    STRUCTURE_RAMPART: "rampart",
    STRUCTURE_CONTROLLER: "controller",
    RESOURCE_ENERGY: "energy",
    FIND_MY_SPAWNS: 1,
    FIND_STRUCTURES: 2,
    FIND_HOSTILE_CREEPS: 3,
    FIND_HOSTILE_STRUCTURES: 4,
    FIND_CREEPS: 5,
    FIND_POWER_CREEPS: 6,
    FIND_SOURCES: 7,
    FIND_MINERALS: 8,
    FIND_DEPOSITS: 9,
    FIND_CONSTRUCTION_SITES: 10,
    LOOK_STRUCTURES: "structure",
    LOOK_CREEPS: "creep",
    LOOK_POWER_CREEPS: "powerCreep",
    LOOK_SOURCES: "source",
    LOOK_MINERALS: "mineral",
    LOOK_DEPOSITS: "deposit",
    OBSTACLE_OBJECT_TYPES: ["spawn", "tower", "constructedWall"],
    EVENT_ATTACK: 1,
    TERRAIN_MASK_WALL: 1,
    TERRAIN_MASK_SWAMP: 2,
    OK: 0,
    ERR_BUSY: -4,
    ERR_TIRED: -11,
    ERR_NO_PATH: -2,
    RoomPosition: class {
      public constructor(public x: number, public y: number, public roomName: string) {}
      public isEqualTo(other: { x: number; y: number; roomName: string }): boolean {
        return this.x === other.x && this.y === other.y && this.roomName === other.roomName;
      }
      public getRangeTo(other: { pos?: { x: number; y: number }; x?: number; y?: number }): number {
        const pos = other.pos || other;
        return Math.max(Math.abs(this.x - pos.x!), Math.abs(this.y - pos.y!));
      }
    }
  };
  const original: Record<string, unknown> = {};
  const options: SiegeOptions = { id: "solo", mode: "solo", homeRoom: "W17N4", targetRoom: "W18N7" };
  let SoloSiege: typeof import("../../src/operations/SoloSiege").SoloSiege;
  let memory: SiegeMemory;
  let game: any;
  let creep: any;
  let events: object[];
  let movements: number[];
  let exactMoves: { x: number; y: number; roomName: string }[];
  let travels: { roomName: string; range: number }[];
  let spawns: string[];
  let spawnBodies: BodyPartConstant[][];
  let hostileStructures: any[];
  let hostiles: any[];
  let obstacles: { kind: string; x: number; y: number; value: any }[];
  let walls: string[];

  before(() => {
    for (const key of [...Object.keys(globals), "Game", "PathFinder"]) original[key] = Reflect.get(global, key);
    Object.assign(global, globals);
    SoloSiege = (require("../../src/operations/SoloSiege") as typeof import("../../src/operations/SoloSiege"))
      .SoloSiege;
  });

  beforeEach(() => {
    events = [];
    movements = [];
    exactMoves = [];
    travels = [];
    spawns = [];
    spawnBodies = [];
    hostileStructures = [];
    hostiles = [];
    obstacles = [];
    walls = [];
    class Matrix {
      private cells = new Map<string, number>();
      public set(x: number, y: number, value: number): void {
        this.cells.set(`${x},${y}`, value);
      }
      public get(x: number, y: number): number {
        return this.cells.get(`${x},${y}`) || 0;
      }
    }
    Reflect.set(global, "PathFinder", {
      CostMatrix: Matrix,
      search: (
        from: { x: number; y: number; roomName: string },
        goal: { pos: { x: number; y: number }; range: number },
        opts: { roomCallback: (roomName: string) => Matrix }
      ) => {
        const matrix = opts.roomCallback(from.roomName);
        const queue: { x: number; y: number; path: { x: number; y: number; roomName: string }[] }[] = [
          { x: from.x, y: from.y, path: [] }
        ];
        const seen = new Set([`${from.x},${from.y}`]);
        while (queue.length) {
          const current = queue.shift()!;
          if (Math.max(Math.abs(current.x - goal.pos.x), Math.abs(current.y - goal.pos.y)) <= goal.range) {
            return { path: current.path, incomplete: false };
          }
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const x = current.x + dx;
              const y = current.y + dy;
              const key = `${x},${y}`;
              if (
                x < 0 ||
                y < 0 ||
                x > 49 ||
                y > 49 ||
                seen.has(key) ||
                matrix.get(x, y) === 255 ||
                walls.includes(key)
              )
                continue;
              seen.add(key);
              queue.push({
                x,
                y,
                path: [...current.path, new (Reflect.get(global, "RoomPosition"))(x, y, from.roomName)]
              });
            }
          }
        }
        return { path: [], incomplete: true };
      }
    });
    const spawn = {
      spawning: null,
      spawnCreep: (parts: BodyPartConstant[], name: string) => {
        spawns.push(name);
        spawnBodies.push(parts);
        return 0;
      }
    };
    const home = {
      name: "W17N4",
      controller: { my: true, owner: { username: "me" } },
      energyAvailable: 1300,
      energyCapacityAvailable: 1300,
      find: (kind: number) => (kind === 1 ? [spawn] : [])
    };
    const room = {
      name: "W18N7",
      controller: { owner: { username: "enemy" }, level: 4, pos: { x: 25, y: 25 } },
      find: (kind: number) => (kind === 2 || kind === 4 ? hostileStructures : kind === 3 ? hostiles : []),
      getEventLog: () => events,
      getTerrain: () => ({ get: (x: number, y: number) => (walls.includes(`${x},${y}`) ? 1 : 0) }),
      lookForAt: (kind: string, x: number, y: number) => [
        ...(kind === "structure" ? hostileStructures.filter(item => item.pos.x === x && item.pos.y === y) : []),
        ...(kind === "creep" ? hostiles.filter(item => item.pos.x === x && item.pos.y === y) : []),
        ...obstacles.filter(item => item.kind === kind && item.x === x && item.y === y).map(item => item.value)
      ]
    };
    const Position = Reflect.get(global, "RoomPosition");
    creep = {
      id: "attacker",
      name: "attacker",
      pos: new Position(48, 20, "W17N7"),
      room: { name: "W17N7", find: () => [], getEventLog: () => events },
      spawning: false,
      hits: 1000,
      hitsMax: 1000,
      fatigue: 0,
      body: [
        { type: "heal", hits: 100 },
        { type: "ranged_attack", hits: 100 }
      ],
      getActiveBodyparts: (part: string) => (part === "heal" || part === "ranged_attack" ? 1 : 0),
      heal: () => 0,
      move: (direction: number) => {
        movements.push(direction);
        return 0;
      },
      moveTo: (pos: { x: number; y: number; roomName: string }) => {
        exactMoves.push(pos);
        return 0;
      },
      travelTo: (pos: { roomName: string }, opts: { range: number }) => {
        travels.push({ roomName: pos.roomName, range: opts.range });
        return 0;
      },
      rangedAttack: () => 0
    };
    game = {
      time: 1000,
      creeps: { attacker: creep },
      rooms: { W17N4: home },
      map: {
        describeExits: () => ({ "3": "W17N7" }),
        findRoute: () => [{ room: "W17N7" }],
        getRoomTerrain: () => ({ get: () => 0 })
      }
    };
    Reflect.set(global, "Game", game);
    memory = {
      id: "solo",
      targetRoom: "W18N7",
      phase: "PREPARING",
      phaseSince: 0,
      attempt: 0,
      members: {},
      solo: {
        name: "attacker",
        entry: { roomName: "W17N7", outside: { x: 1, y: 20 }, inside: { x: 48, y: 20 }, inward: 7, outward: 3 }
      },
      snapshot: {
        roomName: "W18N7",
        tick: 1000,
        owner: "enemy",
        level: 4,
        safeModeEndsAt: 0,
        safeModeCooldownEndsAt: 0,
        controller: { x: 25, y: 25 },
        creeps: [],
        structures: [{ id: "t", x: 25, y: 25, type: "tower", hits: 3000, hostile: true, energy: 1000 }]
      }
    };
    game.target = room;
  });

  after(() => {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) Reflect.deleteProperty(global, key);
      else Reflect.set(global, key, original[key]);
    }
  });

  function setPos(x: number, y: number, roomName: string): void {
    const Position = Reflect.get(global, "RoomPosition");
    creep.pos = new Position(x, y, roomName);
    creep.room = { ...game.target, name: roomName };
  }

  function melee(id: string, x: number, y: number): void {
    hostiles.push({
      id,
      pos: { x, y },
      hits: 100,
      hitsMax: 100,
      body: [{ type: "attack", hits: 100 }],
      getActiveBodyparts: (part: string) => (part === "attack" ? 1 : 0)
    });
  }

  function opportunityScenario(spawnX = 44, towerX = 10, extraMoves = 0): void {
    setPos(48, 20, "W18N7");
    const Position = Reflect.get(global, "RoomPosition");
    hostileStructures.push(
      { id: "spawn", structureType: "spawn", pos: new Position(spawnX, 20, "W18N7") },
      {
        id: "tower",
        structureType: "tower",
        pos: new Position(towerX, 20, "W18N7"),
        store: { getUsedCapacity: () => 1000 }
      }
    );
    creep.body = [
      ...Array(2)
        .fill(null)
        .map(() => ({ type: "ranged_attack", hits: 100 })),
      ...Array(3)
        .fill(null)
        .map(() => ({ type: "heal", hits: 100 })),
      ...Array(5 + extraMoves)
        .fill(null)
        .map(() => ({ type: "move", hits: 100 }))
    ];
    creep.hits = creep.hitsMax = creep.body.length * 100;
    creep.ticksToLive = 1000;
    creep.getActiveBodyparts = (part: string) =>
      creep.body.filter((bodyPart: { type: string; hits: number }) => bodyPart.type === part && bodyPart.hits > 0)
        .length;
  }

  it("spawns one solo attacker without target vision and replaces losses", () => {
    memory.solo = {};
    delete game.creeps.attacker;
    const op = new SoloSiege();
    op.update(memory, options);
    op.supply(memory, options);
    assert.lengthOf(spawns, 1);
    assert.deepEqual(spawnBodies[0], [
      "ranged_attack",
      "ranged_attack",
      "heal",
      "heal",
      "heal",
      "move",
      "move",
      "move",
      "move",
      "move"
    ]);
    assert.equal(memory.solo!.name, spawns[0]);
    game.creeps[spawns[0]] = { spawning: true };
    op.supply(memory, options);
    assert.lengthOf(spawns, 1);
    delete game.creeps[spawns[0]];
    game.time++;
    op.update(memory, options);
    op.supply(memory, options);
    assert.lengthOf(spawns, 2);
    assert.equal(memory.wave, 2);
  });

  it("allows keeper exits but still rejects swamp escape tiles", () => {
    memory.solo = {};
    game.map.describeExits = () => ({ "1": "W16N4", "3": "W17N7" });
    game.map.getRoomTerrain = (roomName: string) => ({
      get: (x: number) => (roomName === "W18N7" && x === 48 ? 2 : 0)
    });
    const op = new SoloSiege();
    op.update(memory, options);
    op.supply(memory, options);
    assert.equal(memory.solo?.entry?.roomName, "W16N4");
    assert.lengthOf(spawns, 1);
    memory.solo = {};
    memory.phase = "PLANNING";
    spawns.length = 0;
    game.map.getRoomTerrain = (roomName: string) => ({
      get: (x: number, y: number) => (roomName === "W18N7" && (x === 48 || y === 1) ? 2 : 0)
    });
    op.update(memory, options);
    op.supply(memory, options);
    assert.equal(memory.phase, "BLOCKED");
    assert.lengthOf(spawns, 0);
    assert.include(memory.status, "plain escape tile");
  });

  it("moves inward from every staging-room border, not just the target-facing border", () => {
    const op = new SoloSiege();
    for (const [x, y, expectedX, expectedY] of [
      [49, 20, 48, 20],
      [0, 20, 1, 20],
      [20, 0, 20, 1],
      [20, 49, 20, 48]
    ]) {
      setPos(x, y, "W17N7");
      op.control(memory, options);
      assert.deepInclude(exactMoves.pop(), { x: expectedX, y: expectedY, roomName: "W17N7" });
      assert.lengthOf(movements, 0);
    }
  });

  it("fires at armed hostiles while leaving the staging-room border", () => {
    const op = new SoloSiege();
    setPos(49, 20, "W17N7");
    melee("enemy", 48, 20);
    let fired: string | undefined;
    creep.rangedAttack = (target: { id: string }) => {
      fired = target.id;
      return 0;
    };
    op.control(memory, options);
    assert.equal(fired, "enemy");
    assert.equal(movements.pop(), 8);
    assert.lengthOf(exactMoves, 0);
  });

  it("fires and moves away from melee at ranges one and two, and holds range three", () => {
    const op = new SoloSiege();
    for (const range of [1, 2, 3]) {
      setPos(25, 25, "W17N7");
      hostiles = [];
      melee("enemy", 25 - range, 25);
      let fired = "";
      creep.rangedAttack = (target: { id: string }) => {
        fired = target.id;
        return 0;
      };
      op.control(memory, options);
      assert.equal(fired, "enemy");
      if (range < 3) {
        assert.include([2, 3, 4], movements.pop());
        assert.include(memory.status, `range=${range}->${range + 1}`);
      } else {
        assert.lengthOf(movements, 0);
        assert.include(memory.status, "maintaining ranged distance 3");
      }
      assert.lengthOf(travels, 0);
      assert.lengthOf(exactMoves, 0);
    }
  });

  it("considers multiple melee threats and avoids occupied, blocked, and edge tiles", () => {
    const op = new SoloSiege();
    setPos(2, 20, "W17N7");
    melee("west", 1, 20);
    melee("north", 2, 19);
    walls.push("3,21");
    obstacles.push({ kind: "structure", x: 3, y: 20, value: { structureType: "spawn" } });
    obstacles.push({ kind: "creep", x: 2, y: 21, value: {} });
    op.control(memory, options);
    assert.lengthOf(movements, 0);
    assert.include(memory.status, "no separating step");
    assert.lengthOf(travels, 0);
  });

  it("chooses a tile that increases distance from all nearby melee threats", () => {
    setPos(25, 25, "W17N7");
    melee("west", 24, 25);
    melee("north", 25, 24);
    new SoloSiege().control(memory, options);
    assert.equal(movements.pop(), 4);
    assert.include(memory.status, "range=1->2");
  });

  it("kites in the target room when its towers are depleted", () => {
    setPos(25, 25, "W18N7");
    memory.snapshot!.structures[0].energy = 0;
    melee("enemy", 24, 25);
    new SoloSiege().control(memory, options);
    assert.include([2, 3, 4], movements.pop());
    assert.include(memory.status, "kiting");
    assert.isNotTrue(memory.solo!.retreating);
  });

  it("continues strategic travel when melee is far away", () => {
    setPos(25, 25, "W16N7");
    melee("enemy", 21, 25);
    new SoloSiege().control(memory, options);
    assert.lengthOf(movements, 0);
    assert.equal(travels[0].roomName, "W17N7");
  });

  it("prioritizes tower retreat and safe-mode retreat over kiting", () => {
    const op = new SoloSiege();
    setPos(48, 20, "W18N7");
    melee("enemy", 47, 20);
    op.control(memory, options);
    assert.equal(movements.pop(), 3);
    assert.include(memory.status, "active or unknown towers");
    memory.phase = "PAUSED";
    op.control(memory, options);
    assert.equal(movements.pop(), 3);
  });

  it("logs combat inputs, attack result, chosen kite step and failed movement", () => {
    setPos(25, 25, "W17N7");
    melee("enemy", 24, 25);
    creep.fatigue = 2;
    creep.move = () => -11;
    creep.rangedAttack = () => -9;
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message?: any) => {
      logs.push(String(message));
    };
    try {
      new SoloSiege().control(memory, options);
    } finally {
      console.log = originalLog;
    }
    assert.lengthOf(logs, 1);
    for (const fragment of [
      "tick=1000",
      "room=W17N7",
      "hits=1000/1000",
      "fatigue=2",
      "enemy@24,25:range=1,attack=1",
      "heal=0",
      "ranged attack enemy: -9",
      "melee range=1->2",
      "result=-11"
    ])
      assert.include(logs[0], fragment);
  });

  it("probes one tile inside, exits on attack and heals before re-entering", () => {
    const op = new SoloSiege();
    setPos(1, 20, "W17N7");
    op.control(memory, options);
    assert.equal(movements.pop(), 7);
    setPos(49, 20, "W18N7");
    op.control(memory, options);
    assert.equal(movements.pop(), 7);
    setPos(48, 20, "W18N7");
    op.control(memory, options);
    assert.lengthOf(movements, 0);
    assert.include(memory.status, "probing");
    events = [{ event: 1, data: { targetId: "attacker", damage: 150 } }];
    op.control(memory, options);
    assert.equal(movements.pop(), 3);
    setPos(0, 20, "W17N7");
    creep.hits = 850;
    op.control(memory, options);
    assert.deepInclude(exactMoves.pop(), { x: 1, y: 20, roomName: "W17N7" });
    setPos(1, 20, "W17N7");
    op.control(memory, options);
    assert.lengthOf(movements, 0);
    assert.include(memory.status, "healing");
    creep.hits = 1000;
    op.control(memory, options);
    assert.equal(movements.pop(), 7);
  });

  it("approaches a six-range spawn when the estimated round trip is survivable", () => {
    opportunityScenario(42, 10, 10);
    new SoloSiege().control(memory, options);
    assert.equal(memory.solo!.opportunity, "attacking");
    assert.include(memory.status, "approaching spawn");
    assert.include(memory.status, "towerDmg=150/tick");
    assert.lengthOf(movements, 1);
    assert.lengthOf(travels, 0);
  });

  it("declines the opportunity when tower damage exceeds the escape budget", () => {
    opportunityScenario(42, 45);
    new SoloSiege().control(memory, options);
    assert.isUndefined(memory.solo!.opportunity);
    assert.include(memory.status, "probing");
    assert.lengthOf(movements, 0);
  });

  it("fires at a nearby spawn and retreats as soon as the escape margin is lost", () => {
    opportunityScenario();
    const op = new SoloSiege();
    op.control(memory, options);
    assert.equal(memory.solo!.opportunity, "attacking");
    setPos(47, 20, "W18N7");
    movements = [];
    let fired = "";
    creep.rangedAttack = (target: { id: string }) => {
      fired = target.id;
      return 0;
    };
    op.control(memory, options);
    assert.equal(fired, "spawn");
    assert.include(memory.status, "firing on spawn");
    creep.hits = 200;
    creep.body.forEach((part: { hits: number }, index: number) => {
      part.hits = index >= 8 ? 100 : 0;
    });
    op.control(memory, options);
    assert.equal(memory.solo!.opportunity, "retreating");
    assert.include(memory.status, "retreating");
    assert.lengthOf(movements, 1);
    setPos(48, 20, "W18N7");
    op.control(memory, options);
    assert.equal(movements.pop(), 3);
    setPos(0, 20, "W17N7");
    op.control(memory, options);
    assert.isUndefined(memory.solo!.opportunity);
    assert.isTrue(memory.solo!.retreating);
  });

  it("does not begin an opportunity when an armed defender or blocked escape is present", () => {
    opportunityScenario();
    const op = new SoloSiege();
    melee("enemy", 20, 20);
    op.control(memory, options);
    assert.isUndefined(memory.solo!.opportunity);
    hostiles = [];
    walls.push("47,19", "47,20", "47,21", "48,19", "48,21");
    op.control(memory, options);
    assert.isUndefined(memory.solo!.opportunity);
    assert.include(memory.status, "probing");
  });

  it("withdraws from an opportunity when a defender appears", () => {
    opportunityScenario();
    const op = new SoloSiege();
    op.control(memory, options);
    setPos(47, 20, "W18N7");
    movements = [];
    melee("defender", 30, 20);
    op.control(memory, options);
    assert.equal(memory.solo!.opportunity, "retreating");
    assert.include(memory.status, "retreating");
    assert.lengthOf(movements, 1);
  });

  it("refuses an opportunity with unknown tower effects or insufficient lifetime", () => {
    opportunityScenario();
    hostileStructures[1].effects = [{ effect: 1, level: 1, ticksRemaining: 10 }];
    const op = new SoloSiege();
    op.control(memory, options);
    assert.isUndefined(memory.solo!.opportunity);
    hostileStructures[1].effects = [];
    creep.ticksToLive = 201;
    creep.fatigue = 3000;
    op.control(memory, options);
    assert.isUndefined(memory.solo!.opportunity);
  });

  it("withdraws after the last spawn is destroyed before marking victory", () => {
    opportunityScenario();
    const op = new SoloSiege();
    op.control(memory, options);
    setPos(47, 20, "W18N7");
    hostileStructures.shift();
    hostileStructures[0].owner = { username: "enemy" };
    hostileStructures[0].hits = 3000;
    game.rooms.W18N7 = game.target;
    op.update(memory, options);
    assert.notEqual(memory.phase, "COMPLETE");
    assert.equal(memory.solo!.opportunity, "retreating");
    movements = [];
    op.control(memory, options);
    assert.lengthOf(movements, 1);
    setPos(0, 20, "W17N7");
    op.update(memory, options);
    assert.equal(memory.phase, "COMPLETE");
  });

  it("assaults a spawn when live tower energy is depleted and withdraws if attacked", () => {
    const op = new SoloSiege();
    setPos(48, 20, "W18N7");
    game.rooms.W18N7 = game.target;
    hostileStructures.push({
      id: "spawn",
      structureType: "spawn",
      hits: 5000,
      owner: { username: "enemy" },
      pos: new (Reflect.get(global, "RoomPosition"))(25, 25, "W18N7")
    });
    hostileStructures.push({
      id: "tower",
      structureType: "tower",
      hits: 3000,
      owner: { username: "enemy" },
      pos: new (Reflect.get(global, "RoomPosition"))(24, 25, "W18N7"),
      store: { getUsedCapacity: () => 0 }
    });
    op.update(memory, options);
    assert.equal(memory.snapshot!.structures[1].energy, 0);
    op.control(memory, options);
    assert.equal(memory.phase, "ASSAULT");
    assert.equal(travels[0].range, 3);
    events = [{ event: 1, data: { targetId: "attacker", damage: 150 } }];
    op.control(memory, options);
    assert.equal(movements.pop(), 3);
  });

  it("starts the last stand at 200 ticks but not at 201", () => {
    const op = new SoloSiege();
    setPos(48, 20, "W18N7");
    const Position = Reflect.get(global, "RoomPosition");
    hostileStructures.push({ id: "spawn", structureType: "spawn", pos: new Position(25, 25, "W18N7") });
    creep.ticksToLive = 201;
    op.control(memory, options);
    assert.include(memory.status, "probing");
    assert.lengthOf(travels, 0);
    creep.ticksToLive = 200;
    events = [{ event: 1, data: { targetId: "attacker", damage: 150 } }];
    memory.solo!.retreating = true;
    op.control(memory, options);
    assert.include(memory.status, "last stand: approaching spawn");
    assert.equal(travels[0].range, 3);
    assert.isFalse(memory.solo!.retreating);
    assert.lengthOf(movements, 0);
  });

  it("prioritizes the spawn over closer structures and hostile creeps while firing", () => {
    setPos(25, 25, "W18N7");
    creep.ticksToLive = 50;
    const Position = Reflect.get(global, "RoomPosition");
    hostileStructures.push(
      { id: "tower", structureType: "tower", pos: new Position(26, 25, "W18N7") },
      { id: "spawn", structureType: "spawn", pos: new Position(28, 25, "W18N7") }
    );
    melee("enemy", 24, 25);
    let fired = "";
    creep.rangedAttack = (target: { id: string }) => {
      fired = target.id;
      return 0;
    };
    new SoloSiege().control(memory, options);
    assert.equal(fired, "spawn");
    assert.include(memory.status, "attacking spawn");
    assert.lengthOf(movements, 0);
  });

  it("attacks a nearby structure and falls back when the spawn has no path", () => {
    setPos(25, 25, "W18N7");
    creep.ticksToLive = 200;
    const Position = Reflect.get(global, "RoomPosition");
    hostileStructures.push(
      { id: "spawn", structureType: "spawn", pos: new Position(40, 25, "W18N7") },
      { id: "tower", structureType: "tower", pos: new Position(27, 25, "W18N7") }
    );
    let fired = "";
    creep.rangedAttack = (target: { id: string }) => {
      fired = target.id;
      return 0;
    };
    creep.travelTo = () => -2;
    new SoloSiege().control(memory, options);
    assert.equal(fired, "tower");
    assert.include(memory.status, "attacking tower");
  });

  it("tries the nearest other structure if the spawn cannot be reached", () => {
    setPos(25, 25, "W18N7");
    creep.ticksToLive = 200;
    const Position = Reflect.get(global, "RoomPosition");
    hostileStructures.push(
      { id: "spawn", structureType: "spawn", pos: new Position(40, 25, "W18N7") },
      { id: "tower", structureType: "tower", pos: new Position(32, 25, "W18N7") },
      { id: "extension", structureType: "extension", pos: new Position(38, 25, "W18N7") }
    );
    const attempted: number[] = [];
    creep.travelTo = (pos: { x: number }) => {
      attempted.push(pos.x);
      return pos.x === 40 ? -2 : 0;
    };
    new SoloSiege().control(memory, options);
    assert.deepEqual(attempted, [40, 32]);
    assert.include(memory.status, "approaching tower");
  });

  it("reports when no structure is reachable", () => {
    setPos(25, 25, "W18N7");
    creep.ticksToLive = 1;
    const Position = Reflect.get(global, "RoomPosition");
    hostileStructures.push(
      { id: "spawn", structureType: "spawn", pos: new Position(40, 25, "W18N7") },
      { id: "tower", structureType: "tower", pos: new Position(32, 25, "W18N7") }
    );
    creep.travelTo = () => -2;
    new SoloSiege().control(memory, options);
    assert.equal(memory.status, "last stand: no reachable hostile structures");
  });

  it("attacks a rampart protecting the spawn", () => {
    setPos(25, 25, "W18N7");
    creep.ticksToLive = 199;
    const Position = Reflect.get(global, "RoomPosition");
    hostileStructures.push(
      { id: "spawn", structureType: "spawn", pos: new Position(27, 25, "W18N7") },
      { id: "rampart", structureType: "rampart", pos: new Position(27, 25, "W18N7") }
    );
    let fired = "";
    creep.rangedAttack = (target: { id: string }) => {
      fired = target.id;
      return 0;
    };
    new SoloSiege().control(memory, options);
    assert.equal(fired, "rampart");
  });

  it("rushes from staging despite damage, but respects safe mode", () => {
    setPos(1, 20, "W17N7");
    creep.ticksToLive = 200;
    creep.hits = 500;
    const op = new SoloSiege();
    op.control(memory, options);
    assert.equal(movements.pop(), 7);
    assert.include(memory.status, "last stand");
    setPos(48, 20, "W18N7");
    memory.phase = "PAUSED";
    op.control(memory, options);
    assert.equal(movements.pop(), 3);
    assert.lengthOf(travels, 0);
  });

  it("does not spawn into known safe mode", () => {
    memory.snapshot!.safeModeEndsAt = 1200;
    const op = new SoloSiege();
    op.update(memory, options);
    op.supply(memory, options);
    assert.equal(memory.phase, "PAUSED");
    assert.lengthOf(spawns, 0);
  });

  it("returns home for recycling when all healing parts are destroyed", () => {
    const op = new SoloSiege();
    setPos(1, 20, "W17N7");
    creep.hits = 400;
    creep.getActiveBodyparts = () => 0;
    const spawn = game.rooms.W17N4.find(1)[0];
    spawn.pos = new (Reflect.get(global, "RoomPosition"))(20, 20, "W17N4");
    let recycled = false;
    spawn.recycleCreep = () => {
      recycled = true;
      return 0;
    };
    op.control(memory, options);
    assert.equal(travels[0].roomName, "W17N4");
    setPos(21, 20, "W17N4");
    op.control(memory, options);
    assert.isTrue(recycled);
  });
});
