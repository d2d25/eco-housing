import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildModel } from "../domain/model";
import { effectiveFloorArea, floorAreaWhenOnSurface, hasSurfaceTag, isSmallEstimatedPlaceable, surfaceUnitsRequired } from "../domain/placementRules";
import { roomOptimization } from "../domain/roomOptimizer";
import { applyTierCap, compatibleCategoriesForRoom, diminishingMultiplier, roomUsesMaterialTier, supportCapPercentForCategory } from "../domain/roomScoring";
import type { EcoData, EcoModel, HousingItem, RoomInput } from "../domain/types";

const repoRoot = path.resolve(__dirname, "../../../..");
const data = JSON.parse(readFileSync(path.join(repoRoot, "outputs/eco-data.json"), "utf8")) as EcoData;
const model = buildModel(data);

function housing(name: string): HousingItem {
  const item = model.housingItems.find((entry) => entry.friendlyName === name);
  expect(item, `Missing housing item: ${name}`).toBeTruthy();
  return item!;
}

function duplicateValue(item: HousingItem, count: number) {
  let total = 0;
  for (let i = 0; i < count; i += 1) total += item.value * diminishingMultiplier(item, i);
  return total;
}

function baseInput(partial: Partial<RoomInput> = {}): RoomInput {
  return {
    roomType: "Bathroom",
    tier: 1,
    width: 4,
    depth: 4,
    height: 3,
    selectedSkills: new Set(),
    ownedItems: new Map(),
    disabledItems: new Set(),
    availability: "all",
    ...partial,
  };
}

describe("Eco housing reference calculations", () => {
  test("matches the Bathroom tooltip support caps", () => {
    const bathroom = duplicateValue(housing("Stump Latrine"), 2);
    const seatingCap = bathroom * (supportCapPercentForCategory(model, "Seating", "Bathroom") ?? 0);
    const decorationCap = bathroom * (supportCapPercentForCategory(model, "Decoration", "Bathroom") ?? 0);
    const lightingCap = bathroom * (supportCapPercentForCategory(model, "Lighting", "Bathroom") ?? 0);
    const total =
      bathroom +
      Math.min(housing("Stump Table").value, seatingCap) +
      Math.min(housing("Participation Trophy").value, decorationCap) +
      Math.min(housing("Torch Stand").value, lightingCap);

    expect(Number(total.toFixed(3))).toBe(3.795);
  });

  test("matches the Living Room tooltip score and tier cap", () => {
    const primary =
      duplicateValue(housing("Ashlar Basalt Fireplace"), 1) +
      duplicateValue(housing("Nylon Futon Couch"), 2) +
      duplicateValue(housing("Elk Statuette"), 5);
    const decorationRaw = housing("Stuffed Bison").value + housing("Orrery").value + housing("Participation Trophy").value;
    const seatingRaw = housing("Coffee Table").value + housing("Adorned Ashlar Basalt Bench").value;
    const lightingRaw = housing("Electric Wall Lamp").value;
    const afterCaps =
      primary +
      Math.min(decorationRaw, primary * (supportCapPercentForCategory(model, "Decoration", "Living Room") ?? 0)) +
      Math.min(seatingRaw, primary * (supportCapPercentForCategory(model, "Seating", "Living Room") ?? 0)) +
      Math.min(lightingRaw, primary * (supportCapPercentForCategory(model, "Lighting", "Living Room") ?? 0));

    expect(Number(primary.toFixed(2))).toBe(22.51);
    expect(Number(afterCaps.toFixed(2))).toBe(48.51);
    expect(Number(applyTierCap(model, afterCaps, 5).toFixed(2))).toBe(33.33);
  });

  test("keeps the known Living Room required volume", () => {
    const total =
      requiredVolume("Ashlar Basalt Fireplace") +
      requiredVolume("Nylon Futon Couch", 2) +
      requiredVolume("Elk Statuette", 5) +
      requiredVolume("Stuffed Bison") +
      requiredVolume("Orrery") +
      requiredVolume("Participation Trophy") +
      requiredVolume("Coffee Table") +
      requiredVolume("Adorned Ashlar Basalt Bench") +
      requiredVolume("Electric Wall Lamp");
    expect(total).toBe(46);
  });

  test("merges duplicate world object partials without losing room volume", () => {
    expect(housing("Sink").requirements?.requiredRoomVolume).toBe(12);
  });

  test("uses x/z as floor and y as height for occupancy", () => {
    const fireplace = housing("Ashlar Basalt Fireplace").occupancy!;
    expect(fireplace.width).toBe(3);
    expect(fireplace.depth).toBe(1);
    expect(fireplace.height).toBe(2);
    expect(fireplace.floorArea).toBe(3);
  });

  test("groups Eco tag-product variants around their base item", () => {
    const base = housing("Ashlar Stone Fireplace");
    const basalt = housing("Ashlar Basalt Fireplace");
    const variants = model.variantItemsByBase.get(base.itemClass) ?? [];

    expect(base.variantOfItemClass).toBeNull();
    expect(basalt.variantOfItemClass).toBe(base.itemClass);
    expect(variants.map((item) => item.friendlyName)).toContain("Ashlar Basalt Fireplace");
    expect(variants.map((item) => item.friendlyName)).toContain("Ashlar Stone Fireplace");
  });

  test("treats rugs and petals with the current placement rules", () => {
    const rug = housing("Rug Large");
    expect(hasSurfaceTag(rug, "Rug")).toBe(true);
    expect(effectiveFloorArea(rug)).toBe(0);
    expect(floorAreaWhenOnSurface(rug)).toBe(0);

    const rose = housing("Rose");
    expect(rose.tags).toContain("Petals");
    expect(rose.worldObjectClass).toBeNull();
    expect(isSmallEstimatedPlaceable(rose)).toBe(true);
    expect(surfaceUnitsRequired(rose)).toBe(1);
    expect(floorAreaWhenOnSurface(rose)).toBe(0);
    expect(effectiveFloorArea(rose)).toBe(0);
  });

  test("does not count side-attached wall lamps as floor area", () => {
    const lamp = housing("Electric Wall Lamp");
    expect(lamp.attachmentDirections?.length || lamp.requirements?.attachmentDirections?.length).toBeGreaterThan(0);
    expect(effectiveFloorArea(lamp)).toBe(0);
    expect(floorAreaWhenOnSurface(lamp)).toBe(0);
  });

  test("keeps floor-attached objects on the floor", () => {
    const fireplace = housing("Ashlar Basalt Fireplace");
    expect(fireplace.attachmentDirections).toContain("Down");
    expect(effectiveFloorArea(fireplace)).toBe(3);
  });
});

