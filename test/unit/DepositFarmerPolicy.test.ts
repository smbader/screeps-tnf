import { getObserverCandidateRooms, isDepositOpportunityViable } from "../../src/operations/DepositFarmerPolicy";
import type { DepositSightingMemory } from "../../src/operations/DepositFarmerTypes";
import { assert } from "chai";

describe("deposit farmer policy", () => {
  it("finds reachable observer rooms once and respects the range limit", () => {
    const graph: Record<string, string[]> = {
      E1N1: ["E1N2", "E2N1"],
      E1N2: ["E1N1", "E1N3"],
      E2N1: ["E1N1", "E2N2"],
      E1N3: ["E1N2"],
      E2N2: ["E2N1"]
    };

    const rooms = getObserverCandidateRooms("E1N1", roomName => graph[roomName] || [], 2);

    assert.sameMembers(rooms, ["E1N2", "E2N1", "E1N3", "E2N2"]);
    assert.lengthOf(rooms, 4);
  });

  it("rejects stale or too-distant deposits without enough remaining lifetime", () => {
    const sighting: DepositSightingMemory = {
      id: "deposit-id" as Id<Deposit>,
      roomName: "E3N3",
      pos: { x: 25, y: 25 },
      depositType: "mist",
      lastSeen: 100,
      ticksToDecay: 800,
      cooldown: 0
    };

    assert.isTrue(isDepositOpportunityViable(sighting, "E1N1", 150, () => 4));
    assert.isFalse(isDepositOpportunityViable(sighting, "E1N1", 150, () => 5));
    assert.isFalse(isDepositOpportunityViable(sighting, "E1N1", 601, () => 1));
    assert.isFalse(isDepositOpportunityViable({ ...sighting, cooldown: 500 }, "E1N1", 150, () => 1));
  });
});
