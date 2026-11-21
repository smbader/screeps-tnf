import type { RoomConfig } from "./RoomConfig";

export class W28S36 {

    public static getConfig(): RoomConfig {
        return {
            "shard": "shard0",
            "type": "owned",
            "roomtemplate": "ricane",
            "roomanchor": {"x": 23, "y": 6},
            "templaterotation": 0,
            "controllerLink": {"x": 9, "y": 36},
            "energysources": [
                {
                    "id": "576a9be757110ab231d8825c",
                    "pos": {"x": 23, "y": 4},
                    "haulers": 2,
                    "linkpos": {"x": 25, "y": 4},
                    "parkingspots": [
                        {"x": 24, "y": 5}
                    ]
                },
                {
                    "id": "576a9be757110ab231d8825d",
                    "pos": {"x": 39, "y": 5},
                    "haulers": 2,
                    "linkpos": {"x": 40, "y": 7},
                    "parkingspots": [
                        {"x": 39, "y": 6},
                        {"x": 40, "y": 6},
                        {"x": 40, "y": 5}
                    ]
                },
            ],
        }
    }
}