describe("Room optimizer behavior", () => {
  test("optimizes a selected room with support categories", () => {
    const result = roomOptimization(model, baseInput({ roomType: "Bathroom", tier: 1, width: 4, depth: 4, height: 3 }));
    expect(result.groups.map((group) => group.category)).toEqual(["Bathroom", "Seating", "Decoration", "Lighting"]);
    expect(result.score.capped).toBeGreaterThan(3);
  });

  test("blocks objects that cannot fit in the room footprint", () => {
    const result = roomOptimization(model, baseInput({ roomType: "Living Room", tier: 5, width: 2, depth: 2, height: 3 }));
    expect(result.entries.some((entry) => entry.item.friendlyName === "Ashlar Basalt Fireplace")).toBe(false);
  });

  test("uses the base item for variant groups in room optimization", () => {
    const allowed = new Set(model.housingItems
      .filter((item) => !["Ashlar Stone Fireplace", "Ashlar Basalt Fireplace"].includes(item.friendlyName))
      .map((item) => item.itemClass));
    const result = roomOptimization(model, baseInput({
      roomType: "Living Room",
      tier: 5,
      width: 6,
      depth: 5,
      height: 3,
      disabledItems: allowed,
    }));

    expect(result.entries.some((entry) => entry.item.friendlyName === "Ashlar Stone Fireplace")).toBe(true);
    expect(result.entries.some((entry) => entry.item.friendlyName === "Ashlar Basalt Fireplace")).toBe(false);
  });

  test("optimizes Outdoor without room size or material tier cap", () => {
    const result = roomOptimization(model, baseInput({ roomType: "Outdoor", tier: 1, width: 1, depth: 1, height: 1 }));

    expect(roomUsesMaterialTier(model, "Outdoor")).toBe(false);
    expect(result.score.tier).toBeNull();
    expect(result.score.capped).toBe(result.score.afterSupportCaps);
    expect(result.entries.length).toBeGreaterThan(0);
    const compatible = compatibleCategoriesForRoom(model, "Outdoor")!;
    expect(result.entries.every((entry) => compatible.has(entry.item.category))).toBe(true);
  });

  test("auto room size computes a minimum fitting room after maximizing score", () => {
    const result = roomOptimization(model, baseInput({ roomType: "Bathroom", tier: 1, width: 1, depth: 1, height: 2, sizeMode: "auto" }));

    expect(result.resolvedSize?.mode).toBe("auto");
    expect(result.resolvedSize?.floorArea).toBeGreaterThanOrEqual(result.constraints.usedFloor);
    expect(result.resolvedSize?.volume).toBeGreaterThanOrEqual(result.constraints.usedRequiredVolume);
    expect(result.score.capped).toBeGreaterThan(0);
  });

  test("material budget mode returns a room within the provided material count", () => {
    const result = roomOptimization(model, baseInput({ roomType: "Bathroom", tier: 1, sizeMode: "materials", materialBudget: 80 }));

    expect(result.resolvedSize?.mode).toBe("materials");
    expect(result.resolvedSize?.materialCount).toBeLessThanOrEqual(80);
  });

  test("blocks objects taller than the room", () => {
    const result = roomOptimization(model, baseInput({ roomType: "Living Room", tier: 5, width: 8, depth: 8, height: 1 }));
    expect(result.entries.every((entry) => (entry.item.occupancy?.height ?? 0) <= 1)).toBe(true);
  });

  test("uses owned items first", () => {
    const item = housing("Elk Statuette");
    const result = roomOptimization(model, baseInput({
      roomType: "Living Room",
      tier: 5,
      width: 8,
      depth: 8,
      height: 3,
      ownedItems: new Map([[item.itemClass, 5]]),
      disabledItems: new Set(model.housingItems.filter((housingItem) => housingItem.itemClass !== item.itemClass).map((housingItem) => housingItem.itemClass)),
    }));
    const elkEntries = result.entries.filter((entry) => entry.item.itemClass === item.itemClass);
    expect(elkEntries.length).toBeGreaterThan(0);
    expect(elkEntries.every((entry) => entry.fromOwned)).toBe(true);
  });

  test("exposes compatible categories for rooms", () => {
    expect(compatibleCategoriesForRoom(model, "Bedroom")).toContain("Decoration");
    expect(compatibleCategoriesForRoom(model, "Bedroom")).toContain("Lighting");
  });
});

