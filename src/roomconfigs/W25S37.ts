import type { RoomConfig } from "./RoomConfig";

export class W25S37 {

    public static getConfig(): RoomConfig {
        return {
            "shard": "shard0",
            "type": "owned",
            "roomtemplate": "ricane",
            "roomanchor": {"x": 14, "y": 13},
            "templaterotation": 0,
            "controllerLink": {"x": 22, "y": 37},
            "energysources": [
                {
                    "id": "576a9bef57110ab231d88367",
                    "pos": {"x": 10, "y": 24},
                    "haulers": 1,
                    "linkpos": {"x": 8, "y": 24},
                    "parkingspots": [
                        {"x": 9, "y": 23},
                        {"x": 9, "y": 24},
                        {"x": 10, "y": 23}
                    ]
                },
                {
                    "id": "576a9bef57110ab231d88366",
                    "pos": {"x": 6, "y": 4},
                    "haulers": 1,
                    "linkpos": {"x": 8, "y": 4},
                    "parkingspots": [
                        {"x": 7, "y": 3},
                        {"x": 7, "y": 4},
                        {"x": 6, "y": 5},
                        {"x": 7, "y": 5}
                    ]
                },
            ],
        }
    }
}
