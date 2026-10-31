import { describe, expect, test } from "vitest";
import { optimizeHouse } from "../domain/houseOptimizer";
import { buildModel } from "../domain/model";
import { optimizeRoom } from "../domain/roomOptimizer";
import type { EcoData, EcoEconomyData, HouseInput, RoomInput } from "../domain/types";

const data: EcoData = {
  housing: [
    { itemClass: "CheapBedItem", friendlyName: "Cheap Bed", category: "Bedroom", value: 5, worldObjectClass: "CheapBedObject", diminishingReturnPercent: 0.5, equivalenceGroupKey: "bed" },
    { itemClass: "FancyBedItem", friendlyName: "Fancy Bed", category: "Bedroom", value: 5, worldObjectClass: "FancyBedObject", diminishingReturnPercent: 0.5, equivalenceGroupKey: "bed" },
    { itemClass: "LuxuryBedItem", friendlyName: "Luxury Bed", category: "Bedroom", value: 20, worldObjectClass: "LuxuryBedObject", diminishingReturnPercent: 0.5 },
    { itemClass: "CookItem", friendlyName: "Cook", category: "Kitchen", value: 6, worldObjectClass: "CookObject", diminishingReturnPercent: 0.5 },
  ],
  items: [
    { className: "CheapBedItem", friendlyName: "Cheap Bed", worldObjectClass: "CheapBedObject" },
    { className: "FancyBedItem", friendlyName: "Fancy Bed", worldObjectClass: "FancyBedObject" },
    { className: "LuxuryBedItem", friendlyName: "Luxury Bed", worldObjectClass: "LuxuryBedObject" },
    { className: "CookItem", friendlyName: "Cook", worldObjectClass: "CookObject" },
  ],
  recipes: [],
  skills: [],
  roomCategories: [
    { name: "Bedroom", canBeRoomCategory: true, shouldCapFromRoomMaterials: true },
    { name: "Decoration", canBeRoomCategory: false, supportForAnyRoomType: true, maxSupportPercentOfPrimary: 0.5 },
    { name: "Kitchen", canBeRoomCategory: true, shouldCapFromRoomMaterials: true },
  ],
  roomTiers: [{ tier: 0, softCap: 100, hardCap: 100, diminishingReturnPercent: 0.5 }],
  worldObjects: [
    { className: "CheapBedObject", representedItemClass: "CheapBedItem", requiredRoomVolume: 1 },
    { className: "FancyBedObject", representedItemClass: "FancyBedItem", requiredRoomVolume: 1 },
    { className: "LuxuryBedObject", representedItemClass: "LuxuryBedItem", requiredRoomVolume: 1 },
    { className: "CookObject", representedItemClass: "CookItem", requiredRoomVolume: 1 },
  ],
  occupancy: [
    { worldObjectClass: "CheapBedObject", blockCount: 1, floorArea: 1, width: 1, depth: 1, height: 1 },
    { worldObjectClass: "FancyBedObject", blockCount: 1, floorArea: 1, width: 1, depth: 1, height: 1 },
    { worldObjectClass: "LuxuryBedObject", blockCount: 1, floorArea: 1, width: 1, depth: 1, height: 1 },
    { worldObjectClass: "CookObject", blockCount: 1, floorArea: 1, width: 1, depth: 1, height: 1 },
  ],
  housingEquivalenceGroups: [{ key: "bed", itemClasses: ["CheapBedItem", "FancyBedItem"], options: [{ itemClass: "CheapBedItem" }, { itemClass: "FancyBedItem" }] }],
};

const economy: EcoEconomyData = {
  fetchedAt: "2026-01-01T00:00:00.000Z",
  currencies: ["Credits"],
  listings: [
    { itemClass: "CheapBedItem", quantity: 10, price: 2, currency: "Credits" },
    { itemClass: "FancyBedItem", quantity: 10, price: 9, currency: "Credits" },
    { itemClass: "LuxuryBedItem", quantity: 10, price: 50, currency: "Credits" },
    { itemClass: "CookItem", quantity: 1, price: 4, currency: "Credits" },
  ],
};

const model = buildModel(data);

