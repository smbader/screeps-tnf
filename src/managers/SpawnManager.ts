import { SpawnRequest } from "types/SpawnRequest";

/**
 * Centralized manager for handling spawn requests across the colony
 */
export class SpawnManager {
  private spawnRequests: SpawnRequest[] = [];

  /**
   * Add a spawn request to the queue
   * @param request The spawn request to add
   */
  public addSpawnRequest(request: SpawnRequest): void {
    this.spawnRequests.push(request);
  }

  /**
   * Get all pending spawn requests (for operations to provide their requests)
   * @returns Array of all pending spawn requests
   */
  public getSpawnRequests(): SpawnRequest[] {
    return [...this.spawnRequests];
  }

  /**
   * Clear all spawn requests (called each tick to reset the queue)
   */
  public clearSpawnRequests(): void {
    this.spawnRequests = [];
  }

  /**
   * Process all spawn requests and assign them to available spawns by priority
   */
  public processSpawnRequests(): void {
    if (this.spawnRequests.length === 0) {
      return;
    }

    // Sort spawn requests by priority (highest first)
    const sortedRequests = this.spawnRequests.sort((a, b) => b.priority - a.priority);

    // Find all available spawns across all owned rooms
    const availableSpawns: StructureSpawn[] = [];
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (room.controller?.owner?.username === "ricane") {
        const roomSpawns = room.find(FIND_MY_SPAWNS);
        availableSpawns.push(...roomSpawns.filter(spawn => !spawn.spawning));
      }
    }

    // Assign spawn requests to available spawns
    let spawnIndex = 0;
    for (const request of sortedRequests) {
      if (spawnIndex >= availableSpawns.length) {
        console.log(`No more available spawns for request: ${request.name}`);
        break;
      }

      const spawn = availableSpawns[spawnIndex];
      const result = spawn.spawnCreep(request.body, request.name, {
        memory: request.memory,
        ...request.opts
      });

      if (result === OK) {
        console.log(`Successfully spawning ${request.name} at spawn ${spawn.name} with priority ${request.priority}`);
        spawnIndex++; // Use next spawn for next request
      } else {
        console.log(`Failed to spawn ${request.name} at spawn ${spawn.name}: ${result}`);
      }
    }

    // Clear requests after processing
    this.clearSpawnRequests();
  }
}
