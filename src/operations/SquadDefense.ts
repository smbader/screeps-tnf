import { Operation } from "../classes/operation";

export type SquadSlot = "M1" | "M2" | "H1" | "H2";
// GATHER: marching to / waiting at the staging room. ACTIVE: advancing on the objective and fighting.
type SquadPhase = "GATHER" | "ACTIVE";

const SLOTS: SquadSlot[] = ["H1", "H2", "M1", "M2"];

export interface SquadDefenseTarget {
  id: string;
  // Room to protect. Teams fight here first.
  room: string;
  // Number of squads (2 melee + 2 healers each).
  teams: number;
  // Once the room is secure, send the last team to clear surrounding rooms.
  sweepNeighbors?: boolean;
  enabled?: boolean;
  // Optional owned room to spawn from; otherwise nearest capable room.
  homeRoom?: string;
}

export const SQUAD_DEFENSE_POLICY = {
  enabled: false,
  targets: [{ id: "E33S1", room: "E33S1", teams: 1, sweepNeighbors: true }] as SquadDefenseTarget[],
  // Ticks with no hostiles before a room counts as secure.
  secureTicks: 10,
  // Only hostiles inside the target room or within this many tiles of it are engaged or chased.
  targetFocusRange: 20,
  // Start spawning the replacement wave when the current wave's oldest member has this many ticks left.
  replacementLeadTicks: 500,
  // Rooms between the staging room and the objective room.
  stagingDistance: 2,
  stagingRange: 5
};

function repeatPart(part: BodyPartConstant, count: number): BodyPartConstant[] {
  return new Array<BodyPartConstant>(count).fill(part);
}

// Every body keeps one MOVE per other part so the squad never builds fatigue on plains or roads.
const MELEE_BODY: BodyPartConstant[] = [...repeatPart(ATTACK, 25), ...repeatPart(MOVE, 25)];
const HEALER_BODY: BodyPartConstant[] = [
  ...repeatPart(MOVE, 25),
  ...repeatPart(RANGED_ATTACK, 2),
  ...repeatPart(HEAL, 23)
];

const MASS_ATTACK_DAMAGE = [0, 10, 4, 1];

function worldCoords(pos: RoomPosition): { x: number; y: number } | null {
  const match = /^([EW])(\d+)([NS])(\d+)$/.exec(pos.roomName);
  if (!match) return null;
  const rx = Number(match[2]);
  const ry = Number(match[4]);
  return {
    x: match[1] === "E" ? rx * 50 + pos.x : -(rx + 1) * 50 + pos.x,
    y: match[3] === "S" ? ry * 50 + pos.y : -(ry + 1) * 50 + pos.y
  };
}

// True when the position is inside the target room or within `targetFocusRange` tiles of its border.
function isNearTarget(pos: RoomPosition, targetRoom: string): boolean {
  if (pos.roomName === targetRoom) return true;
  const a = worldCoords(pos);
  const min = worldCoords(new RoomPosition(0, 0, targetRoom));
  if (!a || !min) return false;
  const dx = Math.max(min.x - a.x, 0, a.x - (min.x + 49));
  const dy = Math.max(min.y - a.y, 0, a.y - (min.y + 49));
  return Math.max(dx, dy) <= SQUAD_DEFENSE_POLICY.targetFocusRange;
}

function isHealerSlot(slot: SquadSlot): boolean {
  return slot.startsWith("H");
}

function bodyFor(slot: SquadSlot): BodyPartConstant[] {
  return isHealerSlot(slot) ? HEALER_BODY : MELEE_BODY;
}

function costOf(body: BodyPartConstant[]): number {
  return body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
}

interface SquadTeamMemory {
  key: string;
  targetId: string;
  index: number;
  // Wave number for this slot; 0 is the original squad, higher numbers are replacements.
  gen?: number;
  phase: SquadPhase;
  // True once every slot of this wave has been spawned. The wave is only replaced after the whole squad is dead.
  deployed?: boolean;
  members: Partial<Record<SquadSlot, string>>;
  rallyRoom?: string;
  stagingRoom?: string;
  stagingFor?: string;
  quietSince?: number;
  sweepQueue?: string[];
  sweepIndex?: number;
  sweepQuiet?: number;
  status?: string;
}

