import type { RoomConfig } from "./RoomConfig";

export class W28S35 {

    public static getConfig(): RoomConfig {
        return {
            "shard": "shard0",
            "type": "remote",
            "energysources": [
                {
                    "id": "576a9be657110ab231d8825a",
                    "pos": {"x": 6, "y": 35},
                    "tinyfarmers": 8,
                },
                {
                    "id": "576a9be657110ab231d88259",
                    "pos": {"x": 8, "y": 34},
                    "tinyfarmers": 4,
                },
            ],
        }
    }
}
