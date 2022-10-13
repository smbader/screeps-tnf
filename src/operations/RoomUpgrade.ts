import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import { RoomUpgrader } from "../operator/RoomUpgrader";

export class RoomUpgrade extends Operation {

    operationOperators:Operator[]

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

            // Find all the sources in the room.
            // Typically two, sometimes 1, center rooms have 4, and non-player rooms have none.
            let sources = room.find(FIND_SOURCES);

            // Let's make sure there is atleast 1
            if (sources.length == 0) {
                continue;
            } else {
                let idx_source = 0;
                for (let source of sources) {
                    // Nothing yet.
                    // Find available parking spaces.

                    // For now we will request one operator per source.
                    // We need a unique name
                    let name = 'Upgrader_' + room.name + '_' + idx_source;
                    let operator = new RoomUpgrader(name, room, source.id, '');

                    console.log(`    Requesting room upgrader: ` +  name);
                    this.operationOperators.push(operator);

                    idx_source += 1;
                }
            }

        }
    }

    roleCall() {
        // Let's determine if we need any spawns.

        for (let operationOperator of this.operationOperators) {
            var creepOperator = Game.creeps[operationOperator.name];

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

        console.log(`--------  Operator RoomUpgrade Actions  ------`);
        for (let operationOperator of this.operationOperators) {
            operationOperator.actions();
        }
        console.log(` `);
    }
}
