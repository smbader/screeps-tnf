import { Operator } from "../classes/operator";

// =====================================================================================
// TYPE DEFINITIONS
// =====================================================================================

interface CachedLinks {
    storage?: Id<StructureLink>;
    controller?: Id<StructureLink>;
    sources: Id<StructureLink>[];
    fields: Id<StructureLink>[];
}

interface TransferTask {
    source?: Id<FieldStructure>;
    target: Id<FieldStructure>;
    resourceType: ResourceConstant;
    priority: number;
    taskType: string;
    debug?: string;
}

interface CachedTask {
    tick: number;
    task: TransferTask;
}

enum CreepState {
    READY = "ready",
    UNLOADING = "unloading",
    WITHDRAWING = "withdrawing",
    TRANSFERRING = "transferring"
}

// =====================================================================================
// CREEP CLASS
// =====================================================================================

export class GroundSupportCreep extends Creep {
    memory!: CreepMemory & {
        state?: CreepState;
        cachedTask?: CachedTask | null;
        resourceType?: ResourceConstant | null;
    };

    constructor(creepid: Id<Creep>) {
        super(creepid);
    }
}

// =====================================================================================
// MAIN OPERATION CLASS
// =====================================================================================

export class GroundSupport extends Operator {
    creep: GroundSupportCreep | null;

    constructor(name: string, room: Room) {
        super(name, room);
        this.creep = Game.creeps[name] ? new GroundSupportCreep(Game.creeps[name].id) : null;
        this.room = room;
    }

    // =====================================================================================
    // MAIN ACTION LOOP
    // =====================================================================================

    actions(): void {
        if (!this.creep || !this.room.storage) {
            this.drawDebugInfo();
            return;
        }

        // Determine creep state and act accordingly
        const state = this.determineCreepState();
        this.creep.memory.state = state;

        switch (state) {
            case CreepState.READY:
                this.handleReadyState();
                break;
            case CreepState.UNLOADING:
                this.handleUnloadingState();
                break;
            case CreepState.WITHDRAWING:
                this.handleWithdrawingState();
                break;
            case CreepState.TRANSFERRING:
                this.handleTransferringState();
                break;
        }

        this.drawDebugInfo();
    }

    // =====================================================================================
    // STATE MANAGEMENT
    // =====================================================================================

    private determineCreepState(): CreepState {
        if (!this.creep) return CreepState.READY;

        // If creep has unwanted resources, needs to unload
        if (this.needsToUnloadResources()) {
            return CreepState.UNLOADING;
        }

        // If creep has a cached task, determine if withdrawing or transferring
        const cached = this.creep.memory.cachedTask;
        if (cached) {
            const task = cached.task;
            if (!task) {
                this.handleStaleCachedTask('determineCreepState: cachedTask exists but task is missing');
                return CreepState.READY;
            }
            const hasRequiredResource = this.creep.store.getUsedCapacity(task.resourceType) > 0;

            // SPECIAL CASE: Link transfer tasks don't require creep to withdraw/carry resources
            // They should go directly to TRANSFERRING state where handleLinkTransferTask will handle them
            if (task.taskType.startsWith("link_transfer_")) {
                return CreepState.TRANSFERRING;
            }

            if (hasRequiredResource) {
                return CreepState.TRANSFERRING;
            } else if (task.source) {
                return CreepState.WITHDRAWING;
            } else {
                // Task without source but no resources - task complete
                this.clearCachedTask();
                return CreepState.READY;
            }
        }

        return CreepState.READY;
    }

    private needsToUnloadResources(): boolean {
        if (!this.creep) return false;

        // Check if creep has resources that don't match current task
        const cached = this.creep.memory.cachedTask;
        if (cached) {
            const task = cached.task;
            if (!task) {
                this.handleStaleCachedTask('needsToUnloadResources: cachedTask exists but task is missing');
                return true; // Be conservative and force unload so creep becomes READY
            }
            const taskResource = task.resourceType;
            for (const resourceType in this.creep.store) {
                const resource = resourceType as ResourceConstant;
                if (this.creep.store[resource]! > 0) {
                    // If this resource matches the task resource, it's wanted
                    if (resource === taskResource) {
                        // This resource is wanted, check others
                    } else {
                        // This resource doesn't match the task, it's unwanted
                        return true;
                    }
                }
            }
            // All resources match the task or creep is empty
            return false;
        } else {
            // No task but has resources - needs to unload everything
            return this.creep.store.getUsedCapacity() > 0;
        }
    }

    // =====================================================================================
    // STATE HANDLERS
    // =====================================================================================

    private handleReadyState(): void {
        if (!this.creep) return;

        // Evaluate all available tasks by priority
        const availableTasks = this.generateTasks();

        if (availableTasks.length === 0) {
            this.parkCreep();
            return;
        }

        // Cache the highest priority task
        const highestPriorityTask = availableTasks.sort((a, b) => a.priority - b.priority)[0];
        this.cacheTask(highestPriorityTask);

        this.creep.say("🎯 Task");
    }

    private handleUnloadingState(): void {
        if (!this.creep || !this.room.storage) return;

        // Find first unwanted resource and unload it
        for (const resourceType in this.creep.store) {
            const resource = resourceType as ResourceConstant;
            if (this.creep.store[resource]! > 0) {
                // Check if this resource matches current task
                const isTaskResource = this.creep.memory.cachedTask?.task.resourceType === resource;

                if (!isTaskResource) {
                    this.transferResourceToTarget(this.room.storage, resource);
                    return;
                }
            }
        }

        // All unwanted resources unloaded
        this.creep.say("🔄 Clean");
    }

    private handleWithdrawingState(): void {
        const cached = this.creep?.memory.cachedTask;
        if (!cached) return;
        const task = cached.task;
        if (!task) {
            this.handleStaleCachedTask('handleWithdrawingState: cachedTask exists but task is missing');
            return;
        }

        if (!this.isTaskStillValid(task)) {
            this.clearCachedTask();
            return;
        }

        if (!task.source) {
            // Task has no source, move to ready state
            this.clearCachedTask();
            return;
        }

        const source = Game.getObjectById(task.source) as FieldStructure;
        if (!source) {
            this.clearCachedTask();
            return;
        }

        this.withdrawResourceFromSource(source, task.resourceType);
    }

