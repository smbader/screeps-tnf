import {filter} from "lodash";
import {Operator} from "../classes/operator";
import {MapHelper} from "../utils/MapHelper";

type FieldStructure = StructureSpawn|StructureExtension|StructureStorage|StructureContainer|StructureLink|StructureTerminal|StructureTower|StructureLab|StructureNuker|StructureFactory|StructurePowerSpawn;
type StoreStructure = StructureTower|StructureSpawn|StructureExtension|StructureLink;
type GSResourceTypes = "energy" | "power" | "ops" | "U" | "L" | "K" | "Z" | "O" | "H" | "X" | "OH" | "ZK" | "UL" | "G" | "UH" | "UO" | "KH" | "KO" | "LH" | "LO" | "ZH" | "ZO" | "GH" | "GO" | "UH2O" | "UHO2" | "KH2O" | "KHO2" | "LH2O" | "LHO2" | "ZH2O" | "ZHO2" | "GH2O" | "GHO2" | "XUH2O" | "XUHO2" | "XKH2O" | "XKHO2" | "XLH2O" | "XLHO2" | "XZH2O" | "XZHO2" | "XGH2O" | "XGHO2" | "mist" | "biomass" | "metal" | "silicon" | "utrium_bar" | "lemergium_bar" | "zynthium_bar" | "keanium_bar" | "ghodium_melt" | "oxidant" | "reductant" | "purifier" | "battery" | "composite" | "crystal" | "liquid" | "wire" | "switch" | "transistor" | "microchip" | "circuit" | "device" | "cell" | "phlegm" | "tissue" | "muscle" | "organoid" | "organism" | "alloy" | "tube" | "fixtures" | "frame" | "hydraulics" | "machine" | "condensate" | "concentrate" | "extract" | "spirit" | "emanation" | "essence";

interface GroundSupportMemory extends CreepMemory {
    targetContainer: Id<FieldStructure> | null;
    sourceContainer: Id<FieldStructure> | null;
    linkSendTo: Id<StructureLink> | null;
    resourceType: GSResourceTypes | null;
    phase: string | null;
}

export class GroundSupportCreep extends Creep {
    memory!: GroundSupportMemory;

    constructor(creepid: any) {
        super(creepid);
    }
}

// An operator is a screep who performs an operation.
export class GroundSupport extends Operator {
    memory: {
        sourceid?: any;
        batteryid?: any;
        roomname?: string;
        name?: string;
    };

    creep: GroundSupportCreep | null;

    constructor(name: string, room: Room) {
        super(name, room);

        this.memory = {};
        this.memory.name = name;
        this.memory.roomname = room.name;

        if (Game.creeps[this.name]) {
            this.creep = new GroundSupportCreep(Game.creeps[this.name].id);
        } else {
            this.creep = null;
        }
        this.room = room;
    }

