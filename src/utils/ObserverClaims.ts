export function claimObserver(observerId: string, tick: number): boolean {
  if (claimTick !== tick) {
    claimTick = tick;
    claimed.clear();
  }
  if (claimed.has(observerId)) return false;
  claimed.add(observerId);
  return true;
}

export function isObserverClaimed(observerId: string, tick: number): boolean {
  return claimTick === tick && claimed.has(observerId);
}

let claimTick = -1;
const claimed = new Set<string>();
