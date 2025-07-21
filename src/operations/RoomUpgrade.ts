import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import { Upgrader } from "../operator/Upgrader";
import { Harvester } from "../operator/Harvester";
import { MapHelper } from "../utils/MapHelper";

export class RoomUpgrade extends Operation {

    operationOperators:Operator[]

    constructor() {
        super();

        this.operationOperators = [];
    }

    init() {

        console.log('Room upgrade init complete.');
    }

    roleCall() {

        console.log('Room upgrade roleCall complete.');
    }

    actions() {

    }
}