interface SquadRoot {
  teams: Record<string, SquadTeamMemory>;
}

interface Member {
  slot: SquadSlot;
  creep: Creep;
}

function getRoot(): SquadRoot {
  const mem = Memory as unknown as { squadDefense?: SquadRoot };
  if (!mem.squadDefense) mem.squadDefense = { teams: {} };
  return mem.squadDefense;
}

function isKeeper(creep: Creep): boolean {
  return !!creep.owner && creep.owner.username === "Source Keeper";
}

function isThreat(creep: Creep): boolean {
  if (isKeeper(creep)) return false;
  return creep.body.some(p => p.hits > 0 && (p.type === ATTACK || p.type === RANGED_ATTACK || p.type === HEAL));
}

function isSourceKeeperRoom(roomName: string): boolean {
  const match = /^[EW](\d+)[NS](\d+)$/.exec(roomName);
  if (!match) return false;
  const x = Number(match[1]) % 10;
  const y = Number(match[2]) % 10;
  return x >= 4 && x <= 6 && y >= 4 && y <= 6 && !(x === 5 && y === 5);
}

export class SquadDefense extends Operation {
  public init(): void {
    if (!SQUAD_DEFENSE_POLICY.enabled) return;
    for (const target of SQUAD_DEFENSE_POLICY.targets) {
      if (target.enabled === false) continue;
      const teams = this.teamsFor(target);
      for (const team of teams) {
        const newest = this.newestAt(teams, team.index);
        if (team !== newest) {
          // An older wave is only dropped once it is completely gone and its successor exists.
          if (this.isGone(team)) delete getRoot().teams[team.key];
        } else {
          this.resetIfWiped(team);
        }
      }
      this.scheduleSuccessors(target, this.teamsFor(target));
    }
  }

  public roleCall(): void {
    if (!SQUAD_DEFENSE_POLICY.enabled) return;
    for (const target of SQUAD_DEFENSE_POLICY.targets) {
      if (target.enabled === false) continue;
      // Build teams one at a time so they don't starve each other of spawn energy.
      for (const team of this.teamsFor(target)) {
        this.adoptOrphans(team);
        if (!this.spawnMissing(target, team)) break;
      }
    }
  }

  public actions(): void {
    if (!SQUAD_DEFENSE_POLICY.enabled) return;
    for (const target of SQUAD_DEFENSE_POLICY.targets) {
      if (target.enabled === false) continue;
      for (const team of this.teamsFor(target)) {
        try {
          this.runTeam(target, team);
        } catch (error) {
          console.log(`[SquadDefense ${team.key}] error: ${String(error)}`);
        }
      }
    }
  }

  // ---------------------------------------------------------------- state

  private getTeam(target: SquadDefenseTarget, index: number, gen = 0): SquadTeamMemory {
    const root = getRoot();
    const key = gen === 0 ? `${target.id}:${index}` : `${target.id}:${index}:g${gen}`;
    if (!root.teams[key]) {
      root.teams[key] = { key, targetId: target.id, index, gen, phase: "GATHER", members: {} };
    }
    return root.teams[key];
  }

  // All waves for a target (every slot always has at least one), oldest first.
  private teamsFor(target: SquadDefenseTarget): SquadTeamMemory[] {
    const root = getRoot();
    for (let i = 0; i < target.teams; i++) {
      if (!Object.values(root.teams).some(t => t.targetId === target.id && t.index === i)) this.getTeam(target, i);
    }
    return Object.values(root.teams)
      .filter(t => t.targetId === target.id && t.index < target.teams)
      .sort((a, b) => (a.gen || 0) - (b.gen || 0) || a.index - b.index);
  }

  private newestAt(teams: SquadTeamMemory[], index: number): SquadTeamMemory | undefined {
    const atIndex = teams.filter(t => t.index === index);
    return atIndex[atIndex.length - 1];
  }

  private isGone(team: SquadTeamMemory): boolean {
    return !!team.deployed && !SLOTS.some(slot => team.members[slot] && Game.creeps[team.members[slot] as string]);
  }

