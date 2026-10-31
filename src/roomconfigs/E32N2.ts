import type { RoomConfig } from "./RoomConfig";
export class E32N2 {

    public static getConfig(): RoomConfig {
        return {
            "shard": "shard1",
            "type": "owned",
            "roomtemplate": "ricane",
            "roomanchor": {"x": 6, "y": 12},
            "templaterotation": 0,
            "controllerLink": {"x": 11, "y": 3},
            "energysources": [
                {
                    "id": "5982ffcfb097071b4adc338f",
                    "pos": {"x": 11, "y": 36},
                    "haulers": 1,
                    "linkpos": {"x": 12, "y": 38},
                    "parkingspots": [
                        {"x": 12, "y": 37},
                    ]
                },
                {
                    "id": "5982ffcfb097071b4adc338e",
                    "pos": {"x": 20, "y": 33},
                    "haulers": 2,
                    "linkpos": {"x": 20, "y": 32},
                    "parkingspots": [
                        {"x": 21, "y": 32},
                    ]
                },
            ],
        }
    }
}

