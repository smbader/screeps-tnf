import { Operator } from "../classes/operator";
import { MapHelper } from "../utils/MapHelper";

declare const REACTIONS: { [reagent1: string]: { [reagent2: string]: string } };

type CachedLinks = {
    storage?: Id<StructureLink>;
    controller?: Id<StructureLink>;
    sources: Id<StructureLink>[];
    fields: Id<StructureLink>[];
};

type EnergyState = "deficit" | "moderate" | "surplus";

interface TransferTask {
    source?: Id<FieldStructure>;
    target: Id<FieldStructure>;
    resourceType: ResourceConstant;
    priority: number;
    taskType: string;
    debug?: string;
}

export class GroundSupportCreep extends Creep {
    memory!: CreepMemory & {
        working?: boolean;
        phase?: string | null;
        targetContainer?: Id<FieldStructure> | null;
        sourceContainer?: Id<FieldStructure> | null;
        resourceType?: ResourceConstant | null;
        linkSendTo?: Id<StructureLink> | null;
    };

    constructor(creepid: Id<Creep>) {
        super(creepid);
    }
}

export class GroundSupport extends Operator {
    creep: GroundSupportCreep | null;

    constructor(name: string, room: Room) {
        super(name, room);
        this.creep = Game.creeps[name] ? new GroundSupportCreep(Game.creeps[name].id) : null;
        this.room = room;
    }

    // --- Link Caching ---
    private cacheLinks(): CachedLinks {
        // Only refresh cache every 100 ticks
        if (!this.room.memory._gs_links || Game.time % 100 === 0) {
            const config = this.room.memory.config;
            const sources: Id<StructureLink>[] = [];
            if (config.energysources) {
                for (const src of config.energysources) {
                    if (src.linkpos) {
                        const link = this.room.find<StructureLink>(FIND_STRUCTURES, {
                            filter: l =>
                                l.structureType === STRUCTURE_LINK &&
                                l.pos.x === src.linkpos.x &&
                                l.pos.y === src.linkpos.y
                        })[0];
                        if (link) sources.push(link.id);
                    }
                }
            }
            // Storage link
            let storage: Id<StructureLink> | undefined;
            if (config.storagelink) {
                const link = this.room.find<StructureLink>(FIND_STRUCTURES, {
                    filter: l =>
                        l.structureType === STRUCTURE_LINK &&
                        l.pos.x === config.storagelink.x &&
                        l.pos.y === config.storagelink.y
                })[0];
                if (link) storage = link.id;
            }
            // Controller link
            let controller: Id<StructureLink> | undefined;
            if (config.controllerLink) {
                const link = this.room.find<StructureLink>(FIND_STRUCTURES, {
                    filter: l =>
                        l.structureType === STRUCTURE_LINK &&
                        l.pos.x === config.controllerLink.x &&
                        l.pos.y === config.controllerLink.y
                })[0];
                if (link) controller = link.id;
            }
            // Field links
            const fields: Id<StructureLink>[] = [];
            if (config.fieldLinks) {
                for (const fl of config.fieldLinks) {
                    const link = this.room.find<StructureLink>(FIND_STRUCTURES, {
                        filter: l =>
                            l.structureType === STRUCTURE_LINK &&
                            l.pos.x === fl.x &&
                            l.pos.y === fl.y
                    })[0];
                    if (link) fields.push(link.id);
                }
            }

            this.room.memory._gs_links = {
                storage,
                controller,
                sources,
                fields
            };
        }
        return this.room.memory._gs_links as CachedLinks;
    }

