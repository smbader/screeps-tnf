export type RoomType = "owned" | "remote" | "defend" | "keeper-mineral";

export interface RoomPositionConfig {
  x: number;
  y: number;
}

export interface EnergySourceConfig {
  id: string;
  pos: RoomPositionConfig;
  haulers?: number;
  tinyfarmers?: number;
  linkpos?: RoomPositionConfig;
  parkingspots?: RoomPositionConfig[];
}

export interface SpawnConfig extends RoomPositionConfig {
  direction?: DirectionConstant;
}

export interface ChemistConfig {
  parking?: RoomPositionConfig;
  spawn?: RoomPositionConfig;
  spawndirection?: DirectionConstant[];
}

export interface FieldConfig {
  levels?: number[];
  spawn?: RoomPositionConfig;
  spawndirection?: DirectionConstant[];
  parkingspot?: RoomPositionConfig;
  sources?: RoomPositionConfig[];
  containers?: RoomPositionConfig[];
}

export interface RoomLayout {
  energysources?: EnergySourceConfig[];
  spawns?: SpawnConfig[];
  storage?: RoomPositionConfig;
  storagelink?: RoomPositionConfig;
  controllerLink?: RoomPositionConfig;
  towers?: RoomPositionConfig[];
  chemist?: ChemistConfig;
  road?: RoomPositionConfig[];
  rampart?: RoomPositionConfig[];
  fieldLinks?: RoomPositionConfig[];
  field0Links?: RoomPositionConfig[];
  field0Link?: RoomPositionConfig;
  fieldContainers?: RoomPositionConfig[];
  field0?: FieldConfig;
  field1?: FieldConfig;
  field2?: FieldConfig;
  field3?: FieldConfig;
  field4?: FieldConfig;
  field5?: FieldConfig;
  powerSpawn?: RoomPositionConfig;
  terminal?: RoomPositionConfig;
  lab?: RoomPositionConfig[];
  nuker?: RoomPositionConfig;
  factory?: RoomPositionConfig;
  observer?: RoomPositionConfig;
  containers?: RoomPositionConfig[];
  sources?: RoomPositionConfig[];
  spawn?: RoomPositionConfig;
  parking?: RoomPositionConfig;
  parkingspot?: RoomPositionConfig;
  direction?: DirectionConstant;
  spawndirection?: DirectionConstant[];
  haulers?: number;
  sourceroom?: string;
}

export interface RoomConfig extends RoomLayout {
  shard: string;
  type: RoomType;
  roomtemplate?: "ricane";
  roomanchor?: RoomPositionConfig;
  templaterotation?: number;
}

export interface RoomConfigRegistration {
  getConfig: () => RoomConfig;
  loadOnVisibility: boolean;
  initializeData: boolean;
}

export interface RoomRuntimeData {
  storagelinkcommand: string;
  storagelinktarget: Id<StructureLink> | null;
  terminal: { energy: number };
  labs: {
    reagents: { id: Id<StructureLab>; component: ResourceConstant }[];
    products: { id: Id<StructureLab> }[];
    boosts: { id: Id<StructureLab>; component: ResourceConstant }[];
    production?: LabProductionState;
    productionStatus?: string;
  };
}

export interface LabProductionState {
  version: 1;
  inputLabIds: [Id<StructureLab>, Id<StructureLab>];
  configuredLabIds: Id<StructureLab>[];
  paused?: boolean;
  activeProduct?: ResourceConstant;
  activeReagents?: [ResourceConstant, ResourceConstant];
  lastMarketAttempt?: number;
  lastStatus?: string;
  lastError?: string;
}

export interface RoomSourceMemory {
  [sourceId: string]: {
    x: number;
    y: number;
    container: { id: string; x: number; y: number };
    linkpos?: RoomPositionConfig;
  };
}

export type ResolvedRoomConfig = Omit<
  Partial<RoomConfig>,
  "sources" | "energysources" | "fieldContainers" | "fieldLinks"
> & {
  energysources: EnergySourceConfig[];
  fieldContainers: RoomPositionConfig[];
  fieldLinks: RoomPositionConfig[];
  nextTrade?: number;
  data?: RoomRuntimeData;
  starvedTime?: number;
  sources?: RoomSourceMemory | RoomPositionConfig[];
  spawnMemory?: unknown;
};

