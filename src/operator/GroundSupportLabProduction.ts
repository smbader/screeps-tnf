export interface LabReactionRecipe {
  product: ResourceConstant;
  reagentA: ResourceConstant;
  reagentB: ResourceConstant;
  tier: number;
}

export interface LabReactionPlan {
  recipe?: LabReactionRecipe;
  missingBase?: ResourceConstant;
}

export interface LabPosition {
  id: string;
  pos: { x: number; y: number };
}

export type ReactionMap = Record<string, Record<string, string>>;

export const LAB_COMPOUND_TARGET = 2000;
export const LAB_PRODUCTION_ENERGY_FLOOR = 400000;
export const LAB_REACTION_MINERAL_AMOUNT = 5;
export const LAB_REACTION_ENERGY_AMOUNT = 2;

const BASE_MINERALS = new Set(["H", "O", "U", "L", "K", "Z", "X"]);

export function getLabReactionRecipes(reactions: ReactionMap = REACTIONS): LabReactionRecipe[] {
  const rawRecipes: Omit<LabReactionRecipe, "tier">[] = [];
  for (const reagentA of Object.keys(reactions).sort()) {
    for (const reagentB of Object.keys(reactions[reagentA]).sort()) {
      rawRecipes.push({
        product: reactions[reagentA][reagentB] as ResourceConstant,
        reagentA: reagentA as ResourceConstant,
        reagentB: reagentB as ResourceConstant
      });
    }
  }

  const recipeByProduct = new Map<string, Omit<LabReactionRecipe, "tier">>();
  for (const recipe of rawRecipes) recipeByProduct.set(recipe.product, recipe);
  const uniqueRecipes = Array.from(recipeByProduct.values());

  const tiers = new Map<string, number>();
  const getTier = (resource: string, visiting: Set<string>): number => {
    const cached = tiers.get(resource);
    if (cached !== undefined) return cached;
    if (BASE_MINERALS.has(resource) || visiting.has(resource)) return 0;
    const recipe = recipeByProduct.get(resource);
    if (!recipe) return 0;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(resource);
    const tier = 1 + Math.max(getTier(recipe.reagentA, nextVisiting), getTier(recipe.reagentB, nextVisiting));
    tiers.set(resource, tier);
    return tier;
  };

  return uniqueRecipes
    .map(recipe => ({ ...recipe, tier: getTier(recipe.product, new Set<string>()) }))
    .filter(recipe => recipe.tier >= 1 && recipe.tier <= 3);
}

export function selectLabReactionPlan(
  availableStock: Partial<Record<ResourceConstant, number>>,
  reactions: ReactionMap = REACTIONS,
  targetAmount = LAB_COMPOUND_TARGET,
  productStock: Partial<Record<ResourceConstant, number>> = availableStock
): LabReactionPlan | null {
  const recipes = getLabReactionRecipes(reactions);
  const recipeByProduct = new Map(recipes.map(recipe => [recipe.product, recipe]));
  const targets = recipes
    .filter(recipe => (productStock[recipe.product] || 0) < targetAmount)
    .sort(
      (left, right) =>
        right.tier - left.tier ||
        (productStock[left.product] || 0) - (productStock[right.product] || 0) ||
        left.product.localeCompare(right.product)
    );
  let firstMissingBase: ResourceConstant | undefined;

  const findNextStep = (product: ResourceConstant, visiting: Set<ResourceConstant>): LabReactionRecipe | null => {
    if (visiting.has(product) || (productStock[product] || 0) >= targetAmount) return null;
    const recipe = recipeByProduct.get(product);
    if (!recipe) return null;

    const nextVisiting = new Set(visiting);
    nextVisiting.add(product);
    const missingReagents = [recipe.reagentA, recipe.reagentB]
      .filter(reagent => (availableStock[reagent] || 0) < LAB_REACTION_MINERAL_AMOUNT)
      .sort((left, right) => (availableStock[left] || 0) - (availableStock[right] || 0) || left.localeCompare(right));

    for (const reagent of missingReagents) {
      if (BASE_MINERALS.has(reagent)) {
        if (!firstMissingBase) firstMissingBase = reagent;
        continue;
      }
      const precursor = findNextStep(reagent, nextVisiting);
      if (precursor) return precursor;
    }
    return missingReagents.length === 0 ? recipe : null;
  };

  for (const target of targets) {
    const recipe = findNextStep(target.product, new Set<ResourceConstant>());
    if (recipe) return { recipe };
  }

  return firstMissingBase ? { missingBase: firstMissingBase } : null;
}

export function selectLabInputPair<T extends LabPosition>(labs: T[], reactionRange = 2): [T, T] | null {
  const sortedLabs = labs
    .slice()
    .sort((left, right) => left.pos.x - right.pos.x || left.pos.y - right.pos.y || left.id.localeCompare(right.id));
  if (sortedLabs.length < 3) return null;

  for (let firstIndex = 0; firstIndex < sortedLabs.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < sortedLabs.length; secondIndex++) {
      const first = sortedLabs[firstIndex];
      const second = sortedLabs[secondIndex];
      const allOutputsInRange = sortedLabs
        .filter(candidate => candidate.id !== first.id && candidate.id !== second.id)
        .every(candidate => {
          const inRangeOfFirst =
            Math.max(Math.abs(candidate.pos.x - first.pos.x), Math.abs(candidate.pos.y - first.pos.y)) <= reactionRange;
          const inRangeOfSecond =
            Math.max(Math.abs(candidate.pos.x - second.pos.x), Math.abs(candidate.pos.y - second.pos.y)) <=
            reactionRange;
          return inRangeOfFirst && inRangeOfSecond;
        });
      if (allOutputsInRange) return [first, second];
    }
  }

  return null;
}

export function getLoadedLabReaction(
  reagentA: ResourceConstant | null,
  reagentB: ResourceConstant | null,
  amountA: number,
  amountB: number,
  reactions: ReactionMap = REACTIONS
): LabReactionRecipe | null {
  if (!reagentA || !reagentB || amountA <= 0 || amountB <= 0) return null;
  const product = reactions[reagentA]?.[reagentB] || reactions[reagentB]?.[reagentA];
  if (!product) return null;
  const recipe = getLabReactionRecipes(reactions).find(candidate => candidate.product === product);
  return recipe ? { ...recipe, reagentA, reagentB } : null;
}

export function getAffordableLabPurchaseAmount(
  requestedAmount: number,
  terminalEnergy: number,
  totalEnergy: number,
  transactionCost: (amount: number) => number,
  energyFloor = LAB_PRODUCTION_ENERGY_FLOOR
): number {
  let low = 0;
  let high = Math.max(0, Math.floor(requestedAmount));
  while (low < high) {
    const amount = Math.ceil((low + high) / 2);
    const cost = transactionCost(amount);
    if (cost <= terminalEnergy && totalEnergy - cost >= energyFloor) low = amount;
    else high = amount - 1;
  }
  return low;
}
