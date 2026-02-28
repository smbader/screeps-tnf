import { assert } from "chai";
import { CombatEvaluator } from "../../src/utils/CombatEvaluator";

// Mock classes for testing
class MockBodyPart {
  type: BodyPartConstant;
  hits: number;
  boost?: ResourceConstant;

  constructor(type: BodyPartConstant, hits: number = 100, boost?: ResourceConstant) {
    this.type = type;
    this.hits = hits;
    this.boost = boost;
  }
}

class MockCreep {
  hits: number;
  hitsMax: number;
  body: MockBodyPart[];

  constructor(hits: number, hitsMax: number, body: MockBodyPart[]) {
    this.hits = hits;
    this.hitsMax = hitsMax;
    this.body = body;
  }
}

describe("CombatEvaluator", () => {
  describe("calculateSquadStats", () => {
    it("should calculate stats for a squad with no creeps", () => {
      const stats = CombatEvaluator.calculateSquadStats([] as any);
      assert.equal(stats.creepCount, 0);
      assert.equal(stats.totalHits, 0);
      assert.equal(stats.maxHits, 0);
      assert.equal(stats.attackPower, 0);
      assert.equal(stats.healPower, 0);
      assert.equal(stats.rangedAttackPower, 0);
    });

    it("should calculate stats for a melee attacker", () => {
      const creep = new MockCreep(1000, 1000, [
        new MockBodyPart(ATTACK),
        new MockBodyPart(ATTACK),
        new MockBodyPart(MOVE)
      ]) as any;

      const stats = CombatEvaluator.calculateSquadStats([creep]);
      assert.equal(stats.creepCount, 1);
      assert.equal(stats.totalHits, 1000);
      assert.equal(stats.maxHits, 1000);
      assert.equal(stats.attackPower, 60); // 2 ATTACK parts * 30
      assert.equal(stats.healPower, 0);
      assert.equal(stats.rangedAttackPower, 0);
    });

    it("should calculate stats for a healer", () => {
      const creep = new MockCreep(500, 1000, [
        new MockBodyPart(HEAL),
        new MockBodyPart(HEAL),
        new MockBodyPart(HEAL),
        new MockBodyPart(MOVE)
      ]) as any;

      const stats = CombatEvaluator.calculateSquadStats([creep]);
      assert.equal(stats.creepCount, 1);
      assert.equal(stats.totalHits, 500);
      assert.equal(stats.maxHits, 1000);
      assert.equal(stats.healPower, 36); // 3 HEAL parts * 12
      assert.equal(stats.attackPower, 0);
    });

    it("should handle boosted parts correctly", () => {
      const creep = new MockCreep(1000, 1000, [
        new MockBodyPart(ATTACK, 100, RESOURCE_CATALYZED_UTRIUM_ACID), // 4x multiplier
        new MockBodyPart(HEAL, 100, RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE), // 4x multiplier
        new MockBodyPart(MOVE)
      ]) as any;

      const stats = CombatEvaluator.calculateSquadStats([creep]);
      assert.equal(stats.attackPower, 120); // 30 * 4
      assert.equal(stats.healPower, 48); // 12 * 4
    });

    it("should ignore damaged body parts", () => {
      const creep = new MockCreep(1000, 1000, [
        new MockBodyPart(ATTACK, 100),
        new MockBodyPart(ATTACK, 0), // Damaged part
        new MockBodyPart(MOVE)
      ]) as any;

      const stats = CombatEvaluator.calculateSquadStats([creep]);
      assert.equal(stats.attackPower, 30); // Only 1 functioning ATTACK part
    });

    it("should calculate stats for multiple creeps", () => {
      const creep1 = new MockCreep(1000, 1000, [
        new MockBodyPart(ATTACK),
        new MockBodyPart(ATTACK)
      ]) as any;

      const creep2 = new MockCreep(500, 1000, [new MockBodyPart(HEAL), new MockBodyPart(HEAL)]) as any;

      const stats = CombatEvaluator.calculateSquadStats([creep1, creep2]);
      assert.equal(stats.creepCount, 2);
      assert.equal(stats.totalHits, 1500);
      assert.equal(stats.maxHits, 2000);
      assert.equal(stats.attackPower, 60);
      assert.equal(stats.healPower, 24);
    });
  });

  describe("evaluateAttack", () => {
    it("should return not winnable for empty squad", () => {
      const mockRoom = {
        find: () => []
      } as any;

      const result = CombatEvaluator.evaluateAttack([], mockRoom);
      assert.isFalse(result.isWinnable);
      assert.equal(result.confidence, 1.0);
      assert.include(result.reasoning[0], "No squad members available");
    });

    it("should consider a squad winnable against a room with no defenses", () => {
      const creep = new MockCreep(1000, 1000, [
        new MockBodyPart(ATTACK),
        new MockBodyPart(HEAL),
        new MockBodyPart(MOVE)
      ]) as any;

      const mockRoom = {
        find: () => []
      } as any;

      const result = CombatEvaluator.evaluateAttack([creep], mockRoom);
      assert.isTrue(result.isWinnable);
      assert.isAbove(result.advantageScore, 0);
    });

    it("should consider high tower energy a threat", () => {
      const creep = new MockCreep(1000, 1000, [
        new MockBodyPart(ATTACK),
        new MockBodyPart(HEAL)
      ]) as any;

      const mockTower = {
        structureType: STRUCTURE_TOWER,
        store: { [RESOURCE_ENERGY]: 5000 },
        pos: { getRangeTo: () => 10 }
      };

      const mockRoom = {
        find: (type: any, opts?: any) => {
          if (opts?.filter) {
            const filtered = [mockTower].filter(opts.filter);
            return filtered;
          }
          return [];
        }
      } as any;

      const result = CombatEvaluator.evaluateAttack([creep], mockRoom);
      // High tower energy should reduce the advantage score
      assert.isBelow(result.advantageScore, 10);
    });

    it("should evaluate low health squads negatively", () => {
      const creep = new MockCreep(300, 1000, [
        // Low health: 30%
        new MockBodyPart(ATTACK),
        new MockBodyPart(HEAL)
      ]) as any;

      const mockRoom = {
        find: () => []
      } as any;

      const result = CombatEvaluator.evaluateAttack([creep], mockRoom);
      // Should have reasoning about low health
      assert.isTrue(result.reasoning.some(r => r.includes("health low")));
    });

    it("should calculate advantage score correctly", () => {
      // Strong squad
      const strongCreep = new MockCreep(2000, 2000, [
        new MockBodyPart(ATTACK, 100, RESOURCE_CATALYZED_UTRIUM_ACID),
        new MockBodyPart(ATTACK, 100, RESOURCE_CATALYZED_UTRIUM_ACID),
        new MockBodyPart(HEAL, 100, RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE),
        new MockBodyPart(HEAL, 100, RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE)
      ]) as any;

      const mockRoom = {
        find: () => []
      } as any;

      const result = CombatEvaluator.evaluateAttack([strongCreep], mockRoom);
      assert.isTrue(result.isWinnable);
      assert.isAbove(result.advantageScore, 20);
    });
  });
});
