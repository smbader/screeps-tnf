export abstract class Operator {
  public room: Room;
  public name: string;

  public constructor(name: string, room: Room) {
    this.room = room;
    this.name = name;
  }


  public actions() {
    return;
  }
}
