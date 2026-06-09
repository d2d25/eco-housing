import { describe, expect, test } from "vitest";
import { buildModel } from "../domain/model";
import { clearHouseOptimizationCache, estimateHouseMaterials, optimizeHouse } from "../domain/houseOptimizer";
import type { EcoData, HouseInput, HouseLayoutRoom } from "../domain/types";

const data: EcoData = {
  housingConfig: { roomCategoryDiminishingReturnRate: 0.5 },
  housing: [
    { itemClass: "BedItem", friendlyName: "Bed", category: "Bedroom", value: 10, worldObjectClass: "BedObject", diminishingReturnPercent: 0.05 },
    { itemClass: "WardrobeItem", friendlyName: "Wardrobe", category: "Bedroom", value: 6, worldObjectClass: "WardrobeObject", diminishingReturnPercent: 0.5 },
    { itemClass: "CookItem", friendlyName: "Cook", category: "Kitchen", value: 8, worldObjectClass: "CookObject", diminishingReturnPercent: 0.5 },
    { itemClass: "BathItem", friendlyName: "Bath", category: "Bathroom", value: 6, worldObjectClass: "BathObject", diminishingReturnPercent: 0.5 },
    { itemClass: "YardItem", friendlyName: "Yard", category: "Outdoor", value: 5, worldObjectClass: "YardObject", diminishingReturnPercent: 0.5 },
    { itemClass: "ZeroItem", friendlyName: "Zero", category: "Zero Room", value: 0, worldObjectClass: "ZeroObject", diminishingReturnPercent: 0.5 },
  ],
  items: [
    { className: "BedItem", friendlyName: "Bed", worldObjectClass: "BedObject" },
    { className: "WardrobeItem", friendlyName: "Wardrobe", worldObjectClass: "WardrobeObject" },
    { className: "CookItem", friendlyName: "Cook", worldObjectClass: "CookObject" },
    { className: "BathItem", friendlyName: "Bath", worldObjectClass: "BathObject" },
    { className: "YardItem", friendlyName: "Yard", worldObjectClass: "YardObject" },
    { className: "ZeroItem", friendlyName: "Zero", worldObjectClass: "ZeroObject" },
  ],
  recipes: [
    { className: "BedRecipe", name: "Bed", products: [{ itemClass: "BedItem", quantity: 1 }], ingredients: [] },
    { className: "WardrobeRecipe", name: "Wardrobe", products: [{ itemClass: "WardrobeItem", quantity: 1 }], ingredients: [] },
    { className: "CookRecipe", name: "Cook", products: [{ itemClass: "CookItem", quantity: 1 }], ingredients: [] },
    { className: "BathRecipe", name: "Bath", products: [{ itemClass: "BathItem", quantity: 1 }], ingredients: [] },
    { className: "YardRecipe", name: "Yard", products: [{ itemClass: "YardItem", quantity: 1 }], ingredients: [] },
  ],
  skills: [],
  roomCategories: [
    { name: "Bedroom", canBeRoomCategory: true, shouldCapFromRoomMaterials: true },
    { name: "Kitchen", canBeRoomCategory: true, shouldCapFromRoomMaterials: true },
    { name: "Bathroom", canBeRoomCategory: true, shouldCapFromRoomMaterials: true, capToPercentOfRestOfProperty: 0.33 },
    { name: "Outdoor", canBeRoomCategory: true, shouldCapFromRoomMaterials: false },
    { name: "Zero Room", canBeRoomCategory: true, shouldCapFromRoomMaterials: true },
  ],
  roomTiers: [
    { tier: 0, softCap: 100, hardCap: 100, diminishingReturnPercent: 0.5 },
    { tier: 2, softCap: 100, hardCap: 100, diminishingReturnPercent: 0.5 },
  ],
  worldObjects: [
    { className: "BedObject", representedItemClass: "BedItem", requiredRoomVolume: 4 },
    { className: "WardrobeObject", representedItemClass: "WardrobeItem", requiredRoomVolume: 8 },
    { className: "CookObject", representedItemClass: "CookItem", requiredRoomVolume: 4 },
    { className: "BathObject", representedItemClass: "BathItem", requiredRoomVolume: 4 },
    { className: "YardObject", representedItemClass: "YardItem", requiredRoomVolume: 0 },
  ],
  occupancy: [
    { worldObjectClass: "BedObject", blockCount: 1, floorArea: 1, width: 1, depth: 1, height: 1 },
    { worldObjectClass: "WardrobeObject", blockCount: 6, floorArea: 6, width: 3, depth: 2, height: 2 },
    { worldObjectClass: "CookObject", blockCount: 1, floorArea: 1, width: 1, depth: 1, height: 1 },
    { worldObjectClass: "BathObject", blockCount: 1, floorArea: 1, width: 1, depth: 1, height: 1 },
    { worldObjectClass: "YardObject", blockCount: 1, floorArea: 1, width: 1, depth: 1, height: 1 },
  ],
};

const model = buildModel(data);

function baseInput(partial: Partial<HouseInput> = {}): HouseInput {
  return {
    constructionTier: 2,
    materialBudget: 500,
    height: 3,
    sameHeightForAllRooms: true,
    maxCopiesPerRoomType: 1,
    selectedSkills: new Set(),
    ownedItems: new Map(),
    disabledItems: new Set(),
    availability: "all",
    minXpEfficiencyPercent: 0,
    allowElectricPower: true,
    allowMechanicalPower: true,
    allowFuel: true,
    allowWater: true,
    allowChimney: true,
    disabledFuelTags: new Set(),
    ...partial,
  };
}

