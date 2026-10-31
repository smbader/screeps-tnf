import type { RoomConfig } from "./RoomConfig";

export class E33S1 {

    public static getConfig(): RoomConfig {
        return {
            "shard": "shard1",
            "type": "defend",
            "controllerLink": {"x": 11, "y": 3},
            "energysources": [
                {
                    "id": "5982ffddb097071b4adc34da",
                    "pos": {"x": 19, "y": 3},
                    "haulers": 1,
                    "linkpos": {"x": 21, "y": 5},
                    "parkingspots": [
                        {"x": 20, "y": 4},
                    ]
                },
                {
                    "id": "5982ffddb097071b4adc34dc",
                    "pos": {"x": 35, "y": 11},
                    "haulers": 1,
                    "linkpos": {"x": 33, "y": 9},
                    "parkingspots": [
                        {"x": 34, "y": 10},
                    ]
                },
            ],
        }
    }
}
