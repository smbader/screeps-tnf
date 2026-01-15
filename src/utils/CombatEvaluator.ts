/**
 * CombatEvaluator: Utility for evaluating combat scenarios and determining if an attack is winnable
 */

interface SquadStats {
  totalHits: number;
  maxHits: number;
  attackPower: number;
  healPower: number;
  rangedAttackPower: number;
  creepCount: number;
}

interface EnemyForces {
  towerCount: number;
  towerEnergy: number;
  towerDamage: number;
  defenderCount: number;
  defenderAttackPower: number;
  defenderHealPower: number;
  wallHits: number;
  rampartHits: number;
}

interface EvaluationResult {
  isWinnable: boolean;
  confidence: number; // 0-1 scale
  reasoning: string[];
  advantageScore: number; // positive means advantage, negative means disadvantage
}

export class CombatEvaluator {
  // Damage constants
  private static readonly TOWER_DAMAGE_MAX = 600;
  private static readonly TOWER_DAMAGE_MIN = 150;
  private static readonly TOWER_RANGE_MAX = 20;
  private static readonly TOWER_ENERGY_PER_SHOT = 10;

  // Boost multipliers
  private static readonly BOOST_MULTIPLIERS: { [key: string]: number } = {
    // Tier 1
    [RESOURCE_UTRIUM_HYDRIDE]: 2,
    [RESOURCE_KEANIUM_OXIDE]: 2,
    [RESOURCE_LEMERGIUM_OXIDE]: 2,
    [RESOURCE_ZYNTHIUM_OXIDE]: 2,
    [RESOURCE_GHODIUM_OXIDE]: 2,
    // Tier 2
    [RESOURCE_UTRIUM_ACID]: 3,
    [RESOURCE_KEANIUM_ALKALIDE]: 3,
    [RESOURCE_LEMERGIUM_ALKALIDE]: 3,
    [RESOURCE_ZYNTHIUM_ALKALIDE]: 3,
    [RESOURCE_GHODIUM_ALKALIDE]: 3,
    // Tier 3
    [RESOURCE_CATALYZED_UTRIUM_ACID]: 4,
    [RESOURCE_CATALYZED_KEANIUM_ALKALIDE]: 4,
    [RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE]: 4,
    [RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE]: 4,
    [RESOURCE_CATALYZED_GHODIUM_ALKALIDE]: 4
  };

  /**
   * Calculate statistics for a squad of creeps
   */
  static calculateSquadStats(creeps: Creep[]): SquadStats {
    const stats: SquadStats = {
      totalHits: 0,
      maxHits: 0,
      attackPower: 0,
      healPower: 0,
      rangedAttackPower: 0,
      creepCount: creeps.length
    };

    for (const creep of creeps) {
      stats.totalHits += creep.hits;
      stats.maxHits += creep.hitsMax;

      for (const part of creep.body) {
        if (part.hits === 0) continue;

        const boost = part.boost;
        const multiplier = boost ? this.BOOST_MULTIPLIERS[boost] || 1 : 1;

        switch (part.type) {
          case ATTACK:
            stats.attackPower += 30 * multiplier;
            break;
          case RANGED_ATTACK:
            stats.rangedAttackPower += 10 * multiplier;
            break;
          case HEAL:
            stats.healPower += 12 * multiplier;
            break;
        }
      }
    }

    return stats;
  }

