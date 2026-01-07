# GroundSupport Operation - AI Documentation

## Overview
The GroundSupport operation is a sophisticated room management system in Screeps that handles resource distribution, link network orchestration, and infrastructure maintenance within a room. It operates as a single-creep logistics coordinator that maintains energy flow throughout the room's structures.

## Core Purpose
- **Primary Function**: Automated resource distribution and room infrastructure maintenance
- **Secondary Function**: Link network orchestration and energy management
- **Operational Scope**: Single room per instance
- **Creep Requirement**: One dedicated GroundSupport creep per room

## Architecture

### Class Structure
```typescript
export class GroundSupport extends Operator {
    creep: GroundSupportCreep | null;
    room: Room;
}

export class GroundSupportCreep extends Creep {
    memory: CreepMemory & {
        working?: boolean;           // True = withdraw mode, False = transfer mode
        phase?: string | null;       // Current operation phase
        targetContainer?: Id<FieldStructure> | null;  // Current target structure
        sourceContainer?: Id<FieldStructure> | null;  // Current source structure
        resourceType?: ResourceConstant | null;       // Resource being transferred
        linkSendTo?: Id<StructureLink> | null;       // Link transfer target
        cachedTask?: CachedTask | null;              // Persistent task cache
    };
}
```

### Data Structures

#### CachedLinks Type
```typescript
type CachedLinks = {
    storage?: Id<StructureLink>;    // Storage link ID
    controller?: Id<StructureLink>; // Controller link ID
    sources: Id<StructureLink>[];   // Source link IDs array
    fields: Id<StructureLink>[];    // Field link IDs array
};
```

#### TransferTask Interface
```typescript
interface TransferTask {
    source?: Id<FieldStructure>;    // Source structure (optional)
    target: Id<FieldStructure>;     // Target structure (required)
    resourceType: ResourceConstant; // Resource to transfer
    priority: number;               // Task priority (lower = higher priority)
    taskType: string;               // Task classification
    debug?: string;                 // Debug information
}
```

#### CachedTask Interface
```typescript
interface CachedTask {
    tick: number;        // Game tick when task was cached
    task: TransferTask;  // The cached task data
}
```

## Core Functionality

### 1. Link Network Orchestration (`fireLinks()`)

#### Purpose
Manages automatic energy transfers between different types of links in the room to maintain optimal energy distribution.

#### Link Types Managed
- **Source Links**: Collect energy from harvesters
- **Storage Link**: Central hub for energy distribution
- **Controller Link**: Supplies energy to upgraders
- **Field Links**: Supply energy to remote operations

#### Timing System
Uses a staggered timing system to distribute CPU load:
- **Room Offset**: `Math.abs(roomName.charCodeAt()) % 10`
- **Tick Calculation**: `(Game.time + roomOffset) % 20`

#### Link Management Logic

##### Source Links (tick10 === 0)
- **Check Frequency**: Every 20 ticks (staggered per room)
- **Trigger Condition**: Source link > 85% full
- **Action**: Transfer energy to storage link
- **Prerequisite**: Storage link must have free capacity

##### Field Links (tick10 === 6)
- **Check Frequency**: Every 20 ticks (offset +6)
- **Trigger Condition**: Field link < 50% full
- **Action**: Storage link transfers energy to field link
- **Prerequisite**: Storage link must have sufficient energy

##### Controller Link (tick10 === 12)
- **Check Frequency**: Every 20 ticks (offset +12)
- **Trigger Condition**: Controller link < 25% full
- **Action**: Storage link transfers energy to controller link
- **Prerequisite**: Storage link must have sufficient energy

#### Caching Strategy
- **Cache Duration**: 100 ticks
- **Cache Key**: `room.memory._gs_links`
- **Refresh Condition**: `Game.time % 100 === 0 || !cache_exists`

### 2. Task Generation System (`getTasks()`)

#### Task Priority System
Lower numbers indicate higher priority:

