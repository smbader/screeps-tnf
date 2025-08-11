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
import { SquadSiegeOperation } from "../operations/SquadSiegeOperation";

type Type_Operation_Classes = {
    [key: string]: any,
}

const OPERATION_CLASSES: Type_Operation_Classes = {
    //remoteattack: RemoteAttack,
    //expansionmanagement: ExpansionManagement,   // 8
    //emergencyservices: EmergencyServices,       // 1
    roomdefense: RoomDefense,                   // 3
    energymanagement: EnergyManagement,         // 2
    market: Market,                             // 5
    constructioncompany: ConstructionCompany,   // 4
    //remotefarming: RemoteFarming,               // 7
    //powerfarming: PowerFarming,                 // 6
    //geominingcompany: GeoMiningCompany,         // 9
    //depositfarmer: DepositFarmer,             // 10
    //remotekeeper: RemoteKeeper,                 // 11
    //remoteconstruction: RemoteDeconstruction,
    //labprocesses: LabProcesses,
};

export var OperationHelper = {

    getOperations: function(): Operation[] {
        // gather flag data, instantiate operations
        let operationList: Operation[] = [];

        // Custom military attack
        if (Game.shard.name == 'shard3') {
            const waypoints = [
                {x: 36, y: 39, room: 'W13N1'},
                {x: 45, y: 10, room: 'W10N0'},
                {x: 4, y: 25, room: 'W1N0'},
                // more...
            ];

            if (Game.time < (72077432 + 1400)  ) {
                let siege = new SquadSiegeOperation("W1N1", "W13N1", waypoints);
                operationList.push(siege);
            }


            //let siege2 = new SquadSiegeOperation("W4N1", "W13N1", waypoints);
            //operationList.push(siege2);
        }

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
