import {
  LabPosition,
  ReactionMap,
  getAffordableLabPurchaseAmount,
  getLabReactionRecipes,
  getLoadedLabReaction,
  selectLabInputPair,
  selectLabReactionPlan
} from "../../src/operator/GroundSupportLabProduction";
import { assert } from "chai";

describe("GroundSupport lab production policy", () => {
  const reactions: ReactionMap = {
    H: { O: "OH" },
    U: { H: "UH" },
    UH: { OH: "UH2O" },
    UH2O: { X: "XUH2O" }
  };

  it("classifies reaction outputs into tiers one through three", () => {
    assert.deepEqual(
      getLabReactionRecipes(reactions).map(recipe => [recipe.product, recipe.tier]),
      [
        ["OH", 1],
        ["UH", 1],
        ["UH2O", 2],
        ["XUH2O", 3]
      ]
    );
  });

  it("prioritizes an actionable tier three deficit", () => {
    const plan = selectLabReactionPlan({ H: 10, O: 10, U: 10, X: 10, OH: 10, UH: 10, UH2O: 10 }, reactions, 2000, {
      OH: 0,
      UH: 0,
      UH2O: 0,
      XUH2O: 0
    });

    assert.equal(plan?.recipe?.product, "XUH2O");
  });

  it("produces a missing precursor before the tier three target", () => {
    const plan = selectLabReactionPlan({ H: 10, O: 10, U: 10, X: 10, OH: 10, UH: 10 }, reactions, 2000, {
      OH: 10,
      UH: 10,
      UH2O: 0,
      XUH2O: 0
    });

    assert.equal(plan?.recipe?.product, "UH2O");
  });

  it("keeps producing an available precursor before buying another missing base", () => {
    const plan = selectLabReactionPlan({ H: 10, O: 10, U: 10, OH: 10, UH: 10 }, reactions, 2000, {
      OH: 10,
      UH: 10,
      UH2O: 0,
      XUH2O: 0
    });

    assert.equal(plan?.recipe?.product, "UH2O");
    assert.isUndefined(plan?.missingBase);
  });

  it("requests a missing raw base mineral only when no reaction is actionable", () => {
    const plan = selectLabReactionPlan({ O: 10, U: 10, X: 10 }, reactions, 2000, {
      OH: 0,
      UH: 0,
      UH2O: 0,
      XUH2O: 0
    });

    assert.equal(plan?.missingBase, "H");
  });

  it("does not count the input buffer toward the compound stock target", () => {
    const plan = selectLabReactionPlan(
      { H: 10, O: 10, U: 10, X: 10, OH: 10, UH: 10, UH2O: 10, XUH2O: 2000 },
      reactions,
      2000,
      { OH: 2000, UH: 2000, UH2O: 2000, XUH2O: 2000 }
    );

    assert.isNull(plan);
  });

  it("bounds market purchases by terminal energy and the room reserve", () => {
    assert.equal(
      getAffordableLabPurchaseAmount(1000, 100, 400100, amount => amount / 2),
      200
    );
    assert.equal(
      getAffordableLabPurchaseAmount(1000, 1000, 500000, amount => amount),
      1000
    );
    assert.equal(
      getAffordableLabPurchaseAmount(1000, 1000, 399999, () => 0),
      0
    );
  });

  it("selects a deterministic input pair within range of every output lab", () => {
    const labs: LabPosition[] = [
      { id: "input-a", pos: { x: 10, y: 10 } },
      { id: "input-b", pos: { x: 12, y: 10 } },
      { id: "product-a", pos: { x: 11, y: 8 } },
      { id: "product-b", pos: { x: 11, y: 12 } }
    ];

    assert.deepEqual(
      selectLabInputPair(labs)?.map(lab => lab.id),
      ["input-a", "input-b"]
    );
    assert.isNull(selectLabInputPair(labs.slice(0, 2)));
  });

  it("keeps a loaded reagent pair's reaction locked until either input is empty", () => {
    assert.equal(getLoadedLabReaction("U", "H", 100, 100, reactions)?.product, "UH");
    assert.equal(getLoadedLabReaction("H", "O", 100, 100, reactions)?.product, "OH");
    assert.isNull(getLoadedLabReaction("U", "H", 0, 100, reactions));
    assert.isNull(getLoadedLabReaction("U", "H", 100, 0, reactions));
  });

  it("rejects a layout when no input pair reaches every output lab", () => {
    const labs: LabPosition[] = [
      { id: "input-a", pos: { x: 10, y: 10 } },
      { id: "input-b", pos: { x: 12, y: 10 } },
      { id: "product-a", pos: { x: 11, y: 8 } },
      { id: "product-b", pos: { x: 30, y: 30 } }
    ];

    assert.isNull(selectLabInputPair(labs));
  });
});
