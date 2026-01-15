# Attack Winnability Evaluation

## Overview
The `CombatEvaluator` utility provides intelligent decision-making for attack squads by evaluating whether an attack is likely to succeed before fully committing forces.

## How It Works

### Evaluation Process
When a squad reaches the target room, the system evaluates the attack every 50 ticks by:

1. **Analyzing Squad Strength**
   - Total HP and maximum HP
   - Attack power (melee and ranged)
   - Heal power
   - Boost multipliers (tier 1-3)
   - Number of creeps

2. **Analyzing Enemy Forces**
   - Tower count and energy levels
   - Hostile creep defenders
   - Defensive structures (walls, ramparts)
   - Enemy attack and heal capabilities

3. **Computing Advantage Score**
   - Positive scores indicate favorable conditions
   - Negative scores indicate unfavorable conditions
   - Threshold: attacks with scores > -20 are considered winnable

### Evaluation Factors

#### Health Status (+10 to -30 points)
- Full health squad (>90%): +10 points
- Low health squad (<50%): -30 points

#### Tower Threats (+20 to -40 points)
- No towers: +20 points
- Low tower energy (<1000): +15 points
- Towers can kill squad: -40 points
- Moderate tower threat: variable penalty

#### Heal/Damage Balance (+20 to -25 points)
- Positive net healing: +20 points
- Severely negative healing: -25 points
- Marginal balance: -10 points

#### Defender Strength (+15 to -20 points)
- No defenders: +15 points
- Strong attack advantage: +15 points
- Weaker than defenders: -20 points

#### Fortifications (-5 to -30 points)
- Heavy fortifications (>10M): -30 points
- Moderate fortifications (1-10M): -15 points
- Light fortifications (<1M): -5 points
- No fortifications: +10 points

## Integration with SquadSiegeOperation

### Decision Flow
```
1. Squad arrives at target room
2. Evaluate attack winnability
3. If NOT WINNABLE:
   - Hold position
   - Heal squad
   - If fully healed, initiate retreat
4. If WINNABLE:
   - Proceed with attack sequence
   - Wait for towers to deplete
   - Breach walls
   - Attack structures
```

### Memory Caching
- Evaluations are cached for 50 ticks to reduce computational overhead
- Results stored in `Memory.squadSiege.attackWinnable`
- Last evaluation tick tracked in `Memory.squadSiege.lastEvaluationTick`

### Logging
The evaluator provides detailed reasoning for its decisions:
```
[SquadSiege:alpha] Attack Evaluation: WINNABLE (confidence: 65%, score: 32)
[SquadSiege:alpha]   - Squad at full health: 100%
[SquadSiege:alpha]   - Towers low on energy: 850
[SquadSiege:alpha]   - Positive heal balance: +45 HP/tick
[SquadSiege:alpha]   - No active defenders
[SquadSiege:alpha]   - Light fortifications: 750K HP
[SquadSiege:alpha]   - Final advantage score: 32
```

## Boost Handling
The evaluator correctly handles all three tiers of boosts:
- **Tier 1** (e.g., UH, LO): 2x multiplier
- **Tier 2** (e.g., UH2O, LHO2): 3x multiplier  
- **Tier 3** (e.g., XUH2O, XLHO2): 4x multiplier

## Configuration
The evaluation uses these constants (can be adjusted in `CombatEvaluator.ts`):
- `TOWER_DAMAGE_MAX`: 600
- `TOWER_DAMAGE_MIN`: 150
- `TOWER_RANGE_MAX`: 20
- `TOWER_ENERGY_PER_SHOT`: 10
- Winnability threshold: -20 advantage score

## Benefits
1. **Prevents Costly Losses**: Squad won't engage in unwinnable battles
2. **Smart Resource Management**: Avoids wasting boosted creeps
3. **Adaptive Strategy**: Squad can retreat and try again later
4. **Transparent Decision-Making**: Detailed logging explains each evaluation
5. **Performance Efficient**: Caching prevents redundant calculations
