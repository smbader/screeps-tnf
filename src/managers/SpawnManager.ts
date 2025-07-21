import { SpawnRequest } from "../interfaces/SpawnRequest";

/**
 * Result of a spawn attempt
 */
interface SpawnResult {
  request: SpawnRequest;
  result: ScreepsReturnCode;
  spawn?: StructureSpawn;
}

/**
 * Centralized SpawnManager that handles all creep spawning for the colony
 */
export class SpawnManager {
  private spawnResults: SpawnResult[] = [];
  
  /**
   * Process all spawn requests from operations
   * @param requests Array of spawn requests from all operations
   */
  processSpawnRequests(requests: SpawnRequest[]): void {
    this.spawnResults = [];
    
    if (requests.length === 0) {
      return;
    }
    
    // Sort requests by priority (highest first)
    const sortedRequests = requests.sort((a, b) => b.priority - a.priority);
    
    console.log(`SpawnManager: Processing ${requests.length} spawn requests`);
    
    for (const request of sortedRequests) {
      this.processSpawnRequest(request);
    }
    
    this.logResults();
  }
  
  /**
   * Process a single spawn request
   */
  private processSpawnRequest(request: SpawnRequest): void {
    // Check if creep already exists
    if (Game.creeps[request.name]) {
      return; // Creep already exists, no need to spawn
    }
    
    // Find available spawns in the requested room
    const availableSpawns = request.room.find(FIND_MY_SPAWNS, {
      filter: (spawn) => !spawn.spawning
    });
    
    if (availableSpawns.length === 0) {
      this.spawnResults.push({
        request,
        result: ERR_BUSY
      });
      return;
    }
    
    // Try to spawn with the first available spawn
    const spawn = availableSpawns[0];
    const result = spawn.spawnCreep(request.body, request.name, {
      memory: request.memory
    });
    
    this.spawnResults.push({
      request,
      result,
      spawn
    });
  }
  
  /**
   * Log spawn results for debugging
   */
  private logResults(): void {
    const successful = this.spawnResults.filter(r => r.result === OK);
    const failed = this.spawnResults.filter(r => r.result !== OK && r.result !== ERR_BUSY);
    const busy = this.spawnResults.filter(r => r.result === ERR_BUSY);
    
    if (successful.length > 0) {
      console.log(`SpawnManager: Successfully spawned ${successful.length} creeps:`);
      for (const result of successful) {
        console.log(`  - ${result.request.name} (${result.request.role}) in ${result.spawn?.room.name}`);
      }
    }
    
    if (failed.length > 0) {
      console.log(`SpawnManager: Failed to spawn ${failed.length} creeps:`);
      for (const result of failed) {
        console.log(`  - ${result.request.name} (${result.request.role}): ${this.getErrorMessage(result.result)}`);
      }
    }
    
    if (busy.length > 0) {
      console.log(`SpawnManager: ${busy.length} requests delayed (spawns busy)`);
    }
  }
  
  /**
   * Convert error codes to readable messages
   */
  private getErrorMessage(code: ScreepsReturnCode): string {
    switch (code) {
      case ERR_NOT_ENOUGH_ENERGY:
        return "Not enough energy";
      case ERR_INVALID_ARGS:
        return "Invalid arguments";
      case ERR_NAME_EXISTS:
        return "Name already exists";
      case ERR_BUSY:
        return "Spawn is busy";
      default:
        return `Error code: ${code}`;
    }
  }
  
  /**
   * Get spawn statistics for monitoring
   */
  getStats(): { total: number; successful: number; failed: number; busy: number } {
    const successful = this.spawnResults.filter(r => r.result === OK).length;
    const failed = this.spawnResults.filter(r => r.result !== OK && r.result !== ERR_BUSY).length;
    const busy = this.spawnResults.filter(r => r.result === ERR_BUSY).length;
    
    return {
      total: this.spawnResults.length,
      successful,
      failed,
      busy
    };
  }
}