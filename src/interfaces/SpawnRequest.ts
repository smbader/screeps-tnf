/**
 * Interface for spawn requests from operations
 */
export interface SpawnRequest {
  /** The role/type of creep being requested */
  role: string;
  
  /** Unique name for the creep */
  name: string;
  
  /** Body parts for the creep */
  body: BodyPartConstant[];
  
  /** Memory object for the creep */
  memory: CreepMemory;
  
  /** Priority level (higher number = higher priority) */
  priority: number;
  
  /** Room where the creep should be spawned */
  room: Room;
}