import internal from "stream";

export var MapHelper = {

    getOpenSpacesInRange: function(place: {pos: RoomPosition}, range:number): RoomPosition[] {
        let openRoomPositions: RoomPosition[] = [];

        for(let x:number = (0 - range); x <= range; x++) {

            let evalX = (place.pos.x + x);
            if (evalX <= 0 || evalX >= 49) { continue; }

            for (let y:number = (0 - range); y <= range; y++) {

                let evalY = (place.pos.y + y);
                if (evalY <= 0 || evalY >= 49) { continue; }

                let position = new RoomPosition(evalX, evalY, place.pos.roomName);
                let terrain = position.lookFor(LOOK_TERRAIN)[0];
                if (terrain == "wall") { continue; }
                if (position.lookFor(LOOK_STRUCTURES).length > 0) { continue };

                openRoomPositions.push(position);
            }
        }

        return openRoomPositions;
    }
}
