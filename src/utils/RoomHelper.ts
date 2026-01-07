import { E31N1 } from "../roomconfigs/E31N1";
import { E31N2 } from "../roomconfigs/E31N2";
import { E31N3 } from "../roomconfigs/E31N3";
import { E31N4 } from "../roomconfigs/E31N4";
import { E32N3 } from "../roomconfigs/E32N3";
import { E32N4 } from "../roomconfigs/E32N4";
import { E28S1 } from "../roomconfigs/E28S1";
import { E37S1 } from "../roomconfigs/E37S1";
import { E33N5 } from "../roomconfigs/E33N5";

export var RoomHelper = {

    loadRoomMemory: function() {


        for (var roomid in Memory.rooms) {

            let room = Game.rooms[roomid];
            if (!room) {
                continue;
            }
            if (room.controller?.owner?.username != 'ricane') {
                continue;
            }
            if (!room.memory.config || room.memory.config.type !== 'owned') {
                continue;
            }
            if (!room.memory.data.labs) {
                room.memory.data.labs = {
                    reagents: [],
                    products: [],
                    boosts: []
                };
            }
        }

        if (Game.rooms['E31N1']) {
            let dataE31N1 = E31N1.getConfig();
            let room = Game.rooms['E31N1'];
            room.memory.config = dataE31N1;
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

        if (Game.rooms['E31N3']) {
            let dataE31N3 = E31N3.getConfig();
            let room = Game.rooms['E31N3'];
            room.memory.config = dataE31N3;
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

        if (Game.rooms['E28S1']) {
            let dataE28S1 = E28S1.getConfig();
            let room = Game.rooms['E28S1'];
            room.memory.config = dataE28S1;
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

        if (Game.rooms['E37S1']) {
            let dataE37S1 = E37S1.getConfig();
            let room = Game.rooms['E37S1'];
            room.memory.config = dataE37S1;
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

        if (Game.rooms['E33N5']) {
            let dataE33N5 = E33N5.getConfig();
            let room = Game.rooms['E33N5'];
            room.memory.config = dataE33N5;
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

        if (Game.rooms['E32N4']) {
            let dataE32N4 = E32N4.getConfig();
            let room = Game.rooms['E32N4'];
            room.memory.config = dataE32N4;
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

        if (Game.rooms['E31N2']) {
            let dataE31N2 = E31N2.getConfig();
            Game.rooms['E31N2'].memory.config = dataE31N2;
        }

        if (Game.rooms['E32N3']) {
            let dataE32N3 = E32N3.getConfig();
            Game.rooms['E32N3'].memory.config = dataE32N3;
        }

        if (Game.rooms['E31N4']) {
            let dataE31N4 = E31N4.getConfig();
            Game.rooms['E31N4'].memory.config = dataE31N4;
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
}
