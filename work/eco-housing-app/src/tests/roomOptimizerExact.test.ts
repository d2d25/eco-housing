import { describe, expect, test } from "vitest";
import { buildModel } from "../domain/model";
import { effectiveFloorArea, floorAreaWhenOnSurface, itemFitsRoomDimensions, surfaceUnitsProvided, surfaceUnitsRequired, canPlaceOnFloorWhenNoSurface } from "../domain/placementRules";
import { optimizeRoom } from "../domain/roomOptimizer";
import { applyTierCap, compatibleCategoriesForRoom, diminishingMultiplier, supportCapPercentForCategory } from "../domain/roomScoring";
import { createCraftAvailabilityIndex } from "../domain/craftResolver";
import type { EcoData, EcoModel, HousingItem, ItemClass, RoomInput } from "../domain/types";

const ROOM_TIERS: EcoData["roomTiers"] = [
  { tier: 0, softCap: 2, hardCap: 4, diminishingReturnPercent: 0.65 },
  { tier: 1, softCap: 5, hardCap: 10, diminishingReturnPercent: 0.65 },
  { tier: 2, softCap: 10, hardCap: 20, diminishingReturnPercent: 0.65 },
];

describe("room optimizer exact solver cross-checks", () => {
  test("matches exhaustive search across representative room inputs", () => {
    const model = exactTestModel();
    const carpenter = new Set(["CarpentrySkill"]);
    const allSkills = new Set(model.skills.map((skill) => skill.className));
    const cases: Array<Partial<RoomInput>> = [
      { roomType: "Bathroom", tier: 1, sizeMode: "manual", width: 2, depth: 2, height: 2, selectedSkills: new Set(), availability: "all" },
      { roomType: "Bathroom", tier: 2, sizeMode: "manual", width: 3, depth: 3, height: 3, selectedSkills: carpenter, availability: "available" },
      { roomType: "Bathroom", tier: 2, sizeMode: "auto", width: 1, depth: 1, height: 2, selectedSkills: allSkills, availability: "available" },
      { roomType: "Bathroom", tier: 1, sizeMode: "materials", materialBudget: 50, selectedSkills: allSkills, availability: "available" },
      { roomType: "Bathroom", tier: 2, sizeMode: "manual", width: 3, depth: 3, height: 3, selectedSkills: allSkills, availability: "available", ownedItems: new Map([["AlphaSeatItem", 1]]) },
      { roomType: "Bathroom", tier: 2, sizeMode: "manual", width: 3, depth: 3, height: 3, selectedSkills: allSkills, availability: "available", disabledItems: new Set(["StrongPrimaryItem"]) },
      { roomType: "Bathroom", tier: 2, sizeMode: "manual", width: 3, depth: 3, height: 3, selectedSkills: allSkills, availability: "available", minXpEfficiencyPercent: 60 },
      { roomType: "Bathroom", tier: 2, sizeMode: "manual", width: 3, depth: 3, height: 3, selectedSkills: allSkills, availability: "available", allowElectricPower: false },
      { roomType: "Bathroom", tier: 2, sizeMode: "manual", width: 3, depth: 3, height: 3, selectedSkills: allSkills, availability: "available", disabledFuelTags: new Set(["Torch"]) },
      { roomType: "Outdoor", tier: 2, sizeMode: "auto", selectedSkills: allSkills, availability: "available" },
      { roomType: "Bathroom", tier: 2, sizeMode: "manual", width: 3, depth: 3, height: 3, selectedSkills: allSkills, availability: "available", objective: { kind: "reachTargetScore", targetScore: 8 } },
    ];

    for (const partial of cases) {
      const input = baseInput(partial);
      const fast = optimizeRoom(model, input);
      const exact = exactOptimize(model, input);
      expect(fast.score.capped, label(input)).toBeCloseTo(exact.score, 3);
    }
  });

  test("respects broad invariants on real Eco data samples", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const repoRoot = path.resolve(__dirname, "../../../..");
    const data = JSON.parse(fs.readFileSync(path.join(repoRoot, "outputs/eco-data.json"), "utf8")) as EcoData;
    const model = buildModel(data);
    const allSkills = new Set(model.skills.map((skill) => skill.className));
    const samples = [
      baseInput({ roomType: "Bathroom", tier: 2, sizeMode: "manual", width: 4, depth: 4, height: 3, selectedSkills: allSkills }),
      baseInput({ roomType: "Bedroom", tier: 5, sizeMode: "auto", selectedSkills: allSkills }),
      baseInput({ roomType: "Living Room", tier: 5, sizeMode: "manual", width: 8, depth: 8, height: 3, selectedSkills: allSkills, allowElectricPower: false }),
      baseInput({ roomType: "Outdoor", tier: 5, sizeMode: "auto", selectedSkills: allSkills }),
    ];

    for (const input of samples) {
      const result = optimizeRoom(model, input);
      const compatible = compatibleCategoriesForRoom(model, input.roomType);
      expect(Number.isFinite(result.score.capped), input.roomType).toBe(true);
      expect(result.entries.every((entry) => !input.disabledItems.has(entry.item.itemClass))).toBe(true);
      expect(result.entries.every((entry) => compatible?.has(entry.item.category) ?? true)).toBe(true);
      if (input.roomType !== "Outdoor" && input.sizeMode === "manual") {
        expect(result.constraints.usedFloor).toBeLessThanOrEqual(input.width * input.depth);
        expect(result.constraints.usedRequiredVolume).toBeLessThanOrEqual(input.width * input.depth * input.height);
      }
      if (input.allowElectricPower === false) {
        expect(result.entries.every((entry) => entry.item.requirements?.operationalRequirements?.powerConsumption?.type !== "ElectricPower")).toBe(true);
      }
    }
  });
});

