import { ErrorMapper } from "utils/ErrorMapper";

declare global {
  /*
    Example types, expand on these or remove them and add your own.
    Note: Values, properties defined here do no fully *exist* by this type definiton alone.
          You must also give them an implemention if you would like to use them. (ex. actually setting a `role` property in a Creeps memory)

    Types added in this `global` block are in an ambient, global context. This is needed because `main.ts` is a module file (uses import or export).
    Interfaces matching on name from @types/screeps will be merged. This is how you can extend the 'built-in' interfaces from @types/screeps.
  */
  // Memory extension samples
  interface Memory {
    uuid: number;
    log: any;
  }

  interface CreepMemory {
    role: string;
    room: string;
    working: boolean;
  }

  // Syntax for adding proprties to `global` (ex "global.log")
  namespace NodeJS {
    interface Global {
      log: any;
    }
  }
}

// When compiling TS to JS and bundling with rollup, the line numbers and file names in error messages change
// This utility uses source maps to get the line numbers and file names of the original, TS source code
export const loop = ErrorMapper.wrapLoop(() => {

  // Display current game tick to the console.
  console.log(`Current game tick is ${Game.time}`);
  console.log(`--------  Start of tick  ------`);

  // Game: The main global game object containing all the game play information.

  // Game.rooms
  // A hash containing all the rooms available to you with room names as hash keys.
  // A room is visible if you have a creep or an owned structure in it.

  for (var roomid in Game.rooms) {

    // roomid (E43S27) is the current room being evaluated
    let room = Game.rooms[roomid];

    // What kind of room are we looking at?
    if (room.controller?.owner?.username == "ricane") {

      console.log(`We found a room that we own: ` + roomid);
      // We're looking at a room we own!  We should try to be productive.

      // To be productive, we need a spawn
      let spawns = room.find(FIND_MY_SPAWNS);

      if (spawns.length > 0) {
        // We have atleast 1 spawn!

        // Attempt to spawn a screep!
        let spawn = spawns[0];
        spawn.spawnCreep([WORK, CARRY, MOVE], 'Worker1');

      } else {
        // It wasn't greater than 0... meaning we have no spawns.
        // This room can't create creeps.
      }

    }

  }

  console.log(`--------  Tick completed. Burying dead creeps  ------`);

  // Automatically delete memory of missing creeps
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      delete Memory.creeps[name];
    }
  }

});