export function getFieldConfig(
  config: Pick<RoomLayout, "field0" | "field1" | "field2" | "field3" | "field4" | "field5">,
  index: number
): FieldConfig | undefined {
  switch (index) {
    case 0:
      return config.field0;
    case 1:
      return config.field1;
    case 2:
      return config.field2;
    case 3:
      return config.field3;
    case 4:
      return config.field4;
    case 5:
      return config.field5;
    default:
      return undefined;
  }
}

const ROOM_TYPES: RoomType[] = ["owned", "remote", "defend", "keeper-mineral"];
const ROOM_CONFIG_KEYS: (keyof RoomConfig)[] = [
  "shard",
  "type",
  "roomtemplate",
  "roomanchor",
  "templaterotation",
  "energysources",
  "spawns",
  "storage",
  "storagelink",
  "controllerLink",
  "towers",
  "chemist",
  "road",
  "rampart",
  "fieldLinks",
  "field0Links",
  "field0Link",
  "fieldContainers",
  "field0",
  "field1",
  "field2",
  "field3",
  "field4",
  "field5",
  "powerSpawn",
  "terminal",
  "lab",
  "nuker",
  "factory",
  "observer",
  "containers",
  "sources",
  "spawn",
  "parking",
  "parkingspot",
  "direction",
  "spawndirection",
  "haulers",
  "sourceroom"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePosition(value: unknown, path: string, maxCoordinate = 49): void {
  if (
    !isRecord(value) ||
    typeof value.x !== "number" ||
    !Number.isInteger(value.x) ||
    typeof value.y !== "number" ||
    !Number.isInteger(value.y) ||
    value.x < 0 ||
    value.x > maxCoordinate ||
    value.y < 0 ||
    value.y > maxCoordinate
  ) {
    throw new Error(`${path} must have integer x/y coordinates between 0 and ${maxCoordinate}`);
  }
}

function validatePositions(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of room positions`);
  }
  value.forEach((position, index) => validatePosition(position, `${path}[${index}]`));
}

function validateDirections(value: unknown, path: string): void {
  const directions = Array.isArray(value) ? value : [value];
  if (
    directions.some(
      direction => typeof direction !== "number" || !Number.isInteger(direction) || direction < 1 || direction > 8
    )
  ) {
    throw new Error(`${path} must contain Screeps directions from 1 to 8`);
  }
}

function validateOptionalPosition(config: Record<string, unknown>, key: string, path: string): void {
  if (config[key] !== undefined) {
    validatePosition(config[key], `${path}.${key}`);
  }
}

function validateOptionalPositions(config: Record<string, unknown>, key: string, path: string): void {
  if (config[key] !== undefined) {
    validatePositions(config[key], `${path}.${key}`);
  }
}

export function validateRoomConfig(roomName: string, value: unknown): RoomConfig {
  if (!/^[WE]\d+[NS]\d+$/.test(roomName)) {
    throw new Error(`Invalid room config name "${roomName}"`);
  }
  if (!isRecord(value)) {
    throw new Error(`Room config "${roomName}" must be an object`);
  }

  const unknownKeys = Object.keys(value).filter(key => ROOM_CONFIG_KEYS.indexOf(key as keyof RoomConfig) < 0);
  if (unknownKeys.length > 0) {
    throw new Error(`Room config "${roomName}" has unknown keys: ${unknownKeys.join(", ")}`);
  }
  if (typeof value.shard !== "string" || !/^shard\d+$/.test(value.shard)) {
    throw new Error(`Room config "${roomName}" must specify a valid shard`);
  }
  if (typeof value.type !== "string" || ROOM_TYPES.indexOf(value.type as RoomType) < 0) {
    throw new Error(`Room config "${roomName}" must specify a valid room type`);
  }
  if (value.roomtemplate !== undefined && value.roomtemplate !== "ricane") {
    throw new Error(`Room config "${roomName}" uses unsupported template "${String(value.roomtemplate)}"`);
  }
  if (value.roomanchor !== undefined) {
    validatePosition(value.roomanchor, `${roomName}.roomanchor`);
  }
  if (
    value.templaterotation !== undefined &&
    (typeof value.templaterotation !== "number" || !Number.isInteger(value.templaterotation))
  ) {
    throw new Error(`${roomName}.templaterotation must be an integer`);
  }

  for (const key of [
    "storage",
    "storagelink",
    "controllerLink",
    "field0Link",
    "powerSpawn",
    "terminal",
    "nuker",
    "factory",
    "observer",
    "spawn",
    "parking",
    "parkingspot"
  ]) {
    validateOptionalPosition(value, key, roomName);
  }
  for (const key of [
    "towers",
    "road",
    "rampart",
    "fieldLinks",
    "field0Links",
    "fieldContainers",
    "lab",
    "containers",
    "sources"
  ]) {
    validateOptionalPositions(value, key, roomName);
  }

  if (value.energysources !== undefined) {
    if (!Array.isArray(value.energysources)) {
      throw new Error(`${roomName}.energysources must be an array`);
    }
    value.energysources.forEach((source, index) => {
      const path = `${roomName}.energysources[${index}]`;
      if (!isRecord(source) || typeof source.id !== "string") {
        throw new Error(`${path} must specify a source id`);
      }
      validatePosition(source.pos, `${path}.pos`);
      if (source.linkpos !== undefined) {
        validatePosition(source.linkpos, `${path}.linkpos`);
      }
      if (source.parkingspots !== undefined) {
        validatePositions(source.parkingspots, `${path}.parkingspots`);
      }
      for (const countKey of ["haulers", "tinyfarmers"]) {
        const count = source[countKey];
        if (count !== undefined && (typeof count !== "number" || !Number.isInteger(count) || count < 0)) {
          throw new Error(`${path}.${countKey} must be a non-negative integer`);
        }
      }
    });
  }
  if (value.spawns !== undefined) {
    if (!Array.isArray(value.spawns)) {
      throw new Error(`${roomName}.spawns must be an array`);
    }
    value.spawns.forEach((spawn, index) => {
      const path = `${roomName}.spawns[${index}]`;
      validatePosition(spawn, path);
      if (isRecord(spawn) && spawn.direction !== undefined) {
        validateDirections(spawn.direction, `${path}.direction`);
      }
    });
  }
  if (value.chemist !== undefined) {
    if (!isRecord(value.chemist)) {
      throw new Error(`${roomName}.chemist must be an object`);
    }
    validateOptionalPosition(value.chemist, "parking", `${roomName}.chemist`);
    validateOptionalPosition(value.chemist, "spawn", `${roomName}.chemist`);
    if (value.chemist.spawndirection !== undefined) {
      validateDirections(value.chemist.spawndirection, `${roomName}.chemist.spawndirection`);
    }
  }
  for (const key of ["field0", "field1", "field2", "field3", "field4", "field5"]) {
    const field = value[key];
    if (field === undefined) continue;
    const path = `${roomName}.${key}`;
    if (!isRecord(field)) {
      throw new Error(`${path} must be an object`);
    }
    validateOptionalPosition(field, "spawn", path);
    validateOptionalPosition(field, "parkingspot", path);
    validateOptionalPositions(field, "sources", path);
    validateOptionalPositions(field, "containers", path);
    if (
      field.levels !== undefined &&
      (!Array.isArray(field.levels) ||
        field.levels.some(level => typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 8))
    ) {
      throw new Error(`${path}.levels must contain controller levels from 1 to 8`);
    }
    if (field.spawndirection !== undefined) {
      validateDirections(field.spawndirection, `${path}.spawndirection`);
    }
  }
  for (const key of ["direction", "spawndirection"]) {
    if (value[key] !== undefined) {
      validateDirections(value[key], `${roomName}.${key}`);
    }
  }
  if (
    value.haulers !== undefined &&
    (typeof value.haulers !== "number" || !Number.isInteger(value.haulers) || value.haulers < 0)
  ) {
    throw new Error(`${roomName}.haulers must be a non-negative integer`);
  }
  if (value.sourceroom !== undefined && typeof value.sourceroom !== "string") {
    throw new Error(`${roomName}.sourceroom must be a room name`);
  }

  return value as unknown as RoomConfig;
}

export function validateRoomConfigRegistry(registry: Readonly<Record<string, RoomConfigRegistration>>): void {
  validateUniqueRoomConfigNames(Object.keys(registry));
  for (const [roomName, entry] of Object.entries(registry)) {
    if (typeof entry.getConfig !== "function") {
      throw new Error(`Room config "${roomName}" has no config provider`);
    }
    if (typeof entry.loadOnVisibility !== "boolean" || typeof entry.initializeData !== "boolean") {
      throw new Error(`Room config "${roomName}" has invalid loading options`);
    }
    validateRoomConfig(roomName, entry.getConfig());
  }
}

export function validateUniqueRoomConfigNames(names: string[]): void {
  if (new Set(names).size !== names.length) {
    throw new Error("Room config registry contains duplicate room names");
  }
  for (const name of names) {
    if (!/^[WE]\d+[NS]\d+$/.test(name)) {
      throw new Error(`Invalid room config name "${name}"`);
    }
  }
}