function exactOptimize(model: EcoModel, input: RoomInput) {
  const candidates = model.housingItems
    .filter((item) => !item.variantOfItemClass)
    .filter((item) => compatibleCategoriesForRoom(model, input.roomType)?.has(item.category) ?? true)
    .filter((item) => !input.disabledItems.has(item.itemClass))
    .filter((item) => availabilityFilter(model, input, item));
  const maxEntries = candidates.length;
  let best = { score: -Infinity, entries: [] as HousingItem[], raw: 0 };

  function visit(startIndex: number, selected: HousingItem[]) {
    const evaluated = evaluateSelection(model, input, selected);
    if (evaluated.valid && compareExact(input, evaluated, best) < 0) best = { score: evaluated.score, entries: [...selected], raw: evaluated.raw };
    if (selected.length >= maxEntries) return;
    for (let index = startIndex; index < candidates.length; index += 1) {
      const item = candidates[index]!;
      const type = item.typeForRoomLimit ?? item.itemClass;
      if (selected.some((selectedItem) => (selectedItem.typeForRoomLimit ?? selectedItem.itemClass) === type)) continue;
      if (selected.filter((selectedItem) => selectedItem.category === item.category).length >= 8) continue;
      selected.push(item);
      visit(index, selected);
      selected.pop();
    }
  }

  visit(0, []);
  return best;
}

