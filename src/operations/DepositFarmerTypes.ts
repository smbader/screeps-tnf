export type DepositMinerState = "travelling" | "harvesting" | "returning" | "unloading" | "retiring";

export interface DepositFarmerPolicy {
  enabled: boolean;
  observerRange: number;
  minimumStorageEnergy: number;
  maxActiveMinersPerHome: number;
  maxSightingAge: number;
  minimumRemainingLifetime: number;
  returnSafetyTicks: number;
  scanFailureLogInterval: number;
  minimumCpuBucket: number;
  scanInterval: number;
  avoidHostileRooms: boolean;
}

export const DEPOSIT_FARMER_POLICY: DepositFarmerPolicy = {
  enabled: true,
  observerRange: 10,
  minimumStorageEnergy: 100000,
  maxActiveMinersPerHome: 1,
  maxSightingAge: 500,
  minimumRemainingLifetime: 300,
  returnSafetyTicks: 100,
  scanFailureLogInterval: 100,
  minimumCpuBucket: 4000,
  scanInterval: 1,
  avoidHostileRooms: true
};

export interface DepositPositionMemory {
  x: number;
  y: number;
}

export interface DepositSightingMemory {
  id: Id<Deposit>;
  roomName: string;
  pos: DepositPositionMemory;
  depositType: DepositConstant;
  lastSeen: number;
  ticksToDecay: number;
  cooldown: number;
  assignedCreep?: string;
  homeRoom?: string;
}

export interface DepositFarmerHomeMemory {
  scanRooms: string[];
  pendingRoom?: string;
  lastScanTick?: number;
}

export interface DepositFarmerMemory {
  version: 2;
  homes: Record<string, DepositFarmerHomeMemory>;
  scannedRooms: Record<string, number>;
  deposits: Record<string, DepositSightingMemory>;
}

export interface DepositMinerCreepMemory extends CreepMemory {
  role: "depositMiner";
  room: string;
  targetRoom: string;
  depositId: Id<Deposit>;
  depositPos: DepositPositionMemory;
  depositType: DepositConstant;
  depositState: DepositMinerState;
}
