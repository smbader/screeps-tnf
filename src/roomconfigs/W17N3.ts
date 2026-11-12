import type { RoomConfig } from "./RoomConfig";

export class W17N3 {

    public static getConfig(): RoomConfig {
        return {
            "shard": "shard0",
            "type": "remote",
            "energysources": [
                {
                    "id": "55c34a6b5be41a0a6e80c3cc",
                    "pos": {"x": 42, "y": 10},
                    "tinyfarmers": 10,
                },
                {
                    "id": "55c34a6b5be41a0a6e80c3cd",
                    "pos": {"x": 32, "y": 29},
                    "tinyfarmers": 10,
                },
            ],
        }
    }
}
