# SpawnManager System

The SpawnManager system centralizes and optimizes creep spawning across all operations in the Screeps TNF codebase.

## Architecture

### SpawnManager
- **Location**: `src/managers/SpawnManager.ts`
- **Purpose**: Central spawning hub that processes all spawn requests
- **Features**:
  - Priority-based spawn ordering (higher numbers = higher priority)
  - Comprehensive error handling and logging
  - Spawn result tracking and statistics
  - Room-based spawn availability checking

### SpawnRequest Interface
- **Location**: `src/interfaces/SpawnRequest.ts`
- **Properties**:
  - `role`: String identifier for the creep type
  - `name`: Unique creep name
  - `body`: Array of body parts for the creep
  - `memory`: CreepMemory object with initial values
  - `priority`: Numeric priority (1-5, where 5 is highest)
  - `room`: Room where the creep should be spawned

### Operation Integration
Each operation now implements `getSpawnRequests(): SpawnRequest[]` which replaces the old `roleCall()` spawning logic.

## Priority System

1. **Priority 5**: Harvesters (critical for energy production)
2. **Priority 4**: Room upgraders for level 1 rooms (essential for early development)  
3. **Priority 3**: Energy managers (important for energy distribution)
4. **Priority 2**: Construction crews (useful but not critical)
5. **Priority 1**: Room upgraders for higher level rooms (maintenance)

## Usage

The main loop automatically:
1. Calls `init()` on all operations
2. Collects spawn requests from all operations via `getSpawnRequests()`
3. Processes all requests through SpawnManager with priority sorting
4. Executes `actions()` on all operations

## Error Handling

The SpawnManager provides detailed logging for:
- Successful spawns with creep names and locations
- Failed spawns with specific error messages
- Busy spawns (will retry next tick)
- Request statistics for monitoring

## Backward Compatibility

The old `roleCall()` methods are preserved but no longer called by the main loop, ensuring existing functionality remains intact during migration.