| Priority | Task Type | Description |
|----------|-----------|-------------|
| 1 | offload_storage_link_for_source | Urgent storage link offload |
| 2 | fill_storage_link_for_field | Storage link filling for fields |
| 3 | fill_storage_link_for_controller | Storage link filling for controller |
| 7 | fill_container_energy | Field container energy supply |
| 10 | deposit_to_storage | Non-energy resource deposits |
| 20 | fill_tower_critical | Critical tower refill (<400 energy) |
| 24 | fill_tower | Standard tower refill |
| 30 | fill_lab_energy | Laboratory energy supply |
| 30 | fill_nuker_energy | Nuker energy supply |
| 31 | fill_nuker_ghodium | Nuker ghodium supply |
| 31 | fill_powerspawn_power | Power spawn power supply |
| 40 | fill_factory_energy | Factory energy supply |
| 50 | fill_terminal_energy | Terminal energy supply |
| 60 | fill_storage_energy | Storage energy from terminal |

#### Task Generation Conditions

##### High Priority Tasks (Always Checked)
1. **Storage Link Offload**
   - Condition: Any source link > 85% full
   - Source: Storage link
   - Target: Room storage
   - Resource: Energy

##### Medium Priority Tasks (Periodic Checks)
2. **Storage Link Filling for Fields**
   - Check: Every 10 ticks (offset +3)
   - Condition: Field link < 50% full AND storage link insufficient
   - Source: Room storage
   - Target: Storage link

3. **Storage Link Filling for Controller**
   - Check: Every 10 ticks (offset +6)
   - Condition: Controller link < 25% full AND storage link insufficient
   - Source: Room storage
   - Target: Storage link

4. **Field Container Supply**
   - Check: Continuous
   - Condition: Container free capacity > 400 energy
   - Source: Room storage
   - Target: Field containers

##### Low Priority Tasks (25-tick Cycles)
5. **Infrastructure Supply** (Checked every 25 ticks)
   - **Towers**: Free capacity > 200, storage > 10,000 energy
   - **Labs**: Free capacity > 200, storage > 125,000 energy
   - **Nukers**: Energy/Ghodium capacity available, storage > 200,000 energy
   - **Power Spawns**: Energy/Power capacity available, storage > 200,000 energy
   - **Factories**: Energy capacity available, storage > 200,000 energy
   - **Terminal**: Energy balancing (30k-150k optimal range)

#### Resource Threshold Requirements

| Structure | Resource | Storage Threshold | Capacity Threshold |
|-----------|----------|-------------------|-------------------|
| Tower | Energy | 10,000 | 200 free |
| Lab | Energy | 125,000 | 200 free |
| Nuker | Energy | 200,000 | Any free |
| Nuker | Ghodium | N/A (Terminal) | Any free |
| Power Spawn | Energy | 200,000 | 800 free |
| Power Spawn | Power | N/A (Terminal) | Any free |
| Factory | Energy | 200,000 | Any free |
| Terminal | Energy | 400,000 (in) / 300,000 (out) | 30k-150k range |

### 3. Task Execution System

#### Task Persistence
- **Cache Location**: `creep.memory.cachedTask`
- **Cache Duration**: Until task completion or invalidation
- **Validation**: Continuous validation of task conditions

#### Task Validation (`isTaskStillValid()`)
Validates that cached tasks remain relevant:
- **Structure Existence**: Source and target structures still exist
- **Capacity Availability**: Target has free capacity for resource
- **Resource Availability**: Source has required resources
- **Threshold Compliance**: Storage thresholds still met

#### Movement and Transfer Logic

##### Withdraw Operations (`withdrawResource()`)
- **Range Check**: Moves to source if not in range
- **Success Handling**: Updates task state, clears if complete
- **Error Handling**: Distinguishes between resource constraints and actual errors
- **Visual Feedback**: Displays emoji status indicators

##### Transfer Operations (`transferResource()`)
- **Range Check**: Moves to target if not in range
- **Success Handling**: Updates task state, clears if complete
- **Overflow Protection**: Special handling for terminal/storage limits
- **Visual Feedback**: Displays emoji status indicators

#### Working Mode Logic
- **Working = true**: Creep store is empty (withdraw mode)
- **Working = false**: Creep has resources (transfer mode)

### 4. Visual Debugging System (`drawTaskInfo()`)

#### Debug Information Display
- **Creep Status**: Name, phase, working mode
- **Current Task**: Resource type, source/target structures
- **Cached Task**: Active task details and debug info
- **Link Operations**: Real-time link orchestration status
- **Task Queue**: Available tasks sorted by priority
- **Visual Indicators**: Target highlighting and status circles

#### Debug Data Storage
- **Link Debug**: `room.memory._gs_linkDebugInfo`
- **Task Debug**: Individual task debug strings
- **Visual Elements**: Colored text and structure highlighting

## Memory Management

