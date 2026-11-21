import { SmallSiege } from "./SmallSiege";
import { QUAD_SLOTS } from "./SiegeTypes";
import { recordSiegeEvent } from "./SiegeDiagnostics";
import type { ProbeWaveMemory, SiegeMemory, SiegeOptions } from "./SiegeTypes";

export class ProbeSiege {
  private readonly siege = new SmallSiege();

  public update(memory: SiegeMemory, options: SiegeOptions): void {
    if (["ABORTED", "COMPLETE"].includes(memory.phase)) return;
    memory.wave = memory.wave || 1;
    memory.probeWaves = (memory.probeWaves || []).filter(wave => {
      if (this.living(wave).length) return true;
      recordSiegeEvent(memory.id, "probe-wave-ended", { wave: wave.wave, members: wave.members });
      return false;
    });
    const living = this.living(memory);
    const active = living.filter(creep => !creep.spawning);
    const legacyDeployment =
      memory.probeLaunched === undefined &&
      ["TRANSIT", "GATHERING", "STAGING", "ADVANCING", "ASSAULT", "RETREATING"].includes(memory.phase);
    if (
      !memory.probeLaunched &&
      (active.length === 4 || (legacyDeployment && Object.keys(memory.members).length === 4))
    ) {
      memory.probeLaunched = true;
      recordSiegeEvent(memory.id, "probe-wave-launched", { wave: memory.wave, members: memory.members });
    }
    if (memory.probeLaunched && living.length <= 2 && !memory.spawnsCleared) {
      const previous = this.saveWave(memory, memory.wave);
      if (living.length) memory.probeWaves.push(previous);
      recordSiegeEvent(memory.id, "probe-wave-handoff", {
        wave: memory.wave,
        survivors: living.map(creep => creep.name),
        nextWave: memory.wave + 1
      });
      memory.wave++;
      memory.members = {};
      memory.probe = undefined;
      memory.drainAnchor = undefined;
      memory.probeLaunched = false;
      memory.phase = "PREPARING";
      memory.phaseSince = Game.time;
      memory.retreatReason = undefined;
    }
    this.siege.update(
      memory,
      options,
      memory.probeWaves.map(wave => wave.probe).filter((probe): probe is NonNullable<typeof probe> => !!probe)
    );
    for (const wave of memory.probeWaves) {
      const context = this.context(memory, wave);
      const reserved = [
        memory.probe,
        ...memory.probeWaves.filter(other => other !== wave).map(other => other.probe)
      ].filter((probe): probe is NonNullable<typeof probe> => !!probe);
      this.siege.update(context, options, reserved);
      Object.assign(wave, this.saveWave(context, wave.wave));
    }
    if (memory.phase === "COMPLETE" && memory.probeWaves.length) memory.phase = "CLEANUP";
  }

  public supply(memory: SiegeMemory, options: SiegeOptions): void {
    this.siege.supply(memory, options);
  }

  public control(memory: SiegeMemory, options: SiegeOptions): void {
    for (const wave of memory.probeWaves || []) {
      const context = this.context(memory, wave);
      this.siege.control(context, options, true);
      Object.assign(wave, this.saveWave(context, wave.wave));
    }
    this.siege.control(memory, options, !!memory.probeLaunched);
    if (!this.living(memory).length && memory.probeWaves?.length && !memory.status) {
      memory.status = "older probe waves active; assembling next wave";
    }
  }

  private living(memory: Pick<SiegeMemory, "members">): Creep[] {
    return QUAD_SLOTS.map(slot => Game.creeps[memory.members[slot]?.name || ""]).filter(Boolean);
  }

  private context(memory: SiegeMemory, wave: ProbeWaveMemory): SiegeMemory {
    return {
      ...wave,
      id: memory.id,
      targetRoom: memory.targetRoom,
      attempt: 0,
      snapshot: memory.snapshot,
      spawnsCleared: memory.spawnsCleared,
      probeLaunched: true
    };
  }

  private saveWave(memory: SiegeMemory, wave: number): ProbeWaveMemory {
    return {
      wave,
      phase: memory.phase,
      phaseSince: memory.phaseSince,
      members: memory.members,
      probe: memory.probe,
      drainAnchor: memory.drainAnchor,
      status: memory.status,
      retreatReason: memory.retreatReason
    };
  }
}