describe("Room optimizer quality", () => {
  test("chooses a combination of smaller items when the highest raw item blocks a better total", () => {
    const synthetic = syntheticModel([
      fixtureItem("Large Blocker", "LargeBlockerItem", "Bathroom", 10, "Large", { volume: 48, floorArea: 1 }),
      fixtureItem("Small A", "SmallAItem", "Bathroom", 7, "SmallA", { volume: 20, floorArea: 1 }),
      fixtureItem("Small B", "SmallBItem", "Bathroom", 7, "SmallB", { volume: 20, floorArea: 1 }),
    ]);

    const result = roomOptimization(synthetic, syntheticInput({ width: 4, depth: 4, height: 3 }));

    expect(names(result)).toEqual(["Small A", "Small B"]);
    expect(result.score.afterSupportCaps).toBe(14);
  });

  test("keeps a slightly lower primary item when its surface enables a better room total", () => {
    const synthetic = syntheticModel([
      fixtureItem("No Surface Primary", "NoSurfaceItem", "Bathroom", 5, "Primary", { floorArea: 1 }),
      fixtureItem("Surface Primary", "SurfaceItem", "Bathroom", 4, "Primary", { floorArea: 1, surfaceProvided: true }),
      fixtureItem("Flower A", "FlowerAItem", "Decoration", 3, "FlowerA", { petals: true }),
      fixtureItem("Flower B", "FlowerBItem", "Decoration", 3, "FlowerB", { petals: true }),
    ], { decorationSupportPercent: 1 });

    const result = roomOptimization(synthetic, syntheticInput());

    expect(names(result)).toContain("Surface Primary");
    expect(names(result)).toContain("Flower A");
    expect(result.score.afterSupportCaps).toBe(7);
  });

  test("reassigns surface-capable items onto surfaces available later in the room", () => {
    const synthetic = syntheticModel([
      fixtureItem("Gong", "GongItem", "Bathroom", 5, "Gong", { floorArea: 1, canBeOnSurface: true }),
      fixtureItem("Table", "TableItem", "Decoration", 1, "Table", { floorArea: 4, surfaceProvided: true }),
    ], { decorationSupportPercent: 1 });

    const result = roomOptimization(synthetic, syntheticInput());
    const gong = result.entries.find((entry) => entry.item.friendlyName === "Gong");

    expect(names(result)).toContain("Table");
    expect(gong?.placedOnFloor).toBeFalsy();
    expect(result.constraints.usedFloor).toBe(4);
    expect(result.constraints.usedSurface).toBe(1);
  });

  test("does not select Petals when no surface is available", () => {
    const synthetic = syntheticModel([
      fixtureItem("Plain Primary", "PlainPrimaryItem", "Bathroom", 5, "Primary", { floorArea: 1 }),
      fixtureItem("Flower A", "FlowerAItem", "Decoration", 3, "FlowerA", { petals: true }),
    ], { decorationSupportPercent: 1 });

    const result = roomOptimization(synthetic, syntheticInput());

    expect(names(result)).toEqual(["Plain Primary"]);
  });

  test("uses support caps from the selected primary value", () => {
    const synthetic = syntheticModel([
      fixtureItem("Low Primary", "LowPrimaryItem", "Bathroom", 10, "Primary", { floorArea: 1 }),
      fixtureItem("High Primary", "HighPrimaryItem", "Bathroom", 12, "Primary", { floorArea: 1 }),
      fixtureItem("Support", "SupportItem", "Decoration", 6, "Support", { floorArea: 1 }),
    ], { decorationSupportPercent: 0.5 });

    const result = roomOptimization(synthetic, syntheticInput());

    expect(names(result)).toEqual(["High Primary", "Support"]);
    expect(result.score.afterSupportCaps).toBe(18);
  });

  test("filters items below the minimum XP efficiency threshold", () => {
    const synthetic = syntheticModel([
      fixtureItem("Primary", "PrimaryItem", "Bathroom", 10, "Primary", { floorArea: 1 }),
      fixtureItem("Capped Support", "CappedSupportItem", "Decoration", 10, "Support", { floorArea: 1 }),
    ], { decorationSupportPercent: 0.5 });

    const permissive = roomOptimization(synthetic, syntheticInput({ minXpEfficiencyPercent: 20 }));
    const strict = roomOptimization(synthetic, syntheticInput({ minXpEfficiencyPercent: 60 }));

    expect(names(permissive)).toEqual(["Primary", "Capped Support"]);
    expect(names(strict)).toEqual(["Primary"]);
  });

  test("filters operational requirements from room input", () => {
    const synthetic = syntheticModel([
      fixtureItem("Primary", "PrimaryItem", "Bathroom", 5, "Primary", { floorArea: 1 }),
      fixtureItem("Electric Support", "ElectricSupportItem", "Decoration", 4, "ElectricSupport", { floorArea: 1, operational: { powerConsumption: { type: "ElectricPower", watts: 60 } } }),
      fixtureItem("Torch Support", "TorchSupportItem", "Decoration", 4, "TorchSupport", { floorArea: 1, operational: { fuel: { tags: ["Torch"], watts: 0.5 }, powerConsumption: { type: "HeatPower", watts: 0.5 } } }),
    ], { decorationSupportPercent: 2 });

    const noElectric = roomOptimization(synthetic, syntheticInput({ allowElectricPower: false }));
    const noTorch = roomOptimization(synthetic, syntheticInput({ disabledFuelTags: new Set(["Torch"]) }));

    expect(names(noElectric)).not.toContain("Electric Support");
    expect(names(noElectric)).toContain("Torch Support");
    expect(names(noTorch)).toContain("Electric Support");
    expect(names(noTorch)).not.toContain("Torch Support");
  });

  test("optimizes the capped useful score instead of only filling raw category value", () => {
    const synthetic = syntheticModel([
      fixtureItem("Efficient Primary", "EfficientPrimaryItem", "Bathroom", 10, "Primary", { floorArea: 1 }),
      fixtureItem("Extra Primary", "ExtraPrimaryItem", "Bathroom", 10, "Extra", { floorArea: 1 }),
      fixtureItem("Support", "SupportItem", "Decoration", 10, "Support", { floorArea: 1 }),
    ], { decorationSupportPercent: 1, roomTiers: [{ tier: 1, softCap: 5, hardCap: 10, diminishingReturnPercent: 0.65 }] });

    const result = roomOptimization(synthetic, syntheticInput({ tier: 1 }));

    expect(result.score.capped).toBeGreaterThan(9);
    expect(result.score.capped).toBeLessThanOrEqual(10);
  });

  test("prefers already owned items when score is tied", () => {
    const synthetic = syntheticModel([
      fixtureItem("Alpha Not Owned", "AlphaNotOwnedItem", "Bathroom", 5, "Primary", { floorArea: 1 }),
      fixtureItem("Zulu Owned", "ZuluOwnedItem", "Bathroom", 5, "Primary", { floorArea: 1 }),
    ]);

    const result = roomOptimization(synthetic, syntheticInput({ ownedItems: new Map([["ZuluOwnedItem", 1]]) }));

    expect(names(result)).toEqual(["Zulu Owned"]);
    expect(result.entries[0]?.fromOwned).toBe(true);
  });

  test("deduplicates equivalent candidates and prefers the owned equivalent", () => {
    const synthetic = syntheticModel([
      fixtureItem("Alpha Equivalent", "AlphaEquivalentItem", "Bathroom", 5, "Primary", { floorArea: 1, equivalenceKey: "bench-equivalent" }),
      fixtureItem("Zulu Equivalent", "ZuluEquivalentItem", "Bathroom", 5, "Primary", { floorArea: 1, equivalenceKey: "bench-equivalent" }),
    ]);

    const result = roomOptimization(synthetic, syntheticInput({ ownedItems: new Map([["ZuluEquivalentItem", 1]]) }));

    expect(names(result)).toEqual(["Zulu Equivalent"]);
    expect(result.entries[0]?.fromOwned).toBe(true);
  });
});