    private handleTransferringState(): void {
        const cached = this.creep?.memory.cachedTask;
        if (!cached) return;
        const task = cached.task;
        if (!task) {
            this.handleStaleCachedTask('handleTransferringState: cachedTask exists but task is missing');
            return;
        }

        const target = Game.getObjectById(task.target) as FieldStructure;
        if (!target) {
            this.clearCachedTask();
            return;
        }

        // Handle special link transfer tasks
        const cachedBefore = this.creep?.memory.cachedTask;
        if (cachedBefore && cachedBefore.task && cachedBefore.task.taskType.startsWith("link_transfer_")) {
            this.handleLinkTransferTask(cachedBefore.task, target as StructureLink);
            return;
        }

        this.transferResourceToTarget(target, task.resourceType);
    }

    // =====================================================================================
    // RESOURCE TRANSFER OPERATIONS
    // =====================================================================================

    private withdrawResourceFromSource(source: FieldStructure, resourceType: ResourceConstant): void {
        if (!this.creep) return;

        const result = this.creep.withdraw(source, resourceType);

        if (result === ERR_NOT_IN_RANGE) {
            this.creep.travelTo(source.pos, { reusePath: 25 });
            this.creep.say(`📥 ${resourceType}`);
        } else if (result === OK) {
            this.creep.say(`✅ Got`);
            // Check if task is complete or creep is full
            if (this.creep.store.getFreeCapacity() === 0 ||
                source.store.getUsedCapacity(resourceType) === 0) {
                // Continue with same task if still valid, don't clear unless invalid
                const cachedNow = this.creep.memory.cachedTask;
                if (!cachedNow || !cachedNow.task) {
                    this.handleStaleCachedTask('withdrawResourceFromSource post-withdraw: cachedTask missing');
                    return;
                }
                if (!this.isTaskStillValid(cachedNow.task)) {
                    this.clearCachedTask();
                }
            }
        } else if (result === ERR_NOT_ENOUGH_RESOURCES || result === ERR_FULL) {
            // Resource constraint, task may still be valid
            this.creep.say("⏳ Wait");
        } else {
            // Actual error, clear task
            this.clearCachedTask();
            this.creep.say("❌ Error");
        }
    }

    private transferResourceToTarget(target: FieldStructure, resourceType: ResourceConstant): void {
        if (!this.creep) return;
        const creep = this.creep;

        // Handle special link transfer tasks
        const cachedBefore = creep.memory.cachedTask;
        if (cachedBefore && cachedBefore.task && cachedBefore.task.taskType.startsWith("link_transfer_")) {
            this.handleLinkTransferTask(cachedBefore.task, target as StructureLink);
            return;
        }

        const result = creep.transfer(target, resourceType);

        if (result === ERR_NOT_IN_RANGE) {
            creep.travelTo(target.pos, { reusePath: 25 });
            creep.say(`📤 ${resourceType}`);
        } else if (result === OK) {
            creep.say(`✅ Done`);

             // Check if task is complete
             if (this.creep.store.getUsedCapacity(resourceType) === 0 ||
                 target.store.getFreeCapacity(resourceType) === 0 ||
                 this.isTransferComplete(target, resourceType)) {

                 // Check if task is still valid for continuation
                const cachedNow = creep.memory.cachedTask;
                if (!cachedNow || !cachedNow.task) {
                    this.handleStaleCachedTask('transferResourceToTarget post-transfer: cachedTask missing');
                    return;
                }
                if (!this.isTaskStillValid(cachedNow.task)) {
                    this.clearCachedTask();
                }
             }
        } else if (result === ERR_FULL || result === ERR_NOT_ENOUGH_RESOURCES) {
             // Resource constraint, check if task should continue
            creep.say("⏳ Full");
            const cachedNow2 = creep.memory.cachedTask;
            if (!cachedNow2 || !cachedNow2.task) {
                this.handleStaleCachedTask('transferResourceToTarget post-full: cachedTask missing');
                return;
            }
            if (!this.isTaskStillValid(cachedNow2.task)) {
                this.clearCachedTask();
            }
        } else {
            // Actual error, clear task
            this.clearCachedTask();
            creep.say("❌ Error");
        }
    }