  // Starts the next wave early so it arrives before the current one expires.
  private scheduleSuccessors(target: SquadDefenseTarget, teams: SquadTeamMemory[]): void {
    for (let i = 0; i < target.teams; i++) {
      const newest = this.newestAt(teams, i);
      if (!newest || !newest.deployed) continue;
      const ttls = SLOTS.map(slot => {
        const name = newest.members[slot];
        return name ? Game.creeps[name]?.ticksToLive : undefined;
      }).filter((ttl): ttl is number => ttl !== undefined);
      if (!ttls.length || Math.min(...ttls) > SQUAD_DEFENSE_POLICY.replacementLeadTicks) continue;
      const next = this.getTeam(target, i, (newest.gen || 0) + 1);
      next.status = `successor wave queued (oldest member ${Math.min(...ttls)} ticks left)`;
      console.log(`[SquadDefense ${next.key}] spawning replacement wave for ${newest.key}.`);
    }
  }

  // The whole squad is gone: start a completely new wave.
  private resetIfWiped(team: SquadTeamMemory): void {
    if (!team.deployed) return;
    if (SLOTS.some(slot => team.members[slot] && Game.creeps[team.members[slot] as string])) return;
    team.deployed = false;
    team.phase = "GATHER";
    team.members = {};
    team.quietSince = undefined;
    team.sweepQueue = undefined;
    team.sweepIndex = undefined;
    team.sweepQuiet = undefined;
    team.status = "squad wiped; respawning the whole group";
    console.log(`[SquadDefense ${team.key}] squad wiped; respawning the whole group.`);
  }

  private adoptOrphans(team: SquadTeamMemory): void {
    for (const creep of Object.values(Game.creeps)) {
      const m = creep.memory;
      if (m.role !== "squadDefense" || m.squadKey !== team.key || !m.squadSlot) continue;
      const known = team.members[m.squadSlot];
      if (known && Game.creeps[known]) continue;
      team.members[m.squadSlot] = creep.name;
    }
  }

  private liveMembers(team: SquadTeamMemory): Member[] {
    const result: Member[] = [];
    for (const slot of SLOTS) {
      const name = team.members[slot];
      const creep = name ? Game.creeps[name] : undefined;
      if (creep && !creep.spawning) result.push({ slot, creep });
    }
    return result;
  }

  // Returns true when the wave is fully spawned (so the next team may start).
  private spawnMissing(target: SquadDefenseTarget, team: SquadTeamMemory): boolean {
    if (team.deployed) return true;
    const missing = SLOTS.filter(candidate => {
      const existing = team.members[candidate];
      return !(existing && Game.creeps[existing]);
    });
    if (!missing.length) {
      team.deployed = true;
      return true;
    }

    // Spawn the healers first since they are the most expensive and gate the whole squad.
    missing.sort((a, b) => Number(isHealerSlot(b)) - Number(isHealerSlot(a)));
    const slot = missing[0];
    const body = bodyFor(slot);
    const cost = costOf(body);

    const rooms = Object.values(Game.rooms)
      .filter(r => r.controller?.my && r.energyCapacityAvailable >= cost && r.find(FIND_MY_SPAWNS).length > 0)
      .filter(r => !target.homeRoom || r.name === target.homeRoom)
      .sort(
        (a, b) =>
          Game.map.getRoomLinearDistance(a.name, target.room) - Game.map.getRoomLinearDistance(b.name, target.room)
      );
    if (!rooms.length) {
      team.status = `no owned room can afford ${slot} (${cost} energy)`;
      return false;
    }

    const room = (team.rallyRoom && rooms.find(r => r.name === team.rallyRoom)) || rooms[0];
    if (room.energyAvailable < cost) {
      team.status = `waiting for ${slot} in ${room.name}: ${room.energyAvailable}/${cost}`;
      return false;
    }
    const spawn = room.find(FIND_MY_SPAWNS).find(s => !s.spawning);
    if (!spawn) {
      team.status = `waiting for ${slot}: spawns busy in ${room.name}`;
      return false;
    }

    const name = `squad_${team.key}_${slot}_${Game.time}`;
    const result = spawn.spawnCreep(body, name, {
      memory: { role: "squadDefense", squadKey: team.key, squadSlot: slot, room: room.name }
    });
    if (result === OK) {
      team.members[slot] = name;
      team.rallyRoom = room.name;
      team.status = `spawning ${slot} in ${room.name}`;
      if (missing.length === 1) team.deployed = true;
    }
    return false;
  }

