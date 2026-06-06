import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildModel } from "../domain/model";
import { effectiveFloorArea, floorAreaWhenOnSurface, itemFootprint, surfaceUnitsProvided, surfaceUnitsRequired } from "../domain/placementRules";
import { duplicateScoreProfile, optimizeRoom } from "../domain/roomOptimizer";
import { diminishingMultiplier } from "../domain/roomScoring";
import type { EcoData, HousingItem, RoomInput } from "../domain/types";

const repoRoot = path.resolve(__dirname, "../../../..");
const data = JSON.parse(readFileSync(path.join(repoRoot, "outputs/eco-data.json"), "utf8")) as EcoData;
const model = buildModel(data);

function housing(name: string): HousingItem {
  const item = model.housingItems.find((entry) => entry.friendlyName === name);
  expect(item, `Missing housing item: ${name}`).toBeTruthy();
  return item!;
}

function input(partial: Partial<RoomInput> = {}): RoomInput {
  return {
    roomType: "Bathroom",
    tier: 2,
    width: 4,
    depth: 4,
    height: 3,
    selectedSkills: new Set(model.skills.map((skill) => skill.className)),
    ownedItems: new Map(),
    disabledItems: new Set(),
    availability: "available",
    ...partial,
  };
}

describe("optimization indexes", () => {
  test("category indexes match direct housing item filters", () => {
    for (const category of new Set(model.housingItems.map((item) => item.category))) {
      expect(model.housingItemsByCategory.get(category)?.map((item) => item.itemClass)).toEqual(
        model.housingItems.filter((item) => item.category === category).sort((a, b) => b.value - a.value || a.friendlyName.localeCompare(b.friendlyName)).map((item) => item.itemClass),
      );
      expect(model.baseHousingItemsByCategory.get(category)?.map((item) => item.itemClass)).toEqual(
        model.housingItems.filter((item) => item.category === category && !item.variantOfItemClass).sort((a, b) => b.value - a.value || a.friendlyName.localeCompare(b.friendlyName)).map((item) => item.itemClass),
      );
    }
  });

  test("item optimization profiles match placement rule helpers", () => {
    for (const item of [housing("Ashlar Basalt Fireplace"), housing("Rug Large"), housing("Rose"), housing("Electric Wall Lamp")]) {
      const profile = model.optimizationProfileByItemClass.get(item.itemClass);
      const footprint = itemFootprint(item);
      expect(profile, item.friendlyName).toBeTruthy();
      expect(profile?.width).toBe(footprint.width || 0);
      expect(profile?.depth).toBe(footprint.depth || 0);
      expect(profile?.height).toBe(footprint.height || 0);
      expect(profile?.effectiveFloorArea).toBe(effectiveFloorArea(item));
      expect(profile?.floorAreaWhenOnSurface).toBe(floorAreaWhenOnSurface(item));
      expect(profile?.surfaceProvided).toBe(surfaceUnitsProvided(item));
      expect(profile?.surfaceRequired).toBe(surfaceUnitsRequired(item));
      expect(profile?.requiredRoomVolume).toBe(item.requirements?.requiredRoomVolume ?? 0);
    }
  });

  test("operational profile exposes requirement flags", () => {
    expect(model.optimizationProfileByItemClass.get(housing("Electric Wall Lamp").itemClass)?.needsElectricPower).toBe(true);
    expect(model.optimizationProfileByItemClass.get(housing("Sink").itemClass)?.needsWater).toBe(true);
    expect(model.optimizationProfileByItemClass.get(housing("Torch Stand").itemClass)?.needsFuel).toBe(true);
  });

  test("duplicate score profile matches diminishing multiplier", () => {
    const item = housing("Large Bath Mat");
    const scores = duplicateScoreProfile(item, 4);
    expect(scores).toEqual([0, 1, 2, 3].map((countBefore) => item.value * diminishingMultiplier(item, countBefore)));
  });

  test("room optimization cache returns isolated results and invalidates by input", () => {
    const base = input();
    const first = optimizeRoom(model, base);
    const originalScore = first.score.capped;
    first.score.capped = -1;

    const cached = optimizeRoom(model, base);
    const changed = optimizeRoom(model, { ...base, tier: 5 });

    expect(cached.score.capped).toBeCloseTo(originalScore, 3);
    expect(changed.score.capped).not.toBe(-1);
    expect(changed.score.capped).not.toBe(cached.score.capped);
  });
});
