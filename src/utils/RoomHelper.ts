import { E28S1 } from "../roomconfigs/E28S1";
import { E31N1 } from "../roomconfigs/E31N1";
import { E31N2 } from "../roomconfigs/E31N2";
import { E31N3 } from "../roomconfigs/E31N3";
import { E31N4 } from "../roomconfigs/E31N4";
import { E32N3 } from "../roomconfigs/E32N3";
import { E32N4 } from "../roomconfigs/E32N4";
import { E33N5 } from "../roomconfigs/E33N5";
import { E37S1 } from "../roomconfigs/E37S1";
import { ricaneroom } from "./ricaneroom";

// Interface for room config classes
interface RoomConfigClass {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getConfig(): any;
}

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
  } else if (!room.memory.data.labs) {
    // Initialize labs if data exists but labs don't
    room.memory.data.labs = {
      reagents: [],
      products: [],
      boosts: []
    };
  }
  if (!room.memory.nextTrade) {
    room.memory.nextTrade = Game.time + Math.floor(Math.random() * 100);
  }
}

// Helper function to load room configuration
function loadRoomConfig(roomName: string, configClass: RoomConfigClass, needsData: boolean): void {
  if (Game.rooms[roomName]) {
    const roomConfig = configClass.getConfig();
    const room = Game.rooms[roomName];
    room.memory.config = roomConfig;

    if (needsData) {
      initializeRoomData(room);
    }
  }
}

