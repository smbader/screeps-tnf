import { Market } from "../../src/operations/Market";
import { assert } from "chai";

interface MockStore {
  getUsedCapacity: (resource?: string) => number;
  getFreeCapacity: (resource?: string) => number;
}

interface MockMarketState {
  deals: string[];
  sends: { resource: string; amount: number; roomName: string }[];
  dealResult: number;
  orders: Order[];
}

const RETURN_OK = 0;
let marketState: MockMarketState;
const GLOBAL_KEYS = ["Game", "Memory", "OK", "ORDER_BUY", "RESOURCE_ENERGY"];
let originalGlobals: Map<string, { present: boolean; value: unknown }>;

function createStore(resources: Record<string, number>, capacity = 1000000): MockStore {
  return {
    getUsedCapacity: resource =>
      resource ? resources[resource] || 0 : Object.keys(resources).reduce((total, key) => total + resources[key], 0),
    getFreeCapacity: () =>
      Math.max(0, capacity - Object.keys(resources).reduce((total, key) => total + resources[key], 0))
  };
}

function createRoom(
  name: string,
  terminalResources: Record<string, number>,
  storageResources: Record<string, number> = { energy: 900000 }
) {
  const store = createStore(terminalResources);
  return {
    name,
    controller: { my: true },
    storage: { store: createStore(storageResources) },
    terminal: {
      my: true,
      cooldown: 0,
      store,
      send: (resource: string, amount: number, roomName: string) => {
        marketState.sends.push({ resource, amount, roomName });
        return RETURN_OK;
      }
    }
  };
}

function setMarketEnvironment(
  rooms: Record<string, ReturnType<typeof createRoom>>,
  orders: Order[],
  memoryRooms: Record<string, { config?: { type: string; shard: string } }> = {},
  priceHistory: unknown = undefined
): void {
  marketState = { deals: [], sends: [], dealResult: RETURN_OK, orders };
  const history = [
    { date: "2026-10-28", transactions: 1, avgPrice: 1 },
    { date: "2026-10-29", transactions: 1, avgPrice: 1 },
    { date: "2026-10-30", transactions: 1, avgPrice: 1 }
  ];

  Object.assign(global, {
    Game: {
      cpu: { bucket: 5000 },
      time: 100,
      shard: { name: "shard1" },
      rooms,
      market: {
        credits: 0,
        orders: {},
        calcTransactionCost: () => 10,
        getAllOrders: (filter: (order: Order) => boolean) => orders.filter(filter),
        getHistory: (resource: string) => {
          if (priceHistory !== undefined) return priceHistory;
          return resource === "energy" ? history.map(sample => ({ ...sample, avgPrice: 10 })) : history;
        },
        deal: (orderId: string) => {
          marketState.deals.push(orderId);
          return marketState.dealResult;
        }
      }
    },
    Memory: { rooms: memoryRooms },
    OK: RETURN_OK,
    ORDER_BUY: "buy",
    RESOURCE_ENERGY: "energy"
  });
}

