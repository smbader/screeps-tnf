/**
 * Represents a request to spawn a creep with specific properties and priority
 */
export interface SpawnRequest {
  /** The body parts for the creep to be spawned */
  body: BodyPartConstant[];

  /** The name for the creep to be spawned */
  name: string;

  /** Memory object for the creep (optional) */
  memory?: CreepMemory;

  /** Priority level for spawn request (higher number = higher priority) */
  priority: number;

  /** Optional spawn options */
  opts?: SpawnOptions;
}
