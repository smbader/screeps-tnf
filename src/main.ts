import { ErrorMapper } from "utils/ErrorMapper";
import { OperationHelper } from "utils/OperationHelper";

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

  // Load system level tasks for game
  let operations = OperationHelper.getOperations()

  console.log(` `);
  console.log(`--------  Operation Initialization  ------`);
  for (let operation of operations) {
    // Takes evalution of what operation and tasks are needed.
    operation.init();
  }

  console.log(` `);
  console.log(`--------  Operation Rolecall and Spawn  ------`);
  for (let operation of operations) {
    //
    operation.roleCall();
  }

  console.log(` `);
  console.log(`--------  Operation Action  ------`);
  for (let operation of operations) operation.actions();

  // Automatically delete memory of missing creeps
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      delete Memory.creeps[name];
    }
  }


  console.log(`--------    End tick     ------`);
  console.log(`-------------------------------`);
});
