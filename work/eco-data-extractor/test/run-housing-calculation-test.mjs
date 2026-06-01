import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");
const data = JSON.parse(readFileSync(path.join(repoRoot, "outputs/eco-data.json"), "utf8"));

function housing(name) {
  const item = data.housing.find((entry) => entry.friendlyName === name);
  assert.ok(item, `Missing housing item: ${name}`);
  return item;
}

function roomCategory(name) {
  const category = data.roomCategories.find((entry) => entry.name === name);
  assert.ok(category, `Missing room category: ${name}`);
  return category;
}

function duplicateValue(item, count) {
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    total += item.value * ((item.diminishingReturnPercent ?? 1) ** i);
  }
  return total;
}

function lineValues(item, count) {
  const values = [];
  for (let i = 0; i < count; i += 1) {
    values.push(item.value * ((item.diminishingReturnPercent ?? 1) ** i));
  }
  return values;
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function assertApprox(actual, expected, tolerance = 0.01, message = "") {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} expected ${expected}, got ${actual}`);
}

function tierCap(value, tier) {
  if (value <= tier.softCap) return value;
  const overflow = value - tier.softCap;
  const range = tier.hardCap - tier.softCap;
  return tier.hardCap - range * (tier.diminishingReturnPercent ** (overflow / range));
}

function supportCap(categoryName, primaryValue, primaryRoomName = null) {
  const category = roomCategory(categoryName);
  const percent = primaryRoomName
    ? category.maxSupportPercentOfPrimaryPerCategory?.[primaryRoomName] ?? category.maxSupportPercentOfPrimary
    : category.maxSupportPercentOfPrimary;
  return primaryValue * percent;
}

function hasSurfaceTag(item, tagName) {
  return item.tags?.includes(`SurfaceTags.${tagName}`);
}

function hasTag(item, tagName) {
  return item.tags?.includes(tagName);
}

function isSmallEstimatedPlaceable(item) {
  return hasSurfaceTag(item, "CanBeOnSurface") || (!item.worldObjectClass && hasTag(item, "Petals"));
}

function itemFootprint(item) {
  const occupancy = occupancyByWorldObject.get(item.worldObjectClass);
  if (occupancy) return occupancy;
  if (isSmallEstimatedPlaceable(item)) return { width: 1, depth: 1, height: 1, floorArea: 1, estimated: true };
  return { width: 0, depth: 0, height: 0, floorArea: 0 };
}

function effectiveFloorArea(item) {
  if (hasSurfaceTag(item, "Rug")) return 0;
  return itemFootprint(item).floorArea;
}

function floorAreaWhenOnSurface(item) {
  if (hasSurfaceTag(item, "Rug")) return 0;
  if (isSmallEstimatedPlaceable(item)) return 0;
  return effectiveFloorArea(item);
}

function surfaceUnitsRequired(item) {
  if (!isSmallEstimatedPlaceable(item)) return 0;
  return Math.max(1, itemFootprint(item).floorArea);
}

const bathroom = duplicateValue(housing("Stump Latrine"), 2);
const seatingCap = bathroom * roomCategory("Seating").maxSupportPercentOfPrimary;
const decorationCap = bathroom * roomCategory("Decoration").maxSupportPercentOfPrimary;
const lightingCap = bathroom * roomCategory("Lighting").maxSupportPercentOfPrimary;

const total =
  bathroom +
  Math.min(housing("Stump Table").value, seatingCap) +
  Math.min(housing("Participation Trophy").value, decorationCap) +
  Math.min(housing("Torch Stand").value, lightingCap);

assert.equal(Number(total.toFixed(3)), 3.795);
assert.deepEqual(lineValues(housing("Stump Latrine"), 2).map((value) => round(value, 2)), [1.5, 0.15]);
assertApprox(Math.min(housing("Stump Table").value, seatingCap), 0.50, 0.01, "Bathroom seating cap");
assertApprox(Math.min(housing("Participation Trophy").value, decorationCap), 0.83, 0.01, "Bathroom decoration cap");
assertApprox(Math.min(housing("Torch Stand").value, lightingCap), 0.83, 0.01, "Bathroom lighting cap");

const tier5 = data.roomTiers.find((entry) => entry.tier === 5);
assert.ok(tier5, "Missing tier 5");
const livingRoomPrimary =
  duplicateValue(housing("Ashlar Basalt Fireplace"), 1) +
  duplicateValue(housing("Nylon Futon Couch"), 2) +
  duplicateValue(housing("Elk Statuette"), 5);
assert.equal(round(livingRoomPrimary, 2), 22.51);

const livingRoomDecorationRaw =
  housing("Stuffed Bison").value +
  housing("Orrery").value +
  housing("Participation Trophy").value;
const livingRoomSeatingRaw =
  housing("Coffee Table").value +
  housing("Adorned Ashlar Basalt Bench").value;
const livingRoomLightingRaw = housing("Electric Wall Lamp").value;
assert.equal(round(Math.min(livingRoomDecorationRaw, supportCap("Decoration", livingRoomPrimary, "Living Room")), 2), 11.25);
assert.equal(round(Math.min(livingRoomSeatingRaw, supportCap("Seating", livingRoomPrimary, "Living Room")), 2), 6.75);
assert.equal(round(Math.min(livingRoomLightingRaw, supportCap("Lighting", livingRoomPrimary, "Living Room")), 2), 8.00);

const livingRoomAfterCaps =
  livingRoomPrimary +
  Math.min(livingRoomDecorationRaw, supportCap("Decoration", livingRoomPrimary, "Living Room")) +
  Math.min(livingRoomSeatingRaw, supportCap("Seating", livingRoomPrimary, "Living Room")) +
  Math.min(livingRoomLightingRaw, supportCap("Lighting", livingRoomPrimary, "Living Room"));
assert.equal(round(livingRoomAfterCaps, 2), 48.51);

const cappedLivingRoom = tierCap(livingRoomAfterCaps, tier5);
assert.equal(Number(cappedLivingRoom.toFixed(2)), 33.33);

const worldObjects = new Map(data.worldObjects.map((entry) => [entry.className, entry]));
const occupancyByWorldObject = new Map(data.occupancy.map((entry) => [entry.worldObjectClass, entry]));
function requiredVolume(name, count = 1) {
  const item = housing(name);
  return (worldObjects.get(item.worldObjectClass)?.requiredRoomVolume ?? 0) * count;
}

const livingRoomRequiredVolume =
  requiredVolume("Ashlar Basalt Fireplace") +
  requiredVolume("Nylon Futon Couch", 2) +
  requiredVolume("Elk Statuette", 5) +
  requiredVolume("Stuffed Bison") +
  requiredVolume("Orrery") +
  requiredVolume("Participation Trophy") +
  requiredVolume("Coffee Table") +
  requiredVolume("Adorned Ashlar Basalt Bench") +
  requiredVolume("Electric Wall Lamp");
assert.equal(livingRoomRequiredVolume, 46);

const fireplace = occupancyByWorldObject.get(housing("Ashlar Basalt Fireplace").worldObjectClass);
assert.equal(fireplace.width, 3);
assert.equal(fireplace.depth, 1);
assert.equal(fireplace.height, 2);
assert.equal(fireplace.floorArea, 3);

assert.ok(housing("Rug Large").tags.includes("SurfaceTags.Rug"));
assert.ok(housing("Elk Statuette").tags.includes("SurfaceTags.CanBeOnSurface"));
const table = housing("Coffee Table");
assert.ok(worldObjects.get(table.worldObjectClass)?.tags.includes("SurfaceTags.HasTableSurface"));

const rose = housing("Rose");
assert.ok(rose.tags.includes("Petals"));
assert.equal(rose.worldObjectClass, null);
assert.equal(hasSurfaceTag(rose, "CanBeOnSurface"), false);
assert.equal(isSmallEstimatedPlaceable(rose), true);
assert.equal(surfaceUnitsRequired(rose), 1);
assert.equal(floorAreaWhenOnSurface(rose), 0);
assert.equal(effectiveFloorArea(rose), 1);

const rugLarge = housing("Rug Large");
assert.equal(surfaceUnitsRequired(rugLarge), 0);
assert.equal(effectiveFloorArea(rugLarge), 0);
assert.equal(floorAreaWhenOnSurface(rugLarge), 0);

console.log("Housing calculation fixture passed.");
