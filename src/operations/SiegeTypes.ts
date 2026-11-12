export type QuadSlot = "A1" | "A2" | "S1" | "S2";
export type QuadRole = "attacker" | "support";
export type QuadPart = "move" | "ranged_attack" | "heal";

export const QUAD_SLOTS: QuadSlot[] = ["S1", "S2", "A1", "A2"];

export const QUAD_SLOT_ROLE: Record<QuadSlot, QuadRole> = {
  A1: "attacker",
  A2: "attacker",
  S1: "support",
  S2: "support"
};

export type SiegePhase =
  | "PLANNING"
  | "PREPARING"
  | "ASSEMBLING"
  | "TRANSIT"
  | "GATHERING"
  | "STAGING"
  | "BREACHING"
  | "ADVANCING"
  | "ASSAULT"
  | "CLEANUP"
  | "RETREATING"
  | "PAUSED"
  | "COMPLETE"
  | "ABORTED"
  | "BLOCKED";

export type RoomSide = "top" | "right" | "bottom" | "left";

export interface SiegeOptions {
  id: string;
  targetRoom: string;
  enabled?: boolean;
  mode?: "rcl4" | "solo";
  homeRoom?: string;
}

export interface SiegePolicy {
  enabled: boolean;
  debug: boolean;
  targets: SiegeOptions[];
  minimumCpuBucket: number;
  observerRange: number;
  scanInterval: number;
  snapshotMaxAge: number;
  creepLifetime: number;
  lifetimeMargin: number;
  safetyFactor: number;
  retreatHitsFraction: number;
  resumeHitsFraction: number;
  minimumSpawnCapacity: number;
  maxQuadAttempts: number;
  allowMultipleWaves: boolean;
  replacementMinTicksToLive: number;
  maxBoostUnitPrice: number;
  boostPurchaseInterval: number;
  rangedBoostWaitTicks: number;
  threatRange: number;
  kiteSearchSteps: number;
  persistSnapshotInterval: number;
}

export const SIEGE_POLICY: SiegePolicy = {
  enabled: true,
  debug: true,
  targets: [{ id: "W18N7-solo", targetRoom: "W18N7", homeRoom: "W17N4", mode: "solo" }],
  minimumCpuBucket: 3000,
  observerRange: 10,
  scanInterval: 25,
  snapshotMaxAge: 500,
  creepLifetime: 1500,
  lifetimeMargin: 150,
  safetyFactor: 0.7,
  retreatHitsFraction: 0.5,
  resumeHitsFraction: 0.9,
  minimumSpawnCapacity: 8900,
  maxQuadAttempts: 3,
  allowMultipleWaves: true,
  replacementMinTicksToLive: 900,
  maxBoostUnitPrice: 100,
  boostPurchaseInterval: 10,
  rangedBoostWaitTicks: 300,
  threatRange: 6,
  kiteSearchSteps: 4,
  persistSnapshotInterval: 25
};

export interface TilePos {
  x: number;
  y: number;
}

export interface SnapshotStructure {
  id: string;
  x: number;
  y: number;
  type: string;
  hits: number;
  hostile: boolean;
  energy?: number;
}

export interface SnapshotCreep {
  id: string;
  x: number;
  y: number;
  hits: number;
  hitsMax: number;
  attackDps: number;
  rangedDps: number;
  healPerTick: number;
}

export interface RoomSnapshot {
  roomName: string;
  tick: number;
  owner?: string;
  level: number;
  safeModeEndsAt: number;
  safeModeCooldownEndsAt: number;
  controller?: TilePos;
  structures: SnapshotStructure[];
  creeps: SnapshotCreep[];
}

export interface BreachTile {
  x: number;
  y: number;
  hits: number;
}

export interface PlanStep {
  anchor: TilePos;
  exposure: number;
  ticks: number;
  breach: BreachTile[];
}

export type SiegeObjective = "SPAWNS" | "TOWERS" | "CLEANUP" | "CONTROLLER";

export interface FileStep {
  x: number;
  y: number;
  hits: number;
}

export interface SiegePlan {
  snapshotTick: number;
  objective: SiegeObjective;
  entrySide?: RoomSide;
  // Single-file tiles from the room border to the first clear 2x2 block, which is path[0].
  file?: FileStep[];
  path: PlanStep[];
  goalAnchor: TilePos;
  targetId: string;
  targetPos: TilePos;
  totalTicks: number;
  totalBreachHits: number;
  peakExposure: number;
  healBudget: number;
}

export interface PlannerFailure {
  feasible: false;
  reasons: string[];
}

export interface PlannerSuccess {
  feasible: true;
  plan: SiegePlan;
}

export type PlannerResult = PlannerFailure | PlannerSuccess;

export interface QuadStats {
  quadDps: number;
  healPerTick: number;
  plainTicksPerTile: number;
  swampTicksPerTile: number;
}

export interface QuadMemberMemory {
  name: string;
  spawnRoom: string;
  spawnedAt: number;
}

export interface SiegeMemory {
  id: string;
  targetRoom: string;
  phase: SiegePhase;
  phaseSince: number;
  attempt: number;
  wave?: number;
  lastMinTtl?: number;
  members: Partial<Record<QuadSlot, QuadMemberMemory>>;
  boostRoom?: string;
  preparingSince?: number;
  gatherRoom?: string;
  gatherAnchor?: TilePos;
  snapshot?: RoomSnapshot;
  snapshotPersistedAt?: number;
  plan?: SiegePlan;
  pathIndex?: number;
  anchor?: TilePos;
  safeModeEndsAt?: number;
  spawnsCleared?: boolean;
  resumePhase?: SiegePhase;
  pendingObserver?: { homeRoom: string; tick: number };
  boostCompounds?: Partial<Record<QuadPart, string>>;
  unboosted?: boolean;
  holdTicks?: number;
  retreatReason?: string;
  lastScanTick?: number;
  lastPurchaseTick?: number;
  blockedReason?: string;
  status?: string;
  scoutName?: string;
  lastScoutSpawnTick?: number;
  drainAnchor?: TilePos;
  smallSiegeEntry?: { roomName: string; pos: TilePos };
  smallSiegeEntryReady?: boolean;
  smallSiegeUnscoutedReady?: boolean;
  assaultPlan?: SiegePlan;
  solo?: {
    name?: string;
    entry?: {
      roomName: string;
      outside: TilePos;
      inside: TilePos;
      inward: DirectionConstant;
      outward: DirectionConstant;
    };
    retreating?: boolean;
    opportunity?: "attacking" | "retreating";
    lastHits?: number;
    lastRoom?: string;
  };
}

export interface SiegeRootMemory {
  version: 1;
  sieges: Record<string, SiegeMemory>;
}

export interface SiegeCreepMemory extends CreepMemory {
  role: "siegeQuad";
  siegeId: string;
  slot: QuadSlot;
}
