import type { RoomConfig } from "./RoomConfig";

export class W29S39 {

    public static getConfig(): RoomConfig {
        return {
            "shard": "shard0",
            "type": "owned",
            "roomtemplate": "ricane",
            "roomanchor": {"x": 5, "y": 28},
            "templaterotation": 0,
            "controllerLink": {"x": 31, "y": 29},
            "energysources": [
                {
                    "id": "576a9be557110ab231d88225",
                    "pos": {"x": 19, "y": 30},
                    "haulers": 1,
                    "linkpos": {"x": 19, "y": 28},
                    "parkingspots": [
                        {"x": 19, "y": 29},
                        {"x": 18, "y": 29},
                        {"x": 18, "y": 30},
                        {"x": 18, "y": 31}
                    ]
                },
                {
                    "id": "576a9be557110ab231d88226",
                    "pos": {"x": 44, "y": 33},
                    "haulers": 1,
                    "linkpos": {"x": 42, "y": 35},
                    "parkingspots": [
                        {"x": 43, "y": 34}
                    ]
                },
            ],
        }
    }
}
    