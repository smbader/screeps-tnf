import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import { EnergyManager } from "../operator/EnergyManager";
import { SpawnRequest } from "../interfaces/SpawnRequest";

export class EnergyManagement extends Operation {

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

            let source = spawns[0].pos.findClosestByRange(FIND_SOURCES);
            if (!source) {
                continue;
            } else {

                // We need a unique name
                let name = 'Energy_' + room.name + '_0';
                let operator = new EnergyManager(name, room, source.id, '');

                console.log(`    Requesting energy manager: ` +  name);
                this.operationOperators.push(operator);
            }
        }
    }

    getSpawnRequests(): SpawnRequest[] {
        const requests: SpawnRequest[] = [];
        
        for (const operator of this.operationOperators) {
            // Check if creep already exists
            if (!Game.creeps[operator.name]) {
                // Only spawn if we have available spawns
                const spawns = operator.room.find(FIND_MY_SPAWNS);
                if (spawns.length > 0) {
                    requests.push({
                        role: "EnergyManager",
                        name: operator.name,
                        body: [WORK, MOVE, CARRY, MOVE],
                        memory: {
                            role: "EnergyManager",
                            room: operator.room.name,
                            working: true
                        },
                        priority: 3, // Medium priority
                        room: operator.room
                    });
                }
            }
        }
        
        return requests;
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

        console.log(`--------  Operator Energy Management Actions  ------`);
        for (let operationOperator of this.operationOperators) {
            operationOperator.actions();
        }
        console.log(` `);
    }
}