    actions() {
        // Creep may not exist yet.
        if (!this.creep) {
            return;
        }

        if (!this.creep.room.storage) {
            return;
        }

        if (!this.creep.room.memory.data.storagelinktarget) {
            this.creep.room.memory.data.storagelinktarget = null;
        }

        if (this.creep.store.getUsedCapacity() == this.creep.store.getCapacity()) {
            this.creep.memory.working = false;
        }
        if (this.creep.store.getUsedCapacity() == 0 && this.creep.memory.working == false) {
            this.creep.memory.working = true;
        }



        if (this.creep.memory.phase == 'inprogress' && this.creep.memory.targetContainer != null) {

            let structure = Game.getObjectById(this.creep.memory.targetContainer);
            if (!structure) {
                this.creep.memory.phase = 'inprogress';
                this.creep.memory.targetContainer = null;
                return;
            }

            let xferResourceType = <GSResourceTypes>RESOURCE_ENERGY;
            if (this.creep.memory.resourceType) {
                xferResourceType = this.creep.memory.resourceType;
            }

            if (this.creep.memory.working == null || this.creep.memory.working == true) {

                let sourceContainer = <FieldStructure>this.creep.room.storage;
                if (this.creep.memory.sourceContainer) {
                    let temp = Game.getObjectById(this.creep.memory.sourceContainer)
                    if (temp) {
                        sourceContainer = temp;
                    }
                }

                const result = this.creep.withdraw(sourceContainer, xferResourceType);

                if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(sourceContainer.pos);
                    return;
                } else if (result == ERR_NOT_ENOUGH_RESOURCES) {
                    this.creep.memory.working = false;
                    return;
                } else if (result == OK) {
                    return;
                }

            } else {

                let result = this.creep.transfer(structure, xferResourceType);

                //console.log('[' + this.creep.room.name + '] Transfer Result: ' + result);

                if (result == ERR_NOT_IN_RANGE) {

                    this.creep.travelTo(structure.pos);
                    return;
                } else if (result == OK) {

                }

                if (structure.store.getFreeCapacity(xferResourceType) == 0 ||
                    structure.id == this.creep.room.storage.id ||
                    (this.creep.room.terminal && structure.id == this.creep.room.terminal.id)
                ) {

                    if (this.creep.memory.linkSendTo) {

                        // Keep requesting the send until the target is empty.
                        let targetLink = Game.getObjectById(this.creep.memory.linkSendTo);
                        if (targetLink == null ||
                            (targetLink && targetLink.store.getUsedCapacity(RESOURCE_ENERGY) > 600)) {

                            this.creep.room.memory.data.storagelinkcommand = '';
                            this.creep.memory.phase = '';
                            this.creep.memory.linkSendTo = null;
                            this.creep.memory.targetContainer = null;
                            this.creep.memory.sourceContainer = null;
                        } else {
                            // Energy not sent yet.
                            this.creep.say('⚡');
                            this.creep.room.memory.data.storagelinkcommand = 'outbound';
                            this.creep.room.memory.data.storagelinktarget = this.creep.memory.linkSendTo;
                        }
                        return;
                    } else {

                        this.creep.room.memory.data.storagelinkcommand = 'inbound';
                        this.creep.room.memory.data.storagelinktarget = null;
                        this.creep.memory.phase = '';
                        this.creep.memory.linkSendTo = null;
                        this.creep.memory.targetContainer = null;
                        this.creep.memory.sourceContainer = null;
                        this.creep.memory.resourceType = null;
                        // The Job is done.
                    }

                }

                return;

            }



        } else {

            // we need to look for a new item to fill.

            // look for tombstones
            let tombstone = this.creep.pos.findClosestByPath(FIND_TOMBSTONES);
            if (tombstone && this.creep.pos.getRangeTo(tombstone) < 10 && tombstone.store.getUsedCapacity() > 0 && this.creep.store.getFreeCapacity() > 0) {
                for(const resourceType in tombstone.store) {
                    let result = this.creep.withdraw(tombstone, <GSResourceTypes>resourceType);
                    if (result == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(tombstone.pos);
                    }
                }
                return;
            }
            if (this.creep.store.getUsedCapacity() > 0) {
                for(const resourceType in this.creep.store) {
                    let result = this.creep.transfer(this.creep.room.storage, <GSResourceTypes>resourceType)
                    if (result == ERR_NOT_IN_RANGE) {
                        this.creep.travelTo(this.creep.room.storage.pos);
                        this.creep.say('180');
                    } else if (result == OK) {
                        this.creep.say('192');
                        return;
                    }
                }
                return;
            }

            // First I need to know what I am responsible for.
            // Unloading link
            // Outbound sends to field and controller links
            // Loading towers
            // Balancing storage / terminal energy

            var storagelinks = this.creep.room.find<StructureLink>(FIND_STRUCTURES, {
                filter: (structure) => {
                    return structure.pos.x === this.room.memory.config.storagelink.x &&
                        this.room.memory.config.storagelink.y === structure.pos.y &&
                        structure.structureType == STRUCTURE_LINK;
                }
            });
            let storagelink;
            if (storagelinks.length > 0) {
                storagelink = storagelinks[0];
            } else {
                storagelink = null;
            }

            // Check if field links need energy.
            if (this.creep.room.memory.config.fieldLinks) {

                let fieldLinks = this.creep.room.memory.config.fieldLinks;

                //for (let i = this.memory.containeridx; i < containers.length; i++) {
                for (let i = 0; i < fieldLinks.length; i++) {

                    var target = this.creep.room.find<StructureLink>(FIND_STRUCTURES, {
                        filter: (structure) => {
                            return structure.pos.x === fieldLinks[i].x &&
                                   structure.pos.y === fieldLinks[i].y &&
                                   structure.structureType == STRUCTURE_LINK &&
                                   structure.store.getFreeCapacity(RESOURCE_ENERGY) > 600;
                        }
                    });

                    if (target.length > 0 && storagelink) {
                        this.creep.memory.targetContainer = storagelink.id; //
                        this.creep.memory.linkSendTo = target[0].id;
                        this.creep.memory.phase = 'inprogress';
                        //console.log('[' + this.creep.room.name + '] Add to field link.');
                        return;
                    }
                }
            }

            // Check if controller links need energy.
            if (this.creep.room.memory.config.controllerLink) {

                let controllerLinkpos = this.creep.room.memory.config.controllerLink;

                var target = this.creep.room.find<StructureLink>(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return structure.pos.x === controllerLinkpos.x
                            && structure.pos.y === controllerLinkpos.y
                            && structure.structureType == STRUCTURE_LINK
                            && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 600;
                    }
                });

