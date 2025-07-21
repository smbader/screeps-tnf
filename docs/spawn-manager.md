# SpawnManager

The SpawnManager is a centralized system for handling spawn requests across the colony. It collects spawn requests from operations and assigns them to available spawns based on priority each tick.

## Overview

The SpawnManager system consists of:

- **SpawnRequest** - A type defining spawn requests with body, name, priority, and optional memory/options
- **SpawnManager** - A class that collects requests and processes them with priority-based assignment

## Usage

### Basic Usage

```typescript
import { SpawnManager } from "managers/SpawnManager";

// Create a spawn manager instance (typically done once per tick)
const spawnManager = new SpawnManager();

// Add spawn requests from operations
spawnManager.addSpawnRequest({
  body: [WORK, CARRY, MOVE],
  name: "Worker1",
  priority: 1,
  memory: { role: "worker", room: "E43S27", working: false }
});

// Process all requests at the end of the tick
spawnManager.processSpawnRequests();
```

### SpawnRequest Properties

| Property | Type | Description |
|----------|------|-------------|
| body | BodyPartConstant[] | The body parts for the creep |
| name | string | Name for the creep |
| priority | number | Priority level (higher = spawned first) |
| memory | CreepMemory? | Optional memory object |
| opts | SpawnOptions? | Optional spawn options |

## Priority System

The SpawnManager processes spawn requests in priority order:
- Higher priority numbers are processed first
- Requests with the same priority are processed in the order they were added
- Available spawns are assigned to requests in priority order

## Integration

The SpawnManager is designed to work with the existing loop structure:

1. Operations add their spawn requests during the tick
2. At the end of the tick, `processSpawnRequests()` assigns requests to spawns
3. Requests are automatically cleared each tick

This centralized approach ensures optimal spawn utilization and priority-based creep production across the colony.