function requiredVolume(name: string, count = 1) {
  return (housing(name).requirements?.requiredRoomVolume ?? 0) * count;
}

function names(result: ReturnType<typeof roomOptimization>) {
  return result.entries.map((entry) => entry.item.friendlyName);
}

function syntheticInput(partial: Partial<RoomInput> = {}): RoomInput {
  return baseInput({
    roomType: "Bathroom",
    tier: 5,
    width: 4,
    depth: 4,
    height: 3,
    availability: "all",
    ...partial,
  });
}

function fixtureItem(
  friendlyName: string,
  itemClass: string,
  category: string,
  value: number,
  typeForRoomLimit: string,
  options: { volume?: number; floorArea?: number; surfaceProvided?: boolean; canBeOnSurface?: boolean; petals?: boolean; equivalenceKey?: string; operational?: NonNullable<HousingItem["requirements"]>["operationalRequirements"] } = {},
) {
  const worldObjectClass = options.petals ? null : `${itemClass.replace(/Item$/, "")}Object`;
  return {
    housing: {
      itemClass,
      friendlyName,
      worldObjectClass,
      category,
      value,
      typeForRoomLimit,
      diminishingReturnPercent: 0,
      tags: [
        ...(options.petals ? ["Petals"] : []),
        ...(options.surfaceProvided ? ["SurfaceTags.HasTableSurface"] : []),
        ...(options.canBeOnSurface ? ["SurfaceTags.CanBeOnSurface"] : []),
      ],
      equivalenceGroupKey: options.equivalenceKey ?? null,
      equivalentItemClasses: options.equivalenceKey ? ["AlphaEquivalentItem", "ZuluEquivalentItem"] : undefined,
      hiddenCategory: false,
      notInBrowser: false,
    },
    item: {
      className: itemClass,
      friendlyName,
      worldObjectClass,
      tags: [
        ...(options.petals ? ["Petals"] : []),
        ...(options.canBeOnSurface ? ["SurfaceTags.CanBeOnSurface"] : []),
      ],
      equivalenceGroupKey: options.equivalenceKey ?? null,
      equivalentItemClasses: options.equivalenceKey ? ["AlphaEquivalentItem", "ZuluEquivalentItem"] : undefined,
    },
    worldObject: worldObjectClass ? {
      className: worldObjectClass,
      tags: options.surfaceProvided ? ["SurfaceTags.HasTableSurface"] : [],
      requiredRoomVolume: options.volume ?? null,
      operationalRequirements: options.operational ?? null,
    } : null,
    occupancy: worldObjectClass ? {
      worldObjectClass,
      blockCount: options.floorArea ?? 0,
      floorArea: options.floorArea ?? 0,
      width: Math.max(1, options.floorArea ?? 0),
      depth: options.floorArea ? 1 : 0,
      height: options.floorArea ? 1 : 0,
    } : null,
  };
}

function syntheticModel(
  fixtures: ReturnType<typeof fixtureItem>[],
  options: {
    decorationSupportPercent?: number;
    roomTiers?: EcoData["roomTiers"];
  } = {},
): EcoModel {
  return buildModel({
    housing: fixtures.map((fixture) => fixture.housing),
    items: fixtures.map((fixture) => fixture.item),
    recipes: [],
    skills: [],
    roomCategories: [
      {
        name: "Bathroom",
        canBeRoomCategory: true,
        supportForAnyRoomType: false,
        supportingRoomCategoryNames: ["Decoration"],
      },
      {
        name: "Decoration",
        canBeRoomCategory: false,
        supportForAnyRoomType: false,
        maxSupportPercentOfPrimary: options.decorationSupportPercent ?? null,
      },
    ],
    roomTiers: options.roomTiers ?? [{ tier: 5, softCap: 100, hardCap: 200, diminishingReturnPercent: 0.65 }],
    worldObjects: fixtures.map((fixture) => fixture.worldObject).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    occupancy: fixtures.map((fixture) => fixture.occupancy).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
  });
}
