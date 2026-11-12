# GroundSupport Debug Guide

The GroundSupport operator now includes comprehensive debugging to show what's happening every tick. With `GROUND_SUPPORT_DEBUG = true` at the top of `src/operator/GroundSupport.ts`, you'll see detailed logs for all major decisions.

## Main Decision Flow

### 1. Lab Production Analysis
When `runLabProduction()` executes, you'll see:

```
[ROOMNAME] GroundSupport stock check - available: {O: 2, G: 300, ...}
```
This shows all available resources from storage, terminal, creep, and labs.

### 2. Input Lab Status
```
[ROOMNAME] GroundSupport inputA has K (2), inputB has EMPTY (0), loadedRecipe=null
```
Shows what minerals are currently in each input lab and whether they form a valid reaction.

### 3. Reaction Plan Selection
```
[ROOMNAME] GroundSupport plan selection: recipe=GH, missingBase=none
```
Shows what reaction was selected (or none if all targets met, or a missing base mineral).

### 4. Supply Check
```
[ROOMNAME] GroundSupport supply check - storageA(K)=2, storageB(G)=300, need=1000
```
**Critical check**: Shows how much of each reagent is available in accessible storage/terminal vs. how much is needed (1000 per input lab).

If either reagent has less than 1000 in storage AND the other also has less than 1000:
```
[ROOMNAME] GroundSupport labs skipped: insufficient accessible K (2) and G (300)
```
This means the system detected it can't supply the reaction and skipped it.

## Lab Need Determination

When `getProductionLabNeed()` checks what needs to be supplied:

### If Inputs Are Loaded
```
[ROOMNAME] GroundSupport inputsHaveLoadedRecipe=true, inputA=K(500), inputB=G(800)
```
Reaction is ready to run.

### If Inputs Need Filling
```
[ROOMNAME] GroundSupport input lab check - need K: used=100, available=900, labMineral=K
[ROOMNAME] GroundSupport need: supply K to input lab (need 900)
```
Shows how much of the needed reagent is available and what needs to be supplied.

### If Stuck Condition Detected
```
[ROOMNAME] GroundSupport input lab check - need O: used=2, available=0, labMineral=K
[ROOMNAME] GroundSupport STUCK: clearing K from input lab
[ROOMNAME] GroundSupport labs stuck: can't supply enough O to lab (need 998, have 0)
```
This means:
- The lab needs O but only has 2 O in total in the room
- The lab has K loaded (leftover from before)
- System can't get 1000 O, so it clears K to try a different reaction

### Output Lab Energy Needs
```
[ROOMNAME] GroundSupport need: fill output lab energy (need 450)
```
Output lab needs energy to run reactions.

### No Needs
```
[ROOMNAME] GroundSupport no needs found
```
System is ready to run reactions (all input labs are loaded with 1000+ units of the right minerals).

## Troubleshooting Guide

### System Shows "STUCK" Message
- **Cause**: Input labs have minerals stuck in them, but not enough supply to complete a full batch
- **Action**: Check if the stuck mineral is from an old reaction. The system should clear it and try a different reaction.

### System Shows "insufficient accessible" Message
- **Cause**: The selected reaction needs more resources than exist in accessible storage/terminal
- **Action**: This is normal - system tries the next reaction plan. Check if you need to import more base minerals.

### System Shows "no needs found" Every Tick But Isn't Reacting
- **Cause**: Input labs are loaded but the reaction isn't running
- **Action**: Check if output labs are full, have low energy, have wrong minerals, or have high cooldown

### Supply Check Shows Large Amounts But Reaction Never Runs
- **Cause**: Resources are in input labs (counted in available) but not in accessible storage (storage/terminal)
- **Action**: This shouldn't happen with the new check. If it does, input labs have stuck minerals - watch for STUCK message.

## Key Constants

- `LAB_INPUT_BUFFER = 1000`: Target amount to fill each input lab to
- `LAB_REACTION_MINERAL_AMOUNT = 5`: Minimum to run a single reaction
- `LAB_INPUT_BUFFER = 1000`: Output labs need this much energy
- `LAB_PRODUCTION_ENERGY_FLOOR = 400000`: Room must have this much energy before attempting production
