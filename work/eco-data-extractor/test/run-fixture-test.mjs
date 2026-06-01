import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { parseFile } from "../src/extract-eco-data.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "../fixtures");
const file = path.join(root, "SampleChair.cs");
const source = await fs.readFile(file, "utf8");
const parsed = parseFile(file, source, root);

assert.equal(parsed.items.length, 1);
assert.equal(parsed.items[0].className, "SampleChairItem");
assert.equal(parsed.items[0].friendlyName, "Sample Chair");
assert.deepEqual(parsed.items[0].categories, []);
assert.deepEqual(parsed.items[0].tags, []);
assert.equal(parsed.items[0].hiddenCategory, false);
assert.equal(parsed.items[0].notInBrowser, false);

assert.equal(parsed.housing.length, 1);
assert.equal(parsed.housing[0].category, "Chair");
assert.equal(parsed.housing[0].value, 2.5);
assert.equal(parsed.housing[0].typeForRoomLimit, "Living Room");
assert.equal(parsed.housing[0].diminishingReturnPercent, 0.5);
assert.equal(parsed.housing[0].hiddenCategory, false);

assert.equal(parsed.recipes.length, 1);
assert.equal(parsed.recipes[0].requiredSkillClass, "CarpentrySkill");
assert.equal(parsed.recipes[0].requiredSkillLevel, 1);
assert.equal(parsed.recipes[0].craftingTableClass, "CarpentryTableObject");
assert.equal(parsed.recipes[0].products[0].itemClass, "SampleChairItem");
assert.equal(parsed.recipes[0].ingredients[0].itemClass, "HewnLogItem");
assert.equal(parsed.recipes[0].ingredients[0].quantity, 4);

assert.equal(parsed.skills.length, 1);
assert.equal(parsed.skills[0].className, "CarpentrySkill");

console.log("Fixture test passed.");
