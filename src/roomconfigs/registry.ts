import { E25N11 } from "./E25N11";
import { E28S1 } from "./E28S1";
import { E29N4 } from "./E29N4";
import { E31N1 } from "./E31N1";
import { E31N2 } from "./E31N2";
import { E31N3 } from "./E31N3";
import { E31N4 } from "./E31N4";
import { E32N2 } from "./E32N2";
import { E32N3 } from "./E32N3";
import { E32N4 } from "./E32N4";
import { E33N2 } from "./E33N2";
import { E33N3 } from "./E33N3";
import { E33N4 } from "./E33N4";
import { E33N5 } from "./E33N5";
import { E33S1 } from "./E33S1";
import { E37S1 } from "./E37S1";
import { W1N1 } from "./W1N1";
import { W1N3 } from "./W1N3";
import { W3N1 } from "./W3N1";
import { W4N1 } from "./W4N1";
import { W5N33 } from "./W5N33";
import { W6N33 } from "./W6N33";
import { W7N33 } from "./W7N33";
import { W7N34 } from "./W7N34";
import { W8N33 } from "./W8N33";
import { W9S2 } from "./W9S2";
import { W13N1 } from "./W13N1";
import { W13N2 } from "./W13N2";
import { W13S6 } from "./W13S6";
import { W15N3 } from "./W15N3";
import { W15N4 } from "./W15N4";
import { W17S1 } from "./W17S1";
import { W17S13 } from "./W17S13";
import { W18N2 } from "./W18N2";
import { W18S5 } from "./W18S5";
import { W18S6 } from "./W18S6";
import { W18S9 } from "./W18S9";
import { W18S13 } from "./W18S13";
import { W18S14 } from "./W18S14";
import { W19N2 } from "./W19N2";
import { W19S6 } from "./W19S6";
import { W19S9 } from "./W19S9";
import { W22S27 } from "./W22S27";
import { W27N8 } from "./W27N8";
import { W27N9 } from "./W27N9";
import { W28N3 } from "./W28N3";
import { W28N7 } from "./W28N7";
import { W28N8 } from "./W28N8";
import { W28N9 } from "./W28N9";
import { W29N3 } from "./W29N3";
import { W29N5 } from "./W29N5";
import { W29N6 } from "./W29N6";
import { W29N7 } from "./W29N7";
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
  E31N1: registration(() => E31N1.getConfig(), true, true),
  E31N2: registration(() => E31N2.getConfig(), true),
  E31N3: registration(() => E31N3.getConfig(), true, true),
  E28S1: registration(() => E28S1.getConfig(), true, true),
  E37S1: registration(() => E37S1.getConfig(), true, true),
  E33N5: registration(() => E33N5.getConfig(), true, true),
  E32N4: registration(() => E32N4.getConfig(), true, true),
  E25N11: registration(() => E25N11.getConfig(), true, true),
  E32N3: registration(() => E32N3.getConfig(), true),
  E32N2: registration(() => E32N2.getConfig(), true, true),
  E31N4: registration(() => E31N4.getConfig(), true),
  E29N4: registration(() => E29N4.getConfig(), true),
  E33N2: registration(() => E33N2.getConfig(), true),
  E33N3: registration(() => E33N3.getConfig(), true),
  E33N4: registration(() => E33N4.getConfig(), true),
  E33S1: registration(() => E33S1.getConfig(), true, true),
  W1N1: registration(() => W1N1.getConfig()),
  W1N3: registration(() => W1N3.getConfig()),
  W3N1: registration(() => W3N1.getConfig()),
  W4N1: registration(() => W4N1.getConfig()),
  W5N33: registration(() => W5N33.getConfig()),
  W6N33: registration(() => W6N33.getConfig()),
  W7N33: registration(() => W7N33.getConfig()),
  W7N34: registration(() => W7N34.getConfig()),
  W8N33: registration(() => W8N33.getConfig()),
  W9S2: registration(() => W9S2.getConfig()),
  W13N1: registration(() => W13N1.getConfig()),
  W13N2: registration(() => W13N2.getConfig()),
  W13S6: registration(() => W13S6.getConfig()),
  W15N3: registration(() => W15N3.getConfig()),
  W15N4: registration(() => W15N4.getConfig()),
  W17S1: registration(() => W17S1.getConfig()),
  W17S13: registration(() => W17S13.getConfig()),
  W18N2: registration(() => W18N2.getConfig()),
  W18S5: registration(() => W18S5.getConfig()),
  W18S6: registration(() => W18S6.getConfig()),
  W18S9: registration(() => W18S9.getConfig()),
  W18S13: registration(() => W18S13.getConfig()),
  W18S14: registration(() => W18S14.getConfig()),
  W19N2: registration(() => W19N2.getConfig()),
  W19S6: registration(() => W19S6.getConfig()),
  W19S9: registration(() => W19S9.getConfig()),
  W22S27: registration(() => W22S27.getConfig()),
  W27N8: registration(() => W27N8.getConfig()),
  W27N9: registration(() => W27N9.getConfig()),
  W28N3: registration(() => W28N3.getConfig()),
  W28N7: registration(() => W28N7.getConfig()),
  W28N8: registration(() => W28N8.getConfig()),
  W28N9: registration(() => W28N9.getConfig()),
  W29N3: registration(() => W29N3.getConfig()),
  W29N5: registration(() => W29N5.getConfig()),
  W29N6: registration(() => W29N6.getConfig()),
  W29N7: registration(() => W29N7.getConfig())
};

validateUniqueRoomConfigNames(Object.keys(ROOM_CONFIGS));

export function getRegisteredRoomConfig(roomName: string): RoomConfig | null {
  const entry = ROOM_CONFIGS[roomName];
  return entry ? validateRoomConfig(roomName, entry.getConfig()) : null;
}
