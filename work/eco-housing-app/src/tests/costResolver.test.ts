import { describe, expect, test } from "vitest";
import { createCostResolver } from "../domain/costResolver";
import { buildModel } from "../domain/model";
import type { EcoData, EcoEconomyData } from "../domain/types";

const data: EcoData = {
  housing: [
    { itemClass: "ChairItem", friendlyName: "Chair", category: "Seating", value: 2 },
    { itemClass: "AltChairItem", friendlyName: "Alt Chair", category: "Seating", value: 2, equivalenceGroupKey: "seat", equivalentItemClasses: ["ChairItem", "AltChairItem"] },
    { itemClass: "TableItem", friendlyName: "Table", category: "Seating", value: 3 },
  ],
  items: [
    { className: "ChairItem", friendlyName: "Chair" },
    { className: "AltChairItem", friendlyName: "Alt Chair" },
    { className: "TableItem", friendlyName: "Table" },
    { className: "BoardItem", friendlyName: "Board", tags: ["WoodBoard"] },
  ],
  recipes: [
    { className: "TableRecipe", name: "Table", requiredSkillClass: "CarpentrySkill", requiredSkillLevel: 1, products: [{ itemClass: "TableItem", quantity: 1 }], ingredients: [{ tag: "WoodBoard", quantity: 2 }] },
    { className: "BoardRecipe", name: "Board", requiredSkillClass: "LoggingSkill", requiredSkillLevel: 1, products: [{ itemClass: "BoardItem", quantity: 1 }], ingredients: [{ tag: "Wood", quantity: 1 }] },
  ],
  skills: [
    { className: "CarpentrySkill", friendlyName: "Carpentry", isSpecialty: true },
    { className: "LoggingSkill", friendlyName: "Logging", isSpecialty: true },
  ],
  roomCategories: [{ name: "Seating", canBeRoomCategory: true }],
  roomTiers: [{ tier: 0, softCap: 100, hardCap: 100, diminishingReturnPercent: 0.5 }],
  worldObjects: [],
  occupancy: [],
  housingEquivalenceGroups: [{ key: "seat", itemClasses: ["ChairItem", "AltChairItem"], options: [{ itemClass: "ChairItem" }, { itemClass: "AltChairItem" }] }],
};

const economy: EcoEconomyData = {
  fetchedAt: "2026-01-01T00:00:00.000Z",
  currencies: ["Credits"],
  listings: [
    { itemClass: "ChairItem", quantity: 1, price: 10, currency: "Credits", storeName: "Expensive" },
    { itemClass: "ChairItem", quantity: 4, price: 6, currency: "Credits", storeName: "Cheap" },
    { itemClass: "AltChairItem", quantity: 2, price: 4, currency: "Credits", storeName: "Alt" },
    { itemClass: "BoardItem", quantity: 10, price: 2, currency: "Credits", storeName: "Boards" },
  ],
};

const model = buildModel(data);

describe("cost resolver", () => {
  test("uses the cheapest listings and reports stock", () => {
    const resolver = createCostResolver({ model, economyData: economy, selectedSkills: new Set() });
    const cost = resolver.resolve("ChairItem", 2);

    expect(cost.totalCost).toBe(12);
    expect(cost.availableQuantity).toBe(2);
    expect(cost.sources.find((source) => source.kind === "buy")?.storeName).toBe("Cheap");
  });

  test("reports stock blocking when market quantity is too low", () => {
    const resolver = createCostResolver({ model, economyData: economy, selectedSkills: new Set() });
    const cost = resolver.resolve("AltChairItem", 3);

    expect(cost.stockBlocking).toBe(true);
    expect(cost.availableQuantity).toBe(2);
  });

  test("can craft through tagged ingredients bought from the market", () => {
    const resolver = createCostResolver({ model, economyData: economy, selectedSkills: new Set(["CarpentrySkill"]) });
    const cost = resolver.resolve("TableItem", 1);

    expect(cost.canCraft).toBe(true);
    expect(cost.totalCost).toBe(4);
  });

  test("lets callers compare equivalent alternatives by price", () => {
    const resolver = createCostResolver({ model, economyData: economy, selectedSkills: new Set() });
    const cheapest = ["ChairItem", "AltChairItem"]
      .map((itemClass) => resolver.resolve(itemClass, 1))
      .sort((a, b) => (a.totalCost ?? Infinity) - (b.totalCost ?? Infinity))[0];

    expect(cheapest?.itemClass).toBe("AltChairItem");
    expect(cheapest?.totalCost).toBe(4);
  });
});
