import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import { ConstructionCrew } from "../operator/ConstructionCrew";

export class ConstructionCompany extends Operation {

    operationOperators:ConstructionCrew[];

    constructor() {
        super();

        this.operationOperators = [];
    }

    init() {
        // This operation is for what rooms we own and have spawns in.

        // Either the room is in active upgrading or just needs sustained at level 8.

        for (var roomid in Game.rooms) {

            // roomid (E43S27) is the current room being evaluated
            let room = Game.rooms[roomid];

            // What kind of room are we looking at?
            if (room.controller?.owner?.username != "ricane") {
                continue;
            } else {
                // Nothing Yet.
                // Find available controller parking spaces.
            }

            // To be productive, we need a spawn
            let spawns = room.find(FIND_MY_SPAWNS);

            if (spawns.length == 0) {
                continue;
            } else {
                for(let spawn of spawns) {
                    //Nothing yet.
                }
            }

            let source = spawns[0].pos.findClosestByRange(FIND_SOURCES);
            if (!source) {
                continue;
            } else {

                let constructionSites = room.find(FIND_CONSTRUCTION_SITES);
                let totalDebt = 0;
                for (let constructionSite of constructionSites) {
                    totalDebt += (constructionSite.progressTotal - constructionSite.progress);
                }
                let numBuilders = Math.floor(totalDebt / 3000);

                if (constructionSites.length > 0) {
                    for (let i = 0; i < 5; i++) {
                        // We need a unique name
                        let name = 'Builder_' + room.name + '_' + i;
                        let operator = new ConstructionCrew(name, room, source.id, '', (i <= numBuilders));

                        console.log(`    Requesting builder: ` +  name);
                        this.operationOperators.push(operator);
                    }
                }
            }
        }
    }

    roleCall() {
        // Let's determine if we need any spawns.

        for (let operationOperator of this.operationOperators) {
            var creepOperator = Game.creeps[operationOperator.name];

            if (!operationOperator.spawnIfNeeded) { continue; }

            if (creepOperator) {
                console.log(`    Clocking in: ` +  operationOperator.name);
            } else {
                // Spawn him.
                let spawns = operationOperator.room.find(FIND_MY_SPAWNS);

                if (spawns.length == 0) {
                    continue;
                } else {
                    for(let spawn of spawns) {
                        if (!spawn.spawning) {
                            console.log(`    Spawning: ` +  operationOperator.name);
                            spawn.spawnCreep([WORK, MOVE, CARRY, MOVE], operationOperator.name);
                        }
                    }
                }
            }
        }
    }

    actions() {

        console.log(`--------  Operator Construction Company Actions  ------`);
        for (let operationOperator of this.operationOperators) {
            operationOperator.actions();
        }
        console.log(` `);
    }
}