  /**
   * Calculate enemy forces in a target room
   */
  static calculateEnemyForces(room: Room): EnemyForces {
    const forces: EnemyForces = {
      towerCount: 0,
      towerEnergy: 0,
      towerDamage: 0,
      defenderCount: 0,
      defenderAttackPower: 0,
      defenderHealPower: 0,
      wallHits: 0,
      rampartHits: 0
    };

    // Calculate tower forces
    const towers = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER
    }) as StructureTower[];

    for (const tower of towers) {
      forces.towerCount++;
      forces.towerEnergy += tower.store[RESOURCE_ENERGY] || 0;
      // Assume average damage (mid-range)
      forces.towerDamage += this.TOWER_DAMAGE_MAX * 0.6;
    }

    // Calculate defender forces
    const defenders = room.find(FIND_HOSTILE_CREEPS);
    forces.defenderCount = defenders.length;

    for (const defender of defenders) {
      for (const part of defender.body) {
        if (part.hits === 0) continue;

        const boost = part.boost;
        const multiplier = boost ? this.BOOST_MULTIPLIERS[boost] || 1 : 1;

        switch (part.type) {
          case ATTACK:
            forces.defenderAttackPower += 30 * multiplier;
            break;
          case RANGED_ATTACK:
            forces.defenderAttackPower += 10 * multiplier;
            break;
          case HEAL:
            forces.defenderHealPower += 12 * multiplier;
            break;
        }
      }
    }

    // Calculate wall/rampart hits (find weakest path through)
    const walls = room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART
    });

    if (walls.length > 0) {
      // Sample walls to estimate average fortification
      const sampleSize = Math.min(10, walls.length);
      let totalHits = 0;
      for (let i = 0; i < sampleSize; i++) {
        totalHits += walls[i].hits;
      }
      const avgHits = totalHits / sampleSize;

      // Estimate total hits needed to breach (assume need to break through ~3 walls)
      forces.wallHits = avgHits * 3;

      // Calculate rampart hits separately (also sample-based for consistency)
      const ramparts = walls.filter(s => s.structureType === STRUCTURE_RAMPART);
      if (ramparts.length > 0) {
        const rampartSample = Math.min(5, ramparts.length);
        let totalRampartHits = 0;
        for (let i = 0; i < rampartSample; i++) {
          totalRampartHits += ramparts[i].hits;
        }
        forces.rampartHits = (totalRampartHits / rampartSample) * 2; // Estimate 2 ramparts to breach
      }
    }

    return forces;
  }

  /**
   * Evaluate if an attack is winnable
   */
  static evaluateAttack(squadCreeps: Creep[], targetRoom: Room): EvaluationResult {
    const squadStats = this.calculateSquadStats(squadCreeps);
    const enemyForces = this.calculateEnemyForces(targetRoom);

    const reasoning: string[] = [];
    let advantageScore = 0;

    // Check if squad exists
    if (squadStats.creepCount === 0) {
      return {
        isWinnable: false,
        confidence: 1.0,
        reasoning: ["No squad members available"],
        advantageScore: -100
      };
    }

    // Calculate health ratio
    const healthRatio = squadStats.totalHits / squadStats.maxHits;
    if (healthRatio < 0.5) {
      advantageScore -= 30;
      reasoning.push(`Squad health low: ${(healthRatio * 100).toFixed(0)}%`);
    } else if (healthRatio > 0.9) {
      advantageScore += 10;
      reasoning.push(`Squad at full health: ${(healthRatio * 100).toFixed(0)}%`);
    }

    // Evaluate tower threat
    const maxTowerShots = Math.floor(enemyForces.towerEnergy / this.TOWER_ENERGY_PER_SHOT);
    const totalTowerDamage = maxTowerShots * (this.TOWER_DAMAGE_MAX * 0.6);

    if (enemyForces.towerCount === 0) {
      advantageScore += 20;
      reasoning.push("No active towers");
    } else if (enemyForces.towerEnergy < 1000) {
      advantageScore += 15;
      reasoning.push(`Towers low on energy: ${enemyForces.towerEnergy}`);
    } else if (totalTowerDamage > squadStats.totalHits) {
      advantageScore -= 40;
      reasoning.push(`Towers can kill squad: ${totalTowerDamage} damage vs ${squadStats.totalHits} HP`);
    } else {
      advantageScore -= Math.min(20, (totalTowerDamage / squadStats.totalHits) * 20);
      reasoning.push(`Tower threat: ${enemyForces.towerCount} towers, ${enemyForces.towerEnergy} energy`);
    }

    // Evaluate heal vs damage balance
    const netHealPower = squadStats.healPower - enemyForces.towerDamage - enemyForces.defenderAttackPower;
    if (netHealPower > 0) {
      advantageScore += 20;
      reasoning.push(`Positive heal balance: +${netHealPower} HP/tick`);
    } else if (netHealPower < -100) {
      advantageScore -= 25;
      reasoning.push(`Negative heal balance: ${netHealPower} HP/tick`);
    } else {
      advantageScore -= 10;
      reasoning.push(`Marginal heal balance: ${netHealPower} HP/tick`);
    }

    // Evaluate attack power vs defenders
    if (enemyForces.defenderCount === 0) {
      advantageScore += 15;
      reasoning.push("No active defenders");
    } else {
      const attackAdvantage = squadStats.attackPower + squadStats.rangedAttackPower - enemyForces.defenderAttackPower;
      if (attackAdvantage > 100) {
        advantageScore += 15;
        reasoning.push(`Strong attack advantage: +${attackAdvantage} damage/tick`);
      } else if (attackAdvantage < -50) {
        advantageScore -= 20;
        reasoning.push(`Defenders stronger: ${attackAdvantage} damage/tick`);
      } else {
        reasoning.push(`${enemyForces.defenderCount} defenders present`);
      }
    }

    // Evaluate fortifications
    if (enemyForces.wallHits > 10000000) {
      advantageScore -= 30;
      reasoning.push(`Heavy fortifications: ${(enemyForces.wallHits / 1000000).toFixed(1)}M HP`);
    } else if (enemyForces.wallHits > 1000000) {
      advantageScore -= 15;
      reasoning.push(`Moderate fortifications: ${(enemyForces.wallHits / 1000000).toFixed(1)}M HP`);
    } else if (enemyForces.wallHits > 0) {
      advantageScore -= 5;
      reasoning.push(`Light fortifications: ${(enemyForces.wallHits / 1000).toFixed(0)}K HP`);
    } else {
      advantageScore += 10;
      reasoning.push("No fortifications detected");
    }

    // Calculate time to breach walls
    const totalAttackPower = squadStats.attackPower + squadStats.rangedAttackPower;
    if (enemyForces.wallHits > 0 && totalAttackPower > 0) {
      const ticksToBreach = enemyForces.wallHits / totalAttackPower;
      if (ticksToBreach > 1500) {
        advantageScore -= 20;
        reasoning.push(`Long breach time: ${Math.ceil(ticksToBreach)} ticks`);
      }
    }

    // Determine winnability
    const isWinnable = advantageScore > -20;
    const confidence = Math.min(1.0, Math.abs(advantageScore) / 50);

    reasoning.push(`Final advantage score: ${advantageScore.toFixed(0)}`);

    return {
      isWinnable,
      confidence,
      reasoning,
      advantageScore
    };
  }

  /**
   * Quick check if towers are a threat
   */
  static areTowersThreat(room: Room): boolean {
    const towers = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER && (s as StructureTower).store[RESOURCE_ENERGY] > 50
    });
    return towers.length > 0;
  }

  /**
   * Calculate expected damage from towers at a given position
   */
  static calculateTowerDamageAtPosition(room: Room, pos: RoomPosition): number {
    const towers = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER && (s as StructureTower).store[RESOURCE_ENERGY] > 0
    }) as StructureTower[];

    let totalDamage = 0;
    for (const tower of towers) {
      const range = tower.pos.getRangeTo(pos);
      const damage = this.calculateTowerDamage(range);
      totalDamage += damage;
    }

    return totalDamage;
  }

  /**
   * Calculate tower damage based on range
   */
  private static calculateTowerDamage(range: number): number {
    if (range <= 5) {
      return this.TOWER_DAMAGE_MAX;
    } else if (range >= this.TOWER_RANGE_MAX) {
      return this.TOWER_DAMAGE_MIN;
    } else {
      // Linear interpolation between max and min damage
      const ratio = (range - 5) / (this.TOWER_RANGE_MAX - 5);
      return this.TOWER_DAMAGE_MAX - (this.TOWER_DAMAGE_MAX - this.TOWER_DAMAGE_MIN) * ratio;
    }
  }
}