function evaluateSelection(model: EcoModel, input: RoomInput, selected: HousingItem[]) {
  const constraints = constraintsFor(input);
  const byType = new Map<string, number>();
  const byCategory = new Map<string, number>();
  let raw = 0;
  let surfaceCapacity = 0;
  const surfaceConsumers: HousingItem[] = [];
  const floorConsumers: HousingItem[] = [];

  for (const item of selected) {
    if (!passesOperational(input, item)) return invalid();
    if (!itemFitsRoomDimensions(item, constraints)) return invalid();
    const type = item.typeForRoomLimit ?? item.itemClass;
    const count = byType.get(type) ?? 0;
    const score = item.value * diminishingMultiplier(item, count);
    const credited = score;
    if (!passesEfficiency(input, item, credited)) return invalid();
    byType.set(type, count + 1);
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + credited);
    raw += credited;
    surfaceCapacity += surfaceUnitsProvided(item);
    if (surfaceUnitsRequired(item) > 0) surfaceConsumers.push(item);
    else floorConsumers.push(item);
    constraints.usedRequiredVolume += item.requirements?.requiredRoomVolume ?? 0;
    if (constraints.usedRequiredVolume > constraints.maxVolume) return invalid();
  }

  let usedSurface = 0;
  let usedFloor = 0;
  for (const item of floorConsumers) usedFloor += floorAreaWhenOnSurface(item);
  for (const item of surfaceConsumers.sort((a, b) => Number(canPlaceOnFloorWhenNoSurface(a)) - Number(canPlaceOnFloorWhenNoSurface(b)))) {
    const required = surfaceUnitsRequired(item);
    if (usedSurface + required <= surfaceCapacity) {
      usedSurface += required;
      usedFloor += floorAreaWhenOnSurface(item);
    } else {
      if (!canPlaceOnFloorWhenNoSurface(item)) return invalid();
      usedFloor += effectiveFloorArea(item);
    }
  }
  if (usedFloor > constraints.maxFloor) return invalid();

  const primaryScore = byCategory.get(input.roomType) ?? 0;
  let afterSupport = 0;
  for (const [category, score] of byCategory) {
    if (category === input.roomType) {
      afterSupport += score;
      continue;
    }
    const capPercent = supportCapPercentForCategory(model, category, input.roomType);
    afterSupport += capPercent == null ? score : Math.min(score, primaryScore * capPercent);
  }
  const capped = input.roomType === "Outdoor" ? afterSupport : applyTierCap(model, afterSupport, input.tier);
  return { valid: true, score: capped, raw };
}

function compareExact(input: RoomInput, a: { score: number; entries?: HousingItem[]; raw: number }, b: { score: number; entries?: HousingItem[]; raw: number }) {
  if (input.objective?.kind === "reachTargetScore") {
    const target = input.objective.targetScore ?? input.objective.minScore ?? 0;
    const aMeets = a.score >= target;
    const bMeets = b.score >= target;
    if (aMeets !== bMeets) return Number(bMeets) - Number(aMeets);
    if (aMeets && bMeets) return a.score - b.score || (a.entries?.length ?? 0) - (b.entries?.length ?? 0);
  }
  return b.score - a.score || b.raw - a.raw || (a.entries?.length ?? 0) - (b.entries?.length ?? 0);
}

function constraintsFor(input: RoomInput) {
  const unlimited = input.roomType === "Outdoor" || input.sizeMode === "auto";
  return {
    maxWidth: unlimited ? Number.POSITIVE_INFINITY : input.width,
    maxDepth: unlimited ? Number.POSITIVE_INFINITY : input.depth,
    maxHeight: unlimited ? Number.POSITIVE_INFINITY : input.height,
    maxFloor: unlimited ? Number.POSITIVE_INFINITY : input.width * input.depth,
    maxVolume: unlimited ? Number.POSITIVE_INFINITY : input.width * input.depth * input.height,
    usedRequiredVolume: 0,
  };
}

function availabilityFilter(model: EcoModel, input: RoomInput, item: HousingItem) {
  const craft = createCraftAvailabilityIndex(model, input.selectedSkills).isCraftable(item.itemClass);
  if (input.availability === "available") return craft || (input.ownedItems.get(item.itemClass) ?? 0) > 0;
  if (input.availability === "locked") return !craft;
  return true;
}

function passesOperational(input: RoomInput, item: HousingItem) {
  const requirements = item.requirements?.operationalRequirements;
  if (requirements?.powerConsumption?.type === "ElectricPower" && input.allowElectricPower === false) return false;
  if (requirements?.powerConsumption?.type === "MechanicalPower" && input.allowMechanicalPower === false) return false;
  if (requirements?.fuel && input.allowFuel === false) return false;
  if (requirements?.water && input.allowWater === false) return false;
  if (requirements?.chimney && input.allowChimney === false) return false;
  return !(requirements?.fuel?.tags ?? []).some((tag) => input.disabledFuelTags?.has(tag));
}

function passesEfficiency(input: RoomInput, item: HousingItem, creditedScore: number) {
  const min = input.minXpEfficiencyPercent ?? 0;
  return min <= 0 || (creditedScore / item.value) * 100 >= min;
}

function invalid() {
  return { valid: false, score: -Infinity, raw: -Infinity };
}

