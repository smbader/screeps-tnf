import { Operator } from "../classes/operator";

// An operator is a screep who performs an operation.
export class RoomUpgrader extends Operator {

    memory: {
        sourceid?: any,
        batteryid?: any,
        roomname?: string,
        name?: string,
    }

    creep: Creep;
    source: Source;

    constructor (name:string, room:Room, sourceid:any, batteryid:any, ) {
        super(name, room);

        this.memory = {};
        this.memory.name = name;
        this.memory.sourceid = sourceid;
        this.memory.roomname = room.name;
        this.memory.batteryid = batteryid;

        this.source = Game.getObjectById(sourceid) as Source;

        this.creep = Game.creeps[this.name];
        this.room = room;
    }

    actions() {

        // Creep may not exist yet.
        if (!this.creep) { return; }

        // While you're harvesting continue until you're full.
        if (this.creep.memory.working == true) {

            // Goto and harvest source
            this.creep.moveTo(this.source);
            this.creep.harvest(this.source);

            console.log(`    ` + this.name + `: Harvesting`);
            if (this.creep.store[RESOURCE_ENERGY] == this.creep.store.getCapacity()) {
                this.creep.memory.working = false;
            }

        } else {

            // Goto and upgrade controller
            if (this.room.controller) {
                this.creep.moveTo(this.room.controller);
                this.creep.upgradeController(this.room.controller);
                console.log(`    ` + this.name + `: Upgrading Controller`);
            }

            if (this.creep.store[RESOURCE_ENERGY] == 0) {
                this.creep.memory.working = true;
            }

        }


    }


}