describe("house optimizer", () => {
  test("uses one construction tier for every indoor room", () => {
    const result = optimizeHouse(model, baseInput({ constructionTier: 2 }));

    expect(result.constructionTier).toBe(2);
    expect(result.rooms.filter((room) => room.roomType !== "Outdoor").every((room) => room.tier === 2)).toBe(true);
  });

  test("ignores room types that cannot score", () => {
    const result = optimizeHouse(model, baseInput());

    expect(result.rooms.some((room) => room.roomType === "Zero Room")).toBe(false);
  });

  test("maxCopiesPerRoomType 1 allows several room types but no duplicate type", () => {
    const result = optimizeHouse(model, baseInput({ maxCopiesPerRoomType: 1 }));

    expect(result.rooms.length).toBeGreaterThan(1);
    expect(result.rooms.every((room) => room.quantity <= 1)).toBe(true);
  });

  test("auto can propose several copies of the same room type when profitable", () => {
    const result = optimizeHouse(model, baseInput({ maxCopiesPerRoomType: "auto", materialBudget: 500 }));
    const bedroom = result.rooms.find((room) => room.roomType === "Bedroom");

    expect(bedroom?.quantity).toBeGreaterThan(1);
  });

  test("minimum XP efficiency also limits duplicated room copies", () => {
    const result = optimizeHouse(model, baseInput({
      maxCopiesPerRoomType: "auto",
      materialBudget: 500,
      minXpEfficiencyPercent: 50,
      disabledItems: new Set(["CookItem", "BathItem", "YardItem"]),
    }));
    const bedroom = result.rooms.find((room) => room.roomType === "Bedroom");

    expect(bedroom?.quantity).toBeLessThanOrEqual(2);
    expect(bedroom?.copyScores.every((copy) => copy.multiplier * 100 >= 50)).toBe(true);
  });

  test("can prefer more smaller rooms over fewer fully furnished rooms", () => {
    const result = optimizeHouse(model, baseInput({
      maxCopiesPerRoomType: "auto",
      materialBudget: 200,
      disabledItems: new Set(["WardrobeItem", "CookItem", "BathItem", "YardItem"]),
    }));
    const bedroom = result.rooms.find((room) => room.roomType === "Bedroom");

    expect(bedroom?.quantity).toBeGreaterThanOrEqual(3);
    expect(bedroom?.optimization.entries.every((entry) => entry.item.itemClass === "BedItem")).toBe(true);
    expect(result.materials.used).toBeLessThanOrEqual(200);
  });

  test("limits Outdoor to one copy", () => {
    const result = optimizeHouse(model, baseInput({ maxCopiesPerRoomType: "auto", materialBudget: 500 }));

    expect(result.rooms.find((room) => room.roomType === "Outdoor")?.quantity).toBeLessThanOrEqual(1);
  });

  test("shared walls cost less than isolated rooms", () => {
    const rooms: HouseLayoutRoom[] = [
      { id: "a", roomType: "Bedroom", width: 3, depth: 3, height: 3, x: 0, y: 0, score: 0 },
      { id: "b", roomType: "Kitchen", width: 3, depth: 3, height: 3, x: 3, y: 0, score: 0 },
    ];
    const materials = estimateHouseMaterials(rooms, 999);

    expect(materials.sharedSavings).toBeGreaterThan(0);
    expect(materials.used).toBeLessThan(materials.isolatedCost);
  });

  test("counts material blocks from internal room size plus one-block walls", () => {
    const materials = estimateHouseMaterials([
      { id: "a", roomType: "Bedroom", width: 2, depth: 2, height: 2, x: 0, y: 0, score: 0 },
    ], 999);

    expect(materials.used).toBe(56);
    expect(materials.isolatedCost).toBe(56);
  });

  test("caps Bathroom with the rest-of-property ratio", () => {
    const bathroomOnly = optimizeHouse(model, baseInput({
      disabledItems: new Set(["BedItem", "WardrobeItem", "CookItem", "YardItem"]),
      maxCopiesPerRoomType: 1,
    }));
    const full = optimizeHouse(model, baseInput({
      disabledItems: new Set(["CookItem", "YardItem"]),
      maxCopiesPerRoomType: 1,
    }));
    const bathroom = full.rooms.find((room) => room.roomType === "Bathroom");

    expect(bathroomOnly.score).toBe(0);
    expect(bathroom?.cappedByRatio).toBe(true);
    expect(bathroom?.totalScore).toBeCloseTo(bathroom?.ratioCap ?? 0, 3);
  });

  test("aggregates craft list across copies and consumes owned items once", () => {
    const result = optimizeHouse(model, baseInput({
      maxCopiesPerRoomType: "auto",
      ownedItems: new Map([["BedItem", 1]]),
      disabledItems: new Set(["CookItem", "BathItem", "YardItem"]),
    }));
    const bed = result.craftList.find((entry) => entry.item.itemClass === "BedItem");

    expect(result.rooms.find((room) => room.roomType === "Bedroom")?.quantity).toBeGreaterThan(1);
    expect(bed?.ownedUsed).toBe(1);
    expect(bed?.craftQuantity).toBe((bed?.quantity ?? 0) - 1);
  });

  test("caches house results without returning mutable shared objects", () => {
    clearHouseOptimizationCache(model);
    const input = baseInput({ maxCopiesPerRoomType: "auto", materialBudget: 500 });
    const first = optimizeHouse(model, input);
    const expectedScore = first.score;
    first.score = -1;
    first.rooms.length = 0;

    const cached = optimizeHouse(model, input);

    expect(cached.score).toBe(expectedScore);
    expect(cached.rooms.length).toBeGreaterThan(0);
  });
});