function label(input: RoomInput) {
  return `${input.roomType} T${input.tier} ${input.sizeMode ?? "manual"} ${input.availability}`;
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
    allowElectricPower: true,
    allowMechanicalPower: true,
    allowFuel: true,
    allowWater: true,
    allowChimney: true,
    ...partial,
  };
}

function exactTestModel(): EcoModel {
  const fixtures = [
    fixture("Strong Primary", "StrongPrimaryItem", "Bathroom", 6, "Primary", { floorArea: 2, volume: 6, skill: "CarpentrySkill" }),
    fixture("Small Primary", "SmallPrimaryItem", "Bathroom", 4, "Small", { floorArea: 1, volume: 4 }),
    fixture("Tiny Primary", "TinyPrimaryItem", "Bathroom", 2, "Tiny", { floorArea: 1, volume: 2 }),
    fixture("Alpha Seat", "AlphaSeatItem", "Seating", 3, "Seat", { floorArea: 1 }),
    fixture("Electric Deco", "ElectricDecoItem", "Decoration", 4, "Electric", { floorArea: 1, electric: true }),
    fixture("Torch Deco", "TorchDecoItem", "Decoration", 3, "Torch", { floorArea: 1, fuelTag: "Torch" }),
    fixture("Flower", "FlowerItem", "Decoration", 2, "Flower", { petals: true }),
    fixture("Table", "TableItem", "Decoration", 1, "Table", { floorArea: 1, surface: true }),
    fixture("Outdoor Statue", "OutdoorStatueItem", "Outdoor", 5, "Outdoor", { floorArea: 1 }),
  ];
  return buildModel({
    housing: fixtures.map((entry) => entry.housing),
    items: fixtures.map((entry) => entry.item),
    recipes: fixtures.flatMap((entry) => entry.recipe ? [entry.recipe] : []),
    skills: [{ className: "CarpentrySkill", friendlyName: "Carpentry", professionGroup: "Carpenter" }],
    roomCategories: [
      { name: "Bathroom", canBeRoomCategory: true, supportingRoomCategoryNames: ["Seating"], supportForAnyRoomType: false },
      { name: "Outdoor", canBeRoomCategory: true, shouldCapFromRoomMaterials: false, supportForAnyRoomType: false },
      { name: "Seating", canBeRoomCategory: false, maxSupportPercentOfPrimary: 0.5, supportForAnyRoomType: false },
      { name: "Decoration", canBeRoomCategory: false, maxSupportPercentOfPrimary: 0.5, supportForAnyRoomType: true },
    ],
    roomTiers: ROOM_TIERS,
    worldObjects: fixtures.map((entry) => entry.worldObject).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    occupancy: fixtures.map((entry) => entry.occupancy).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
  });
}

function fixture(name: string, itemClass: ItemClass, category: string, value: number, type: string, options: { floorArea?: number; volume?: number; petals?: boolean; surface?: boolean; electric?: boolean; fuelTag?: string; skill?: string } = {}) {
  const worldObjectClass = options.petals ? null : `${itemClass.replace(/Item$/, "")}Object`;
  return {
    housing: {
      itemClass,
      friendlyName: name,
      worldObjectClass,
      category,
      value,
      typeForRoomLimit: type,
      diminishingReturnPercent: 0,
      tags: [
        ...(options.petals ? ["Petals"] : []),
        ...(options.surface ? ["SurfaceTags.HasTableSurface"] : []),
      ],
      hiddenCategory: false,
      notInBrowser: false,
    },
    item: {
      className: itemClass,
      friendlyName: name,
      worldObjectClass,
      tags: options.petals ? ["Petals"] : [],
    },
    recipe: options.skill ? {
      className: `${itemClass}Recipe`,
      name,
      requiredSkillClass: options.skill,
      requiredSkillLevel: 1,
      products: [{ itemClass }],
      ingredients: [],
    } : null,
    worldObject: worldObjectClass ? {
      className: worldObjectClass,
      tags: options.surface ? ["SurfaceTags.HasTableSurface"] : [],
      requiredRoomVolume: options.volume ?? null,
      operationalRequirements: {
        ...(options.electric ? { powerConsumption: { type: "ElectricPower", watts: 10 } } : {}),
        ...(options.fuelTag ? { fuel: { tags: [options.fuelTag], watts: 1 } } : {}),
      },
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
