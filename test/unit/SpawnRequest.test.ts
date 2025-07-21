import { SpawnRequest } from "../../src/interfaces/SpawnRequest";
import { expect } from "chai";

describe("SpawnRequest Interface", () => {
  it("should define the correct structure", () => {
    const mockRoom = {} as Room;
    const mockMemory = { role: "test", room: "testroom", working: false } as CreepMemory;
    
    const spawnRequest: SpawnRequest = {
      role: "TestRole",
      name: "TestCreep_1",
      body: ["work", "move", "carry"] as BodyPartConstant[],
      memory: mockMemory,
      priority: 3,
      room: mockRoom
    };

    expect(spawnRequest.role).to.equal("TestRole");
    expect(spawnRequest.name).to.equal("TestCreep_1");
    expect(spawnRequest.body).to.deep.equal(["work", "move", "carry"]);
    expect(spawnRequest.memory).to.equal(mockMemory);
    expect(spawnRequest.priority).to.equal(3);
    expect(spawnRequest.room).to.equal(mockRoom);
  });

  it("should support different priority levels", () => {
    const mockRoom = {} as Room;
    const mockMemory = { role: "test", room: "testroom", working: false } as CreepMemory;

    // Test priority range from 1 to 5
    for (let priority = 1; priority <= 5; priority++) {
      const spawnRequest: SpawnRequest = {
        role: "TestRole",
        name: `TestCreep_${priority}`,
        body: ["work", "move", "carry"] as BodyPartConstant[],
        memory: mockMemory,
        priority: priority,
        room: mockRoom
      };

      expect(spawnRequest.priority).to.equal(priority);
    }
  });
});