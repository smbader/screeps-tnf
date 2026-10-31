import type { FieldConfig, RoomLayout, RoomPositionConfig } from "../roomconfigs/RoomConfig";

function rotateAndTranslate(pos: RoomPositionConfig, anchor: RoomPositionConfig, rotation: number): RoomPositionConfig {
  const r = ((rotation % 4) + 4) % 4;
  const N = 11;
  let rx = 0;
  let ry = 0;
  switch (r) {
    case 0:
      rx = pos.x;
      ry = pos.y;
      break;
    case 1:
      rx = pos.y;
      ry = N - pos.x;
      break;
    case 2:
      rx = N - pos.x;
      ry = N - pos.y;
      break;
    case 3:
      rx = N - pos.y;
      ry = pos.x;
      break;
  }
  return { x: anchor.x + rx, y: anchor.y + ry };
}

function mapPosition(
  position: RoomPositionConfig | undefined,
  anchor: RoomPositionConfig,
  rotation: number
): RoomPositionConfig | undefined {
  return position ? rotateAndTranslate(position, anchor, rotation) : undefined;
}

function mapPositions(
  positions: RoomPositionConfig[] | undefined,
  anchor: RoomPositionConfig,
  rotation: number
): RoomPositionConfig[] | undefined {
  return positions ? positions.map(position => rotateAndTranslate(position, anchor, rotation)) : undefined;
}

function mapFieldConfig(
  field: FieldConfig | undefined,
  anchor: RoomPositionConfig,
  rotation: number
): FieldConfig | undefined {
  if (!field) return undefined;
  return {
    ...field,
    spawn: mapPosition(field.spawn, anchor, rotation),
    parkingspot: mapPosition(field.parkingspot, anchor, rotation),
    sources: mapPositions(field.sources, anchor, rotation),
    containers: mapPositions(field.containers, anchor, rotation)
  };
}

export function mapTemplateConfig(
  templateConfig: RoomLayout,
  anchor: RoomPositionConfig,
  rotation: number
): RoomLayout {
  return {
    ...templateConfig,
    spawns: templateConfig.spawns?.map(spawn => ({
      ...spawn,
      ...rotateAndTranslate(spawn, anchor, rotation)
    })),
    storage: mapPosition(templateConfig.storage, anchor, rotation),
    storagelink: mapPosition(templateConfig.storagelink, anchor, rotation),
    controllerLink: mapPosition(templateConfig.controllerLink, anchor, rotation),
    towers: mapPositions(templateConfig.towers, anchor, rotation),
    chemist: templateConfig.chemist && {
      ...templateConfig.chemist,
      parking: mapPosition(templateConfig.chemist.parking, anchor, rotation),
      spawn: mapPosition(templateConfig.chemist.spawn, anchor, rotation)
    },
    road: mapPositions(templateConfig.road, anchor, rotation),
    rampart: mapPositions(templateConfig.rampart, anchor, rotation),
    fieldLinks: mapPositions(templateConfig.fieldLinks, anchor, rotation),
    field0Links: mapPositions(templateConfig.field0Links, anchor, rotation),
    field0Link: mapPosition(templateConfig.field0Link, anchor, rotation),
    fieldContainers: mapPositions(templateConfig.fieldContainers, anchor, rotation),
    field0: mapFieldConfig(templateConfig.field0, anchor, rotation),
    field1: mapFieldConfig(templateConfig.field1, anchor, rotation),
    field2: mapFieldConfig(templateConfig.field2, anchor, rotation),
    field3: mapFieldConfig(templateConfig.field3, anchor, rotation),
    field4: mapFieldConfig(templateConfig.field4, anchor, rotation),
    field5: mapFieldConfig(templateConfig.field5, anchor, rotation),
    powerSpawn: mapPosition(templateConfig.powerSpawn, anchor, rotation),
    terminal: mapPosition(templateConfig.terminal, anchor, rotation),
    lab: mapPositions(templateConfig.lab, anchor, rotation),
    nuker: mapPosition(templateConfig.nuker, anchor, rotation),
    factory: mapPosition(templateConfig.factory, anchor, rotation),
    observer: mapPosition(templateConfig.observer, anchor, rotation),
    containers: mapPositions(templateConfig.containers, anchor, rotation),
    sources: mapPositions(templateConfig.sources, anchor, rotation),
    spawn: mapPosition(templateConfig.spawn, anchor, rotation),
    parking: mapPosition(templateConfig.parking, anchor, rotation),
    parkingspot: mapPosition(templateConfig.parkingspot, anchor, rotation)
  };
}
