import { W27S36 } from "./W27S36";
import { W27S37 } from "./W27S37";
import { W28S36 } from "./W28S36";
import { W28S35 } from "./W28S35";
import { W28S37 } from "./W28S37";

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
  W28S36: registration(() => W28S36.getConfig(), true, true),
  W27S36: registration(() => W27S36.getConfig()),
  W28S35: registration(() => W28S35.getConfig()),
  W28S37: registration(() => W28S37.getConfig()),
  W27S37: registration(() => W27S37.getConfig()),
};

validateUniqueRoomConfigNames(Object.keys(ROOM_CONFIGS));

export function getRegisteredRoomConfig(roomName: string): RoomConfig | null {
  const entry = ROOM_CONFIGS[roomName];
  return entry ? validateRoomConfig(roomName, entry.getConfig()) : null;
}
