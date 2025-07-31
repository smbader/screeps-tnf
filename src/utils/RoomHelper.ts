import { W13N2 } from "../roomconfigs/W13N2";
import {W13S6} from "../roomconfigs/W13S6";
import { W18N2 } from "../roomconfigs/W18N2";
import { W19N2 } from "../roomconfigs/W19N2";
import { W15N3 } from "../roomconfigs/W15N3";
import { W13N1 } from "../roomconfigs/W13N1";
import { W17S1 } from "../roomconfigs/W17S1";
import { W19S6 } from "../roomconfigs/W19S6";
import { W18S6 } from "../roomconfigs/W18S6";
import { W19S9 } from "../roomconfigs/W19S9";
import { W18S5 } from "../roomconfigs/W18S5";
import { W18S9 } from "../roomconfigs/W18S9";
import { W15N4 } from "../roomconfigs/W15N4";
import { W18S13 } from "../roomconfigs/W18S13";
import { W17S13 } from "../roomconfigs/W17S13";
import { W18S14 } from "../roomconfigs/W18S14";
import { W4N1 } from "../roomconfigs/W4N1";
import { W3N1 } from "../roomconfigs/W3N1";

export var RoomHelper = {

    loadRoomMemory: function() {

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
                    }
                };
            }
            if (!room.memory.nextTrade) {
                room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
            }
        }

        /*
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

        */
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


        return;
    }
}
