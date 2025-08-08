import { Operator } from "../classes/operator";
import { MapHelper } from "../utils/MapHelper";

declare const REACTIONS: { [reagent1: string]: { [reagent2: string]: string } };

const SIEGE_BOOSTS: ResourceConstant[] = ["GHO2", "XZHO2", "XLHO2", "XKHO2", "XUH2O"];
const TIER3_LIST: ResourceConstant[] = [
    "XGH2O", "XGHO2", "XKH2O", "XKHO2", "XLH2O", "XLHO2",
    "XZH2O", "XZHO2", "XUH2O", "XUHO2"
];

interface TransferTask {
    source?: Id<FieldStructure>;
    target: Id<FieldStructure>;
    resourceType: ResourceConstant;
    linkSendTo?: Id<StructureLink>;
    linkCommand?: string;
    priority: number; // Added for task prioritization
    taskType: string; // Added for debugging
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
    memory: {
        sourceid?: Id<FieldStructure>;
        batteryid?: Id<StructureContainer>;
        roomname?: string;
        name?: string;
    };

    creep: GroundSupportCreep | null;

    constructor(name: string, room: Room) {
        super(name, room);
        this.memory = { name, roomname: room.name };
        this.creep = Game.creeps[name] ? new GroundSupportCreep(Game.creeps[name].id) : null;
        this.room = room;
    }

    private initializeMemory(): void {
        if (!this.creep?.room.memory.data && this.creep) {
            this.creep.room.memory.data = {
                storagelinkcommand: "",
                storagelinktarget: null,
                terminal: { energy: 0 },
                labs: { reagents: [], products: [], boosts: [] }
            };
        }
    }

    private withdrawResource(source: FieldStructure, resourceType: ResourceConstant): boolean {
        const creep = this.creep!;
        const result = creep.withdraw(source, resourceType);
        if (result === ERR_NOT_IN_RANGE) {
            creep.travelTo(source.pos, { reusePath: 5 });
            creep.say(`📥 ${resourceType}`);
            return false;
        } else if (result === OK) {
            creep.say(`✅ ${resourceType}`);
            return true;
        } else if (result === ERR_NOT_ENOUGH_RESOURCES && source.structureType === STRUCTURE_LINK) {
            console.log(`[GroundSupport] Link ${source.id} empty for ${resourceType}, clearing task`);
            creep.memory.phase = null;
            creep.memory.targetContainer = null;
            creep.memory.sourceContainer = null;
            creep.memory.resourceType = null;
            creep.memory.linkSendTo = null;
            creep.say(`🛑 Link empty`);
            return false;
        } else {
            console.log(`[GroundSupport] Withdraw failed from ${source.id} (${source.structureType}) for ${resourceType}: ${result}`);
            return false;
        }
    }

    private transferResource(target: FieldStructure, resourceType: ResourceConstant): boolean {
        const creep = this.creep!;
        const result = creep.transfer(target, resourceType);
        if (result === ERR_NOT_IN_RANGE) {
            creep.travelTo(target.pos, { reusePath: 5 });
            creep.say(`📤 ${resourceType}`);
            return false;
        } else if (result === OK) {
            creep.say(`✅ ${resourceType}`);
            return true;
        } else if (result === ERR_FULL && target.store.getFreeCapacity(resourceType) === 0) {
            if (target.structureType !== STRUCTURE_STORAGE && target.structureType !== STRUCTURE_TERMINAL) {
                creep.memory.phase = null;
                creep.memory.targetContainer = null;
                creep.memory.sourceContainer = null;
                creep.memory.resourceType = null;
                creep.memory.linkSendTo = null;
                creep.say(`🛑 ${target.structureType} full`);
            }
            return false;
        } else {
            console.log(`[GroundSupport] Transfer failed to ${target.id} (${target.structureType}) for ${resourceType}: ${result}`);
            return false;
        }
    }

    private parkCreep(): void {
        const creep = this.creep!;
        creep.travelTo(
            new RoomPosition(this.room.memory.config.chemist.parking.x, this.room.memory.config.chemist.parking.y, this.room.name),
            { reusePath: 5 }
        );
        creep.say("💤");
    }

