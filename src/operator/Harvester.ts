import { Operator } from "../classes/operator";
import { MapHelper } from "../utils/MapHelper";

// An operator is a screep who performs an operation.
export class Harvester extends Operator {

    memory: {
        sourceid?: any,
        roomname?: string,
        name?: string,
        parkingSpot?: RoomPosition;
    }

    creep: Creep;
    source: Source;
    parkingSpot: RoomPosition;

    constructor (name:string, room:Room, sourceid:any) {
        super(name, room);

        this.memory = {};
        this.memory.name = name;
        this.memory.sourceid = sourceid;
        this.memory.roomname = room.name;

        this.source = Game.getObjectById(sourceid) as Source;
        let parkingSpots = MapHelper.getOpenSpacesInRange(this.source, 1);
        this.parkingSpot = parkingSpots[0];
        this.memory.parkingSpot = parkingSpots[0];

        this.creep = Game.creeps[this.name];
        this.room = room;
    }

    actions() {

        // Creep may not exist yet.
        if (!this.creep) { return; }

        // Goto and harvest source
        if (this.creep.harvest(this.source) == ERR_NOT_IN_RANGE) {
            this.creep.moveTo(this.source);
            console.log(`    ` + this.name + `: Traveling`);
        } else {
            console.log(`    ` + this.name + `: Harvesting`);
        }

        if (!this.parkingSpot) { return; }

        let container = _.filter(this.parkingSpot.lookFor(LOOK_STRUCTURES), site => site.structureType == STRUCTURE_CONTAINER);
        console.log(JSON.stringify(container));
        if (container.length > 0) {
            // Container already exits.
            console.log(`    ` + this.name + `: Container Exists`);
        } else {
            let constructionSite = this.parkingSpot.lookFor(LOOK_CONSTRUCTION_SITES);
            if (constructionSite.length > 0) {
                this.creep.build(constructionSite[0]);
                console.log(`    ` + this.name + `: Building Container`);
            } else {
                if (this.room.createConstructionSite(this.parkingSpot.x, this.parkingSpot.y, STRUCTURE_CONTAINER) == OK) {
                    console.log(`    ` + this.name + `: Planning Container`);
                }
            }
        }
    }
}
