import { E28S1 } from "../roomconfigs/E28S1";
import { E31N1 } from "../roomconfigs/E31N1";
import { E31N2 } from "../roomconfigs/E31N2";
import { E31N3 } from "../roomconfigs/E31N3";
import { E31N4 } from "../roomconfigs/E31N4";
import { E32N3 } from "../roomconfigs/E32N3";
import { E32N4 } from "../roomconfigs/E32N4";
import { E33N5 } from "../roomconfigs/E33N5";
import { E37S1 } from "../roomconfigs/E37S1";

// Room configuration array - defines all rooms and their setup requirements
const ROOMS = [
  // Rooms with full initialization (config + data + nextTrade)
  { name: "E31N1", config: E31N1, needsData: true },
  { name: "E31N3", config: E31N3, needsData: true },
  { name: "E28S1", config: E28S1, needsData: true },
  { name: "E37S1", config: E37S1, needsData: true },
  { name: "E33N5", config: E33N5, needsData: true },
  { name: "E32N4", config: E32N4, needsData: true },
  // Rooms with config only
  { name: "E31N2", config: E31N2, needsData: false },
  { name: "E32N3", config: E32N3, needsData: false },
  { name: "E31N4", config: E31N4, needsData: false }
];

// Helper function to initialize room data with default values
function initializeRoomData(room: Room): void {
  if (!room.memory.data) {
    room.memory.data = {
      storagelinkcommand: "",
      storagelinktarget: null,
      terminal: {
        energy: 0
      },
      labs: {
        reagents: [],
        products: [],
        boosts: []
      }
    };
  }
  if (!room.memory.nextTrade) {
    room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
  }
}

// Helper function to load room configuration
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadRoomConfig(roomName: string, configClass: any, needsData: boolean): void {
  if (Game.rooms[roomName]) {
    const roomConfig = configClass.getConfig();
    const room = Game.rooms[roomName];
    room.memory.config = roomConfig;

    if (needsData) {
      initializeRoomData(room);
    }
  }
}