// Utility: rotate a template-relative position (assumed in 0..11 space) around the 12x12 square
function rotateAndTranslate(pos: { x: number; y: number }, anchor: { x: number; y: number }, rotation: number): { x: number; y: number } {
  // Normalize rotation to 0-3 (multiples of 90 degrees clockwise)
  const r = ((rotation % 4) + 4) % 4;
  // Template grid size (0..11)
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

// Map a template config (as returned by ricaneroom.getConfig()) into absolute room coordinates
function mapTemplateConfig(templateConfig: any, anchor: { x: number; y: number }, rotation: number): any {
  const mapped: any = {};

  for (const key in templateConfig) {
    const value = templateConfig[key];
    if (value == null) continue;

    // Single-position objects
    if (value.x !== undefined && value.y !== undefined) {
      mapped[key] = rotateAndTranslate(value, anchor, rotation);
      continue;
    }

    // Arrays of positions
    if (Array.isArray(value)) {
      mapped[key] = value.map((entry: any) => {
        if (entry.x !== undefined && entry.y !== undefined) {
          return rotateAndTranslate(entry, anchor, rotation);
        }
        return entry;
      });
      continue;
    }

    // Nested objects (fields etc)
    if (typeof value === 'object') {
      mapped[key] = {};
      for (const subkey in value) {
        const subvalue = value[subkey];
        if (subvalue == null) continue;
        if (subvalue.x !== undefined && subvalue.y !== undefined) {
          mapped[key][subkey] = rotateAndTranslate(subvalue, anchor, rotation);
        } else if (Array.isArray(subvalue)) {
          mapped[key][subkey] = subvalue.map((entry: any) => {
            if (entry.x !== undefined && entry.y !== undefined) return rotateAndTranslate(entry, anchor, rotation);
            return entry;
          });
        } else {
          mapped[key][subkey] = subvalue;
        }
      }
      continue;
    }

    // Fallback - copy as-is
    mapped[key] = value;
  }

  return mapped;
}

// Build energysources array for rooms that don't have explicit energysources in their config
function buildEnergySourcesForRoom(room: Room): any[] {
  const sources: Source[] = room.find(FIND_SOURCES);
  const energysources: any[] = [];

  for (const s of sources) {
    const entry: any = {
      id: s.id,
      pos: { x: s.pos.x, y: s.pos.y },
      haulers: 1
    };

    // If room.memory.sources has container info, use that for parking
    if (room.memory.sources && room.memory.sources[s.id]) {
      const cont = room.memory.sources[s.id].container;
      if (cont) {
        entry.parkingspots = [ { x: cont.x, y: cont.y } ];
        // Try to find a link near the container
        const link = room.find<StructureLink>(FIND_STRUCTURES, {
          filter: l => l.structureType === STRUCTURE_LINK && l.pos.getRangeTo(cont.x, cont.y) < 4
        })[0];
        if (link) {
          entry.linkpos = { x: link.pos.x, y: link.pos.y };
        }
      }
    } else {
      // fallback: create one parking spot adjacent to source
      const px = Math.max(1, Math.min(48, s.pos.x + 1));
      const py = Math.max(1, Math.min(48, s.pos.y));
      entry.parkingspots = [{ x: px, y: py }];
      // try to find a nearby link
      const link = room.find<StructureLink>(FIND_STRUCTURES, {
        filter: l => l.structureType === STRUCTURE_LINK && l.pos.getRangeTo(s.pos) < 4
      })[0];
      if (link) entry.linkpos = { x: link.pos.x, y: link.pos.y };
    }

    energysources.push(entry);
  }

  return energysources;
}

// Resolve a room's config: if the room uses a template, translate template coords into absolute positions
function resolveTemplateConfig(room: Room): any {
  if (!room || !room.memory || !room.memory.config) return null;
  const memcfg = room.memory.config;
  if (!memcfg.roomtemplate) return memcfg;

  const templateName = memcfg.roomtemplate;
  const anchor = memcfg.roomanchor || { x: 0, y: 0 };
  const rotation = memcfg.templaterotation || 0;

  // Only 'ricane' template supported for now
  let templateConfig: any = null;
  if (templateName === 'ricane') {
    templateConfig = ricaneroom.getConfig();
  } else {
    // Unknown template - return the raw memory config so at least template metadata is preserved
    return memcfg;
  }

  const mapped = mapTemplateConfig(templateConfig, anchor, rotation);

  // Merge - memory config keys should override template defaults
  const merged: any = Object.assign({}, mapped, memcfg);

  // If energysources aren't provided by the memory config, build them from actual room sources
  if (!merged.energysources) {
    merged.energysources = buildEnergySourcesForRoom(room);
  }

  // If spawns aren't present, ensure mapped spawns exist
  if (!merged.spawns && mapped.spawns) merged.spawns = mapped.spawns;

  // Ensure storagelink/controllerLink/fieldContainers/fieldLinks/chemist are present from template where missing
  if (!merged.storagelink && mapped.storagelink) merged.storagelink = mapped.storagelink;
  if (!merged.fieldContainers && mapped.fieldContainers) merged.fieldContainers = mapped.fieldContainers;
  if (!merged.fieldLinks && mapped.fieldLinks) merged.fieldLinks = mapped.fieldLinks;
  if (!merged.chemist && mapped.chemist) merged.chemist = mapped.chemist;

  // controllerLink isn't explicitly in template; if absent try using first fieldLink as controllerLink
  if (!merged.controllerLink && merged.fieldLinks && merged.fieldLinks.length > 0) {
    merged.controllerLink = merged.fieldLinks[0];
  }

  // Also map field-specific entries (field0, field2 etc) from template if present and missing
  for (const key in mapped) {
    if (key.startsWith('field') && !merged[key]) {
      merged[key] = mapped[key];
    }
  }

  return merged;
}

export var RoomHelper = {


  loadRoomMemory: function() {
    // First, load configuration for all explicitly configured rooms
    for (const roomEntry of ROOMS) {
      loadRoomConfig(roomEntry.name, roomEntry.config, roomEntry.needsData);
    }

    // Then, initialize data for any other owned rooms not in the explicit list
    const configuredRoomNames = new Set(ROOMS.map(r => r.name));
    for (let roomid in Memory.rooms) {
      let room = Game.rooms[roomid];
      if (!room) {
        continue;
      }
      if (room.controller?.owner?.username !== "ricane") {
        continue;
      }
      if (!room.memory.config || room.memory.config.type !== "owned") {
        continue;
      }
      // If config uses a template, resolve template positions into concrete coords
      if (room.memory.config.roomtemplate) {
        const resolved = resolveTemplateConfig(room);
        if (resolved) {
          room.memory.config = resolved;
        }
      }
      // Only initialize if not already handled by the ROOMS array
      if (!configuredRoomNames.has(roomid)) {
        initializeRoomData(room);
      }
    }

    return;
  },

  // Returns the resolved configuration for a room without modifying memory
  getRoomValues: function(room: Room) {
    if (!room) return null;

    // Load runtime values from memory first so they are available
    const memoryValues: any = {};
    if (room.memory) {
      if (room.memory.nextTrade !== undefined) memoryValues.nextTrade = room.memory.nextTrade;
      if (room.memory.data !== undefined) memoryValues.data = room.memory.data;
      if (room.memory.starvedTime !== undefined) memoryValues.starvedTime = room.memory.starvedTime;
      if (room.memory.sources !== undefined) memoryValues.sources = room.memory.sources;
      if (room.memory.spawnMemory !== undefined) memoryValues.spawnMemory = room.memory.spawnMemory;
      // Do not copy room.memory.config here - we'll resolve it below and let config fields overwrite memory values
    }

    // Start with resolved config (handles templates)
    let cfg = null;
    if (room.memory && room.memory.config) {
      cfg = resolveTemplateConfig(room);
    }

    // Merge memory values first, then overlay the resolved config so config keys overwrite runtime memory values
    let base: any = Object.assign({}, memoryValues, cfg || {});

    // Ensure energysources are present
    if (!base.energysources) {
      base.energysources = buildEnergySourcesForRoom(room);
    }

    // Ensure spawns are represented as {x,y,direction}
    if (!base.spawns) {
      // Use FIND_MY_STRUCTURES with a filter to get strongly-typed spawns
      const spawns = room.find<StructureSpawn>(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_SPAWN });
      if (spawns && spawns.length > 0) {
        base.spawns = spawns.map(s => ({ x: s.pos.x, y: s.pos.y, direction: LEFT }));
      }
    }

    // Ensure storagelink is present (coordinate)
    if (!base.storagelink && room.storage) {
      const link = room.find<StructureLink>(FIND_STRUCTURES, { filter: l => l.structureType === STRUCTURE_LINK && l.pos.getRangeTo(room.storage!.pos) < 4 })[0];
      if (link) base.storagelink = { x: link.pos.x, y: link.pos.y };
    }

    // Ensure controllerLink is present
    if (!base.controllerLink && room.controller) {
      const link = room.find<StructureLink>(FIND_STRUCTURES, { filter: l => l.structureType === STRUCTURE_LINK && l.pos.getRangeTo(room.controller!.pos) < 4 })[0];
      if (link) base.controllerLink = { x: link.pos.x, y: link.pos.y };
    }

    // Field containers/links: fall back to empty arrays if missing
    if (!base.fieldContainers) base.fieldContainers = base.fieldContainers || [];
    if (!base.fieldLinks) base.fieldLinks = base.fieldLinks || [];

    // Chemist parking
    if (!base.chemist && cfg && cfg.chemist) base.chemist = cfg.chemist;

    return base;
  },

  // Backwards compatible alias: keep getRoomConfig but delegate to getRoomValues
  getRoomConfig: function(room: Room) {
    return this.getRoomValues(room);
  }
};