    private getReactants(product: ResourceConstant): [ResourceConstant, ResourceConstant] | null {
        for (const a in REACTIONS) {
            for (const b in REACTIONS[a]) {
                if (REACTIONS[a][b] === product) return [a as ResourceConstant, b as ResourceConstant];
            }
        }
        return null;
    }

    private getStorageOrTerminal(resourceType: ResourceConstant, minAmount: number = 30): StructureStorage | StructureTerminal | null {
        const { storage, terminal } = this.room;
        console.log(`[GroundSupport] Checking source for ${resourceType}: storage=${storage?.store[resourceType] || 0}, terminal=${terminal?.store[resourceType] || 0}, minAmount=${minAmount}`);
        if (storage && storage.store.getUsedCapacity(resourceType) >= minAmount) return storage;
        if (terminal && terminal.store.getUsedCapacity(resourceType) >= minAmount) return terminal;
        return null;
    }

    private handleLabs(): TransferTask | null {
        const { storage, terminal } = this.room;
        if (!storage || !terminal) return null;

        // Unload products from output labs
        for (const product of this.room.memory.data.labs.products) {
            const lab = Game.getObjectById(product.id) as StructureLab | null;
            if (!lab || !lab.mineralType || lab.mineralAmount <= 100) continue;
            if (this.creep!.store.getUsedCapacity() === 0) {
                console.log(`[GroundSupport] Lab unload task: target=${lab.id}, resource=${lab.mineralType}`);
                return { target: lab.id, resourceType: lab.mineralType, priority: 2, taskType: "lab_unload" };
            } else if (this.creep!.store.getUsedCapacity(lab.mineralType) > 0) {
                console.log(`[GroundSupport] Lab deposit task: target=${storage.id}, resource=${lab.mineralType}`);
                return { target: storage.id, resourceType: lab.mineralType, priority: 2, taskType: "lab_deposit" };
            }
        }

        // Handle boost requests
        for (const boost of this.room.memory.data.labs.boosts) {
            const lab = Game.getObjectById(boost.id) as StructureLab | null;
            if (!lab) {
                console.log(`[GroundSupport] Invalid lab ID ${boost.id} in boost request`);
                continue;
            }
            if (lab.mineralType === boost.component && (lab.mineralAmount || 0) >= 1500) continue;
            const src = this.getStorageOrTerminal(boost.component);
            if (src) {
                if (this.creep!.store.getUsedCapacity(boost.component) === 0) {
                    console.log(`[GroundSupport] Lab boost task: source=${src.id}, target=${lab.id}, resource=${boost.component}`);
                    return { source: src.id, target: lab.id, resourceType: boost.component, priority: 1, taskType: "lab_boost_withdraw" };
                } else {
                    console.log(`[GroundSupport] Lab boost transfer: target=${lab.id}, resource=${boost.component}`);
                    return { target: lab.id, resourceType: boost.component, priority: 1, taskType: "lab_boost_transfer" };
                }
            } else {
                console.log(`[GroundSupport] No source has ${boost.component} for lab ${boost.id}`);
            }
        }

        // Handle reactions
        if (this.room.memory.data.labs.reagents.length === 2) {
            const compoundsToMake = [...SIEGE_BOOSTS, ...TIER3_LIST.filter(c => !SIEGE_BOOSTS.includes(c))];
            let targetCompound: ResourceConstant | null = null;
            for (const compound of compoundsToMake) {
                let total = 0;
                if (storage) total += storage.store.getUsedCapacity(compound) || 0;
                if (terminal) total += terminal.store.getUsedCapacity(compound) || 0;
                if (total < 1000) {
                    targetCompound = compound;
                    break;
                }
            }
            if (!targetCompound) return null;

            const outputLabs = this.room.memory.data.labs.products
                .map(p => Game.getObjectById(p.id))
                .filter((l): l is StructureLab => !!l);
            // @ts-ignore
            const canReact = outputLabs.every(lab => !lab.cooldown && lab.store.getFreeCapacity() >= 5);
            if (!canReact) return null;

            const reactants = this.getReactants(targetCompound);
            if (!reactants) return null;

            for (let i = 0; i < 2; i++) {
                const reagent = this.room.memory.data.labs.reagents[i];
                const lab = Game.getObjectById(reagent.id) as StructureLab | null;
                if (!lab) {
                    console.log(`[GroundSupport] Invalid lab ID ${reagent.id} in reagent request`);
                    continue;
                }
                if (lab.mineralType === reactants[i] && (lab.mineralAmount || 0) >= 1500) continue;
                const src = this.getStorageOrTerminal(reactants[i]);
                if (src) {
                    if (this.creep!.store.getUsedCapacity(reactants[i]) === 0) {
                        console.log(`[GroundSupport] Lab reaction task: source=${src.id}, target=${lab.id}, resource=${reactants[i]}`);
                        return { source: src.id, target: lab.id, resourceType: reactants[i], priority: 3, taskType: "lab_reaction_withdraw" };
                    } else {
                        console.log(`[GroundSupport] Lab reaction transfer: target=${lab.id}, resource=${reactants[i]}`);
                        return { target: lab.id, resourceType: reactants[i], priority: 3, taskType: "lab_reaction_transfer" };
                    }
                } else {
                    console.log(`[GroundSupport] No source has ${reactants[i]} for lab ${reagent.id}`);
                }
            }
        }
        return null;
    }