  // -------------------------------------------------------------- control

  private runTeam(target: SquadDefenseTarget, team: SquadTeamMemory): void {
    const members = this.liveMembers(team);
    if (!members.length) return;

    const targetView = Game.rooms[target.room];
    const targetThreats = targetView ? targetView.find(FIND_HOSTILE_CREEPS).filter(isThreat) : [];
    // Until the target room has been seen clear, it outranks everything else: no chasing, no sweeping.
    const secured = team.quietSince !== undefined && Game.time - team.quietSince >= SQUAD_DEFENSE_POLICY.secureTicks;
    const rush = targetThreats.length > 0 || (!targetView && !secured);

    const hostiles = rush
      ? targetThreats
      : this.visibleThreats(members).filter(h => isNearTarget(h.pos, target.room));

    if (team.phase !== "ACTIVE") {
      // Pre-deployment: trickle toward staging; once the whole squad exists, nothing stops it reaching the target.
      if (!team.deployed) {
        this.march(members, this.stagingRoom(target, team));
        this.combat(members, undefined, "");
        return;
      }
      team.phase = "ACTIVE";
    }

    const objective = rush ? target.room : this.objectiveRoom(target, team, members);
    // Fighting only ever happens in the room the squad is working on, never along the way.
    const roomHostiles = hostiles.filter(h => h.pos.roomName === objective);
    const focus = this.pickFocus(members, roomHostiles, objective);
    this.combat(members, focus, objective);

    const arrived = (m: Member) => m.creep.pos.roomName === objective && !this.onEdge(m.creep.pos);
    if (!members.every(arrived)) {
      // Keep moving until everyone is inside the objective room.
      const center = new RoomPosition(25, 25, objective);
      for (const m of members) {
        if (!arrived(m)) m.creep.travelTo(center, { range: 20, allowHostile: true });
      }
      return;
    }
    this.advance(target, team, members, roomHostiles, focus, rush, objective);
  }

  // A room `stagingDistance` rooms before the target along the route from the spawn room.
  private stagingRoom(target: SquadDefenseTarget, team: SquadTeamMemory): string {
    const from = team.rallyRoom;
    if (!from) return target.room;
    if (team.stagingRoom && team.stagingFor === `${from}>${target.room}`) return team.stagingRoom;

    let room = from;
    const route = Game.map.findRoute(from, target.room);
    if (Array.isArray(route)) {
      const index = route.length - 1 - SQUAD_DEFENSE_POLICY.stagingDistance;
      if (index >= 0) room = route[index].room;
    }
    team.stagingRoom = room;
    team.stagingFor = `${from}>${target.room}`;
    return room;
  }

  // Leave the base the moment a creep spawns and head for the staging room.
  private march(members: Member[], stagingRoom: string): void {
    const center = new RoomPosition(25, 25, stagingRoom);
    for (const m of members) {
      const arrived =
        m.creep.pos.roomName === stagingRoom && m.creep.pos.getRangeTo(center) <= SQUAD_DEFENSE_POLICY.stagingRange;
      if (!arrived) m.creep.travelTo(center, { range: SQUAD_DEFENSE_POLICY.stagingRange });
    }
  }

  private assembled(members: Member[], stagingRoom: string): boolean {
    const lead = members[0].creep;
    return members.every(
      m => m.creep.pos.roomName === stagingRoom && m.creep.pos.getRangeTo(lead) <= 8 && !this.onEdge(m.creep.pos)
    );
  }

  private onEdge(pos: RoomPosition): boolean {
    return pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49;
  }