    // --- Room Energy State ---
    private updateRoomEnergyState(): EnergyState {
        const storageEnergy = this.room.storage ? this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) : 0;
        const terminalEnergy = this.room.terminal ? this.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) : 0;
        const totalEnergy = storageEnergy + terminalEnergy;

        let state: EnergyState;
        if (totalEnergy < 350000) {
            state = "deficit";
        } else if (totalEnergy > 750000) {
            state = "surplus";
        } else {
            state = "moderate";
        }
        this.room.memory._gs_energyState = state;
        return state;
    }

    // --- Link Orchestration ---
    private fireLinks(): void {
        const cached = this.cacheLinks();
        const storageLink = cached.storage ? Game.getObjectById(cached.storage) as StructureLink : undefined;
        const controllerLink = cached.controller ? Game.getObjectById(cached.controller) as StructureLink : undefined;
        const fieldLinks = cached.fields.map(id => Game.getObjectById(id) as StructureLink).filter(Boolean);
        const sourceLinks = cached.sources.map(id => Game.getObjectById(id) as StructureLink).filter(Boolean);

        const debug: string[] = [];

        // 1. Priority: Offloading source links
        for (const srcLink of sourceLinks) {
            const srcPct = srcLink.store.getUsedCapacity(RESOURCE_ENERGY) / srcLink.store.getCapacity(RESOURCE_ENERGY);
            debug.push(`SourceLink ${srcLink.id}: ${Math.round(srcPct * 100)}%`);
            if (srcPct > 0.85) {
                // Storage link must be empty first
                if (storageLink && storageLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    debug.push(`StorageLink ${storageLink.id} not empty. Requesting offload to storage.`);
                } else if (
                    storageLink &&
                    srcLink.cooldown === 0 &&
                    storageLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                ) {
                    // Transfer from source link to storage link
                    const result = srcLink.transferEnergy(storageLink);
                    debug.push(`SourceLink ${srcLink.id} -> StorageLink ${storageLink.id} [${result}]`);
                }
            }
        }

        // 2. Priority: Filling field links (if any)
        for (const fieldLink of fieldLinks) {
            const fieldPct = fieldLink.store.getUsedCapacity(RESOURCE_ENERGY) / fieldLink.store.getCapacity(RESOURCE_ENERGY);
            debug.push(`FieldLink ${fieldLink.id}: ${Math.round(fieldPct * 100)}%`);
            if (fieldPct < 0.5) {
                const missing = fieldLink.store.getCapacity(RESOURCE_ENERGY) - fieldLink.store.getUsedCapacity(RESOURCE_ENERGY);
                if (storageLink && storageLink.store.getUsedCapacity(RESOURCE_ENERGY) < missing) {
                    debug.push(`StorageLink ${storageLink.id} not full enough (${storageLink.store.getUsedCapacity(RESOURCE_ENERGY)}/${missing}). Requesting fill from storage.`);
                } else if (
                    storageLink &&
                    fieldLink.cooldown === 0 &&
                    storageLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0
                ) {
                    const result = storageLink.transferEnergy(fieldLink);
                    debug.push(`StorageLink ${storageLink.id} -> FieldLink ${fieldLink.id} (${missing}) [${result}]`);
                }
            }
        }

        // 3. Priority: Filling controller link
        if (controllerLink) {
            const ctrlPct = controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) / controllerLink.store.getCapacity(RESOURCE_ENERGY);
            debug.push(`ControllerLink ${controllerLink.id}: ${Math.round(ctrlPct * 100)}%`);
            if (ctrlPct < 0.25) {
                const missing = controllerLink.store.getCapacity(RESOURCE_ENERGY) - controllerLink.store.getUsedCapacity(RESOURCE_ENERGY);
                if (storageLink && storageLink.store.getUsedCapacity(RESOURCE_ENERGY) < missing) {
                    debug.push(`StorageLink ${storageLink.id} not full enough (${storageLink.store.getUsedCapacity(RESOURCE_ENERGY)}/${missing}). Requesting fill from storage.`);
                } else if (
                    storageLink &&
                    controllerLink.cooldown === 0 &&
                    storageLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0
                ) {
                    const result = storageLink.transferEnergy(controllerLink);
                    debug.push(`StorageLink ${storageLink.id} -> ControllerLink ${controllerLink.id} (${missing}) [${result}]`);
                }
            }
        }

        // Save debug info for visualization
        this.room.memory._gs_linkDebugInfo = debug;
    }

    // --- Creep Tasks ---
    private getTasks(): TransferTask[] {
        const tasks: TransferTask[] = [];
        const room = this.room;
        const creep = this.creep;
        if (!creep || !room.storage) return tasks;

        // Update energy state first
        const energyState: EnergyState = this.updateRoomEnergyState();

        // Cache links
        const cached = this.cacheLinks();
        const storageLink = cached.storage ? Game.getObjectById(cached.storage) as StructureLink : undefined;
        const controllerLink = cached.controller ? Game.getObjectById(cached.controller) as StructureLink : undefined;
        const fieldLinks = cached.fields.map(id => Game.getObjectById(id) as StructureLink).filter(Boolean);
        const sourceLinks = cached.sources.map(id => Game.getObjectById(id) as StructureLink).filter(Boolean);

        // --- New: Energy supply redistribution ---
        const storageEnergy = room.storage ? room.storage.store.getUsedCapacity(RESOURCE_ENERGY) : 0;
        const terminal = room.terminal;
        const terminalEnergy = terminal ? terminal.store.getUsedCapacity(RESOURCE_ENERGY) : 0;

        if (energyState === "deficit" && terminal && terminalEnergy > 50000) {
            tasks.push({
                source: terminal.id,
                target: room.storage.id,
                resourceType: RESOURCE_ENERGY,
                priority: 0,
                taskType: "terminal_to_storage_deficit",
                debug: "Room deficit: moving energy from terminal to storage"
            });
        } else if (energyState === "surplus" && terminal && terminalEnergy < 150000 && storageEnergy > 0) {
            tasks.push({
                source: room.storage.id,
                target: terminal.id,
                resourceType: RESOURCE_ENERGY,
                priority: 0,
                taskType: "storage_to_terminal_surplus",
                debug: "Room surplus: moving energy from storage to terminal"
            });
        }

        // 1. Offload storage link to storage if source links need to offload
        for (const srcLink of sourceLinks) {
            const srcPct = srcLink.store.getUsedCapacity(RESOURCE_ENERGY) / srcLink.store.getCapacity(RESOURCE_ENERGY);
            if (srcPct > 0.85 && storageLink && storageLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                tasks.push({
                    source: storageLink.id,
                    target: room.storage.id,
                    resourceType: RESOURCE_ENERGY,
                    priority: 1,
                    taskType: "offload_storage_link_for_source",
                    debug: `Offload storage link ${storageLink.id} for source link ${srcLink.id}`
                });
                break;
            }
        }

        // 2. Fill storage link if any field link needs energy
        for (const fieldLink of fieldLinks) {
            const fieldPct = fieldLink.store.getUsedCapacity(RESOURCE_ENERGY) / fieldLink.store.getCapacity(RESOURCE_ENERGY);
            if (fieldPct < 0.5 && storageLink) {
                const missing = fieldLink.store.getCapacity(RESOURCE_ENERGY) - fieldLink.store.getUsedCapacity(RESOURCE_ENERGY);
                if (storageLink.store.getUsedCapacity(RESOURCE_ENERGY) < missing) {
                    tasks.push({
                        source: room.storage.id,
                        target: storageLink.id,
                        resourceType: RESOURCE_ENERGY,
                        priority: 2,
                        taskType: "fill_storage_link_for_field",
                        debug: `Fill storage link ${storageLink.id} for field link ${fieldLink.id} (${missing})`
                    });
                    break;
                }
            }
        }

        // 3. Fill storage link if controller link needs energy
        if (controllerLink) {
            const ctrlPct = controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) / controllerLink.store.getCapacity(RESOURCE_ENERGY);
            if (ctrlPct < 0.25 && storageLink) {
                const missing = controllerLink.store.getCapacity(RESOURCE_ENERGY) - controllerLink.store.getUsedCapacity(RESOURCE_ENERGY);
                if (storageLink.store.getUsedCapacity(RESOURCE_ENERGY) < missing) {
                    tasks.push({
                        source: room.storage.id,
                        target: storageLink.id,
                        resourceType: RESOURCE_ENERGY,
                        priority: 3,
                        taskType: "fill_storage_link_for_controller",
                        debug: `Fill storage link ${storageLink.id} for controller link ${controllerLink.id} (${missing})`
                    });
                }
            }
        }

        // 4. Fill field containers
        if (room.memory.config.fieldContainers) {
            for (const fc of room.memory.config.fieldContainers) {
                const container = this.room.find<StructureContainer>(FIND_STRUCTURES, {
                    filter: l =>
                        l.structureType === STRUCTURE_CONTAINER &&
                        l.pos.x === fc.x &&
                        l.pos.y === fc.y &&
                        l.store.getFreeCapacity(RESOURCE_ENERGY) > 400
                })[0];
                if (container) {
                    tasks.push({
                        source: room.storage.id,
                        target: container.id,
                        resourceType: RESOURCE_ENERGY,
                        priority: 7,
                        taskType: "fill_container_energy",
                        debug: `Fill container ${container.id}`
                    });
                }
            }
        }

        // 5. Deposit any non-energy resources creep may be carrying into storage
        if (creep.store.getUsedCapacity() > 0) {
            for (const resourceType in creep.store) {
                if (resourceType !== RESOURCE_ENERGY && creep.store[resourceType as ResourceConstant]! > 0) {
                    tasks.push({
                        target: room.storage.id,
                        resourceType: resourceType as ResourceConstant,
                        priority: 10,
                        taskType: "deposit_to_storage",
                        debug: `Deposit ${resourceType}`
                    });
                }
            }
        }

        // 6. Other critical structures
        // Towers
        const towers = room.find<StructureTower>(FIND_STRUCTURES, {
            filter: t => t.structureType === STRUCTURE_TOWER && t.store.getFreeCapacity(RESOURCE_ENERGY) > 200
        });
        towers.forEach((tower) => {
            if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 10000) {
                tasks.push({
                    source: room.storage.id,
                    target: tower.id,
                    resourceType: RESOURCE_ENERGY,
                    priority: tower.store.getUsedCapacity(RESOURCE_ENERGY) < 400 ? 20 : 24,
                    taskType: tower.store.getUsedCapacity(RESOURCE_ENERGY) < 400 ? "fill_tower_critical" : "fill_tower",
                    debug: `Fill tower ${tower.id} ${tower.store.getUsedCapacity(RESOURCE_ENERGY)}/${tower.store.getCapacity(RESOURCE_ENERGY)}`
                });
            }
        });

        // Labs
        const labs = room.find<StructureLab>(FIND_MY_STRUCTURES, {
            filter: l => l.structureType === STRUCTURE_LAB && l.store.getFreeCapacity(RESOURCE_ENERGY) > 200
        });
        labs.forEach((lab) => {
            if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 125000) {
                tasks.push({
                    source: room.storage.id,
                    target: lab.id,
                    resourceType: RESOURCE_ENERGY,
                    priority: 30,
                    taskType: "fill_lab_energy",
                    debug: `Fill lab ${lab.id}`
                });
            }
        });

        // Nukers
        const nukers = room.find<StructureNuker>(FIND_MY_STRUCTURES, {
            filter: n => n.structureType === STRUCTURE_NUKER && n.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        });
        nukers.forEach((nuker) => {
            if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 200000) {
                tasks.push({
                    source: room.storage.id,
                    target: nuker.id,
                    resourceType: RESOURCE_ENERGY,
                    priority: 30,
                    taskType: "fill_nuker_energy",
                    debug: `Fill nuker ${nuker.id}`
                });
            }
            if (room.terminal && room.terminal.store.getUsedCapacity(RESOURCE_GHODIUM) > 0 && nuker.store.getFreeCapacity(RESOURCE_GHODIUM) > 0) {
                tasks.push({
                    source: room.terminal.id,
                    target: nuker.id,
                    resourceType: RESOURCE_GHODIUM,
                    priority: 31,
                    taskType: "fill_nuker_ghodium",
                    debug: `Fill nuker ${nuker.id} ghodium`
                });
            }
        });

        // Power spawns
        const powerspawns = room.find<StructurePowerSpawn>(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_POWER_SPAWN && (s.store.getFreeCapacity(RESOURCE_ENERGY) > 800 || s.store.getFreeCapacity(RESOURCE_POWER) > 0)
        });
        powerspawns.forEach((ps) => {
            if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 200000 && ps.store.getFreeCapacity(RESOURCE_ENERGY) > 800) {
                tasks.push({
                    source: room.storage.id,
                    target: ps.id,
                    resourceType: RESOURCE_ENERGY,
                    priority: 30,
                    taskType: "fill_powerspawn_energy",
                    debug: `Fill powerspawn ${ps.id}`
                });
            }
            if (room.terminal && room.terminal.store.getUsedCapacity(RESOURCE_POWER) > 0 && ps.store.getFreeCapacity(RESOURCE_POWER) > 0) {
                tasks.push({
                    source: room.terminal.id,
                    target: ps.id,
                    resourceType: RESOURCE_POWER,
                    priority: 31,
                    taskType: "fill_powerspawn_power",
                    debug: `Fill powerspawn ${ps.id} power`
                });
            }
        });

        // Factory
        const factories = room.find<StructureFactory>(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_FACTORY && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        });
        factories.forEach((factory) => {
            if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 200000) {
                tasks.push({
                    source: room.storage.id,
                    target: factory.id,
                    resourceType: RESOURCE_ENERGY,
                    priority: 40,
                    taskType: "fill_factory_energy",
                    debug: `Fill factory ${factory.id}`
                });
            }
        });

        return tasks;
    }

    // --- Efficient movement ---
    private withdrawResource(source: FieldStructure, resourceType: ResourceConstant): boolean {
        const creep = this.creep!;
        const result = creep.withdraw(source, resourceType);
        if (result === ERR_NOT_IN_RANGE) {
            creep.travelTo(source.pos, { reusePath: 25 });
            creep.say(`📥 ${resourceType}`);
            return false;
        } else if (result === OK) {
            creep.say(`✅ ${resourceType}`);
            if (creep.store.getFreeCapacity() === 0 || source.store.getUsedCapacity(resourceType) === 0) {
                this.clearTask();
            }
            return true;
        } else {
            this.clearTask();
            return false;
        }
    }

    private transferResource(target: FieldStructure, resourceType: ResourceConstant): boolean {
        const creep = this.creep!;
        const result = creep.transfer(target, resourceType);
        if (result === ERR_NOT_IN_RANGE) {
            creep.travelTo(target.pos, { reusePath: 25 });
            creep.say(`📤 ${resourceType}`);
            return false;
        } else if (result === OK) {
            creep.say(`✅ ${resourceType}`);
            if (creep.store.getUsedCapacity(resourceType) === 0 || target.store.getFreeCapacity(resourceType) === 0) {
                this.clearTask();
            }
            return true;
        } else {
            this.clearTask();
            return false;
        }
    }

    private clearTask(): void {
        if (this.creep) {
            this.creep.memory.phase = null;
            this.creep.memory.targetContainer = null;
            this.creep.memory.sourceContainer = null;
            this.creep.memory.resourceType = null;
            this.creep.memory.linkSendTo = null;
        }
    }

    private parkCreep(): void {
        const creep = this.creep!;
        creep.travelTo(
            new RoomPosition(this.room.memory.config.chemist.parking.x, this.room.memory.config.chemist.parking.y, this.room.name),
            { reusePath: 50 }
        );
        creep.say("💤");
    }

    // --- Visual Debugging (drawTaskInfo) ---
    private drawTaskInfo(): void {
        if (!this.creep || !this.creep.room) return;

        const visual = this.creep.room.visual;
        const pos = new RoomPosition(1, 1, this.creep.room.name);
        const boxWidth = 22;
        const boxHeight = 26;
        const style = {
            fill: '#000000',
            opacity: 0.5,
            stroke: '#ffffff',
            strokeWidth: 0.1
        };
        visual.rect(pos.x - 0.5, pos.y - 0.5, boxWidth, boxHeight, style);

        let yOffset = 0;
        const creepName = this.creep.name;
        const phase = this.creep.memory.phase || 'Idle';
        const resourceType = this.creep.memory.resourceType || 'None';
        const sourceId = this.creep.memory.sourceContainer || 'None';
        const targetId = this.creep.memory.targetContainer || 'None';
        const linkSendTo = this.creep.memory.linkSendTo || 'None';
        const targetType = this.creep.memory.targetContainer ? Game.getObjectById(this.creep.memory.targetContainer)?.structureType || 'Unknown' : 'None';
        const sourceType = this.creep.memory.sourceContainer ? Game.getObjectById(this.creep.memory.sourceContainer)?.structureType || 'Unknown' : 'None';
        const working = this.creep.memory.working ? 'Withdraw' : 'Transfer';
        const energyState = this.room.memory._gs_energyState || "unknown";

        const textStyle = {
            color: '#ffffff',
            fontSize: 0.7,
            align: 'left' as const,
            opacity: 1
        };

        visual.text(`Creep: ${creepName}`, pos.x, pos.y + yOffset++, textStyle);
        visual.text(`Phase: ${phase} | Mode: ${working}`, pos.x, pos.y + yOffset++, textStyle);
        visual.text(`Resource: ${resourceType}`, pos.x, pos.y + yOffset++, textStyle);
        visual.text(`Source: ${sourceId} (${sourceType})`, pos.x, pos.y + yOffset++, textStyle);
        visual.text(`Target: ${targetId} (${targetType})`, pos.x, pos.y + yOffset++, textStyle);
        visual.text(`Energy State: ${energyState}`, pos.x, pos.y + yOffset++, { ...textStyle, color: (energyState === "deficit" ? "#ff2222" : energyState === "surplus" ? "#22ff22" : "#ffff66")});
        if (linkSendTo !== 'None') {
            visual.text(`Link To: ${linkSendTo}`, pos.x, pos.y + yOffset++, textStyle);
        }

        // Display link orchestration debug info
        const linkDebugInfo = this.room.memory._gs_linkDebugInfo || [];
        if (linkDebugInfo.length > 0) {
            visual.text(`Link Ops:`, pos.x, pos.y + yOffset++, { ...textStyle, color: '#00ffff' });
            linkDebugInfo.slice(0, 18).forEach((line, i) => {
                visual.text(line, pos.x + 1, pos.y + yOffset++, { ...textStyle, color: '#00ffff' });
            });
        }

        // Display tasks
        const tasks = this.getTasks();
        visual.text(`Tasks (${tasks.length}):`, pos.x, pos.y + yOffset++, textStyle);
        tasks.sort((a, b) => a.priority - b.priority).slice(0, 18).forEach((task, index) => {
            const target = Game.getObjectById(task.target) as FieldStructure;
            visual.text(
                `${task.taskType} (P${task.priority}): ${target.structureType} ${task.resourceType}`,
                pos.x + 1,
                pos.y + yOffset++,
                { ...textStyle, color: '#ffff00' }
            );
            if (task.debug) {
                visual.text(`- ${task.debug}`, pos.x + 2, pos.y + yOffset++, { ...textStyle, color: '#8888ff' });
            }
        });

        // Display towers
        const towers = this.room.find<StructureTower>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_TOWER
        });
        towers.forEach((tower, index) => {
            if (this.creep?.memory.targetContainer === tower.id) {
                visual.circle(tower.pos, { radius: 0.5, fill: 'transparent', stroke: '#ff0000', strokeWidth: 0.1 });
            }
        });

        // Display labs, nukers, powerspawns, factories status
        const labs = this.room.find<StructureLab>(FIND_MY_STRUCTURES, { filter: l => l.structureType === STRUCTURE_LAB });
        labs.forEach((lab, idx) => {
            visual.text(`Lab ${lab.id}: ${lab.store.getUsedCapacity(RESOURCE_ENERGY)}/${lab.store.getCapacity(RESOURCE_ENERGY)}`, lab.pos.x + 1, lab.pos.y, { color: '#00ffcc' });
        });
        const nukers = this.room.find<StructureNuker>(FIND_MY_STRUCTURES, { filter: n => n.structureType === STRUCTURE_NUKER });
        nukers.forEach((nuker, idx) => {
            visual.text(`Nuker ${nuker.id}: E=${nuker.store.getUsedCapacity(RESOURCE_ENERGY)}/${nuker.store.getCapacity(RESOURCE_ENERGY)} G=${nuker.store.getUsedCapacity(RESOURCE_GHODIUM)}/${nuker.store.getCapacity(RESOURCE_GHODIUM)}`, nuker.pos.x + 1, nuker.pos.y, { color: '#ffcc00' });
        });
        const powerspawns = this.room.find<StructurePowerSpawn>(FIND_MY_STRUCTURES, { filter: p => p.structureType === STRUCTURE_POWER_SPAWN });
        powerspawns.forEach((ps, idx) => {
            visual.text(`PowerSpawn ${ps.id}: E=${ps.store.getUsedCapacity(RESOURCE_ENERGY)}/${ps.store.getCapacity(RESOURCE_ENERGY)} P=${ps.store.getUsedCapacity(RESOURCE_POWER)}/${ps.store.getCapacity(RESOURCE_POWER)}`, ps.pos.x + 1, ps.pos.y, { color: '#ffccff' });
        });
        const factories = this.room.find<StructureFactory>(FIND_MY_STRUCTURES, { filter: f => f.structureType === STRUCTURE_FACTORY });
        factories.forEach((factory, idx) => {
            visual.text(`Factory ${factory.id}: E=${factory.store.getUsedCapacity(RESOURCE_ENERGY)}/${factory.store.getCapacity(RESOURCE_ENERGY)}`, factory.pos.x + 1, factory.pos.y, { color: '#ccccff' });
        });
        // Display field containers
        if (this.room.memory.config.fieldContainers) {
            for (const fc of this.room.memory.config.fieldContainers) {
                const container = this.room.find<StructureContainer>(FIND_STRUCTURES, {
                    filter: l =>
                        l.structureType === STRUCTURE_CONTAINER &&
                        l.pos.x === fc.x &&
                        l.pos.y === fc.y
                })[0];
                if (container) {
                    visual.text(`FieldCont ${container.id}: ${container.store.getUsedCapacity(RESOURCE_ENERGY)}/${container.store.getCapacity(RESOURCE_ENERGY)}`, container.pos.x + 1, container.pos.y, { color: '#ff8844' });
                }
            }
        }
    }

    actions(): void {
        if (!this.creep || !this.room.storage) {
            return;
        }

        // Orchestrate links per tick (efficient with cache)
        this.fireLinks();

        // Creep only interacts with storage link and storage, and fills towers/labs/nukers/powerspawns/factories/fieldContainers
        this.creep.memory.working = this.creep.store.getUsedCapacity() === 0;

        // Only allow tasks that interact with the storage link and storage
        if (this.creep.memory.phase === "inprogress" && this.creep.memory.targetContainer) {
            const target = Game.getObjectById(this.creep.memory.targetContainer) as FieldStructure | null;
            if (!target) {
                this.clearTask();
                this.drawTaskInfo();
                return;
            }
            const resourceType = this.creep.memory.resourceType || RESOURCE_ENERGY;
            if (this.creep.memory.working && this.creep.memory.sourceContainer) {
                const source = Game.getObjectById(this.creep.memory.sourceContainer) as FieldStructure | null;
                if (!source) {
                    this.clearTask();
                    this.drawTaskInfo();
                    return;
                }
                this.withdrawResource(source, resourceType);
                this.drawTaskInfo();
                return;
            } else if (!this.creep.memory.working && this.creep.store.getUsedCapacity(resourceType) > 0) {
                this.transferResource(target, resourceType);
                this.drawTaskInfo();
                return;
            } else {
                this.clearTask();
                this.drawTaskInfo();
                return;
            }
        }

        const tasks = this.getTasks();
        if (tasks.length > 0) {
            const task = tasks.sort((a, b) => a.priority - b.priority)[0];
            this.creep.memory.phase = "inprogress";
            this.creep.memory.targetContainer = task.target;
            this.creep.memory.sourceContainer = task.source || null;
            this.creep.memory.resourceType = task.resourceType;
            this.creep.memory.linkSendTo = null;
            if (task.source && this.creep.memory.working) {
                const source = Game.getObjectById(task.source) as FieldStructure;
                this.withdrawResource(source, task.resourceType);
            } else if (!task.source && this.creep.store.getUsedCapacity(task.resourceType) > 0) {
                const target = Game.getObjectById(task.target) as FieldStructure;
                this.transferResource(target, task.resourceType);
            }
            this.drawTaskInfo();
            return;
        }

        this.parkCreep();
        this.drawTaskInfo();
    }
}
