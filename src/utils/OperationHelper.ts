import { Operation } from "../classes/operation";
import { RoomUpgrade } from "operations/RoomUpgrade";
import { EnergyManagement } from "operations/EnergyManagement";
import { EmergencyServices } from "operations/EmegencyServices";
import { ConstructionCompany } from "operations/ConstructionCompany";
import { RoomDefense } from "operations/RoomDefense";
import { RemoteFarming } from "operations/RemoteFarming";
import { RemoteDeconstruction } from "operations/RemoteDeconstruction";
import { DepositFarmer } from "../operations/DepositFarmer";
import { ExpansionManagement } from "../operations/ExpansionManagement";
import { Market } from "../operations/Market";
import { GeoMiningCompany } from "../operations/GeoMiningCompany";
import RemoteAttack from "../operations/RemoteAttack";
import { RemoteKeeper } from "../operations/RemoteKeeper";
import { PowerHarvestOperation } from "../operations/PowerHarvestOperation";
import { LabProcesses } from "../operations/LabProcesses";
import { SiegeOperation } from "../operations/SiegeOperation";
import { SquadDefense } from "../operations/SquadDefense";
import { ControllerAttacker } from "../operations/ControllerAttacker";
import { SiloDefense } from "../operations/SiloDefense";
import { ManualExpansion } from "../operations/ManualExpansion";

type Type_Operation_Classes = {
    [key: string]: any,
}

const OPERATION_CLASSES: Type_Operation_Classes = {
    siege: SiegeOperation,                      // runs before depositfarmer so it claims observers first
    squaddefense: SquadDefense,
    market: Market,                             // 5
    remoteattack: RemoteAttack,
    //powerharvestoperation: PowerHarvestOperation,                 // 6
    expansionmanagement: ExpansionManagement,   // 8
    remotefarming: RemoteFarming,               // 7
    roomdefense: RoomDefense,                   // 3
    constructioncompany: ConstructionCompany,   // 4
    energymanagement: EnergyManagement,         // 2
    emergencyservices: EmergencyServices,       // 1
    geominingcompany: GeoMiningCompany,         // 9
    depositfarmer: DepositFarmer,             // 10
    //remotekeeper: RemoteKeeper,                 // 11
    //remoteconstruction: RemoteDeconstruction,
    labprocesses: LabProcesses,
    silodefense: SiloDefense,
    manualexpansion: ManualExpansion,
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
