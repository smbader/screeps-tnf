import { Operation } from "../classes/operation";

export class ControllerAttacker extends Operation {
    public action(sourceRoom: string, targetRoom: string) {
        const creepName = `controllerAttacker_${targetRoom}`;
        const creepMemory = { role: "controllerAttacker", operation: 'ControllerAttacker_' + targetRoom, targetRoom };
        const body = [CLAIM, CLAIM, CLAIM, CLAIM, CLAIM, MOVE, MOVE, MOVE, MOVE, MOVE];

        console.log('ControllerAttacker action called for sourceRoom:', sourceRoom, 'targetRoom:', targetRoom);

        // Spawn creep if not present
        let creep = Game.creeps[creepName];
        if (!creep) {
            console.log(`Spawning new controller attacker: ${creepName} in room ${sourceRoom}`);
            const room = Game.rooms[sourceRoom];
            if (room) {
                console.log(`Room ${room} already attached`);
                const spawns = room.find(FIND_MY_SPAWNS);
                if (spawns.length > 0) {
                    let result = spawns[0].spawnCreep(body, creepName, { memory: creepMemory });
                    if (result == OK) {
                        console.log(`Spawning new controller attacker: ${creepName} in room ${sourceRoom}`);
                    } else {
                        console.log(`Failed to spawn controller attacker: ${result} in room ${sourceRoom}`);
                    }
                } else {
                    console.log(`No spawns found in room ${sourceRoom} for spawning controller attacker.`);
                }
            } else {
                console.log(`Room ${sourceRoom} not found for spawning controller attacker.`);
            }
            return;
        }

        // Move to target room
        if (creep.room.name !== targetRoom) {
            if (typeof creep.travelTo === 'function') {
                creep.travelTo(new RoomPosition(25, 25, targetRoom));
            } else {
                creep.moveTo(new RoomPosition(25, 25, targetRoom));
            }
            console.log(`Moving controller attacker ${creepName} to target room ${targetRoom}`);
            return;
        }

        // Attack controller
        const controller = creep.room.controller;
        if (controller) {
            if (creep.pos.inRangeTo(controller, 1)) {
                let result = creep.attackController(controller);
                console.log(`Attacking controller in room ${targetRoom} with creep ${creepName} result: ${result}`);
            } else {
                creep.moveTo(controller);
                console.log(`Moving controller attacker ${creepName} to controller in room ${targetRoom}`);
            }
        }
    }
}
