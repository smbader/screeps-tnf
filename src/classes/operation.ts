
import { SpawnRequest } from "../interfaces/SpawnRequest";

export abstract class Operation {

    constructor() {
    }

    init() {
    }

    roleCall() {
    }

    /**
     * Get spawn requests for this operation
     * Operations should override this method to return their desired creeps
     */
    getSpawnRequests(): SpawnRequest[] {
        return [];
    }

    actions() {
    }
}