                if (target.length > 0 && storagelink) {
                    this.creep.memory.targetContainer = storagelink.id; //
                    this.creep.memory.linkSendTo = target[0].id;
                    this.creep.memory.phase = 'inprogress';
                    //console.log('[' + this.creep.room.name + '] Add to controller.');
                    return;
                }

            }

            // CLEAR STORAGE LINK FOR INBOUND
            if (storagelink && storagelink.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
                this.creep.room.storage.store.getUsedCapacity() < (this.creep.room.storage.store.getCapacity() - 1000)) {

                //console.log('[' + this.creep.room.name + '] Unload storage link.');
                this.creep.memory.sourceContainer = storagelink.id;
                this.creep.memory.targetContainer = this.creep.room.storage.id;
                this.creep.memory.phase = 'inprogress';
                //console.log('[' + this.creep.room.name + '] Clearing Link.');
                return;
            }


            // IF TOWERS NEED ENERGY
            var targets = this.creep.room.find<StructureTower>(FIND_STRUCTURES, {
                filter: (structure) => {
                    return structure.structureType == STRUCTURE_TOWER &&
                        structure.store.getFreeCapacity(RESOURCE_ENERGY) > 200;
                }
            });

            let storageEnergy = this.creep.room.storage.store.getUsedCapacity(RESOURCE_ENERGY)

            if (targets.length > 0 && storageEnergy > 33000) {

                this.creep.memory.targetContainer = targets[0].id;
                this.creep.memory.linkSendTo = null;
                this.creep.memory.phase = 'inprogress';
                //console.log('[' + this.creep.room.name + '] Add to tower.');
                return;
            }

            if (!this.creep.room.terminal) {
                this.creep.travelTo(new RoomPosition(this.room.memory.config.chemist.parking.x, this.room.memory.config.chemist.parking.y, this.room.name));
                this.creep.say('💤');
                return;
            }

            let terminalEnergy = this.creep.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY)

            if (terminalEnergy > storageEnergy && storageEnergy < 50000) {
                //console.log('[' + this.creep.room.name + '] Add to storage.');
                this.creep.memory.sourceContainer = this.creep.room.terminal.id;
                this.creep.memory.targetContainer = this.creep.room.storage.id;
                this.creep.memory.phase = 'inprogress';
                return;
            }

            if ((terminalEnergy < 35000 && storageEnergy > 100000) || (storageEnergy > 900000 && terminalEnergy < 125000)) {
                //console.log('[' + this.creep.room.name + '] Add to terminal.');
                this.creep.memory.sourceContainer = this.creep.room.storage.id;
                this.creep.memory.targetContainer = this.creep.room.terminal.id;
                this.creep.memory.phase = 'inprogress';
                return;
            }

            // If there is RESOURCE in storage that the terminal needs more of, move it over.
            for(const resourceType in this.creep.room.storage.store) {

                if (this.creep.room.terminal.store.getUsedCapacity(<GSResourceTypes>resourceType) < 15000) {
                    this.creep.memory.sourceContainer = this.creep.room.storage.id;
                    this.creep.memory.targetContainer = this.creep.room.terminal.id;
                    this.creep.memory.resourceType = <GSResourceTypes>resourceType;
                    this.creep.memory.phase = 'inprogress';
                    return;
                }
            }

            if (storageEnergy > 125000) {
                let labs = this.creep.room.find<StructureLab>(FIND_MY_STRUCTURES, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_LAB
                            && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 200;
                    }
                });
                if (labs && labs.length > 0) {
                    this.creep.memory.sourceContainer = this.creep.room.storage.id;
                    this.creep.memory.targetContainer = labs[0].id;
                    this.creep.memory.phase = 'inprogress';
                    return;
                }
            }

            if (storageEnergy > 200000) {
                let nukers = this.creep.room.find<StructureNuker>(FIND_MY_STRUCTURES, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_NUKER
                            && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
                });
                if (nukers && nukers.length > 0) {
                    this.creep.memory.sourceContainer = this.creep.room.storage.id;
                    this.creep.memory.targetContainer = nukers[0].id;
                    this.creep.memory.phase = 'inprogress';
                    return;
                }
            }

            if (storageEnergy > 200000) {
                let powerspawns = this.creep.room.find<StructurePowerSpawn>(FIND_MY_STRUCTURES, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_POWER_SPAWN
                            && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 800;
                    }
                });
                if (powerspawns && powerspawns.length > 0) {
                    this.creep.memory.sourceContainer = this.creep.room.storage.id;
                    this.creep.memory.targetContainer = powerspawns[0].id;
                    this.creep.memory.phase = 'inprogress';
                    return;
                }

                if (this.creep.room.terminal.store.getUsedCapacity(RESOURCE_POWER) > 0) {
                    powerspawns = this.creep.room.find<StructurePowerSpawn>(FIND_MY_STRUCTURES, {
                        filter: (structure) => {
                            return structure.structureType == STRUCTURE_POWER_SPAWN
                                && structure.store.getFreeCapacity(RESOURCE_POWER) > 50;
                        }
                    });

                    if (powerspawns && powerspawns.length > 0) {
                        this.creep.memory.sourceContainer = this.creep.room.terminal.id;
                        this.creep.memory.targetContainer = powerspawns[0].id;
                        this.creep.memory.resourceType = RESOURCE_POWER;
                        this.creep.memory.phase = 'inprogress';
                        return;
                    }
                }

            }

            if (storageEnergy > 200000) {
                let factorys = this.creep.room.find<StructureFactory>(FIND_MY_STRUCTURES, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_FACTORY
                            && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
                });
                if (factorys && factorys.length > 0) {
                    this.creep.memory.sourceContainer = this.creep.room.storage.id;
                    this.creep.memory.targetContainer = factorys[0].id;
                    this.creep.memory.phase = 'inprogress';
                    return;
                }
            }



            // Nothing to do?  Renew myself.

            this.creep.travelTo(new RoomPosition(this.room.memory.config.chemist.parking.x, this.room.memory.config.chemist.parking.y, this.room.name));
            this.creep.say('💤');

        }