describe("market operation", () => {
  before(() => {
    originalGlobals = new Map(
      GLOBAL_KEYS.map(key => [key, { present: Reflect.has(global, key), value: Reflect.get(global, key) as unknown }])
    );
  });

  after(() => {
    for (const [key, original] of originalGlobals) {
      if (original.present) {
        Reflect.set(global, key, original.value);
      } else {
        Reflect.deleteProperty(global, key);
      }
    }
  });

  it("sells eligible raw-mineral surplus only at or above the recent median", () => {
    const room = createRoom("E1N1", { energy: 50000, H: 12000 });
    const orders: Order[] = [
      {
        id: "h-order",
        created: 1,
        type: "buy",
        resourceType: "H",
        roomName: "E2N2",
        amount: 1000,
        remainingAmount: 1000,
        price: 2
      }
    ];
    setMarketEnvironment({ E1N1: room }, orders);

    new Market().actions();
    assert.deepEqual(marketState.deals, ["h-order"]);
  });

  it("sells all deposit-resource types when profitable buy orders are available", () => {
    const resources: DepositConstant[] = ["mist", "biomass", "metal", "silicon"];
    const rooms: Record<string, ReturnType<typeof createRoom>> = {};
    const orders: Order[] = resources.map((resource, index) => {
      const roomName = `E${index + 1}N1`;
      rooms[roomName] = createRoom(roomName, { energy: 50000, [resource]: 3000 });
      return {
        id: `${resource}-order`,
        created: 1,
        type: "buy",
        resourceType: resource,
        roomName: "E9N9",
        amount: 1000,
        remainingAmount: 1000,
        price: 2
      };
    });
    setMarketEnvironment(rooms, orders);

    new Market().actions();

    assert.sameMembers(
      marketState.deals,
      resources.map(resource => `${resource}-order`)
    );
  });

  it("does not sell below the recent median or through the protected terminal reserve", () => {
    const belowMedianRoom = createRoom("E1N1", { energy: 50000, H: 12000 });
    const belowMedianOrder: Order = {
      id: "low-order",
      created: 1,
      type: "buy",
      resourceType: "H",
      roomName: "E2N2",
      amount: 1000,
      remainingAmount: 1000,
      price: 0.9
    };
    setMarketEnvironment({ E1N1: belowMedianRoom }, [belowMedianOrder]);
    new Market().actions();
    assert.lengthOf(marketState.deals, 0);

    const reserveRoom = createRoom("E1N1", { energy: 50000, H: 10000 });
    setMarketEnvironment({ E1N1: reserveRoom }, [{ ...belowMedianOrder, id: "reserve-order", price: 2 }]);
    new Market().actions();
    assert.lengthOf(marketState.deals, 0);
  });

  it("balances a terminal deficit before selling the donor's remaining stock", () => {
    const donor = createRoom("E1N1", { energy: 50000, H: 12000 });
    const recipient = createRoom("E2N2", { energy: 30000, H: 0 });
    const order: Order = {
      id: "h-order",
      created: 1,
      type: "buy",
      resourceType: "H",
      roomName: "E3N3",
      amount: 1000,
      remainingAmount: 1000,
      price: 2
    };
    setMarketEnvironment({ E1N1: donor, E2N2: recipient }, [order]);

    new Market().actions();

    assert.deepEqual(marketState.sends, [{ resource: "H", amount: 2000, roomName: "E2N2" }]);
    assert.lengthOf(marketState.deals, 0);
  });

  it("prints each room on its own line in the debug update", () => {
    const firstRoom = createRoom("E1N1", { energy: 50000, H: 10000 });
    const secondRoom = createRoom("E2N2", { energy: 50000, H: 10000 });
    setMarketEnvironment({ E1N1: firstRoom, E2N2: secondRoom }, []);

    const originalLog = console.log;
    const messages: string[] = [];
    console.log = (message?: unknown) => messages.push(String(message));
    try {
      new Market().actions();
    } finally {
      console.log = originalLog;
    }

    const debugUpdate = messages.find(message => message.includes("Tick update:"));
    assert.isDefined(debugUpdate);
    assert.include(debugUpdate, "Tick update:\nE1N1:");
    assert.include(debugUpdate, "\nE2N2:");
  });

  it("sells energy only above storage, terminal, and unseen-room reserves", () => {
    const energyOrder: Order = {
      id: "energy-order",
      created: 1,
      type: "buy",
      resourceType: "energy",
      roomName: "E2N2",
      amount: 1000,
      remainingAmount: 1000,
      price: 10
    };
    const surplusRoom = createRoom("E1N1", { energy: 100000 });
    setMarketEnvironment({ E1N1: surplusRoom }, [energyOrder]);

    new Market().actions();

    assert.deepEqual(marketState.deals, ["energy-order"]);

    const belowStorageReserve = createRoom("E1N1", { energy: 100000 }, { energy: 199999 });
    setMarketEnvironment({ E1N1: belowStorageReserve }, [energyOrder]);

    new Market().actions();

    assert.lengthOf(marketState.deals, 0);

    const knownRoomWithEnergy = createRoom("E1N1", { energy: 100000 }, { energy: 200000 });
    setMarketEnvironment({ E1N1: knownRoomWithEnergy }, [energyOrder], {
      E2N2: { config: { type: "owned", shard: "shard1" } }
    });

    new Market().actions();

    assert.lengthOf(marketState.deals, 0);
  });

  it("does not retry or allocate the terminal twice after a failed deal", () => {
    const room = createRoom("E1N1", { energy: 50000, H: 12000, O: 12000 });
    const orders: Order[] = [
      {
        id: "h-order",
        created: 1,
        type: "buy",
        resourceType: "H",
        roomName: "E2N2",
        amount: 1000,
        remainingAmount: 1000,
        price: 2
      },
      {
        id: "o-order",
        created: 1,
        type: "buy",
        resourceType: "O",
        roomName: "E2N2",
        amount: 1000,
        remainingAmount: 1000,
        price: 2
      }
    ];
    setMarketEnvironment({ E1N1: room }, orders);
    marketState.dealResult = -6;

    new Market().actions();

    assert.deepEqual(marketState.deals, ["h-order"]);
  });

  it("defers market sales when price history is malformed instead of throwing", () => {
    const room = createRoom("E1N1", { energy: 50000, H: 12000 });
    const order: Order = {
      id: "h-order",
      created: 1,
      type: "buy",
      resourceType: "H",
      roomName: "E2N2",
      amount: 1000,
      remainingAmount: 1000,
      price: 2
    };
    setMarketEnvironment({ E1N1: room }, [order], {}, undefined);

    Object.assign(Game.market, {
      getHistory: () => {
        throw new TypeError("Cannot read properties of undefined (reading '0')");
      }
    });

    assert.doesNotThrow(() => new Market().actions());
    assert.lengthOf(marketState.deals, 0);
  });
});
