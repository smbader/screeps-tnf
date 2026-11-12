import type { QuadMember } from "./QuadController";
import { summarizeCreep } from "./SiegeScanner";

const RANGED_ATTACK_RANGE = 3;

export function findStructureAt(room: Room, x: number, y: number): Structure | null {
  const structures = room
    .lookForAt(LOOK_STRUCTURES, x, y)
    .filter(structure => structure.structureType !== STRUCTURE_ROAD && structure.structureType !== STRUCTURE_CONTAINER);
  return (
    structures.find(structure => structure.structureType === STRUCTURE_RAMPART) ||
    structures.find(structure => structure.structureType !== STRUCTURE_CONTROLLER) ||
    null
  );
}

// Both supports heal the member with the largest unhealed deficit; when nobody is hurt they pre-heal the weakest.
export function healMembers(members: QuadMember[]): void {
  const deficits = new Map<string, number>();
  for (const member of members) deficits.set(member.creep.name, member.creep.hitsMax - member.creep.hits);

  for (const healer of members) {
    if (healer.creep.getActiveBodyparts(HEAL) <= 0) continue;
    const reachable = members.filter(member => healer.creep.pos.getRangeTo(member.creep) <= 1);
    if (!reachable.length) continue;

    let target = reachable[0];
    for (const candidate of reachable) {
      const candidateDeficit = deficits.get(candidate.creep.name) || 0;
      const targetDeficit = deficits.get(target.creep.name) || 0;
      if (
        candidateDeficit > targetDeficit ||
        (candidateDeficit === targetDeficit && candidate.creep.hits < target.creep.hits)
      ) {
        target = candidate;
      }
    }
    if (healer.creep.heal(target.creep) === OK) {
      deficits.set(
        target.creep.name,
        (deficits.get(target.creep.name) || 0) - summarizeCreep(healer.creep).healPerTick
      );
    }
  }
}

export function getCreepThreatScore(creep: Creep): number {
  const summary = summarizeCreep(creep);
  return summary.healPerTick * 10 + summary.attackDps + summary.rangedDps;
}

export function isArmed(creep: Creep): boolean {
  return getCreepThreatScore(creep) > 0;
}

export function chooseCreepFocus(hostiles: Creep[], members: QuadMember[]): Creep | null {
  let best: Creep | null = null;
  for (const hostile of hostiles) {
    if (!isArmed(hostile)) continue;
    if (!members.some(member => member.creep.pos.getRangeTo(hostile) <= RANGED_ATTACK_RANGE)) continue;
    if (
      !best ||
      getCreepThreatScore(hostile) > getCreepThreatScore(best) ||
      (getCreepThreatScore(hostile) === getCreepThreatScore(best) && hostile.hits < best.hits)
    ) {
      best = hostile;
    }
  }
  return best;
}

// Everyone fires on the shared focus when in range; otherwise on the best hostile creep or fallback target in reach.
export function attackWithMembers(
  members: QuadMember[],
  focus: Creep | Structure | null,
  hostiles: Creep[],
  fallbackTargets: Structure[],
  onAttack?: (creep: Creep, action: string, result: number) => void
): void {
  for (const member of members) {
    const creep = member.creep;
    if (creep.getActiveBodyparts(RANGED_ATTACK) <= 0) continue;

    const nearbyHostiles = hostiles.filter(hostile => creep.pos.getRangeTo(hostile) <= RANGED_ATTACK_RANGE);
    if (nearbyHostiles.length >= 3 && !(focus && creep.pos.getRangeTo(focus) <= RANGED_ATTACK_RANGE)) {
      const result = creep.rangedMassAttack();
      if (onAttack) onAttack(creep, "mass attack", result);
      continue;
    }

    let target: Creep | Structure | undefined;
    if (focus && creep.pos.getRangeTo(focus) <= RANGED_ATTACK_RANGE) target = focus;
    if (!target) {
      target = nearbyHostiles.sort((left, right) => getCreepThreatScore(right) - getCreepThreatScore(left))[0];
    }
    if (!target) {
      target = fallbackTargets.find(structure => creep.pos.getRangeTo(structure) <= RANGED_ATTACK_RANGE);
    }
    if (target) {
      const result = creep.rangedAttack(target);
      if (onAttack) onAttack(creep, `ranged attack ${target.id}`, result);
    }
  }
}
