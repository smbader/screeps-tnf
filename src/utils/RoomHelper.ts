import {
  EnergySourceConfig,
  ResolvedRoomConfig,
  RoomConfig,
  validateRoomConfig
} from "../roomconfigs/RoomConfig";
import { getRegisteredRoomConfig, ROOM_CONFIGS } from "../roomconfigs/registry";
import { ricaneroom } from "./ricaneroom";
import { mapTemplateConfig } from "./RoomLayoutMapper";

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
function loadRoomConfig(
  roomName: string,
  configEntry: (typeof ROOM_CONFIGS)[string]
): void {
  if (Game.rooms[roomName]) {
    const roomConfig = getRegisteredRoomConfig(roomName);
    if (!roomConfig) {
      throw new Error(`Room config "${roomName}" is registered without a configuration`);
    }
    const room = Game.rooms[roomName];
    room.memory.config = roomConfig;

    if (configEntry.initializeData) {
      initializeRoomData(room);
    }
  }
}

// Build energysources array for rooms that don't have explicit energysources in their config
function buildEnergySourcesForRoom(room: Room): EnergySourceConfig[] {
  const sources: Source[] = room.find(FIND_SOURCES);
  const energysources: EnergySourceConfig[] = [];

  for (const s of sources) {
    const entry: EnergySourceConfig = {
      id: s.id,
      pos: { x: s.pos.x, y: s.pos.y },
      haulers: 1
    };

    // If room.memory.sources has container info, use that for parking
    if (room.memory.sources && room.memory.sources[s.id]) {
      const memSrc = room.memory.sources[s.id];
      const cont = memSrc.container;
      if (cont) {
        entry.parkingspots = [ { x: cont.x, y: cont.y } ];
        // If memory explicitly records a link position for this source, prefer that exact link first
        if (memSrc.linkpos) {
          const lx = memSrc.linkpos.x;
          const ly = memSrc.linkpos.y;
          const structs = room.lookForAt(LOOK_STRUCTURES, lx, ly) as Structure[];
          const exactLink = structs.find(sst => (sst.structureType === STRUCTURE_LINK)) as StructureLink | undefined;
          if (exactLink) {
            entry.linkpos = { x: exactLink.pos.x, y: exactLink.pos.y };
          } else {
            // Try to find a link near the container (previous behavior)
            const link = room.find<StructureLink>(FIND_STRUCTURES, {
              filter: l => l.structureType === STRUCTURE_LINK && l.pos.getRangeTo(cont.x, cont.y) < 4
            })[0];
            if (link) {
              entry.linkpos = { x: link.pos.x, y: link.pos.y };
            }
          }
        } else {
          // Try to find a link near the container
          const link = room.find<StructureLink>(FIND_STRUCTURES, {
            filter: l => l.structureType === STRUCTURE_LINK && l.pos.getRangeTo(cont.x, cont.y) < 4
          })[0];
          if (link) {
            entry.linkpos = { x: link.pos.x, y: link.pos.y };
          }
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

// Resolve a room's config: if the room uses a template, translate template coords into concrete positions
function resolveTemplateConfig(room: Room): RoomConfig | null {
  if (!room || !room.memory || !room.memory.config) return null;
  const memcfg = validateRoomConfig(room.name, room.memory.config);
  if (!memcfg.roomtemplate) return memcfg;

  const anchor = memcfg.roomanchor || { x: 0, y: 0 };
  const rotation = memcfg.templaterotation || 0;
  const mapped = mapTemplateConfig(ricaneroom.getConfig(), anchor, rotation);
  const merged: RoomConfig = Object.assign({}, mapped, memcfg);

  // If energysources aren't provided by the memory config, build them from actual room sources
  if (!merged.energysources) {
    merged.energysources = buildEnergySourcesForRoom(room);
  }

  // controllerLink isn't explicitly in template; if absent try using first fieldLink as controllerLink
  if (!merged.controllerLink && merged.fieldLinks && merged.fieldLinks.length > 0) {
    merged.controllerLink = merged.fieldLinks[0];
  }

  return validateRoomConfig(room.name, merged);
}

export var RoomHelper = {


  loadRoomMemory: function() {
    // Load only configs that were previously applied by the room loader.
    for (const [roomName, roomEntry] of Object.entries(ROOM_CONFIGS)) {
      if (roomEntry.loadOnVisibility) {
        loadRoomConfig(roomName, roomEntry);
      }
    }

    // Initialize data for owned rooms that are not configured for visibility loading.
    const configuredRoomNames = new Set(
      Object.keys(ROOM_CONFIGS).filter(roomName => ROOM_CONFIGS[roomName].loadOnVisibility)
    );
    for (let roomid in Memory.rooms) {
      let room = Game.rooms[roomid];
      if (!room) {
        continue;
      }
      if (room.controller?.owner?.username !== "ricane") {
        continue;
      }
      if (!room.memory.config) {
        continue;
      }
      const roomConfig = validateRoomConfig(roomid, room.memory.config);
      if (roomConfig.type !== "owned") continue;
      // If config uses a template, resolve template positions into concrete coords
      if (roomConfig.roomtemplate) {
        const resolved = resolveTemplateConfig(room);
        if (resolved) {
          room.memory.config = resolved;
        }
      }
      // Avoid reinitializing data for rooms handled by the registry.
      if (!configuredRoomNames.has(roomid)) {
        initializeRoomData(room);
      }
    }

    return;
  },

  // Returns the resolved configuration for a room without modifying memory
  getRoomValues: function(room: Room): ResolvedRoomConfig {
    // Load runtime values from memory first so they are available
    const memoryValues: ResolvedRoomConfig = {
      energysources: [],
      fieldContainers: [],
      fieldLinks: []
    };
    if (room.memory) {
      if (room.memory.nextTrade !== undefined) memoryValues.nextTrade = room.memory.nextTrade;
      if (room.memory.data !== undefined) memoryValues.data = room.memory.data;
      if (room.memory.starvedTime !== undefined) memoryValues.starvedTime = room.memory.starvedTime;
      if (room.memory.sources !== undefined) memoryValues.sources = room.memory.sources;
      if (room.memory.spawnMemory !== undefined) memoryValues.spawnMemory = room.memory.spawnMemory;
      // Do not copy room.memory.config here - we'll resolve it below and let config fields overwrite memory values
    }

    // Start with resolved config (handles templates)
    let cfg: RoomConfig | null = null;
    if (room.memory && room.memory.config) {
      cfg = resolveTemplateConfig(room);
    }

    // Merge memory values first, then overlay the resolved config so config keys overwrite runtime memory values
    const base: ResolvedRoomConfig = Object.assign({}, memoryValues, cfg || {});

    // Ensure energysources are present
    if (!cfg || cfg.energysources === undefined) {
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
    // Chemist parking
    if (!base.chemist && cfg && cfg.chemist) base.chemist = cfg.chemist;

    return base;
  },

  // Backwards compatible alias: keep getRoomConfig but delegate to getRoomValues
  getRoomConfig: function(room: Room): ResolvedRoomConfig {
    return this.getRoomValues(room);
  },

  // Get config by room name, even if room is not visible
  getRoomConfigByName: function(roomName: string): ResolvedRoomConfig | RoomConfig | null {
    // First, check if room is visible and has config
    const room = Game.rooms[roomName];
    if (room) {
      return this.getRoomConfig(room);
    }

    return getRegisteredRoomConfig(roomName);
  }
};