function roomInput(partial: Partial<RoomInput> = {}): RoomInput {
  return {
    roomType: "Bedroom",
    tier: 0,
    width: 4,
    depth: 4,
    height: 3,
    selectedSkills: new Set(),
    ownedItems: new Map(),
    disabledItems: new Set(),
    availability: "all",
    minXpEfficiencyPercent: 0,
    ...partial,
  };
}

function houseInput(partial: Partial<HouseInput> = {}): HouseInput {
  return {
    constructionTier: 0,
    materialBudget: 500,
    height: 3,
    sameHeightForAllRooms: true,
    maxCopiesPerRoomType: 1,
    selectedSkills: new Set(),
    ownedItems: new Map(),
    disabledItems: new Set(),
    availability: "all",
    minXpEfficiencyPercent: 0,
    ...partial,
  };
}

describe("economy-aware optimization", () => {
  test("room keeps current result when economy is absent", () => {
    const withoutEconomy = optimizeRoom(model, roomInput());
    const disabledEconomy = optimizeRoom(model, roomInput({ economyEnabled: false, economyData: economy, economyBudget: 1 }));

    expect(disabledEconomy.score.capped).toBe(withoutEconomy.score.capped);
    expect(disabledEconomy.economy).toBeNull();
  });

  test("room respects budget and avoids unaffordable higher XP items", () => {
    const result = optimizeRoom(model, roomInput({ economyEnabled: true, economyData: economy, economyBudget: 10, economyCurrency: "Credits" }));

    expect(result.entries.some((entry) => entry.item.itemClass === "LuxuryBedItem")).toBe(false);
    expect(result.economy?.totalCost).toBeLessThanOrEqual(10);
  });

  test("room chooses the cheaper equivalent at equal score", () => {
    const result = optimizeRoom(model, roomInput({ economyEnabled: true, economyData: economy, economyBudget: 2, economyCurrency: "Credits", disabledItems: new Set(["LuxuryBedItem"]) }));

    expect(result.entries[0]?.item.itemClass).toBe("CheapBedItem");
    expect(result.economy?.totalCost).toBe(2);
  });

  test("room reports cheaper equivalent alternatives", () => {
    const result = optimizeRoom(model, roomInput({ economyEnabled: true, economyData: economy, economyBudget: 20, economyCurrency: "Credits", disabledItems: new Set(["CheapBedItem", "LuxuryBedItem"]) }));
    const alternative = result.economy?.analysis.cheaperAlternatives.find((entry) => entry.itemClass === "FancyBedItem");

    expect(result.entries[0]?.item.itemClass).toBe("FancyBedItem");
    expect(alternative?.alternativeItemClass).toBe("CheapBedItem");
    expect(alternative?.savings).toBe(14);
  });

  test("room exposes economy analysis for retained objects", () => {
    const result = optimizeRoom(model, roomInput({ economyEnabled: true, economyData: economy, economyBudget: 10, economyCurrency: "Credits", disabledItems: new Set(["LuxuryBedItem"]) }));

    expect(result.economy?.analysis.bestXpPerCredit?.itemClass).toBe("CheapBedItem");
    expect(result.economy?.analysis.strongestXp?.xp).toBeGreaterThan(0);
    expect(result.economy?.purchaseList[0]?.xpPerCredit).toBeGreaterThan(0);
  });

  test("room can use a live Eco exporter listing with a custom server currency", () => {
    const liveEconomy: EcoEconomyData = {
      fetchedAt: "2026-06-15T16:22:42.575Z",
      currencies: ["d2d25 Credit"],
      listings: [
        { itemClass: "CheapBedItem", quantity: 3, price: 10, currency: "d2d25 Credit" },
      ],
    };
    const result = optimizeRoom(model, roomInput({
      economyEnabled: true,
      economyData: liveEconomy,
      economyBudget: 30,
      economyCurrency: "d2d25 Credit",
      disabledItems: new Set(["FancyBedItem", "LuxuryBedItem"]),
    }));

    expect(result.entries.some((entry) => entry.item.itemClass === "CheapBedItem")).toBe(true);
    expect(result.economy?.totalCost).toBeLessThanOrEqual(30);
    expect(result.economy?.currency).toBe("d2d25 Credit");
    expect(result.economy?.stockBlocking).toHaveLength(0);
  });

  test("room exposes best economy candidates per category", () => {
    const result = optimizeRoom(model, roomInput({ economyEnabled: true, economyData: economy, economyBudget: 10, economyCurrency: "Credits" }));
    const bedroom = result.economy?.analysis.categories.find((entry) => entry.category === "Bedroom");

    expect(bedroom?.bestXpPerCredit?.itemClass).toBe("CheapBedItem");
    expect(bedroom?.cheapestAvailable?.itemClass).toBe("CheapBedItem");
    expect(bedroom?.strongestXp?.itemClass).toBe("LuxuryBedItem");
  });

  test("room reports listings hidden by the selected currency", () => {
    const mixedCurrencyEconomy: EcoEconomyData = {
      ...economy,
      currencies: ["Credits", "Tokens"],
      listings: economy.listings.map((entry) => entry.itemClass === "LuxuryBedItem" ? { ...entry, currency: "Tokens" } : entry),
    };
    const result = optimizeRoom(model, roomInput({ economyEnabled: true, economyData: mixedCurrencyEconomy, economyBudget: 10, economyCurrency: "Credits" }));
    const gap = result.economy?.analysis.marketGaps.find((entry) => entry.itemClass === "LuxuryBedItem");

    expect(gap?.reason).toBe("otherCurrency");
    expect(gap?.availableCurrencies).toEqual(["Tokens"]);
    expect(result.economy?.analysis.rejectedItems.find((entry) => entry.itemClass === "LuxuryBedItem")?.reason).toBe("otherCurrency");
  });

  test("room reports craftable objects absent from the market", () => {
    const craftModel = buildModel({
      ...data,
      recipes: [{ className: "CheapBedRecipe", name: "Cheap Bed", products: [{ itemClass: "CheapBedItem", quantity: 1 }], ingredients: [] }],
    });
    const noCheapListing: EcoEconomyData = {
      ...economy,
      listings: economy.listings.filter((entry) => entry.itemClass !== "CheapBedItem"),
    };
    const result = optimizeRoom(craftModel, roomInput({ economyEnabled: true, economyData: noCheapListing, economyBudget: 10, economyCurrency: "Credits", disabledItems: new Set(["FancyBedItem", "LuxuryBedItem"]) }));
    const gap = result.economy?.analysis.marketGaps.find((entry) => entry.itemClass === "CheapBedItem");

    expect(result.entries[0]?.item.itemClass).toBe("CheapBedItem");
    expect(gap?.reason).toBe("noListing");
    expect(gap?.canCraft).toBe(true);
  });

  test("room exposes rejected economy candidates", () => {
    const result = optimizeRoom(model, roomInput({ economyEnabled: true, economyData: economy, economyBudget: 10, economyCurrency: "Credits" }));
    const rejectedLuxury = result.economy?.analysis.rejectedItems.find((entry) => entry.itemClass === "LuxuryBedItem");

    expect(rejectedLuxury?.reason).toBe("overBudget");
    expect(rejectedLuxury?.xp).toBe(20);
  });

  test("room refuses objects without enough stock", () => {
    const result = optimizeRoom(model, roomInput({ roomType: "Kitchen", economyEnabled: true, economyData: economy, economyBudget: 100, economyCurrency: "Credits" }));

    expect(result.entries.filter((entry) => entry.item.itemClass === "CookItem")).toHaveLength(1);
    expect(result.economy?.stockBlocking).toHaveLength(0);
  });

  test("house respects global economy budget", () => {
    const result = optimizeHouse(model, houseInput({ economyEnabled: true, economyData: economy, economyBudget: 6, economyCurrency: "Credits" }));

    expect(result.economy?.totalCost).toBeLessThanOrEqual(6);
    expect(result.economy?.stockBlocking).toHaveLength(0);
  });

  test("house aggregates rejected economy candidates from selected rooms", () => {
    const result = optimizeHouse(model, houseInput({ economyEnabled: true, economyData: economy, economyBudget: 10, economyCurrency: "Credits" }));
    const rejectedLuxury = result.economy?.analysis.rejectedItems.find((entry) => entry.itemClass === "LuxuryBedItem");

    expect(rejectedLuxury?.reason).toBe("overBudget");
  });
});