    private getTasks(): TransferTask[] {
        const tasks: TransferTask[] = [];
        const { creep, room } = this;
        if (!creep || !room.storage) return tasks;

        const storageEnergy = room.storage.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
        const terminal = room.terminal;
        const terminalEnergy = terminal ? terminal.store.getUsedCapacity(RESOURCE_ENERGY) || 0 : 0;

        // Task 1: Deposit to storage (high priority if carrying resources)
        if (creep.store.getUsedCapacity() > 0) {
            for (const resourceType in creep.store) {
                if (creep.store[resourceType as ResourceConstant]! > 0) {
                    tasks.push({ target: room.storage.id, resourceType: resourceType as ResourceConstant, priority: 1, taskType: "deposit_to_storage" });
                }
            }
        }

        // Task 2: Handle storage link
        const storagelink = room.find<StructureLink>(FIND_STRUCTURES, {
            filter: s =>
                s.pos.x === room.memory.config.storagelink.x &&
                s.pos.y === room.memory.config.storagelink.y &&
                s.structureType === STRUCTURE_LINK
        })[0];
        if (
            storagelink &&
            storagelink.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
            room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 1000
        ) {
            tasks.push({ source: storagelink.id, target: room.storage.id, resourceType: RESOURCE_ENERGY, priority: 2, taskType: "storage_link_to_storage" });
        }

        // Task 3: Handle field/controller links
        if (room.memory.config.fieldLinks) {
            for (const link of room.memory.config.fieldLinks) {
                const target = room.find<StructureLink>(FIND_STRUCTURES, {
                    filter: s =>
                        s.pos.x === link.x &&
                        s.pos.y === link.y &&
                        s.structureType === STRUCTURE_LINK &&
                        s.store.getFreeCapacity(RESOURCE_ENERGY) > 600
                })[0];
                if (target && storagelink) {
                    tasks.push({
                        source: room.storage.id,
                        target: storagelink.id,
                        resourceType: RESOURCE_ENERGY,
                        linkSendTo: target.id,
                        linkCommand: "outbound",
                        priority: 3,
                        taskType: "field_link_transfer"
                    });
                }
            }
        }
        if (room.memory.config.controllerLink) {
            const target = room.find<StructureLink>(FIND_STRUCTURES, {
                filter: s =>
                    s.pos.x === room.memory.config.controllerLink.x &&
                    s.pos.y === room.memory.config.controllerLink.y &&
                    s.structureType === STRUCTURE_LINK &&
                    s.store.getFreeCapacity(RESOURCE_ENERGY) > 600
            })[0];
            if (target && storagelink) {
                tasks.push({
                    source: room.storage.id,
                    target: storagelink.id,
                    resourceType: RESOURCE_ENERGY,
                    linkSendTo: target.id,
                    linkCommand: "outbound",
                    priority: 3,
                    taskType: "controller_link_transfer"
                });
            }
        }

        // Task 4: Fill all towers
        if (storageEnergy > 10000) {
            const towers = room.find<StructureTower>(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_TOWER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 200
            });
            const criticalTowers = towers.filter(t => t.store.getUsedCapacity(RESOURCE_ENERGY) < 400);
            if (criticalTowers.length > 0) {
                criticalTowers.forEach(tower => {
                    tasks.push({ source: room.storage?.id, target: tower.id, resourceType: RESOURCE_ENERGY, priority: 0, taskType: "fill_tower_critical" });
                });
            } else {
                towers.forEach(tower => {
                    tasks.push({ source: room.storage?.id, target: tower.id, resourceType: RESOURCE_ENERGY, priority: 4, taskType: "fill_tower" });
                });
            }
        }

