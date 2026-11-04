import { findBestExpansionLayout } from "./ExpansionLayout";
import type { ExpansionLayoutRecommendation } from "./ExpansionLayout";

export type ExpansionPhase = "scouting" | "ready" | "claiming" | "bootstrapping" | "active" | "failed";

export interface ExpansionRoomIntel {
  roomName: string;
  lastSeen: number;
  owner: string | null;
  reservation: string | null;
  controller: boolean;
  sources: number;
  sourceIds: Id<Source>[];
  keeperLairs: boolean;
  hostileCreeps: number;
  layout?: ExpansionLayoutRecommendation;
}

export interface ExpansionAssignment {
  targetRoom: string;
  homeRoom: string;
  phase: ExpansionPhase;
  createdAt: number;
  updatedAt: number;
  retries: number;
  reason?: string;
  forced?: boolean;
}

export interface ExpansionManagementMemory {
  version: 2;
  enabled: boolean;
  dryRun: boolean;
  currentTarget?: string;
  approvedRoom?: string;
  forcedRoom?: string;
  assignments: Record<string, ExpansionAssignment>;
  intel: Record<string, ExpansionRoomIntel>;
  lastStatusLog?: number;
  lastCandidateReport?: number;
}

declare global {
  interface Memory {
    expansionManagement?: ExpansionManagementMemory;
  }
}

export interface ExpansionCandidate {
  roomName: string;
  homeRoom: string;
  distance: number;
}

export interface AcceptableExpansionCandidate {
  candidate: ExpansionCandidate;
  intel: ExpansionRoomIntel & { layout: ExpansionLayoutRecommendation };
}

export const EXPANSION_POLICY = {
  minimumCpuBucket: 5000,
  minimumHomeControllerLevel: 6,
  minimumStorageEnergy: 100000,
  maximumDistance: 3,
  maximumCandidates: 40,
  maximumIntelAge: 1000,
  maximumAssignmentAge: 5000,
  minimumSources: 2,
  workersPerSource: 1,
  handoffControllerLevel: 2,
  statusLogInterval: 100
};

export function getExpansionCandidates(
  homeRooms: string[],
  getExits: (roomName: string) => string[],
  maximumDistance: number,
  maximumCandidates: number
): ExpansionCandidate[] {
  const bestByRoom: Record<string, ExpansionCandidate> = {};

  for (const homeRoom of homeRooms.slice().sort()) {
    const visited = new Set<string>([homeRoom]);
    let frontier = [homeRoom];

    for (let distance = 1; distance <= maximumDistance && frontier.length > 0; distance++) {
      const next: string[] = [];
      for (const roomName of frontier.sort()) {
        for (const exit of getExits(roomName).slice().sort()) {
          if (visited.has(exit)) continue;
          visited.add(exit);
          next.push(exit);
          const current = bestByRoom[exit];
          if (
            !current ||
            distance < current.distance ||
            (distance === current.distance && homeRoom < current.homeRoom)
          ) {
            bestByRoom[exit] = { roomName: exit, homeRoom, distance };
          }
        }
      }
      frontier = next;
    }
  }

  return Object.values(bestByRoom)
    .sort((left, right) => left.distance - right.distance || left.roomName.localeCompare(right.roomName))
    .slice(0, maximumCandidates);
}

export function evaluateExpansionIntel(
  intel: ExpansionRoomIntel,
  username: string,
  minimumSources: number
): string | null {
  if (!intel.controller) return "no controller";
  if (intel.owner) return `owned by ${intel.owner}`;
  if (intel.reservation && intel.reservation !== username) return `reserved by ${intel.reservation}`;
  if (intel.keeperLairs) return "source keeper room";
  if (intel.hostileCreeps > 0) return "hostile creeps present";
  if (intel.sources < minimumSources) return `only ${intel.sources} source(s)`;
  return null;
}

// A forced room only needs a claimable controller; source count, hostiles and registration are ignored.
export function evaluateForcedExpansionIntel(intel: ExpansionRoomIntel, username: string): string | null {
  if (!intel.controller) return "no controller";
  if (intel.owner) return `owned by ${intel.owner}`;
  if (intel.reservation && intel.reservation !== username) return `reserved by ${intel.reservation}`;
  return null;
}

export function getAcceptableExpansionCandidates(
  candidates: ExpansionCandidate[],
  intelByRoom: Record<string, ExpansionRoomIntel>,
  currentTick: number,
  username: string,
  minimumSources: number,
  maximumIntelAge: number
): AcceptableExpansionCandidate[] {
  return candidates
    .map(candidate => ({ candidate, intel: intelByRoom[candidate.roomName] }))
    .filter(
      (entry): entry is AcceptableExpansionCandidate =>
        !!entry.intel &&
        currentTick - entry.intel.lastSeen <= maximumIntelAge &&
        evaluateExpansionIntel(entry.intel, username, minimumSources) === null &&
        !!entry.intel.layout
    )
    .sort(
      (left, right) =>
        right.intel.sources - left.intel.sources ||
        left.candidate.distance - right.candidate.distance ||
        left.candidate.roomName.localeCompare(right.candidate.roomName)
    );
}

export function ensureExpansionMemory(): ExpansionManagementMemory {
  if (!Memory.expansionManagement || Memory.expansionManagement.version !== 2) {
    Memory.expansionManagement = {
      version: 2,
      enabled: false,
      dryRun: true,
      assignments: {},
      intel: {}
    };
  }
  const memory = Memory.expansionManagement;
  if (typeof memory.enabled !== "boolean") memory.enabled = false;
  if (typeof memory.dryRun !== "boolean") memory.dryRun = true;
  if (!memory.assignments) memory.assignments = {};
  if (!memory.intel) memory.intel = {};
  return memory;
}

export function recordExpansionRoomIntel(room: Room): boolean {
  const memory = ensureExpansionMemory();
  const targetRoom = memory.currentTarget;
  const assignment = targetRoom ? memory.assignments[targetRoom] : undefined;
  if (!assignment || assignment.phase !== "scouting" || assignment.targetRoom !== room.name) return false;

  const controller = room.controller;
  const sources = room.find(FIND_SOURCES);
  memory.intel[room.name] = {
    roomName: room.name,
    lastSeen: Game.time,
    owner: controller?.owner?.username || null,
    reservation: controller?.reservation?.username || null,
    controller: !!controller,
    sources: sources.length,
    sourceIds: sources.map(source => source.id),
    keeperLairs:
      room.find(FIND_STRUCTURES, {
        filter: structure => structure.structureType === STRUCTURE_KEEPER_LAIR
      }).length > 0,
    hostileCreeps: room.find(FIND_HOSTILE_CREEPS).length,
    layout: findBestExpansionLayout(room) || undefined
  };
  assignment.updatedAt = Game.time;
  return true;
}

export function isExpansionTargetAssigned(targetRoom: string): boolean {
  const assignment = ensureExpansionMemory().assignments[targetRoom];
  return !!assignment && assignment.phase !== "failed";
}

export function isExpansionAssignmentInPhase(targetRoom: string | null | undefined, phase: ExpansionPhase): boolean {
  if (!targetRoom) return false;
  return ensureExpansionMemory().assignments[targetRoom]?.phase === phase;
}
