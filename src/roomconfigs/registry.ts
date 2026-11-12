import { W17N4 } from "./W17N4";
import { W17N3 } from "./W17N3";
import { W18N4 } from "./W18N4";

import { validateRoomConfig, validateUniqueRoomConfigNames } from "./RoomConfig";
import type { RoomConfig, RoomConfigRegistration } from "./RoomConfig";

function registration(
  getConfig: RoomConfigRegistration["getConfig"],
  loadOnVisibility = false,
  initializeData = false
): RoomConfigRegistration {
  return { getConfig, loadOnVisibility, initializeData };
}

export const ROOM_CONFIGS: Record<string, RoomConfigRegistration> = {
  W17N4: registration(() => W17N4.getConfig(), true, true),
  W17N3: registration(() => W17N3.getConfig()),
  W18N4: registration(() => W18N4.getConfig()),
};

validateUniqueRoomConfigNames(Object.keys(ROOM_CONFIGS));

export function getRegisteredRoomConfig(roomName: string): RoomConfig | null {
  const entry = ROOM_CONFIGS[roomName];
  return entry ? validateRoomConfig(roomName, entry.getConfig()) : null;
}
