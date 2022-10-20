import { Operation } from "../classes/operation";
import { RoomUpgrade } from "operations/RoomUpgrade";
import { EnergyManagement } from "operations/EnergyManagement";
import { ConstructionCompany } from "operations/ConstructionCompany";

type Type_Operation_Classes = {
    [key: string]: any,
}

const OPERATION_CLASSES: Type_Operation_Classes = {
    roomupgrade: RoomUpgrade,
    constructioncompany: ConstructionCompany,
    energymanagement: EnergyManagement,
};

export var OperationHelper = {

    getOperations: function(): Operation[] {
        // gather flag data, instantiate operations
        let operationList: Operation[] = [];

        // loop through operations defined by library
        for (let typeName in OPERATION_CLASSES) {

            if (!OPERATION_CLASSES.hasOwnProperty(typeName)) continue;

            console.log('Load operational class: ' + typeName);
            let operationClass = OPERATION_CLASSES[typeName];
            let operation = new operationClass();
            operationList.push(operation);

        }

        return operationList;
    }
}
