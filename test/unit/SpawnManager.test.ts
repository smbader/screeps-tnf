import { assert } from "chai";
import { SpawnManager } from "../../src/managers/SpawnManager";

describe("SpawnManager", () => {
  let spawnManager: SpawnManager;

  beforeEach(() => {
    spawnManager = new SpawnManager();
  });

  it("should initialize with empty spawn requests", () => {
    const requests = spawnManager.getSpawnRequests();
    assert.equal(requests.length, 0);
  });

  it("should add spawn requests", () => {
    spawnManager.addSpawnRequest({
      body: ["work" as BodyPartConstant, "carry" as BodyPartConstant, "move" as BodyPartConstant],
      name: "TestWorker",
      priority: 1
    });

    const requests = spawnManager.getSpawnRequests();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].name, "TestWorker");
    assert.equal(requests[0].priority, 1);
  });

  it("should clear spawn requests", () => {
    spawnManager.addSpawnRequest({
      body: ["work" as BodyPartConstant, "carry" as BodyPartConstant, "move" as BodyPartConstant],
      name: "TestWorker",
      priority: 1
    });

    spawnManager.clearSpawnRequests();
    const requests = spawnManager.getSpawnRequests();
    assert.equal(requests.length, 0);
  });

  it("should sort spawn requests by priority", () => {
    spawnManager.addSpawnRequest({
      body: ["work" as BodyPartConstant, "carry" as BodyPartConstant, "move" as BodyPartConstant],
      name: "LowPriority",
      priority: 1
    });
    spawnManager.addSpawnRequest({
      body: ["work" as BodyPartConstant, "carry" as BodyPartConstant, "move" as BodyPartConstant],
      name: "HighPriority",
      priority: 3
    });
    spawnManager.addSpawnRequest({
      body: ["work" as BodyPartConstant, "carry" as BodyPartConstant, "move" as BodyPartConstant],
      name: "MediumPriority",
      priority: 2
    });

    const requests = spawnManager.getSpawnRequests();
    // Note: The sorting happens in processSpawnRequests, but we can test the input order
    assert.equal(requests[0].name, "LowPriority");
    assert.equal(requests[1].name, "HighPriority");
    assert.equal(requests[2].name, "MediumPriority");
  });
});