export var RoomHelper = {
  loadRoomMemory: function() {
    for (var roomid in Memory.rooms) {
      let room = Game.rooms[roomid];
      if (!room) {
        continue;
      }
      if (room.controller?.owner?.username != "ricane") {
        continue;
      }
      if (!room.memory.config || room.memory.config.type !== "owned") {
        continue;
      }
      if (!room.memory.data) {
        room.memory.data = {
          storagelinkcommand: "",
          storagelinktarget: null,
          terminal: {
            energy: 0
          },
          labs: {
            reagents: [],
            products: [],
            boosts: []
          }
        };
      } else if (!room.memory.data.labs) {
        room.memory.data.labs = {
          reagents: [],
          products: [],
          boosts: []
        };
      }
    }

    // Load configuration for all rooms using the rooms array
    for (const roomEntry of ROOMS) {
      loadRoomConfig(roomEntry.name, roomEntry.config, roomEntry.needsData);
    }

    /*
        if (Game.rooms['W1N3']) {
            let dataW1N3 = W1N3.getConfig();
            let room = Game.rooms['W1N3'];
            room.memory.config = dataW1N3;
            if (!room.memory.data) {
                room.memory.data = {
                    storagelinkcommand: '',
                    storagelinktarget: null,
                    terminal: {
                        energy: 0
                    },
                    labs: {
                        reagents: [],
                        products: [],
                        boosts: [],
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }


        if (Game.rooms['W1N1']) {
            let dataW1N1 = W1N1.getConfig();
            let room = Game.rooms['W1N1'];
            room.memory.config = dataW1N1;
            if (!room.memory.data) {
                room.memory.data = {
                    storagelinkcommand: '',
                    storagelinktarget: null,
                    terminal: {
                        energy: 0
                    },
                    labs: {
                        reagents: [],
                        products: [],
                        boosts: [],
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }

        if (Game.rooms['W18S9']) {
            let dataW18S9 = W18S9.getConfig();
            let room = Game.rooms['W18S9'];
            room.memory.config = dataW18S9;
            if (!room.memory.data) {
                room.memory.data = {
                    storagelinkcommand: '',
                    storagelinktarget: null,
                    terminal: {
                        energy: 0
                    },
                    labs: {
                        reagents: [],
                        products: [],
                        boosts: [],
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }

        if (Game.rooms['W19S9']) {
            let dataW19S9 = W19S9.getConfig();
            let room = Game.rooms['W19S9'];
            room.memory.config = dataW19S9;
            if (!room.memory.data) {
                room.memory.data = {
                    storagelinkcommand: '',
                    storagelinktarget: null,
                    terminal: {
                        energy: 0
                    },
                    labs: {
                        reagents: [],
                        products: [],
                        boosts: [],
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }

        if (Game.rooms['W13N2']) {
            let dataW13N2 = W13N2.getConfig();
            let room = Game.rooms['W13N2'];
            room.memory.config = dataW13N2;
            if (!room.memory.data) {
                room.memory.data = {
                    storagelinkcommand: '',
                    storagelinktarget: null,
                    terminal: {
                        energy: 0
                    },
                    labs: {
                        reagents: [],
                        products: [],
                        boosts: [],
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }

        if (Game.rooms['W18N2']) {
            let dataW18N2 = W18N2.getConfig();
            let room = Game.rooms['W18N2'];
            room.memory.config = dataW18N2;
            if (!room.memory.data) {
                room.memory.data = {
                    storagelinkcommand: '',
                    storagelinktarget: null,
                    terminal: {
                        energy: 0
                    },
                    labs: {
                        reagents: [],
                        products: [],
                        boosts: [],
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }
        if (Game.rooms['W19N2']) {
            let dataW19N2 = W19N2.getConfig();
            let room = Game.rooms['W19N2'];
            room.memory.config = dataW19N2;
            if (!room.memory.data) {
                room.memory.data = {
                    storagelinkcommand: '',
                    storagelinktarget: null,
                    terminal: {
                        energy: 0
                    },
                    labs: {
                        reagents: [],
                        products: [],
                        boosts: [],
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }
        if (Game.rooms['W15N3']) {
            let dataW15N3 = W15N3.getConfig();
            let room = Game.rooms['W15N3'];
            room.memory.config = dataW15N3;
            if (!room.memory.data) {
                room.memory.data = {
                    storagelinkcommand: '',
                    storagelinktarget: null,
                    terminal: {
                        energy: 0
                    },
                    labs: {
                        reagents: [],
                        products: [],
                        boosts: [],
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }
        if (Game.rooms['W13N1']) {
            let dataW13N1 = W13N1.getConfig();
            let room = Game.rooms['W13N1'];
            room.memory.config = dataW13N1;
            if (!room.memory.data) {
                room.memory.data = {
                    storagelinkcommand: '',
                    storagelinktarget: null,
                    terminal: {
                        energy: 0
                    },
                    labs: {
                        reagents: [],
                        products: [],
                        boosts: [],
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }
        if (Game.rooms['W17S1']) {
            let dataW17S1 = W17S1.getConfig();
            let room = Game.rooms['W17S1'];
            room.memory.config = dataW17S1;
            if (!room.memory.data) {
                room.memory.data = {
                    storagelinkcommand: '',
                    storagelinktarget: null,
                    terminal: {
                        energy: 0
                    },
                    labs: {
                        reagents: [],
                        products: [],
                        boosts: [],
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }
        if (Game.rooms['W19S6']) {
            let dataW19S6 = W19S6.getConfig();
            let room = Game.rooms['W19S6'];
            room.memory.config = dataW19S6;
            if (!room.memory.data) {
                room.memory.data = {
                    storagelinkcommand: '',
                    storagelinktarget: null,
                    terminal: {
                        energy: 0
                    },
                    labs: {
                        reagents: [],
                        products: [],
                        boosts: [],
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }
        if (Game.rooms['W18S5']) {
            let dataW18S5 = W18S5.getConfig();
            let room = Game.rooms['W18S5'];
            room.memory.config = dataW18S5;
            if (!room.memory.data) {
                room.memory.data = {
                    storagelinkcommand: '',
                    storagelinktarget: null,
                    terminal: {
                        energy: 0
                    },
                    labs: {
                        reagents: [],
                        products: [],
                        boosts: [],
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }

        if (Game.rooms['W18S13']) {
            let dataW18S13 = W18S13.getConfig();
            let room = Game.rooms['W18S13'];
            room.memory.config = dataW18S13;
            if (!room.memory.data) {
                room.memory.data = {
                    storagelinkcommand: '',
                    storagelinktarget: null,
                    terminal: {
                        energy: 0
                    },
                    labs: {
                        reagents: [],
                        products: [],
                        boosts: [],
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }

        if (Game.rooms['W13S6']) {
            let dataW13S6 = W13S6.getConfig();
            let room = Game.rooms['W13S6'];
            room.memory.config = dataW13S6;
            if (!room.memory.data) {
                room.memory.data = {
                    storagelinkcommand: '',
                    storagelinktarget: null,
                    terminal: {
                        energy: 0
                    },
                    labs: {
                        reagents: [],
                        products: [],
                        boosts: [],
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }

        if (Game.rooms['W4N1']) {
            let dataW4N1 = W4N1.getConfig();
            let room = Game.rooms['W4N1'];
            room.memory.config = dataW4N1;
            if (!room.memory.data) {
                room.memory.data = {
                    storagelinkcommand: '',
                    storagelinktarget: null,
                    terminal: {
                        energy: 0
                    },
                    labs: {
                        reagents: [],
                        products: [],
                        boosts: [],
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }

        let dataW6N33 = W6N33.getConfig();
        Game.rooms['W6N33'].memory.config = dataW6N33;

        if (Game.rooms['W7N33']) {
            let dataW7N33 = W7N33.getConfig();
            Game.rooms['W7N33'].memory.config = dataW7N33;
        }

        if (Game.rooms['W8N33']) {
            let dataW8N33 = W8N33.getConfig();
            Game.rooms['W8N33'].memory.config = dataW8N33;
        }

        if (Game.rooms['W3N1']) {
            let dataW3N1 = W3N1.getConfig();
            Game.rooms['W3N1'].memory.config = dataW3N1;
        }
        if (Game.rooms['W17S13']) {
            let dataW17S13 = W17S13.getConfig();
            Game.rooms['W17S13'].memory.config = dataW17S13;
        }
        if (Game.rooms['W18S6']) {
            let dataW18S6 = W18S6.getConfig();
            Game.rooms['W18S6'].memory.config = dataW18S6;
        }
        if (Game.rooms['W15N4']) {
            let dataW15N4 = W15N4.getConfig();
            Game.rooms['W15N4'].memory.config = dataW15N4;
        }
    */

    return;
  }
};
