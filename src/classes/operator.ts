
export abstract class Operator {

    room: Room;
    name: string;

    constructor(name:string, room:Room) {
        this.room = room;
        this.name = name;
    }

    actions() {
    }
}
