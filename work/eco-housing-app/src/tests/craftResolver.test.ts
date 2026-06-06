import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createCraftAvailabilityIndex, createCraftResolver } from "../domain/craftResolver";
import { buildModel } from "../domain/model";
import type { EcoData, SkillClass } from "../domain/types";

const repoRoot = path.resolve(__dirname, "../../../..");
const data = JSON.parse(readFileSync(path.join(repoRoot, "outputs/eco-data.json"), "utf8")) as EcoData;
const model = buildModel(data);

describe("craft availability index", () => {
  test("matches the recursive craft resolver for housing items", () => {
    const selectedSkills = new Set<SkillClass>(
      model.skills
        .filter((skill) => ["Carpenter", "Mason"].includes(skill.professionGroup ?? ""))
        .map((skill) => skill.className),
    );
    const resolver = createCraftResolver(model, selectedSkills);
    const index = createCraftAvailabilityIndex(model, selectedSkills);

    for (const item of model.housingItems) {
      expect(index.resolve(item.itemClass), item.friendlyName).toEqual(resolver.resolve(item.itemClass));
    }
  });

  test("keeps availability dependent on the selected skills", () => {
    const none = createCraftAvailabilityIndex(model, new Set());
    const all = createCraftAvailabilityIndex(model, new Set(model.skills.map((skill) => skill.className)));

    expect(none.isCraftable("AshlarStoneFireplaceItem")).toBe(false);
    expect(all.isCraftable("AshlarStoneFireplaceItem")).toBe(true);
  });
});