/*

        let storage = this.creep.room.storage;
        if (!storage) {
            return;
        }
        let storageEnergy = storage.store.getUsedCapacity(RESOURCE_ENERGY)

        // IF STORAGE NEEDS ENERGY
        if (this.creep.room.terminal && this.creep.room.storage &&
            this.creep.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) > storageEnergy &&
            storageEnergy < 50000) {

            if (this.creep.room.name == 'W15N3') { console.log ( 'Storage'); }
            // While you're harvesting continue until you're full.
            if (this.creep.memory.working == null || this.creep.memory.working == true) {

                const result = this.creep.withdraw(this.creep.room.terminal, RESOURCE_ENERGY);

                if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(this.creep.room.terminal.pos);
                    return;
                } else if (result == ERR_NOT_ENOUGH_ENERGY) {
                    return;
                } else if (result == OK) {
                    return;
                }

            } else {

                let result = this.creep.transfer(storage, RESOURCE_ENERGY);
                if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(storage.pos);
                    return;
                } else if (result == OK) {
                    return;
                }
            }
        }



        // IF TERMINAL NEEDS ENERGY
        if (this.creep.room.terminal && this.creep.room.storage &&
            this.creep.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) < 35000 &&
            storageEnergy > 100000) {

            //if (this.creep.room.name == 'W15N3') { console.log ( 'Terminal'); }
            // While you're harvesting continue until you're full.
            if (this.creep.memory.working == null || this.creep.memory.working == true) {

                const result = this.creep.withdraw(storage, RESOURCE_ENERGY);

                if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(storage.pos);
                    return;
                } else if (result == ERR_NOT_ENOUGH_ENERGY) {
                    return;
                } else if (result == OK) {
                    return;
                }

            } else {

                let result = this.creep.transfer(this.creep.room.terminal, RESOURCE_ENERGY);
                if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(this.creep.room.terminal.pos);
                    return;
                } else if (result == OK) {
                    return;
                }

            }
        }

        var links = this.creep.room.find<FieldStructure>(FIND_STRUCTURES, {
            filter: (structure) => {
                return structure.pos.x === this.room.memory.config.storagelink.x &&
                    this.room.memory.config.storagelink.y === structure.pos.y &&
                    structure.structureType == STRUCTURE_LINK;
            }
        });

        if (links.length > 0) {

            //if (this.creep.room.name == 'W15N3') { console.log ( 'Link Work'); }
            this.creep.travelTo(new RoomPosition(this.room.memory.config.chemist.parking.x, this.room.memory.config.chemist.parking.y, this.room.name));

            let source;
            let destination;

            if (this.creep.room.memory.data.storagelinkcommand == "inbound") {
                source = links[0];
                destination = storage;
                this.creep.say('in');
                //console.log('[' + this.creep.room.name + '] Load link to storage' );
            } else {
                source = storage;
                destination = links[0];
                this.creep.say('out');
                //console.log('[' + this.creep.room.name + '] Load storage to link' );
            }

            if (this.creep.memory.working == null || this.creep.memory.working == true) {

                const result = this.creep.withdraw(source, RESOURCE_ENERGY);
                if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(source.pos);
                    //console.log('[' + this.creep.room.name + '] Attempt to withdraw not in range' );
                    return;
                } else if (result == ERR_NOT_ENOUGH_ENERGY) {
                    //console.log('[' + this.creep.room.name + '] Not enough energy in source' );
                    return;
                } else if (result == OK) {
                    //console.log('[' + this.creep.room.name + '] Successful withdraw' );
                    return;
                }

            } else {
                // offload to storage
                let result = this.creep.transfer(destination, RESOURCE_ENERGY);
                if (result == ERR_NOT_IN_RANGE) {
                    this.creep.travelTo(destination.pos);
                    //console.log('[' + this.creep.room.name + '] Attempt to deposit not in range' );
                    return;
                } else if (result == OK) {
                    //console.log('[' + this.creep.room.name + '] Successful deposit' );
                    return;
                }
            }

        }

        this.creep.travelTo(new RoomPosition(this.room.memory.config.chemist.parking.x, this.room.memory.config.chemist.parking.y, this.room.name));
        this.creep.say('💤');
*/
    }
}