### Room Memory Extensions
```typescript
room.memory._gs_links: CachedLinks          // Link cache
room.memory._gs_linkDebugInfo: string[]    // Link operation debug info
```

### Creep Memory Structure
```typescript
creep.memory = {
    working: boolean,                    // Current working mode
    phase: string | null,               // Operation phase
    targetContainer: Id<FieldStructure> | null,  // Current target
    sourceContainer: Id<FieldStructure> | null,  // Current source  
    resourceType: ResourceConstant | null,       // Resource type
    linkSendTo: Id<StructureLink> | null,       // Link target
    cachedTask: CachedTask | null              // Persistent task
}
```

## Configuration Dependencies

### Required Room Config
- `room.memory.config.energysources[].linkpos`: Source link positions
- `room.memory.config.storagelink`: Storage link position
- `room.memory.config.controllerLink`: Controller link position  
- `room.memory.config.fieldLinks[]`: Field link positions
- `room.memory.config.fieldContainers[]`: Field container positions
- `room.memory.config.chemist.parking`: Parking position for idle creep

## CPU Optimization Features

### Staggered Operations
- **Link Checks**: Distributed across multiple ticks using room-based offsets
- **Structure Scans**: 25-tick cycles for non-critical infrastructure
- **Cache Refresh**: 100-tick intervals for link discovery

### Efficient Pathfinding
- **Path Reuse**: 25-tick reuse for withdraw operations, 50-tick for parking
- **Range Optimization**: Early range checks before expensive operations

### Task Prioritization
- **Critical Tasks**: Checked every tick (storage link management)
- **Standard Tasks**: 10-tick cycles with offsets
- **Infrastructure**: 25-tick cycles for CPU efficiency

## Error Handling and Recovery

### Task Invalidation
- **Structure Destruction**: Automatic task clearing
- **Resource Depletion**: Graceful task completion
- **Threshold Changes**: Dynamic task re-evaluation

### Creep Recovery
- **Stuck Prevention**: Automatic parking when no valid tasks
- **Memory Cleanup**: Complete task clearing on errors
- **State Reset**: Phase and container memory cleanup

## Integration Points

### Dependencies
- **Operator Base Class**: Inherits from base operator functionality
- **Traveler System**: Uses advanced pathfinding for movement
- **Room Configuration**: Requires structured room memory setup

### External Interactions
- **Energy Management**: Coordinates with room energy operations
- **Construction Crew**: Supplies building operations via containers
- **Upgrader Operations**: Maintains controller link energy supply
- **Remote Operations**: Supports field operations via field links

## Performance Characteristics

### CPU Usage
- **Baseline**: ~0.5-1.0 CPU per tick for basic operations
- **Peak Load**: ~2-3 CPU during 25-tick infrastructure scans
- **Optimization**: Staggered operations reduce CPU spikes

### Memory Usage
- **Link Cache**: ~100-200 bytes per room
- **Task Cache**: ~50-100 bytes per active task
- **Debug Info**: ~200-500 bytes per room (optional)

### Scalability
- **Room Limit**: One GroundSupport instance per room
- **Structure Support**: Handles unlimited structures within CPU constraints
- **Task Capacity**: Prioritized queue system handles multiple simultaneous needs

## Common Use Cases

### Early Game (RCL 3-5)
- Basic energy distribution to towers and upgraders
- Simple container management
- Limited link network (source to storage)

### Mid Game (RCL 6-7)
- Full link network orchestration
- Laboratory and infrastructure support
- Advanced energy balancing

### Late Game (RCL 8)
- Complex resource management (nukers, power spawns)
- Factory operations support
- Terminal energy optimization
- Full infrastructure automation

## Troubleshooting Guide

### Common Issues
1. **Creep Stuck**: Check parking position configuration
2. **Tasks Not Executing**: Verify storage thresholds and structure existence
3. **Link Network Issues**: Confirm link position configuration
4. **High CPU Usage**: Review stagger timing and cache refresh rates

### Debug Information
- Visual debugging provides real-time task and link status
- Console logging for 25-tick cycles and link operations
- Memory inspection for cached tasks and link states

## Future Enhancement Opportunities

### Potential Improvements
- Dynamic priority adjustment based on room conditions
- Multi-creep coordination for large rooms
- Advanced resource type handling beyond energy
- Predictive task queuing based on structure usage patterns
- Integration with market operations for resource optimization