        // Task 5: Balance terminal/storage energy
        if (terminal) {
            if (terminalEnergy > storageEnergy && storageEnergy < 300000) {
                tasks.push({ source: terminal.id, target: room.storage.id, resourceType: RESOURCE_ENERGY, priority: 5, taskType: "balance_terminal_to_storage" });
            } else if ((terminalEnergy < 35000 && storageEnergy > 100000) || (storageEnergy > 900000 && terminalEnergy < 125000)) {
                tasks.push({ source: room.storage.id, target: terminal.id, resourceType: RESOURCE_ENERGY, priority: 5, taskType: "balance_storage_to_terminal" });
            }
        }

        // Task 6: Move resources to terminal
        if (terminal) {
            for (const resourceType in room.storage.store) {
                if (terminal.store.getUsedCapacity(resourceType as ResourceConstant) < 15000) {
                    tasks.push({ source: room.storage.id, target: terminal.id, resourceType: resourceType as ResourceConstant, priority: 6, taskType: "move_to_terminal" });
                }
            }
        }

        // Task 7: Handle labs (boosts and reactions)
        const labTask = this.handleLabs();
        if (labTask) tasks.push(labTask);

        // Task 8: Fill labs with energy
        if (storageEnergy > 125000) {
            const lab = room.find<StructureLab>(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_LAB && s.store.getFreeCapacity(RESOURCE_ENERGY) > 200
            })[0];
            if (lab) {
                tasks.push({ source: room.storage.id, target: lab.id, resourceType: RESOURCE_ENERGY, priority: 7, taskType: "fill_lab_energy" });
            }
        }

        // Task 9: Fill nukers
        if (storageEnergy > 200000) {
            const nuker = room.find<StructureNuker>(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_NUKER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            })[0];
            if (nuker) {
                tasks.push({ source: room.storage.id, target: nuker.id, resourceType: RESOURCE_ENERGY, priority: 8, taskType: "fill_nuker_energy" });
            }
        }
        if (terminal && terminal.store.getUsedCapacity(RESOURCE_GHODIUM) > 0) {
            const nuker = room.find<StructureNuker>(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_NUKER && s.store.getFreeCapacity(RESOURCE_GHODIUM) > 0
            })[0];
            if (nuker) {
                tasks.push({ source: terminal.id, target: nuker.id, resourceType: RESOURCE_GHODIUM, priority: 8, taskType: "fill_nuker_ghodium" });
            }
        }

        // Task 10: Fill power spawns
        if (storageEnergy > 200000) {
            const powerspawn = room.find<StructurePowerSpawn>(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_POWER_SPAWN && s.store.getFreeCapacity(RESOURCE_ENERGY) > 800
            })[0];
            if (powerspawn) {
                tasks.push({ source: room.storage.id, target: powerspawn.id, resourceType: RESOURCE_ENERGY, priority: 9, taskType: "fill_powerspawn_energy" });
            }
        }
        if (terminal && terminal.store.getUsedCapacity(RESOURCE_POWER) > 0) {
            const powerspawn = room.find<StructurePowerSpawn>(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_POWER_SPAWN && s.store.getFreeCapacity(RESOURCE_POWER) > 50
            })[0];
            if (powerspawn) {
                tasks.push({ source: terminal.id, target: powerspawn.id, resourceType: RESOURCE_POWER, priority: 9, taskType: "fill_powerspawn_power" });
            }
        }

        // Task 11: Fill factories
        if (storageEnergy > 200000) {
            const factory = room.find<StructureFactory>(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_FACTORY && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            })[0];
            if (factory) {
                tasks.push({ source: room.storage.id, target: factory.id, resourceType: RESOURCE_ENERGY, priority: 10, taskType: "fill_factory_energy" });
            }
        }

        console.log(`[GroundSupport] Generated tasks: ${JSON.stringify(tasks.map(t => ({
            taskType: t.taskType,
            priority: t.priority,
            source: t.source,
            target: t.target,
            targetType: Game.getObjectById(t.target)?.structureType,
            resourceType: t.resourceType
        })))}`);
        return tasks;
    }

    private drawTaskInfo(): void {
        if (!this.creep || !this.creep.room) return;

        const visual = this.creep.room.visual;
        const pos = new RoomPosition(1, 1, this.creep.room.name);
        const boxWidth = 20;
        const boxHeight = 10;
        const style = {
            fill: '#000000',
            opacity: 0.5,
            stroke: '#ffffff',
            strokeWidth: 0.1
        };

        visual.rect(pos.x - 0.5, pos.y - 0.5, boxWidth, boxHeight, style);

        const creepName = this.creep.name;
        const phase = this.creep.memory.phase || 'Idle';
        const resourceType = this.creep.memory.resourceType || 'None';
        const sourceId = this.creep.memory.sourceContainer || 'None';
        const targetId = this.creep.memory.targetContainer || 'None';
        const linkSendTo = this.creep.memory.linkSendTo || 'None';
        const targetType = this.creep.memory.targetContainer ? Game.getObjectById(this.creep.memory.targetContainer)?.structureType || 'Unknown' : 'None';
        const sourceType = this.creep.memory.sourceContainer ? Game.getObjectById(this.creep.memory.sourceContainer)?.structureType || 'Unknown' : 'None';
        const working = this.creep.memory.working ? 'Withdraw' : 'Transfer';

        const textStyle = {
            color: '#ffffff',
            fontSize: 0.7,
            align: 'left' as const,
            opacity: 1
        };
        let yOffset = 0;
        visual.text(`Creep: ${creepName}`, pos.x, pos.y + yOffset++, textStyle);
        visual.text(`Phase: ${phase}`, pos.x, pos.y + yOffset++, textStyle);
        visual.text(`Mode: ${working}`, pos.x, pos.y + yOffset++, textStyle);
        visual.text(`Resource: ${resourceType}`, pos.x, pos.y + yOffset++, textStyle);
        visual.text(`Source: ${sourceId} (${sourceType})`, pos.x, pos.y + yOffset++, textStyle);
        visual.text(`Target: ${targetId} (${targetType})`, pos.x, pos.y + yOffset++, textStyle);
        if (linkSendTo !== 'None') {
            visual.text(`Link To: ${linkSendTo}`, pos.x, pos.y + yOffset++, textStyle);
        }

        // Visualize all generated tasks
        const tasks = this.getTasks();
        visual.text(`Tasks (${tasks.length}):`, pos.x, pos.y + yOffset++, textStyle);
        tasks.sort((a, b) => a.priority - b.priority).slice(0, 3).forEach((task, index) => {
            const target = Game.getObjectById(task.target) as FieldStructure;
            visual.text(
                `${task.taskType} (P${task.priority}): ${target.structureType} ${task.resourceType}`,
                pos.x + 1,
                pos.y + yOffset++,
                { ...textStyle, color: task.taskType.includes("tower") ? '#ff0000' : '#ffffff' }
            );
        });

        // Visualize tower energy levels
        const towers = this.room.find<StructureTower>(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_TOWER
        });
        towers.forEach((tower, index) => {
            const energy = tower.store.getUsedCapacity(RESOURCE_ENERGY);
            const maxEnergy = tower.store.getCapacity(RESOURCE_ENERGY);
            const color = energy < 400 ? '#ff0000' : energy < 600 ? '#ffff00' : '#00ff00';
            visual.text(
                `Tower ${index + 1}: ${energy}/${maxEnergy}`,
                tower.pos.x + 1,
                tower.pos.y,
                { color }
            );
            if (this.creep?.memory.targetContainer === tower.id) {
                visual.circle(tower.pos, { radius: 0.5, fill: 'transparent', stroke: '#ff0000', strokeWidth: 0.1 });
            }
        });
    }

    actions(): void {
        if (!this.creep || !this.room.storage) {
            console.log(`[GroundSupport] No creep or storage available`);
            return;
        }

        this.initializeMemory();

        // Check if creep needs to switch modes
        if (this.creep.store.getUsedCapacity() >= this.creep.store.getCapacity()) {
            this.creep.memory.working = false;
        } else if (this.creep.store.getUsedCapacity() === 0) {
            this.creep.memory.working = true;
        }

        // Log current state
        console.log(`[GroundSupport] Creep ${this.creep.name} state: phase=${this.creep.memory.phase || 'none'}, working=${this.creep.memory.working}, store=${JSON.stringify(this.creep.store)}`);

        // Handle ongoing transfer task
        if (this.creep.memory.phase === "inprogress" && this.creep.memory.targetContainer) {
            const target = Game.getObjectById(this.creep.memory.targetContainer) as FieldStructure | null;
            if (!target) {
                console.log(`[GroundSupport] Invalid target container ${this.creep.memory.targetContainer}`);
                this.creep.memory.phase = null;
                this.creep.memory.targetContainer = null;
                this.creep.memory.sourceContainer = null;
                this.creep.memory.resourceType = null;
                this.creep.memory.linkSendTo = null;
                this.drawTaskInfo();
                return;
            }

            const resourceType = this.creep.memory.resourceType || RESOURCE_ENERGY;

            if (this.creep.memory.working && this.creep.memory.sourceContainer) {
                const source = Game.getObjectById(this.creep.memory.sourceContainer) as FieldStructure | null;
                if (!source) {
                    console.log(`[GroundSupport] Invalid source container ${this.creep.memory.sourceContainer}`);
                    this.creep.memory.phase = null;
                    this.creep.memory.targetContainer = null;
                    this.creep.memory.sourceContainer = null;
                    this.creep.memory.resourceType = null;
                    this.creep.memory.linkSendTo = null;
                    this.drawTaskInfo();
                    return;
                }
                if (source.structureType === STRUCTURE_LINK && source.store.getUsedCapacity(resourceType) === 0) {
                    console.log(`[GroundSupport] Link ${source.id} empty for ${resourceType}, clearing task`);
                    this.creep.memory.phase = null;
                    this.creep.memory.targetContainer = null;
                    this.creep.memory.sourceContainer = null;
                    this.creep.memory.resourceType = null;
                    this.creep.memory.linkSendTo = null;
                    this.drawTaskInfo();
                    return;
                }
                if (this.withdrawResource(source, resourceType)) {
                    this.creep.memory.working = false;
                }
                this.drawTaskInfo();
                return;
            } else if (!this.creep.memory.working && this.creep.store.getUsedCapacity(resourceType) > 0) {
                if (this.transferResource(target, resourceType)) {
                    if (
                        (target.structureType === STRUCTURE_STORAGE || target.structureType === STRUCTURE_TERMINAL) &&
                        (target.store.getFreeCapacity(resourceType) === 0 ||
                            (this.creep.memory.linkSendTo &&
                                (Game.getObjectById(this.creep.memory.linkSendTo) as StructureLink)?.store.getUsedCapacity(RESOURCE_ENERGY) > 600))
                    ) {
                        if (this.creep.memory.linkSendTo) {
                            const targetLink = Game.getObjectById(this.creep.memory.linkSendTo) as StructureLink | null;
                            if (!targetLink || targetLink.store.getUsedCapacity(RESOURCE_ENERGY) > 600) {
                                this.creep.room.memory.data.storagelinkcommand = "";
                                this.creep.memory.phase = null;
                                this.creep.memory.linkSendTo = null;
                                this.creep.memory.targetContainer = null;
                                this.creep.memory.sourceContainer = null;
                                this.creep.memory.resourceType = null;
                            } else {
                                this.creep.room.memory.data.storagelinkcommand = "outbound";
                                this.creep.room.memory.data.storagelinktarget = this.creep.memory.linkSendTo;
                            }
                        } else {
                            this.creep.room.memory.data.storagelinkcommand = "inbound";
                            this.creep.room.memory.data.storagelinktarget = null;
                            this.creep.memory.phase = null;
                            this.creep.memory.linkSendTo = null;
                            this.creep.memory.targetContainer = null;
                            this.creep.memory.sourceContainer = null;
                            this.creep.memory.resourceType = null;
                        }
                    }
                }
                this.drawTaskInfo();
                return;
            } else {
                console.log(`[GroundSupport] Invalid task state: working=${this.creep.memory.working}, sourceContainer=${this.creep.memory.sourceContainer}, store=${JSON.stringify(this.creep.store)}, target=${target.id} (${target.structureType})`);
                this.creep.memory.phase = null;
                this.creep.memory.targetContainer = null;
                this.creep.memory.sourceContainer = null;
                this.creep.memory.resourceType = null;
                this.creep.memory.linkSendTo = null;
                this.drawTaskInfo();
                return;
            }
        }

        // Get and process tasks
        const tasks = this.getTasks();
        const sortedTasks = tasks.sort((a, b) => a.priority - b.priority);
        //const task = sortedTasks.find(t =>
        //    (t.source && this.creep!.store.getUsedCapacity() === 0 && this.creep!.memory.working) ||
        //    (!t.source && this.creep!.store.getUsedCapacity(t.resourceType) > 0 && !this.creep!.memory.working)
        //);

        if (sortedTasks.length > 0) {
            const task = sortedTasks[0];
            const target = Game.getObjectById(task.target) as FieldStructure;
            console.log(`[GroundSupport] Selected task: ${task.taskType}, priority=${task.priority}, source=${task.source || 'none'}, target=${task.target} (${target.structureType}), resource=${task.resourceType}`);
            if (!task.taskType.includes("tower")) {
                const towerTasks = tasks.filter(t => t.taskType.includes("tower"));
                console.log(`[GroundSupport] Skipped tower tasks: ${JSON.stringify(towerTasks.map(t => ({
                    taskType: t.taskType,
                    priority: t.priority,
                    target: t.target,
                    targetType: Game.getObjectById(t.target)?.structureType,
                    resourceType: t.resourceType
                })))}`);
            }
            this.creep.memory.phase = "inprogress";
            this.creep.memory.targetContainer = task.target;
            this.creep.memory.sourceContainer = task.source || null;
            this.creep.memory.resourceType = task.resourceType;
            this.creep.memory.linkSendTo = task.linkSendTo || null;
            if (task.linkCommand) {
                this.creep.room.memory.data.storagelinkcommand = task.linkCommand;
                this.creep.room.memory.data.storagelinktarget = task.linkSendTo || null;
            }
            if (task.source && this.creep.memory.working) {
                const source = Game.getObjectById(task.source) as FieldStructure;
                if (source.structureType === STRUCTURE_LINK && source.store.getUsedCapacity(task.resourceType) === 0) {
                    console.log(`[GroundSupport] Link ${source.id} empty for ${task.resourceType}, skipping task`);
                    this.creep.memory.phase = null;
                    this.creep.memory.targetContainer = null;
                    this.creep.memory.sourceContainer = null;
                    this.creep.memory.resourceType = null;
                    this.creep.memory.linkSendTo = null;
                } else {
                    this.withdrawResource(source, task.resourceType);
                }
            } else if (!task.source && this.creep.store.getUsedCapacity(task.resourceType) > 0) {
                this.transferResource(target, task.resourceType);
            } else {
                console.log(`[GroundSupport] Task mismatch: taskType=${task.taskType}, source=${task.source || 'none'}, working=${this.creep.memory.working}, store=${JSON.stringify(this.creep.store)}, target=${task.target} (${target.structureType})`);
                this.creep.memory.phase = null;
                this.creep.memory.targetContainer = null;
                this.creep.memory.sourceContainer = null;
                this.creep.memory.resourceType = null;
                this.creep.memory.linkSendTo = null;
            }
            this.drawTaskInfo();
            return;
        }

        // No tasks, park creep
        console.log(`[GroundSupport] No suitable tasks found. Parking creep.`);
        const towerTasks = tasks.filter(t => t.taskType.includes("tower"));
        if (towerTasks.length > 0) {
            console.log(`[GroundSupport] Available tower tasks not selected: ${JSON.stringify(towerTasks.map(t => ({
                taskType: t.taskType,
                priority: t.priority,
                target: t.target,
                targetType: Game.getObjectById(t.target)?.structureType,
                resourceType: t.resourceType
            })))}`);
        }
        this.parkCreep();
        this.drawTaskInfo();
    }
}
