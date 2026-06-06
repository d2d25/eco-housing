import { describe, expect, test } from "vitest";
import { deserializeHouseInput, serializeHouseInput } from "../ui/houseWorkerTypes";
import type { HouseInput } from "../domain/types";

describe("house worker input serialization", () => {
  test("round-trips sets and maps", () => {
    const input: HouseInput = {
      constructionTier: 3,
      materialBudget: 240,
      height: 4,
      sameHeightForAllRooms: true,
      maxCopiesPerRoomType: "auto",
      selectedSkills: new Set(["CarpentrySkill", "MasonrySkill"]),
      ownedItems: new Map([["TableItem", 2]]),
      disabledItems: new Set(["LampItem"]),
      availability: "available",
      minXpEfficiencyPercent: 20,
      allowElectricPower: false,
      allowMechanicalPower: true,
      allowFuel: true,
      allowWater: false,
      allowChimney: true,
      disabledFuelTags: new Set(["Wood"]),
    };

    const restored = deserializeHouseInput(serializeHouseInput(input));

    expect(restored.selectedSkills).toBeInstanceOf(Set);
    expect(restored.ownedItems).toBeInstanceOf(Map);
    expect(restored.disabledItems).toBeInstanceOf(Set);
    expect(restored.disabledFuelTags).toBeInstanceOf(Set);
    expect([...restored.selectedSkills].sort()).toEqual(["CarpentrySkill", "MasonrySkill"]);
    expect(restored.ownedItems.get("TableItem")).toBe(2);
    expect(restored.disabledItems.has("LampItem")).toBe(true);
    expect(restored.disabledFuelTags?.has("Wood")).toBe(true);
  });
});