  // The squad moves every tick: melee push toward the focus or objective, healers shadow their melee partner.
  private advance(
    target: SquadDefenseTarget,
    team: SquadTeamMemory,
    members: Member[],
    hostiles: Creep[],
    focus: Creep | undefined,
    rush: boolean,
    objectiveRoom: string
  ): void {
    const melee = members.filter(m => !isHealerSlot(m.slot));
    const healers = members.filter(m => isHealerSlot(m.slot));
    const advancing = new Set<string>();

    if (focus) {
      this.noteClear(team, false);
      for (const m of melee) {
        if (m.creep.pos.getRangeTo(focus) > 1) {
          m.creep.travelTo(focus.pos, { range: 1, allowHostile: true });
          advancing.add(m.creep.name);
        }
      }
    } else {
      // Only count the room as quiet when we can actually see the target room.
      if (!rush && Game.rooms[target.room]) this.noteClear(team, true);
      const objective = new RoomPosition(25, 25, objectiveRoom);
      for (const m of melee) {
        if (m.creep.pos.roomName !== objective.roomName || m.creep.pos.getRangeTo(objective) > 20) {
          m.creep.travelTo(objective, { range: 20 });
          advancing.add(m.creep.name);
        }
      }
      if (!melee.length) {
        for (const m of healers) {
          if (m.creep.pos.roomName !== objective.roomName || m.creep.pos.getRangeTo(objective) > 20) {
            m.creep.travelTo(objective, { range: 20 });
          }
        }
        return;
      }
    }

    for (const healer of healers) this.followPartner(healer, melee, advancing, focus, hostiles.length > 0);
  }

  private partnerFor(healer: Member, melee: Member[]): Member | undefined {
    const wanted = `M${healer.slot.slice(1)}`;
    const own = melee.find(m => m.slot === wanted);
    if (own) return own;
    return melee.sort((a, b) => healer.creep.pos.getRangeTo(a.creep) - healer.creep.pos.getRangeTo(b.creep))[0];
  }

  private followPartner(
    healer: Member,
    melee: Member[],
    advancing: Set<string>,
    focus: Creep | undefined,
    fighting: boolean
  ): void {
    const partner = this.partnerFor(healer, melee);
    if (!partner) {
      if (fighting && focus) healer.creep.travelTo(focus.pos, { range: 3, allowHostile: true });
      return;
    }
    if (healer.creep.pos.getRangeTo(partner.creep) > 1) {
      healer.creep.travelTo(partner.creep.pos, { range: 1, allowHostile: true });
    } else if (advancing.has(partner.creep.name)) {
      // Step into the tile the partner is leaving so the pair stays touching.
      healer.creep.move(healer.creep.pos.getDirectionTo(partner.creep.pos));
    }
  }

  // Decides which room this team should be in: the protected room until it's secure, then sweep neighbours.
  private objectiveRoom(target: SquadDefenseTarget, team: SquadTeamMemory, members: Member[]): string {
    const roomName = members[0].creep.pos.roomName;
    const secure = team.quietSince !== undefined && Game.time - team.quietSince >= SQUAD_DEFENSE_POLICY.secureTicks;
    const sweeper = target.sweepNeighbors && team.index === target.teams - 1;
    if (!sweeper || (roomName === target.room && !secure)) return target.room;
    if (!team.sweepQueue) {
      const exits = Game.map.describeExits(target.room) || {};
      team.sweepQueue = Object.values(exits).filter(
        (name): name is string =>
          !!name && !isSourceKeeperRoom(name) && Game.map.getRoomStatus(name).status === "normal"
      );
      team.sweepIndex = 0;
    }

    const queue = team.sweepQueue;
    let index = team.sweepIndex || 0;
    if (index >= queue.length) return target.room;
    const current = queue[index];

    if (roomName === current) {
      const room = members[0].creep.room;
      const hostileOwned = room.controller && room.controller.owner && !room.controller.my;
      team.sweepQuiet = (team.sweepQuiet || 0) + 1;
      if (hostileOwned || team.sweepQuiet >= SQUAD_DEFENSE_POLICY.secureTicks) {
        team.sweepIndex = index + 1;
        team.sweepQuiet = 0;
        index = team.sweepIndex;
        if (index >= queue.length) {
          team.sweepQueue = undefined;
          return target.room;
        }
        return queue[index];
      }
    }
    return current;
  }

  private noteClear(team: SquadTeamMemory, clear: boolean): void {
    if (!clear) {
      team.quietSince = undefined;
      return;
    }
    if (team.quietSince === undefined) team.quietSince = Game.time;
  }

