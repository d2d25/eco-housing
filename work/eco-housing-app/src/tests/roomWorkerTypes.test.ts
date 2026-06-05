import { describe, expect, test } from "vitest";
import type { RoomInput } from "../domain/types";
import { deserializeRoomInput, serializeRoomInput } from "../ui/roomWorkerTypes";

describe("room worker serialization", () => {
  test("converts Set and Map fields to cloneable arrays and rebuilds RoomInput", () => {
    const input: RoomInput = {
      roomType: "Bathroom",
      tier: 2,
      width: 4,
      depth: 5,
      height: 3,
      sizeMode: "materials",
      materialBudget: 120,
      selectedSkills: new Set(["LoggingSkill", "CarpentrySkill"]),
      ownedItems: new Map([["StumpLatrineItem", 2], ["TorchStandItem", 1]]),
      disabledItems: new Set(["ChandelierItem"]),
      availability: "available",
      minXpEfficiencyPercent: 20,
    };

    const serialized = serializeRoomInput(input);

    expect(serialized.selectedSkills).toEqual(["LoggingSkill", "CarpentrySkill"]);
    expect(serialized.ownedItems).toEqual([["StumpLatrineItem", 2], ["TorchStandItem", 1]]);
    expect(serialized.disabledItems).toEqual(["ChandelierItem"]);
    expect(serialized.minXpEfficiencyPercent).toBe(20);

    const rebuilt = deserializeRoomInput(serialized);

    expect(rebuilt.roomType).toBe("Bathroom");
    expect(rebuilt.tier).toBe(2);
    expect(rebuilt.width).toBe(4);
    expect(rebuilt.depth).toBe(5);
    expect(rebuilt.height).toBe(3);
    expect(rebuilt.sizeMode).toBe("materials");
    expect(rebuilt.materialBudget).toBe(120);
    expect([...rebuilt.selectedSkills]).toEqual(["LoggingSkill", "CarpentrySkill"]);
    expect([...rebuilt.ownedItems.entries()]).toEqual([["StumpLatrineItem", 2], ["TorchStandItem", 1]]);
    expect([...rebuilt.disabledItems]).toEqual(["ChandelierItem"]);
    expect(rebuilt.minXpEfficiencyPercent).toBe(20);
  });
});
