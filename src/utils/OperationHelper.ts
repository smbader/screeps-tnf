import { Operation } from "../classes/operation";
import { RoomUpgrade } from "operations/RoomUpgrade";
import { EnergyManagement } from "operations/EnergyManagement";
import { EmergencyServices } from "operations/EmegencyServices";
import { ConstructionCompany } from "operations/ConstructionCompany";
import { RoomDefense } from "operations/RoomDefense";
import { RemoteFarming } from "operations/RemoteFarming";
import { RemoteDeconstruction } from "operations/RemoteDeconstruction";
import {DepositFarmer} from "../operations/DepositFarmer";
import { ExpansionManagement } from "../operations/ExpansionManagement";
import { Market } from "../operations/Market";
import { GeoMiningCompany } from "../operations/GeoMiningCompany";
import { RemoteAttack } from "../operations/RemoteAttack";
import { RemoteKeeper } from "../operations/RemoteKeeper";
import { PowerFarming } from "../operations/PowerFarming";
import { LabProcesses } from "../operations/LabProcesses";

type Type_Operation_Classes = {
    [key: string]: any,
}

const OPERATION_CLASSES: Type_Operation_Classes = {
    remoteattack: RemoteAttack,
    //emergencyservices: EmergencyServices,       // 1
    energymanagement: EnergyManagement,         // 2
    roomdefense: RoomDefense,                   // 3
    expansionmanagement: ExpansionManagement,   // 8
    market: Market,                             // 5
    //powerfarming: PowerFarming,                 // 6
    //remotefarming: RemoteFarming,               // 7
    //geominingcompany: GeoMiningCompany,         // 9
    //depositfarmer: DepositFarmer,             // 10
    //remotekeeper: RemoteKeeper,                 // 11
    //remoteconstruction: RemoteDeconstruction,
    //labprocesses: LabProcesses,
    //constructioncompany: ConstructionCompany,   // 4
};

export var OperationHelper = {

    getOperations: function(): Operation[] {
        // gather flag data, instantiate operations
        let operationList: Operation[] = [];

        // loop through operations defined by library
        for (let typeName in OPERATION_CLASSES) {

            if (!OPERATION_CLASSES.hasOwnProperty(typeName)) continue;

            // console.log('Load operational class: ' + typeName);
            let operationClass = OPERATION_CLASSES[typeName];
            let operation = new operationClass();
            operation.name = typeName;
            operationList.push(operation);

        }

        return operationList;
    }
}