  private visibleThreats(members: Member[]): Creep[] {
    const rooms = new Set(members.map(m => m.creep.pos.roomName));
    const hostiles: Creep[] = [];
    for (const name of rooms) {
      const room = Game.rooms[name];
      if (room) hostiles.push(...room.find(FIND_HOSTILE_CREEPS).filter(isThreat));
    }
    return hostiles;
  }

  // ---------------------------------------------------------------- combat

  // Shared focus: enemies inside the target room always come first, then healers, then closest.
  private pickFocus(members: Member[], hostiles: Creep[], targetRoom: string): Creep | undefined {
    if (!hostiles.length) return undefined;
    const lead = (members.find(m => !isHealerSlot(m.slot)) || members[0]).creep;
    const inTarget = hostiles.filter(h => h.pos.roomName === targetRoom);
    const sameRoom = hostiles.filter(h => h.pos.roomName === lead.pos.roomName);
    const pool = inTarget.length ? inTarget : sameRoom.length ? sameRoom : hostiles;
    return [...pool].sort((a, b) => {
      const ha = a.getActiveBodyparts(HEAL) > 0 ? 0 : 1;
      const hb = b.getActiveBodyparts(HEAL) > 0 ? 0 : 1;
      if (ha !== hb) return ha - hb;
      return lead.pos.getRangeTo(a) - lead.pos.getRangeTo(b);
    })[0];
  }

  // Melee and ranged attacks only happen in `fightRoom`; healing runs everywhere.
  private combat(members: Member[], focus: Creep | undefined, fightRoom: string): void {
    for (const m of members) {
      const canFight = m.creep.pos.roomName === fightRoom;
      if (isHealerSlot(m.slot)) this.healerActions(m, members, canFight ? focus : undefined, canFight);
      else if (canFight) this.meleeAttack(m.creep, focus);
    }
  }

  private meleeAttack(creep: Creep, focus: Creep | undefined): void {
    const adjacent = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1).filter(h => !isKeeper(h));
    if (!adjacent.length) return;
    const preferred = (focus && adjacent.find(h => h.id === focus.id)) || adjacent.sort((a, b) => a.hits - b.hits)[0];
    creep.attack(preferred);
  }

  // Heals every tick (pre-healing the partner when nobody is hurt) and spends the ranged parts on enemies.
  private healerActions(healer: Member, members: Member[], focus: Creep | undefined, attack: boolean): void {
    const creep = healer.creep;
    const partnerSlot = `M${healer.slot.slice(1)}`;
    const allies = members
      .filter(m => m.creep.pos.getRangeTo(creep) <= 3)
      .sort((a, b) => {
        const fa = a.creep.hits / a.creep.hitsMax;
        const fb = b.creep.hits / b.creep.hitsMax;
        if (fa !== fb) return fa - fb;
        return Number(b.slot === partnerSlot) - Number(a.slot === partnerSlot);
      });
    const patient = allies[0]?.creep;
    let ranged = false;
    if (patient) {
      if (creep.pos.getRangeTo(patient) <= 1) {
        creep.heal(patient);
      } else if (patient.hits < patient.hitsMax) {
        creep.rangedHeal(patient);
        ranged = true;
        const adjacentAlly = allies.find(m => m.creep.pos.getRangeTo(creep) <= 1);
        if (adjacentAlly) creep.heal(adjacentAlly.creep);
      }
    }
    if (!ranged && attack) this.rangedAttack(creep, focus);
  }

  private rangedAttack(creep: Creep, focus: Creep | undefined): void {
    const parts = creep.getActiveBodyparts(RANGED_ATTACK);
    if (parts === 0) return;
    const inRange = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3).filter(h => !isKeeper(h));
    if (!inRange.length) return;

    const massDamage = inRange.reduce((sum, h) => sum + MASS_ATTACK_DAMAGE[creep.pos.getRangeTo(h)], 0) * parts;
    if (inRange.length > 1 && massDamage > 10 * parts) {
      creep.rangedMassAttack();
      return;
    }
    const targetCreep = (focus && inRange.find(h => h.id === focus.id)) || inRange.sort((a, b) => a.hits - b.hits)[0];
    creep.rangedAttack(targetCreep);
  }
}
