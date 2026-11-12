import type { RoomConfig } from "./RoomConfig";

export class W17N4 {

    public static getConfig(): RoomConfig {
        return {
            "shard": "shard0",
            "type": "owned",
            "roomtemplate": "ricane",
            "roomanchor": {"x": 14, "y": 13},
            "templaterotation": 0,
            "controllerLink": {"x": 8, "y": 22},
            "energysources": [
                {
                    "id": "55c34a6b5be41a0a6e80bf88",
                    "pos": {"x": 40, "y": 11},
                    "haulers": 1,
                    "linkpos": {"x": 42, "y": 13},
                    "parkingspots": [
                        {"x": 41, "y": 12},
                        {"x": 42, "y": 12},
                        {"x": 42, "y": 11}
                    ]
                },
                {
                    "id": "55c34a6b5be41a0a6e80bf87",
                    "pos": {"x": 45, "y": 9},
                    "haulers": 1,
                    "linkpos": {"x": 45, "y": 7},
                    "parkingspots": [
                        {"x": 45, "y": 8},
                        {"x": 44, "y": 8},
                        {"x": 44, "y": 9},
                        {"x": 44, "y": 10}
                    ]
                },
            ],
        }
    }
}
