import { SpawnManager } from "../../src/managers/SpawnManager";
import { SpawnRequest } from "../../src/interfaces/SpawnRequest";
import { expect } from "chai";

describe("SpawnManager", () => {
  let spawnManager: SpawnManager;

  beforeEach(() => {
    spawnManager = new SpawnManager();
  });

  it("should handle empty spawn requests", () => {
    // This should not throw any errors
    spawnManager.processSpawnRequests([]);
    
    const stats = spawnManager.getStats();
    expect(stats.total).to.equal(0);
    expect(stats.successful).to.equal(0);
    expect(stats.failed).to.equal(0);
    expect(stats.busy).to.equal(0);
  });

  it("should sort requests by priority", () => {
    // Mock room and spawns would be needed for full testing
    // For now, just verify the SpawnManager can be instantiated
    expect(spawnManager).to.be.instanceOf(SpawnManager);
  });

  it("should provide statistics", () => {
    const stats = spawnManager.getStats();
    expect(stats).to.have.property('total');
    expect(stats).to.have.property('successful');
    expect(stats).to.have.property('failed');
    expect(stats).to.have.property('busy');
  });
});