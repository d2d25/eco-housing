import { describe, expect, test } from "vitest";
import { createCostResolver } from "../domain/costResolver";
import { economyAccepts, summarizeItemEconomy } from "../domain/economyPlanner";
import { buildModel } from "../domain/model";
import type { EcoData, EcoEconomyData } from "../domain/types";

const data: EcoData = {
  housing: [
    { itemClass: "ChairItem", friendlyName: "Chair", category: "Seating", value: 2 },
    { itemClass: "AltChairItem", friendlyName: "Alt Chair", category: "Seating", value: 2, equivalenceGroupKey: "seat", equivalentItemClasses: ["ChairItem", "AltChairItem"] },
    { itemClass: "TableItem", friendlyName: "Table", category: "Seating", value: 3 },
    { itemClass: "MachineItem", friendlyName: "Machine", category: "Industrial", value: 0, worldObjectClass: "MachineObject" },
    { itemClass: "ToolItem", friendlyName: "Tool", category: "Industrial", value: 0 },
    { itemClass: "ToolTwoItem", friendlyName: "Tool Two", category: "Industrial", value: 0 },
  ],
  items: [
    { className: "ChairItem", friendlyName: "Chair" },
    { className: "AltChairItem", friendlyName: "Alt Chair" },
    { className: "TableItem", friendlyName: "Table" },
    { className: "MachineItem", friendlyName: "Machine", worldObjectClass: "MachineObject" },
    { className: "ToolItem", friendlyName: "Tool" },
    { className: "ToolTwoItem", friendlyName: "Tool Two" },
    { className: "BoardItem", friendlyName: "Board", tags: ["WoodBoard"] },
    { className: "HewnLogItem", friendlyName: "Hewn Log", variantGroupKey: "HewnLogRecipe", variantItemClasses: ["HewnLogItem", "SoftwoodHewnLogItem"] },
    { className: "SoftwoodHewnLogItem", friendlyName: "Softwood Hewn Log", variantGroupKey: "HewnLogRecipe", variantOfItemClass: "HewnLogItem", variantItemClasses: ["HewnLogItem", "SoftwoodHewnLogItem"] },
  ],
  recipes: [
    { className: "TableRecipe", name: "Table", requiredSkillClass: "CarpentrySkill", requiredSkillLevel: 1, products: [{ itemClass: "TableItem", quantity: 1 }], ingredients: [{ tag: "WoodBoard", quantity: 2 }] },
    { className: "BoardRecipe", name: "Board", requiredSkillClass: "LoggingSkill", requiredSkillLevel: 1, products: [{ itemClass: "BoardItem", quantity: 1 }], ingredients: [{ tag: "Wood", quantity: 1 }] },
    { className: "ToolRecipe", name: "Tool", craftingTableClass: "MachineObject", products: [{ itemClass: "ToolItem", quantity: 1 }], ingredients: [{ itemClass: "BoardItem", quantity: 1 }] },
    { className: "ToolTwoRecipe", name: "Tool Two", craftingTableClass: "MachineObject", products: [{ itemClass: "ToolTwoItem", quantity: 1 }], ingredients: [{ itemClass: "BoardItem", quantity: 1 }] },
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
    { itemClass: "MachineItem", quantity: 1, price: 100, currency: "Credits", storeName: "Machines" },
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

  test("includes non-baseline crafting station cost", () => {
    const resolver = createCostResolver({ model, economyData: economy, selectedSkills: new Set() });
    const cost = resolver.resolve("ToolItem", 1);

    expect(cost.canCraft).toBe(true);
    expect(cost.totalCost).toBe(102);
    expect(cost.sources.some((source) => source.kind === "station" && source.itemClass === "MachineItem")).toBe(true);
  });

  test("blocks craft when a required station is unavailable", () => {
    const economyWithoutMachine: EcoEconomyData = {
      ...economy,
      listings: economy.listings.filter((listing) => listing.itemClass !== "MachineItem"),
    };
    const resolver = createCostResolver({ model, economyData: economyWithoutMachine, selectedSkills: new Set() });
    const cost = resolver.resolve("ToolItem", 1);

    expect(cost.availableQuantity).toBe(0);
    expect(cost.stockBlocking).toBe(true);
  });

  test("does not mix currencies to satisfy one purchase", () => {
    const multiCurrency: EcoEconomyData = {
      fetchedAt: economy.fetchedAt,
      currencies: ["Credits", "Coins"],
      listings: [
        { itemClass: "ChairItem", quantity: 1, price: 1, currency: "Credits", storeName: "Credit Store" },
        { itemClass: "ChairItem", quantity: 1, price: 1, currency: "Coins", storeName: "Coin Store" },
      ],
    };
    const resolver = createCostResolver({ model, economyData: multiCurrency, selectedSkills: new Set() });
    const cost = resolver.resolve("ChairItem", 2);

    expect(cost.availableQuantity).toBe(1);
    expect(cost.stockBlocking).toBe(true);
    expect(cost.currency).toBe("Coins");
  });

  test("honors an explicit currency filter", () => {
    const multiCurrency: EcoEconomyData = {
      fetchedAt: economy.fetchedAt,
      currencies: ["Credits", "Coins"],
      listings: [
        { itemClass: "ChairItem", quantity: 2, price: 5, currency: "Credits", storeName: "Credit Store" },
        { itemClass: "ChairItem", quantity: 2, price: 1, currency: "Coins", storeName: "Coin Store" },
      ],
    };
    const resolver = createCostResolver({ model, economyData: multiCurrency, selectedSkills: new Set(), currency: "Credits" });
    const cost = resolver.resolve("ChairItem", 2);

    expect(cost.availableQuantity).toBe(2);
    expect(cost.totalCost).toBe(10);
    expect(cost.currency).toBe("Credits");
  });

  test("accepts live Eco store listings from the exporter", () => {
    const liveEconomy: EcoEconomyData = {
      fetchedAt: "2026-06-15T16:22:42.575Z",
      currencies: ["d2d25 Credit"],
      listings: [
        { itemClass: "SoftwoodHewnLogItem", quantity: 3, price: 10, currency: "d2d25 Credit" },
      ],
    };
    const resolver = createCostResolver({ model, economyData: liveEconomy, selectedSkills: new Set(), currency: "d2d25 Credit" });
    const cost = resolver.resolve("SoftwoodHewnLogItem", 3);

    expect(cost.availableQuantity).toBe(3);
    expect(cost.totalCost).toBe(30);
    expect(cost.currency).toBe("d2d25 Credit");
    expect(cost.stockBlocking).toBe(false);
  });

  test("can satisfy a base construction material from a sold variant", () => {
    const liveEconomy: EcoEconomyData = {
      fetchedAt: "2026-06-19T00:20:36.366Z",
      currencies: ["d2d25 Credit"],
      listings: [
        { itemClass: "SoftwoodHewnLogItem", quantity: 3, price: 10, currency: "d2d25 Credit", storeName: "d2d25's Store" },
      ],
    };
    const resolver = createCostResolver({ model, economyData: liveEconomy, selectedSkills: new Set(), currency: "d2d25 Credit" });
    const cost = resolver.resolve("HewnLogItem", 3);

    expect(cost.availableQuantity).toBe(3);
    expect(cost.totalCost).toBe(30);
    expect(cost.sources.some((source) => source.itemClass === "SoftwoodHewnLogItem" && source.kind === "buy")).toBe(true);
  });

  test("applies listing taxes and fees to the effective unit cost", () => {
    const taxedEconomy: EcoEconomyData = {
      fetchedAt: economy.fetchedAt,
      currencies: ["Credits"],
      listings: [
        { itemClass: "ChairItem", quantity: 2, price: 10, taxRate: 0.1, fee: 1, currency: "Credits", storeName: "Taxed Store" },
      ],
    };
    const resolver = createCostResolver({ model, economyData: taxedEconomy, selectedSkills: new Set(), currency: "Credits" });
    const cost = resolver.resolve("ChairItem", 2);

    expect(cost.unitCost).toBe(12);
    expect(cost.totalCost).toBe(24);
    expect(cost.sources.find((source) => source.kind === "buy")?.unitCost).toBe(12);
  });

  test("detects global stock overuse across multiple crafted objects", () => {
    const limitedBoards: EcoEconomyData = {
      ...economy,
      listings: economy.listings.map((listing) => listing.itemClass === "BoardItem" ? { ...listing, quantity: 2 } : listing),
    };
    const summary = summarizeItemEconomy(
      model,
      {
        enabled: true,
        economyData: limitedBoards,
        selectedSkills: new Set(["CarpentrySkill"]),
        ownedItems: new Map(),
        currency: "Credits",
      },
      new Map([
        ["TableItem", 1],
        ["ToolItem", 1],
      ]),
      3,
    );

    const boardUse = summary?.stockOveruse.find((entry) => entry.itemClass === "BoardItem");
    expect(boardUse?.quantity).toBe(3);
    expect(boardUse?.availableQuantity).toBe(2);
    expect(summary?.objectCost).toBeNull();
    expect(economyAccepts(summary)).toBe(false);
  });

  test("counts a shared crafting station once in global economy summaries", () => {
    const summary = summarizeItemEconomy(
      model,
      {
        enabled: true,
        economyData: economy,
        selectedSkills: new Set(),
        ownedItems: new Map(),
        currency: "Credits",
      },
      new Map([
        ["ToolItem", 1],
        ["ToolTwoItem", 1],
      ]),
      0,
    );

    expect(summary?.objectCost).toBe(104);
    expect(summary?.stockUsage.find((entry) => entry.itemClass === "MachineItem")?.quantity).toBe(1);
    expect(summary?.stockUsage.find((entry) => entry.itemClass === "BoardItem")?.quantity).toBe(2);
    expect(economyAccepts(summary)).toBe(true);
  });

  test("detects global owned item overuse across multiple crafted objects", () => {
    const economyWithoutBoards: EcoEconomyData = {
      ...economy,
      listings: economy.listings.filter((listing) => listing.itemClass !== "BoardItem"),
    };
    const summary = summarizeItemEconomy(
      model,
      {
        enabled: true,
        economyData: economyWithoutBoards,
        selectedSkills: new Set(),
        ownedItems: new Map([["BoardItem", 1]]),
        currency: "Credits",
      },
      new Map([
        ["ToolItem", 1],
        ["ToolTwoItem", 1],
      ]),
      0,
    );

    const boardUse = summary?.ownedOveruse.find((entry) => entry.itemClass === "BoardItem");
    expect(boardUse?.quantity).toBe(2);
    expect(boardUse?.availableQuantity).toBe(1);
    expect(summary?.objectCost).toBeNull();
    expect(economyAccepts(summary)).toBe(false);
  });
});