    private handleLinkTransferTask(task: TransferTask, targetLink: StructureLink): void {
        if (!this.creep || !task.source) return;

        const sourceLink = Game.getObjectById(task.source) as StructureLink;
        if (!sourceLink) {
            this.creep.say("🔗❌ NoSrc");
            this.clearCachedTask();
            return;
        }

        // Enhanced debugging
        const sourceEnergy = sourceLink.store.getUsedCapacity(RESOURCE_ENERGY);
        const targetEnergy = targetLink.store.getUsedCapacity(RESOURCE_ENERGY);

        // Check if we can transfer
        if (sourceLink.cooldown > 0) {
            this.creep.say(`⏳ CD:${sourceLink.cooldown}`);
            return;
        }

        // Check if transfer is still needed and possible
        if (!this.isTaskStillValid(task)) {
            this.creep.say("🔗❌ Invalid");
            this.clearCachedTask();
            return;
        }

        // Debug the actual transfer attempt
        this.creep.say(`🔗 ${sourceEnergy}→${targetEnergy}`);

        // Perform the link transfer (no creep positioning required)
        const result = sourceLink.transferEnergy(targetLink, Math.min(targetLink.store.getFreeCapacity(RESOURCE_ENERGY), sourceLink.store.getUsedCapacity(RESOURCE_ENERGY)));

        if (result === OK) {
            this.creep.say("🔗✅ Sent");
            // Task continues until link is off cooldown and conditions are no longer met
            // The validation will handle clearing when appropriate
        } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
            this.creep.say("🔗❌ NoE");
            this.clearCachedTask();
        } else if (result === ERR_FULL) {
            this.creep.say("🔗❌ Full");
            this.clearCachedTask();
        } else if (result === ERR_INVALID_TARGET) {
            this.creep.say("🔗❌ BadTgt");
            this.clearCachedTask();
        } else if (result === ERR_NOT_OWNER) {
            this.creep.say("🔗❌ NotOwn");
            this.clearCachedTask();
        } else if (result === ERR_TIRED) {
            this.creep.say("🔗❌ Tired");
            this.clearCachedTask();
        } else {
            this.creep.say(`🔗❌ ${result}`);
            this.clearCachedTask();
        }
    }

    private isTransferComplete(target: FieldStructure, resourceType: ResourceConstant): boolean {
        // Special completion conditions for certain structures
        if (target.structureType === STRUCTURE_TERMINAL && resourceType === RESOURCE_ENERGY) {
            return target.store.getUsedCapacity(RESOURCE_ENERGY) > 40000;
        }

        if (target.structureType === STRUCTURE_STORAGE && resourceType === RESOURCE_ENERGY) {
            // Check periodically if storage is getting too full
            return Game.time % 50 === 0 && target.store.getUsedCapacity(RESOURCE_ENERGY) > 300000;
        }

        return false;
    }

    // =====================================================================================
    // TASK MANAGEMENT
    // =====================================================================================

    private cacheTask(task: TransferTask): void {
        if (!this.creep) return;

        this.creep.memory.cachedTask = {
            tick: Game.time,
            task: task
        };
        this.creep.memory.resourceType = task.resourceType;
    }

    private clearCachedTask(): void {
        if (!this.creep) return;

        this.creep.memory.cachedTask = null;
        this.creep.memory.resourceType = null;
    }

    // Gracefully handle malformed/stale cachedTask entries
    private handleStaleCachedTask(context: string): void {
        if (!this.creep) return;
        try {
            console.log(`[GroundSupport:${this.room.name}][${this.creep.name}] Stale cachedTask detected: ${context}. Clearing cachedTask.`);
        } catch (e) {}
        this.clearCachedTask();
    }

    private isTaskStillValid(task: TransferTask): boolean {
        const target = Game.getObjectById(task.target) as FieldStructure | null;
        if (!target) return false;

        const source = task.source ? Game.getObjectById(task.source) as FieldStructure | null : null;
        if (task.source && !source) return false;

        // Check task-specific validity conditions
        return this.checkTaskConditions(task, target, source);
    }

    private checkTaskConditions(task: TransferTask, target: FieldStructure, source: FieldStructure | null): boolean {
        switch (task.taskType) {
            case "offload_storage_nonenergy":
                return this.validateOffloadStorageNonEnergyTask(task, target as StructureTerminal);
            case "fill_tower_critical":
            case "fill_tower":
                return this.validateTowerTask(target as StructureTower);

            case "fill_lab_energy":
                return this.validateLabTask(target as StructureLab);

            case "fill_nuker_energy":
                return this.validateNukerEnergyTask(target as StructureNuker);

            case "fill_nuker_ghodium":
                return this.validateNukerGhodiumTask(target as StructureNuker);

            case "fill_powerspawn_energy":
                return this.validatePowerSpawnEnergyTask(target as StructurePowerSpawn);

            case "fill_powerspawn_power":
                return this.validatePowerSpawnPowerTask(target as StructurePowerSpawn);

            case "fill_factory_energy":
                return this.validateFactoryTask(target as StructureFactory);

            case "fill_terminal_energy":
                return this.validateTerminalTask(target as StructureTerminal);

            case "fill_storage_energy":
                return this.validateStorageTask(target as StructureStorage);

            case "fill_storage_link":
                return this.validateStorageLinkTask(target as StructureLink);

            case "fill_container_energy":
                return this.validateContainerTask(target as StructureContainer);

            case "offload_storage_link_for_source":
                return this.validateOffloadStorageLinkTask(source as StructureLink, target as StructureStorage);

            case "link_transfer_source_to_storage":
                return this.validateLinkTransferSourceToStorage(source as StructureLink, target as StructureLink);

            case "link_transfer_storage_to_field":
                return this.validateLinkTransferStorageToField(source as StructureLink, target as StructureLink);

            case "link_transfer_storage_to_controller":
                return this.validateLinkTransferStorageToController(source as StructureLink, target as StructureLink);

            case "fill_terminal_from_excess":
                // Task moves non-energy resources from storage -> terminal when terminal energy is very low
                // This helps free up storage and place non-energy resources where they can be handled later
                return this.validateTerminalFromExcessTask(task, target as StructureTerminal);

            default:
                return true; // For basic tasks, assume still valid
        }
    }

    private validateOffloadStorageNonEnergyTask(task: TransferTask, terminal: StructureTerminal): boolean {
        if (!this.room.storage || !terminal) return false;

        const resource = task.resourceType;
        if (resource === RESOURCE_ENERGY) return false;

        // Ensure storage is still above threshold (>900k)
        const storageOverThreshold = this.room.storage.store.getUsedCapacity() > 900000;
        if (!storageOverThreshold) return false;

        const storageHas = this.room.storage.store.getUsedCapacity(resource) > 0;
        const terminalHasSpace = terminal.store.getFreeCapacity(resource) > 0;

        return storageHas && terminalHasSpace;
    }

    // =====================================================================================
    // TASK VALIDATION METHODS
    // =====================================================================================

    private validateTowerTask(tower: StructureTower): boolean {
        if (!this.room.storage) return false;
        const hasCapacity = tower.store.getFreeCapacity(RESOURCE_ENERGY) > 200;
        const hasResource = this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 10000;
        return hasCapacity && hasResource;
    }

    private validateLabTask(lab: StructureLab): boolean {
        if (!this.room.storage) return false;
        const hasCapacity = lab.store.getFreeCapacity(RESOURCE_ENERGY) > 200;
        const hasResource = this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 125000;
        return hasCapacity && hasResource;
    }

    private validateNukerEnergyTask(nuker: StructureNuker): boolean {
        if (!this.room.storage) return false;
        const hasCapacity = nuker.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        const hasResource = this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 200000;
        return hasCapacity && hasResource;
    }

    private validateNukerGhodiumTask(nuker: StructureNuker): boolean {
        if (!this.room.terminal && !this.room.storage) return false;

        const hasCapacity = nuker.store.getFreeCapacity(RESOURCE_GHODIUM) > 0;
        if (!hasCapacity) return false;

        // If creep already has Ghodium for this task, validation should pass
        if (this.creep?.store.getUsedCapacity(RESOURCE_GHODIUM)! > 0) {
            return true;
        }

        // Check which source the current task is using
        const currentTask = this.creep?.memory.cachedTask?.task;
        if (currentTask && currentTask.source) {
            const source = Game.getObjectById(currentTask.source);
            if (source?.structureType === STRUCTURE_TERMINAL) {
                return this.room.terminal?.store.getUsedCapacity(RESOURCE_GHODIUM)! > 0;
            } else if (source?.structureType === STRUCTURE_STORAGE) {
                return this.room.storage?.store.getUsedCapacity(RESOURCE_GHODIUM)! > 0;
            }
        }

        // Fallback: check if any source has Ghodium (for initial task selection)
        const terminalHasGhodium = this.room.terminal?.store.getUsedCapacity(RESOURCE_GHODIUM)! > 0;
        const storageHasGhodium = this.room.storage?.store.getUsedCapacity(RESOURCE_GHODIUM)! > 0;
        return terminalHasGhodium || storageHasGhodium;
    }

    private validatePowerSpawnEnergyTask(powerSpawn: StructurePowerSpawn): boolean {
        if (!this.room.storage) return false;
        const hasCapacity = powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY) > 800;
        const hasResource = this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 200000;
        return hasCapacity && hasResource;
    }

    private validatePowerSpawnPowerTask(powerSpawn: StructurePowerSpawn): boolean {
        if (!this.room.terminal) return false;
        const hasCapacity = powerSpawn.store.getFreeCapacity(RESOURCE_POWER) > 0;
        const hasResource = this.room.terminal.store.getUsedCapacity(RESOURCE_POWER) > 0;
        return hasCapacity && hasResource;
    }

    private validateFactoryTask(factory: StructureFactory): boolean {
        if (!this.room.storage) return false;
        const hasCapacity = factory.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        const hasResource = this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 200000;
        return hasCapacity && hasResource;
    }

    private validateTerminalTask(terminal: StructureTerminal): boolean {
        if (!this.room.storage) return false;
        const hasCapacity = terminal.store.getUsedCapacity(RESOURCE_ENERGY) < 30000;
        const hasResource = this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 100000;
        return hasCapacity && hasResource;
    }

    private validateStorageTask(storage: StructureStorage): boolean {
        if (!this.room.terminal) return false;
        const hasCapacity = storage.store.getUsedCapacity(RESOURCE_ENERGY) < 300000;
        const hasResource = this.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) > 150000;
        return hasCapacity && hasResource;
    }

    private validateStorageLinkTask(link: StructureLink): boolean {
        if (!this.room.storage) return false;

        // Check if the storage link still has capacity for more energy
        const hasCapacity = link.store.getFreeCapacity(RESOURCE_ENERGY) > 0;

        // Check if room storage has enough energy to continue filling
        const hasResource = this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 10000;

        // Check if there are still field/controller links that need energy (the original reason for filling storage link)
        const links = this.getCachedLinks();
        const hasFieldLinksNeedingEnergy = links.fields.some(fieldLinkId => {
            const fieldLink = Game.getObjectById(fieldLinkId) as StructureLink;
            return fieldLink && fieldLink.store.getUsedCapacity(RESOURCE_ENERGY) < 400;
        });

        const hasControllerLinkNeedingEnergy = links.controller ? (() => {
            const controllerLink = Game.getObjectById(links.controller) as StructureLink;
            return controllerLink && controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) < 500;
        })() : false;

        return hasCapacity && hasResource && (hasFieldLinksNeedingEnergy || hasControllerLinkNeedingEnergy);
    }

    private validateOffloadStorageLinkTask(source: StructureLink, target: StructureStorage): boolean {
        // The source parameter here is actually the storage link (the source of energy for this task)
        // The task should continue as long as the storage link has energy to offload
        const hasEnergyToOffload = source.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
        const hasTargetCapacity = target.store.getFreeCapacity(RESOURCE_ENERGY) > 0;

        return hasEnergyToOffload && hasTargetCapacity;
    }

    private validateContainerTask(container: StructureContainer): boolean {
        if (!this.room.storage) return false;
        // Validate that the container has capacity and storage has enough energy
        const hasCapacity = container.store.getFreeCapacity(RESOURCE_ENERGY) > 400;
        const hasResource = this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 10000;
        return hasCapacity && hasResource;
    }

    private validateLinkTransferSourceToStorage(source: StructureLink, target: StructureLink): boolean {
        // Validate that the source link has enough energy and the target storage link has capacity
        const hasEnergy = source.store.getUsedCapacity(RESOURCE_ENERGY) > 600;
        const hasCapacity = target.store.getFreeCapacity(RESOURCE_ENERGY) > 0;

        // NEW: If the storage link is nearly full (< 100 free capacity), this task should be invalid
        // because we should prioritize emptying the storage link first
        const storageLinkNearlyFull = target.store.getFreeCapacity(RESOURCE_ENERGY) < 100;

        // If storage link is nearly full, don't allow source-to-storage transfers
        // This will cause the task to be invalidated and the creep will pick up the higher priority
        // offload task instead
        if (storageLinkNearlyFull) {
            return false;
        }

        return hasEnergy && hasCapacity;
    }

    private validateLinkTransferStorageToField(source: StructureLink, target: StructureLink): boolean {
        // Validate that the source storage link has energy and the target field link needs energy
        const hasEnergy = source.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
        const needsEnergy = target.store.getUsedCapacity(RESOURCE_ENERGY) < 800;

        return hasEnergy && needsEnergy;
    }

    private validateLinkTransferStorageToController(source: StructureLink, target: StructureLink): boolean {
        // Validate that the source storage link has energy and the target controller link needs energy
        const hasEnergy = source.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
        const needsEnergy = target.store.getUsedCapacity(RESOURCE_ENERGY) < 500;

        return hasEnergy && needsEnergy;
    }

    private validateTerminalFromExcessTask(task: TransferTask, terminal: StructureTerminal): boolean {
        // Move non-energy resources from storage to terminal when terminal energy is very low
        if (!this.room.storage || !terminal) return false;

        const resource = task.resourceType;
        // This validator is only for non-energy resources
        if (resource === RESOURCE_ENERGY) return false;

        const terminalEnergyLow = terminal.store.getUsedCapacity(RESOURCE_ENERGY) < 20000;
        const storageEnergyHigh = this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 300000;
        const storageHasResource = this.room.storage.store.getUsedCapacity(resource) > 0;
        const terminalHasSpaceForResource = terminal.store.getFreeCapacity(resource) > 0;

        return terminalEnergyLow && storageEnergyHigh && storageHasResource && terminalHasSpaceForResource;
    }

    // =====================================================================================
    // TASK GENERATION
    // =====================================================================================

    private generateTasks(): TransferTask[] {
        const tasks: TransferTask[] = [];
        if (!this.creep || !this.room.storage) return tasks;

        // Critical tasks (checked every tick)
        // Very high priority: if storage is completely full, offload the largest non-energy resource to terminal
        this.addStorageOverflowTask(tasks);
        this.addLinkManagementTasks(tasks);
        this.addUnwantedResourceTasks(tasks);

        // Medium priority tasks (checked periodically)
        this.addContainerTasks(tasks);

        // Infrastructure tasks (checked every 25 ticks for CPU efficiency)
        if (Game.time % 25 === 0) {
            this.addInfrastructureTasks(tasks);
        }

        return tasks;
    }

    // If storage is completely full, move the single largest non-energy resource to the terminal
    // as long as the terminal exists and has space. This prevents storage from becoming blocked.
    private addStorageOverflowTask(tasks: TransferTask[]): void {
        if (!this.room.storage || !this.room.terminal) return;

        // Only trigger when storage is completely full
        // Trigger when storage used capacity is over 900k
        const storageUsed = this.room.storage.store.getUsedCapacity();
        if (!(storageUsed > 900000)) return;

        // Terminal must have some free capacity overall
        if (this.room.terminal.store.getFreeCapacity() === 0) return;

        // Find the non-energy resource with the highest amount in storage
        let topResource: ResourceConstant | null = null;
        let topAmount = 0;
        for (const resType in this.room.storage.store) {
            const r = resType as ResourceConstant;
            if (r === RESOURCE_ENERGY) continue;
            const amt = this.room.storage.store.getUsedCapacity(r);
            if (amt > topAmount) {
                topAmount = amt;
                topResource = r;
            }
        }

        if (topResource && topAmount > 0) {
            // Only create task if terminal has space for this specific resource
            if (this.room.terminal.store.getFreeCapacity(topResource) > 0) {
                tasks.push({
                    source: this.room.storage.id,
                    target: this.room.terminal.id,
                    resourceType: topResource,
                    priority: -1, // very high priority
                    taskType: "offload_storage_nonenergy",
                    debug: `Storage full: move ${topResource} (${topAmount}) to terminal`
                });
            }
        }
    }

    private addLinkManagementTasks(tasks: TransferTask[]): void {
        const links = this.getCachedLinks();
        const storageLink = links.storage ? Game.getObjectById(links.storage) as StructureLink : null;

        if (!storageLink) return;

        // Check if any source links have energy that needs to be transferred
        const sourceLinksNeedingToTransfer = links.sources.some(sourceLinkId => {
            const sourceLink = Game.getObjectById(sourceLinkId) as StructureLink;
            return sourceLink && sourceLink.store.getUsedCapacity(RESOURCE_ENERGY) > 600;
        });

        // Priority 0: If storage link is full and source links need to transfer, empty the storage link first
        if (storageLink.store.getFreeCapacity(RESOURCE_ENERGY) < 100 &&
            sourceLinksNeedingToTransfer &&
            this.room.storage!.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            tasks.push({
                source: storageLink.id,
                target: this.room.storage!.id,
                resourceType: RESOURCE_ENERGY,
                priority: 0,
                taskType: "offload_storage_link_for_source",
                debug: `Empty storage link to make room for source transfers`
            });
        }

        // Priority 1: Fill storage link from room storage if it's empty and field links need energy
        const hasFieldLinksNeedingEnergy = links.fields.some(fieldLinkId => {
            const fieldLink = Game.getObjectById(fieldLinkId) as StructureLink;
            return fieldLink && fieldLink.store.getUsedCapacity(RESOURCE_ENERGY) < 400;
        });

        const hasControllerLinkNeedingEnergy = links.controller ? (() => {
            const controllerLink = Game.getObjectById(links.controller) as StructureLink;
            return controllerLink && controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) < 500;
        })() : false;

        // Only fill storage link if:
        // 1. Storage link is very low (< 100 energy)
        // 2. Field/controller links need energy
        // 3. Room storage has enough energy
        // 4. No source links are waiting to transfer (to avoid ping-pong effect)
        if (storageLink.store.getUsedCapacity(RESOURCE_ENERGY) < 100 &&
            (hasFieldLinksNeedingEnergy || hasControllerLinkNeedingEnergy) &&
            this.room.storage!.store.getUsedCapacity(RESOURCE_ENERGY) > 10000 &&
            !sourceLinksNeedingToTransfer) {
            tasks.push({
                source: this.room.storage!.id,
                target: storageLink.id,
                resourceType: RESOURCE_ENERGY,
                priority: 1,
                taskType: "fill_storage_link",
                debug: `Fill storage link from room storage`
            });
        }

        // Priority 2: Check if any source links need to transfer to storage (energy > 600)
        for (const sourceLinkId of links.sources) {
            const sourceLink = Game.getObjectById(sourceLinkId) as StructureLink;
            if (!sourceLink) continue;

            if (sourceLink.store.getUsedCapacity(RESOURCE_ENERGY) > 600 && storageLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                tasks.push({
                    source: sourceLink.id,
                    target: storageLink.id,
                    resourceType: RESOURCE_ENERGY,
                    priority: 2,
                    taskType: "link_transfer_source_to_storage",
                    debug: `Transfer energy from source link ${sourceLink.id} to storage link`
                });
                break; // Only handle one source link at a time
            }
        }

        // Priority 3: Check if any field links need energy from storage (energy < 400)
        for (const fieldLinkId of links.fields) {
            const fieldLink = Game.getObjectById(fieldLinkId) as StructureLink;
            if (!fieldLink) continue;

            if (fieldLink.store.getUsedCapacity(RESOURCE_ENERGY) < 400 && storageLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                tasks.push({
                    source: storageLink.id,
                    target: fieldLink.id,
                    resourceType: RESOURCE_ENERGY,
                    priority: 3,
                    taskType: "link_transfer_storage_to_field",
                    debug: `Transfer energy from storage link to field link ${fieldLink.id}`
                });
                break; // Only handle one field link at a time
            }
        }

        // Priority 4: Check if controller link needs energy from storage (energy < 400)
        if (links.controller) {
            const controllerLink = Game.getObjectById(links.controller) as StructureLink;
            if (controllerLink && controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) < 400 && storageLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                tasks.push({
                    source: storageLink.id,
                    target: controllerLink.id,
                    resourceType: RESOURCE_ENERGY,
                    priority: 4,
                    taskType: "link_transfer_storage_to_controller",
                    debug: `Transfer energy from storage link to controller link`
                });
            }
        }
    }

    private addUnwantedResourceTasks(tasks: TransferTask[]): void {
        if (!this.creep || !this.room.storage) return;

        // Add tasks to deposit non-energy resources that don't match current task
        for (const resourceType in this.creep.store) {
            const resource = resourceType as ResourceConstant;
            if (this.creep.store[resource]! > 0) {
                // Check if this resource matches the current cached task
                const isTaskResource = this.creep.memory.cachedTask?.task.resourceType === resource;

                // Only create deposit task for resources that don't match current task
                if (!isTaskResource && resource !== RESOURCE_ENERGY) {
                    tasks.push({
                        target: this.room.storage.id,
                        resourceType: resource,
                        priority: 10,
                        taskType: "deposit_to_storage",
                        debug: `Deposit ${resource} to storage`
                    });
                }
            }
        }
    }

    private addContainerTasks(tasks: TransferTask[]): void {
        if (!this.room.storage || !this.room.memory.config.fieldContainers) return;

        for (const containerConfig of this.room.memory.config.fieldContainers) {
            const container = this.room.find<StructureContainer>(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER &&
                           s.pos.x === containerConfig.x &&
                           s.pos.y === containerConfig.y &&
                           s.store.getFreeCapacity(RESOURCE_ENERGY) > 400
            })[0];

            if (container) {
                tasks.push({
                    source: this.room.storage.id,
                    target: container.id,
                    resourceType: RESOURCE_ENERGY,
                    priority: 7,
                    taskType: "fill_container_energy",
                    debug: `Fill field container ${container.id}`
                });
            }
        }
    }

    private addInfrastructureTasks(tasks: TransferTask[]): void {
        if (!this.room.storage) return;

        this.addTowerTasks(tasks);
        this.addLabTasks(tasks);
        this.addNukerTasks(tasks);
        this.addPowerSpawnTasks(tasks);
        this.addFactoryTasks(tasks);
        this.addTerminalTasks(tasks);
    }

    private addTowerTasks(tasks: TransferTask[]): void {
        const towers = this.room.find<StructureTower>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_TOWER &&
                        s.store.getFreeCapacity(RESOURCE_ENERGY) > 200
        });

        for (const tower of towers) {
            if (this.room.storage!.store.getUsedCapacity(RESOURCE_ENERGY) > 10000) {
                const isCritical = tower.store.getUsedCapacity(RESOURCE_ENERGY) < 400;
                tasks.push({
                    source: this.room.storage!.id,
                    target: tower.id,
                    resourceType: RESOURCE_ENERGY,
                    priority: isCritical ? 20 : 24,
                    taskType: isCritical ? "fill_tower_critical" : "fill_tower",
                    debug: `Fill tower ${tower.id} (${tower.store.getUsedCapacity(RESOURCE_ENERGY)}/${tower.store.getCapacity(RESOURCE_ENERGY)})`
                });
            }
        }
    }

    private addLabTasks(tasks: TransferTask[]): void {
        const labs = this.room.find<StructureLab>(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LAB &&
                        s.store.getFreeCapacity(RESOURCE_ENERGY) > 200
        });

        for (const lab of labs) {
            if (this.room.storage!.store.getUsedCapacity(RESOURCE_ENERGY) > 125000) {
                tasks.push({
                    source: this.room.storage!.id,
                    target: lab.id,
                    resourceType: RESOURCE_ENERGY,
                    priority: 30,
                    taskType: "fill_lab_energy",
                    debug: `Fill lab ${lab.id}`
                });
            }
        }
    }

    private addNukerTasks(tasks: TransferTask[]): void {
        const nukers = this.room.find<StructureNuker>(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_NUKER
        });

        for (const nuker of nukers) {
            // Energy task
            if (nuker.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                this.room.storage!.store.getUsedCapacity(RESOURCE_ENERGY) > 200000) {
                tasks.push({
                    source: this.room.storage!.id,
                    target: nuker.id,
                    resourceType: RESOURCE_ENERGY,
                    priority: 30,
                    taskType: "fill_nuker_energy",
                    debug: `Fill nuker ${nuker.id} energy`
                });
            }

            // Ghodium task
            if (nuker.store.getFreeCapacity(RESOURCE_GHODIUM) > 0 &&
                this.room.terminal?.store.getUsedCapacity(RESOURCE_GHODIUM)! > 0) {
                tasks.push({
                    source: this.room.terminal!.id,
                    target: nuker.id,
                    resourceType: RESOURCE_GHODIUM,
                    priority: 31,
                    taskType: "fill_nuker_ghodium",
                    debug: `Fill nuker ${nuker.id} ghodium`
                });
            } else if (nuker.store.getFreeCapacity(RESOURCE_GHODIUM) > 0 &&
                this.room.storage?.store.getUsedCapacity(RESOURCE_GHODIUM)! > 0) {
                tasks.push({
                    source: this.room.storage!.id,
                    target: nuker.id,
                    resourceType: RESOURCE_GHODIUM,
                    priority: 31,
                    taskType: "fill_nuker_ghodium",
                    debug: `Fill nuker ${nuker.id} ghodium`
                });
            }
        }
    }

    private addPowerSpawnTasks(tasks: TransferTask[]): void {
        const powerSpawns = this.room.find<StructurePowerSpawn>(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_POWER_SPAWN
        });

        for (const powerSpawn of powerSpawns) {
            // Energy task
            if (powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY) > 800 &&
                this.room.storage!.store.getUsedCapacity(RESOURCE_ENERGY) > 200000) {
                tasks.push({
                    source: this.room.storage!.id,
                    target: powerSpawn.id,
                    resourceType: RESOURCE_ENERGY,
                    priority: 30,
                    taskType: "fill_powerspawn_energy",
                    debug: `Fill power spawn ${powerSpawn.id} energy`
                });
            }

            // Power task
            if (powerSpawn.store.getFreeCapacity(RESOURCE_POWER) > 0 &&
                this.room.terminal?.store.getUsedCapacity(RESOURCE_POWER)! > 0) {
                tasks.push({
                    source: this.room.terminal!.id,
                    target: powerSpawn.id,
                    resourceType: RESOURCE_POWER,
                    priority: 31,
                    taskType: "fill_powerspawn_power",
                    debug: `Fill power spawn ${powerSpawn.id} power`
                });
            }
        }
    }

    private addFactoryTasks(tasks: TransferTask[]): void {
        const factories = this.room.find<StructureFactory>(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_FACTORY &&
                        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        });

        for (const factory of factories) {
            if (this.room.storage!.store.getUsedCapacity(RESOURCE_ENERGY) > 200000) {
                tasks.push({
                    source: this.room.storage!.id,
                    target: factory.id,
                    resourceType: RESOURCE_ENERGY,
                    priority: 40,
                    taskType: "fill_factory_energy",
                    debug: `Fill factory ${factory.id}`
                });
            }
        }
    }

    private addTerminalTasks(tasks: TransferTask[]): void {
        if (!this.room.terminal) return;

        // Fill terminal if energy is low
        if (this.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) < 30000 &&
            this.room.storage!.store.getUsedCapacity(RESOURCE_ENERGY) > 100000) {
            tasks.push({
                source: this.room.storage!.id,
                target: this.room.terminal.id,
                resourceType: RESOURCE_ENERGY,
                priority: 50,
                taskType: "fill_terminal_energy",
                debug: `Fill terminal energy`
            });
        }

        // Empty terminal if energy is high
        if (this.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) > 150000 &&
            this.room.storage!.store.getUsedCapacity(RESOURCE_ENERGY) < 300000) {
            tasks.push({
                source: this.room.terminal.id,
                target: this.room.storage!.id,
                resourceType: RESOURCE_ENERGY,
                priority: 60,
                taskType: "fill_storage_energy",
                debug: `Transfer terminal energy to storage`
            });
        }

        // Move any non-energy resources from storage to terminal when terminal is critically low on energy
        // This helps free up storage and place non-energy resources where they can be handled later
        if (this.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) < 20000 &&
            this.room.storage!.store.getUsedCapacity(RESOURCE_ENERGY) > 300000) {
            for (const resourceType in this.room.storage!.store) {
                const resource = resourceType as ResourceConstant;
                if (resource === RESOURCE_ENERGY) continue;
                const amountInStorage = this.room.storage!.store.getUsedCapacity(resource);
                // Only move resources that actually exist in storage and terminal has space
                if (amountInStorage > 0 && this.room.terminal.store.getFreeCapacity(resource) > 0) {
                    tasks.push({
                        source: this.room.storage!.id,
                        target: this.room.terminal.id,
                        resourceType: resource,
                        priority: 70,
                        taskType: "fill_terminal_from_excess",
                        debug: `Move excess ${resource} from storage to terminal because terminal energy is low`
                    });
                }
            }
        }
    }

    // =====================================================================================
    // LINK MANAGEMENT
    // =====================================================================================

    private getCachedLinks(): CachedLinks {
        // Refresh cache every 100 ticks
        if (!this.room.memory._gs_links || Game.time % 100 === 0) {
            this.refreshLinksCache();
        }
        return this.room.memory._gs_links as CachedLinks;
    }

    private refreshLinksCache(): void {
        const config = this.room.memory.config;
        const sources: Id<StructureLink>[] = [];
        const fields: Id<StructureLink>[] = [];
        let storage: Id<StructureLink> | undefined;
        let controller: Id<StructureLink> | undefined;

        // Find source links
        if (config.energysources) {
            for (const source of config.energysources) {
                if (source.linkpos) {
                    const link = this.findLinkAtPosition(source.linkpos.x, source.linkpos.y);
                    if (link) sources.push(link.id);
                }
            }
        }

        // Find storage link
        if (config.storagelink) {
            const link = this.findLinkAtPosition(config.storagelink.x, config.storagelink.y);
            if (link) storage = link.id;
        }

        // Find controller link
        if (config.controllerLink) {
            const link = this.findLinkAtPosition(config.controllerLink.x, config.controllerLink.y);
            if (link) controller = link.id;
        }

        // Find field links
        if (config.fieldLinks) {
            for (const fieldLink of config.fieldLinks) {
                const link = this.findLinkAtPosition(fieldLink.x, fieldLink.y);
                if (link) fields.push(link.id);
            }
        }

        this.room.memory._gs_links = { storage, controller, sources, fields };
    }

    private findLinkAtPosition(x: number, y: number): StructureLink | null {
        return this.room.find<StructureLink>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK && s.pos.x === x && s.pos.y === y
        })[0] || null;
    }

    // =====================================================================================
    // UTILITY METHODS
    // =====================================================================================

    private parkCreep(): void {
        if (!this.creep || !this.room.memory.config.chemist?.parking) return;

        const parkingPos = new RoomPosition(
            this.room.memory.config.chemist.parking.x,
            this.room.memory.config.chemist.parking.y,
            this.room.name
        );

        this.creep.travelTo(parkingPos, { reusePath: 50 });
        this.creep.say("💤");
    }

    // =====================================================================================
    // DEBUG VISUALIZATION
    // =====================================================================================

    private drawDebugInfo(): void {
        const visual = this.room.visual;
        const startX = 1;
        const startY = 1;
        let yOffset = 0;

        // Background box
        visual.rect(startX - 0.5, startY - 0.5, 25, 20, {
            fill: '#000000',
            opacity: 0.5,
            stroke: '#ffffff',
            strokeWidth: 0.1
        });

        const textStyle = { color: '#ffffff', fontSize: 0.7, align: 'left' as const };

        // Show room and operator status first
        visual.text(`Room: ${this.room.name}`, startX, startY + yOffset++, textStyle);
        visual.text(`Storage: ${this.room.storage ? 'Yes' : 'No'}`, startX, startY + yOffset++, textStyle);

        // Creep status
        if (!this.creep) {
            visual.text(`Creep: NOT FOUND`, startX, startY + yOffset++, { ...textStyle, color: '#ff0000' });

            // Show what creeps exist in the room for debugging
            const roomCreeps = this.room.find(FIND_MY_CREEPS);
            visual.text(`Room Creeps: ${roomCreeps.length}`, startX, startY + yOffset++, textStyle);
            roomCreeps.slice(0, 5).forEach(creep => {
                visual.text(`  ${creep.name} (${creep.memory.role})`, startX, startY + yOffset++, { ...textStyle, color: '#cccccc' });
            });
        } else {
            // Basic creep info
            visual.text(`Creep: ${this.creep.name}`, startX, startY + yOffset++, textStyle);
            visual.text(`State: ${this.creep.memory.state || 'Unknown'}`, startX, startY + yOffset++, textStyle);

            // Store info
            const storeInfo = Object.keys(this.creep.store)
                .filter(resource => this.creep!.store[resource as ResourceConstant]! > 0)
                .map(resource => `${resource}:${this.creep!.store[resource as ResourceConstant]}`)
                .join(', ') || 'Empty';
            visual.text(`Store: ${storeInfo}`, startX, startY + yOffset++, textStyle);

            // Current task
            if (this.creep.memory.cachedTask) {
                const task = this.creep.memory.cachedTask.task;
                visual.text(`Task: ${task.taskType} (P${task.priority})`, startX, startY + yOffset++, { ...textStyle, color: '#ffff00' });
                visual.text(`Resource: ${task.resourceType}`, startX, startY + yOffset++, { ...textStyle, color: '#ffff00' });
                if (task.debug) {
                    visual.text(`Debug: ${task.debug}`, startX, startY + yOffset++, { ...textStyle, color: '#8888ff' });
                }
            } else {
                visual.text(`Task: None`, startX, startY + yOffset++, textStyle);
            }
        }

        yOffset++; // Empty line

        // Link status info (show this regardless of creep status)
        const links = this.getCachedLinks();
        if (links.storage || links.sources.length > 0 || links.fields.length > 0 || links.controller) {
            visual.text(`Link Network Status:`, startX, startY + yOffset++, { ...textStyle, color: '#00ff00' });

            // Storage link
            if (links.storage) {
                const storageLink = Game.getObjectById(links.storage) as StructureLink;
                if (storageLink) {
                    const energy = storageLink.store.getUsedCapacity(RESOURCE_ENERGY);
                    const capacity = storageLink.store.getCapacity(RESOURCE_ENERGY);
                    const cooldown = storageLink.cooldown > 0 ? ` CD:${storageLink.cooldown}` : '';
                    visual.text(`  Storage: ${energy}/${capacity}${cooldown}`, startX, startY + yOffset++, textStyle);
                } else {
                    visual.text(`  Storage: NOT FOUND`, startX, startY + yOffset++, { ...textStyle, color: '#ff0000' });
                }
            } else {
                visual.text(`  Storage: NOT CONFIGURED`, startX, startY + yOffset++, { ...textStyle, color: '#ff8800' });
            }

            // Source links
            if (links.sources.length > 0) {
                links.sources.forEach((sourceLinkId, index) => {
                    const sourceLink = Game.getObjectById(sourceLinkId) as StructureLink;
                    if (sourceLink) {
                        const energy = sourceLink.store.getUsedCapacity(RESOURCE_ENERGY);
                        const capacity = sourceLink.store.getCapacity(RESOURCE_ENERGY);
                        const cooldown = sourceLink.cooldown > 0 ? ` CD:${sourceLink.cooldown}` : '';
                        const needsTransfer = energy > 800 ? ' [FULL]' : '';
                        visual.text(`  Source${index + 1}: ${energy}/${capacity}${cooldown}${needsTransfer}`, startX, startY + yOffset++,
                            needsTransfer ? { ...textStyle, color: '#ff8800' } : textStyle);
                    } else {
                        visual.text(`  Source${index + 1}: NOT FOUND`, startX, startY + yOffset++, { ...textStyle, color: '#ff0000' });
                    }
                });
            } else {
                visual.text(`  Sources: NONE CONFIGURED`, startX, startY + yOffset++, { ...textStyle, color: '#ff8800' });
            }

            // Field links
            if (links.fields.length > 0) {
                links.fields.forEach((fieldLinkId, index) => {
                    const fieldLink = Game.getObjectById(fieldLinkId) as StructureLink;
                    if (fieldLink) {
                        const energy = fieldLink.store.getUsedCapacity(RESOURCE_ENERGY);
                        const capacity = fieldLink.store.getCapacity(RESOURCE_ENERGY);
                        const cooldown = fieldLink.cooldown > 0 ? ` CD:${fieldLink.cooldown}` : '';
                        const needsEnergy = energy < 800 ? ' [LOW]' : '';
                        visual.text(`  Field${index + 1}: ${energy}/${capacity}${cooldown}${needsEnergy}`, startX, startY + yOffset++,
                            needsEnergy ? { ...textStyle, color: '#ff8800' } : textStyle);
                    } else {
                        visual.text(`  Field${index + 1}: NOT FOUND`, startX, startY + yOffset++, { ...textStyle, color: '#ff0000' });
                    }
                });
            }

            // Controller link
            if (links.controller) {
                const controllerLink = Game.getObjectById(links.controller) as StructureLink;
                if (controllerLink) {
                    const energy = controllerLink.store.getUsedCapacity(RESOURCE_ENERGY);
                    const capacity = controllerLink.store.getCapacity(RESOURCE_ENERGY);
                    const cooldown = controllerLink.cooldown > 0 ? ` CD:${controllerLink.cooldown}` : '';
                    const needsEnergy = energy < 500 ? ' [LOW]' : '';
                    visual.text(`  Controller: ${energy}/${capacity}${cooldown}${needsEnergy}`, startX, startY + yOffset++,
                        needsEnergy ? { ...textStyle, color: '#ff8800' } : textStyle);
                } else {
                    visual.text(`  Controller: NOT FOUND`, startX, startY + yOffset++, { ...textStyle, color: '#ff0000' });
                }
            }
        } else {
            visual.text(`Link Network: NOT CONFIGURED`, startX, startY + yOffset++, { ...textStyle, color: '#ff8800' });
        }

        yOffset++; // Empty line

        // Available tasks (show even without creep to see what would be available)
        if (this.creep && this.room.storage) {
            const availableTasks = this.generateTasks();
            visual.text(`Available Tasks (${availableTasks.length}):`, startX, startY + yOffset++, textStyle);

            if (availableTasks.length === 0) {
                visual.text(`  NO TASKS AVAILABLE`, startX, startY + yOffset++, { ...textStyle, color: '#ff8800' });
            } else {
                availableTasks
                    .sort((a, b) => a.priority - b.priority)
                    .slice(0, 8)
                    .forEach(task => {
                        const isLinkTask = task.taskType.startsWith('link_transfer_');
                        visual.text(`  ${task.taskType} (P${task.priority})`, startX, startY + yOffset++,
                            isLinkTask ? { ...textStyle, color: '#00ffff' } : { ...textStyle, color: '#cccccc' });
                    });
            }

            // Highlight current target
            if (this.creep.memory.cachedTask) {
                const target = Game.getObjectById(this.creep.memory.cachedTask.task.target);
                if (target) {
                    visual.circle(target.pos, { radius: 0.5, fill: 'transparent', stroke: '#ff0000', strokeWidth: 0.2 });
                }
            }
        } else {
            visual.text(`Tasks: Cannot generate (need creep + storage)`, startX, startY + yOffset++, { ...textStyle, color: '#ff8800' });
        }
    }
}

// =====================================================================================
// GLOBAL EXTENSIONS
// =====================================================================================

declare global {
    interface String {
        hashCode(): number;
    }
}

if (!String.prototype.hashCode) {
    String.prototype.hashCode = function() {
        let hash = 0;
        for (let i = 0; i < this.length; i++) {
            const char = this.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash;
    };
}
