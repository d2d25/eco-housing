#!/usr/bin/env node

import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const VERSION = "0.1.0";

function parseArgs(argv) {
  const args = {
    ecoPath: null,
    modsPath: null,
    out: "outputs/eco-data.json",
    pretty: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--eco-path") args.ecoPath = argv[++i];
    else if (arg === "--mods-path") args.modsPath = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--compact") args.pretty = false;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Argument inconnu: ${arg}`);
    }
  }

  if (!args.modsPath && args.ecoPath) {
    args.modsPath = path.join(args.ecoPath, "Eco_Data", "Server", "Mods");
  }

  if (!args.modsPath) {
    throw new Error("Indique --eco-path ou --mods-path.");
  }

  return args;
}

function printHelp() {
  console.log(`Eco Data Extractor ${VERSION}

Usage:
  node src/extract-eco-data.mjs --eco-path "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Eco" --out outputs\\eco-data.json
  node src/extract-eco-data.mjs --mods-path "C:\\...\\Eco_Data\\Server\\Mods" --out outputs\\eco-data.json
`);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await exists(filePath))) return null;
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function readHousingConfig(ecoPath) {
  if (!ecoPath) return null;
  const configsPath = path.join(ecoPath, "Eco_Data", "Server", "Configs");
  const config =
    (await readJsonIfExists(path.join(configsPath, "Rooms.eco"))) ??
    (await readJsonIfExists(path.join(configsPath, "Rooms.eco.template")));
  if (!config) return null;

  return {
    roomCategoryDiminishingReturnRate: parseNumber(config.RoomCategoryDiminishingReturnRate),
    housePointsMultiplierPerResidentsCount: Array.isArray(config.HousePointsMultiplierPerResidentsCount)
      ? config.HousePointsMultiplierPerResidentsCount.map(parseNumber).filter((value) => value != null)
      : [],
  };
}

async function readMarketplaceBlueprintWorldObjects(ecoPath) {
  if (!ecoPath) return new Set();

  const catalogPath = path.join(ecoPath, "Eco_Data", "StreamingAssets", "aa", "catalog.bin");
  if (!(await exists(catalogPath))) return new Set();

  const source = (await fs.readFile(catalogPath)).toString("latin1");
  const iapIndex = source.indexOf("Assets/Art/IAP");
  if (iapIndex === -1) return new Set();

  const start = Math.max(0, iapIndex - 500);
  const bakedWindIndex = source.indexOf("BakedWindAnimators", iapIndex);
  const end = bakedWindIndex === -1 ? Math.min(source.length, iapIndex + 20000) : bakedWindIndex;
  const iapBlock = source.slice(start, end);
  const worldObjects = new Set();

  for (const match of iapBlock.matchAll(/\b([A-Za-z0-9_]+Object)\.prefab\b/g)) {
    worldObjects.add(match[1]);
  }

  return worldObjects;
}

async function listCsFiles(root) {
  const files = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".cs")) {
        files.push(fullPath);
      }
    }
  }

  await walk(root);
  return files;
}

function normalizeWhitespace(value) {
  return value?.replace(/\s+/g, " ").trim() ?? null;
}

function parseStringLiteral(raw) {
  if (!raw) return null;
  const localizer = raw.match(/Localizer\.DoStr\(\s*"((?:\\"|[^"])*)"\s*\)/);
  const simple = raw.match(/"((?:\\"|[^"])*)"/);
  const value = localizer?.[1] ?? simple?.[1] ?? null;
  return value ? value.replace(/\\"/g, "\"") : null;
}

function parseFriendlyProperty(source, propertyName) {
  const regex = new RegExp(`override\\s+string\\s+${propertyName}\\s*\\{[\\s\\S]*?return\\s+([^;]+);`, "m");
  return normalizeWhitespace(parseStringLiteral(source.match(regex)?.[1]));
}

function parseLocAttribute(attributes, attributeName) {
  return normalizeWhitespace(parseStringLiteral(attributes.match(new RegExp(`${attributeName}\\s*\\(\\s*([^\\)]*)\\)`, "m"))?.[1]));
}

function parseClassDisplay(entry) {
  return parseLocAttribute(entry.attributes, "LocDisplayName") ?? parseFriendlyProperty(entry.body, "FriendlyName");
}

function parseClassDescription(entry) {
  return parseLocAttribute(entry.attributes, "LocDescription") ?? parseFriendlyProperty(entry.body, "Description");
}

function parseCategories(attributes) {
  const categories = [];
  for (const match of attributes.matchAll(/Category\s*\(\s*"((?:\\"|[^"])*)"\s*\)/g)) {
    categories.push(match[1].replace(/\\"/g, "\""));
  }
  return categories;
}

function parseTags(attributes) {
  const tags = [];
  for (const match of attributes.matchAll(/Tag\s*\(\s*"((?:\\"|[^"])*)"\s*\)/g)) {
    tags.push(match[1].replace(/\\"/g, "\""));
  }
  for (const match of attributes.matchAll(/Tag\s*\(\s*nameof\s*\(\s*SurfaceTags\.([A-Za-z0-9_]+)\s*\)\s*\)/g)) {
    tags.push(`SurfaceTags.${match[1]}`);
  }
  return tags;
}

function parseBrowserMetadata(entry) {
  const categories = parseCategories(entry.attributes);
  const tags = parseTags(entry.attributes);
  return {
    categories,
    tags,
    hiddenCategory: categories.includes("Hidden"),
    notInBrowser: tags.includes("NotInBrowser"),
    noIcon: /\[NoIcon\]/.test(entry.attributes),
  };
}

function parseSkillTier(entry) {
  return (
    parseNumber(entry.body.match(/override\s+int\s+Tier\s*\{[\s\S]*?return\s+([0-9]+)/m)?.[1]) ??
    parseNumber(entry.attributes.match(/Tier\s*\(\s*([0-9]+)/m)?.[1])
  );
}

function parseProfessionGroup(entry) {
  return parseStringLiteral(entry.attributes.match(/Ecopedia\s*\(\s*"Professions"\s*,\s*([^,\)]+)/m)?.[1]);
}

function parseParentSkillClass(entry) {
  return entry.attributes.match(/RequiresSkill\s*\(\s*typeof\(([A-Za-z0-9_]+)\)/m)?.[1] ?? null;
}

function parseNumber(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[fFdDmM]$/, "");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseCraftingElements(block) {
  const elements = [];
  if (!block) return elements;

  const genericRegex = /new\s+CraftingElement<([A-Za-z0-9_]+)>\s*\(([^;\n\r]*)\)/g;
  for (const match of block.matchAll(genericRegex)) {
    const args = match[2];
    const skillModifiedQuantity = args.match(/typeof\([A-Za-z0-9_]+\)\s*,\s*([0-9.]+[fFdDmM]?)/)?.[1];
    const directQuantity = args.match(/^\s*([0-9.]+[fFdDmM]?)/)?.[1];
    elements.push({
      itemClass: match[1],
      quantity: parseNumber(skillModifiedQuantity ?? directQuantity),
      raw: normalizeWhitespace(match[0]),
    });
  }

  const typeRegex = /new\s+CraftingElement\s*\(\s*typeof\(([A-Za-z0-9_]+)\)\s*,\s*([0-9.]+[fFdDmM]?)/g;
  for (const match of block.matchAll(typeRegex)) {
    elements.push({
      itemClass: match[1],
      quantity: parseNumber(match[2]),
      raw: normalizeWhitespace(match[0]),
    });
  }

  return elements;
}

function extractAssignmentBlock(source, propertyName) {
  const marker = new RegExp(`${propertyName}\\s*=\\s*new\\s+CraftingElement\\[\\]\\s*\\{`, "m");
  const match = marker.exec(source);
  if (!match) return null;

  const start = match.index + match[0].length;
  let depth = 1;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i);
  }

  return null;
}

function extractNamedListBlock(source, name, listType) {
  const marker = new RegExp(`${name}\\s*:\\s*new\\s+List<${listType}>\\s*\\{`, "m");
  const match = marker.exec(source);
  if (!match) return null;

  const start = match.index + match[0].length;
  let depth = 1;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i);
  }

  return null;
}

function parseIngredientElements(block) {
  const elements = [];
  if (!block) return elements;

  const regex = /new\s+IngredientElement\s*\(\s*(typeof\(([A-Za-z0-9_]+)\)|"([^"]+)")\s*,\s*([0-9.]+[fFdDmM]?)/g;
  for (const match of block.matchAll(regex)) {
    elements.push({
      itemClass: match[2] ?? null,
      tag: match[3] ?? null,
      quantity: parseNumber(match[4]),
      raw: normalizeWhitespace(match[0]),
    });
  }

  return elements;
}

function parseHousingValue(source) {
  const housingMatch = source.match(/(?:HousingValue\s+HousingVal|HomeFurnishingValue\s+homeValue)[\s\S]*?new\s+(?:HousingValue|HomeFurnishingValue)\s*\(\s*\)\s*\{([\s\S]*?)\}\s*;/m);
  if (!housingMatch) return null;

  const body = housingMatch[1];
  const getString = (key) => parseStringLiteral(body.match(new RegExp(`${key}\\s*=\\s*([^,\\n\\r]+)`, "m"))?.[1]);
  const getRoomCategory = () => parseStringLiteral(body.match(/Category\s*=\s*HousingConfig\.GetRoomCategory\s*\(\s*([^)]+)\)/m)?.[1]);
  const getNumber = (key) => parseNumber(body.match(new RegExp(`${key}\\s*=\\s*([0-9.]+[fFdDmM]?)`, "m"))?.[1]);
  const dynamic = /IHasDynamicHomeFurnishingValue|DynamicFurnishingValue|CalcArtValue/.test(source);

  return {
    category: getRoomCategory() ?? getString("Category"),
    value: getNumber("BaseValue") ?? getNumber("Val"),
    typeForRoomLimit: getString("TypeForRoomLimit"),
    diminishingReturnPercent: getNumber("DiminishingReturnPercent") ?? getNumber("DiminishingReturnMultiplier"),
    diminishingMultiplierAcrossFullProperty: getNumber("DiminishingMultiplierAcrossFullProperty"),
    hasDynamicFurnishingValue: dynamic,
  };
}

function extractBalancedObject(source, start) {
  const openBrace = source.indexOf("{", start);
  if (openBrace === -1) return null;

  let depth = 1;
  for (let i = openBrace + 1; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(openBrace + 1, i);
  }

  return null;
}

function parseStringArray(raw) {
  if (!raw) return [];
  const values = [];
  for (const match of raw.matchAll(/"((?:\\"|[^"])*)"/g)) {
    values.push(match[1].replace(/\\"/g, "\""));
  }
  return values;
}

function parseEnumArray(raw) {
  if (!raw) return [];
  const values = [];
  for (const match of raw.matchAll(/PropertyType\.([A-Za-z0-9_]+)/g)) {
    values.push(match[1]);
  }
  return values;
}

function parseBool(raw) {
  if (raw == null) return null;
  if (/true/i.test(raw)) return true;
  if (/false/i.test(raw)) return false;
  return null;
}

function parseRoomCategories(source) {
  const categories = [];
  const regex = /new\s+RoomCategory\s*\(\s*\)/g;

  for (const match of source.matchAll(regex)) {
    const body = extractBalancedObject(source, match.index);
    if (!body) continue;

    const getPrimitive = (key) => body.match(new RegExp(`${key}\\s*=\\s*([^,\\n\\r\\}]+)`, "m"))?.[1]?.trim();
    const getStringList = (key) => body.match(new RegExp(`${key}\\s*=\\s*new\\[\\]\\s*\\{([^\\}]*)\\}`, "m"))?.[1];
    const perCategory = {};
    const perCategoryStart = body.indexOf("MaxSupportPercentOfPrimaryPerCategory");
    const perCategoryBody = perCategoryStart >= 0 ? extractBalancedObject(body, perCategoryStart) : null;
    if (perCategoryBody) {
      for (const entry of perCategoryBody.matchAll(/\{\s*"((?:\\"|[^"])*)"\s*,\s*([.0-9]+[fFdDmM]?)\s*\}/g)) {
        perCategory[entry[1].replace(/\\"/g, "\"")] = parseNumber(entry[2]);
      }
    }
    const displayName = parseStringLiteral(getPrimitive("DisplayName"));
    if (!displayName) continue;

    categories.push({
      name: displayName,
      canBeRoomCategory: parseBool(getPrimitive("CanBeRoomCategory")) ?? true,
      canAutoChooseCategory: parseBool(getPrimitive("CanAutoChooseCategory")) ?? true,
      supportForAnyRoomType: parseBool(getPrimitive("SupportForAnyRoomType")) ?? false,
      negatesValue: parseBool(getPrimitive("NegatesValue")) ?? false,
      shouldCapFromRoomMaterials: parseBool(getPrimitive("ShouldCapFromRoomMaterials")) ?? true,
      maxSupportPercentOfPrimary: parseNumber(getPrimitive("MaxSupportPercentOfPrimary")),
      maxSupportPercentOfPrimaryPerCategory: perCategory,
      capToPercentOfRestOfProperty: parseNumber(getPrimitive("CapToPercentOfRestOfProperty")),
      affectsPropertyTypes: parseEnumArray(getStringList("AffectsPropertyTypes")),
      supportingRoomCategoryNames: parseStringArray(getStringList("SupportingRoomCategoryNames")),
    });
  }

  return categories;
}

function parseRoomTiers(source) {
  const tiers = [];
  const regex = /new\s+RoomTier\s*\{([^}]*)\}/g;

  for (const match of source.matchAll(regex)) {
    const body = match[1];
    const getNumber = (key) => parseNumber(body.match(new RegExp(`${key}\\s*=\\s*([.0-9]+[fFdDmM]?)`, "m"))?.[1]);
    const tier = {
      tier: getNumber("TierVal"),
      softCap: getNumber("SoftCap"),
      hardCap: getNumber("HardCap"),
      diminishingReturnPercent: getNumber("DiminishingReturnPercent"),
    };
    if (tier.tier != null) tiers.push(tier);
  }

  return tiers;
}

function parseWorldObjectRequirements(entry) {
  const attachment = entry.body.match(/GetOccupancyContext\s*=>\s*new\s+SideAttachedContext\s*\(\s*([^,]+),/m)?.[1] ?? null;
  const attachmentDirections = attachment
    ? [...attachment.matchAll(/DirectionAxisFlags\.([A-Za-z0-9_]+)/g)].map((match) => match[1])
    : [];
  return {
    className: entry.name,
    displayName: parseClassDisplay(entry),
    representedItemClass: entry.body.match(/RepresentedItemType\s*=>\s*typeof\(([A-Za-z0-9_]+)\)/m)?.[1] ?? null,
    ...parseBrowserMetadata(entry),
    attachmentDirections,
    requireRoomContainment: /\[RequireRoomContainment\]/.test(entry.attributes),
    requiredRoomVolume: parseNumber(entry.attributes.match(/RequireRoomVolume\s*\(\s*([0-9.]+[fFdDmM]?)/m)?.[1]),
    requiredRoomMaterialTier: parseNumber(entry.attributes.match(/RequireRoomMaterialTier\s*\(\s*([0-9.]+[fFdDmM]?)/m)?.[1]),
    requiresOccupancy: /RequireComponent\s*\(\s*typeof\(OccupancyRequirementComponent\)\s*\)/.test(entry.attributes),
    requiresRoomRequirements: /RequireComponent\s*\(\s*typeof\(RoomRequirementsComponent\)\s*\)/.test(entry.attributes),
  };
}

function summarizeOccupancy(objectClass, coords, portTypes) {
  if (!coords.length) return null;
  const xs = coords.map((coord) => coord.x);
  const ys = coords.map((coord) => coord.y);
  const zs = coords.map((coord) => coord.z);
  const floorCells = new Set(coords.map((coord) => `${coord.x}:${coord.z}`));

  return {
    worldObjectClass: objectClass,
    blockCount: coords.length,
    floorArea: floorCells.size,
    width: Math.max(...xs) - Math.min(...xs) + 1,
    depth: Math.max(...zs) - Math.min(...zs) + 1,
    height: Math.max(...ys) - Math.min(...ys) + 1,
    min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
    max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
    ports: [...new Set(portTypes)].sort(),
  };
}

function parseOccupancyData(source) {
  const entries = [];
  const regex = /WorldObject\.AddOccupancy<([A-Za-z0-9_]+)>\s*\(\s*new\s+List<BlockOccupancy>\s*\(\)?\s*\)\s*\{([\s\S]*?)\}\s*\);/g;

  for (const match of source.matchAll(regex)) {
    const objectClass = match[1];
    const body = match[2];
    const coords = [];
    const portTypes = [];
    const coordRegex = /new\s+BlockOccupancy\s*\(\s*new\s+Vector3i\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)([^)]*)\)/g;
    for (const coordMatch of body.matchAll(coordRegex)) {
      coords.push({
        x: Number(coordMatch[1]),
        y: Number(coordMatch[2]),
        z: Number(coordMatch[3]),
      });
      const port = coordMatch[4].match(/BlockOccupancyType\.([A-Za-z0-9_]+)/)?.[1];
      if (port) portTypes.push(port);
    }

    const summary = summarizeOccupancy(objectClass, coords, portTypes);
    if (summary) entries.push(summary);
  }

  return entries;
}

function parseClasses(source) {
  const classes = [];
  const classRegex = /((?:\[[^\]]+\]\s*)*)public\s+(?:partial\s+)?class\s+([A-Za-z0-9_]+)\s*:\s*([^\n\r{]+)/g;

  for (const match of source.matchAll(classRegex)) {
    const publicIndex = match.index + (match[1]?.length ?? 0);
    classes.push({
      attributes: readLeadingAttributes(source, publicIndex) || match[1] || "",
      name: match[2],
      base: match[3].trim(),
      start: match.index,
    });
  }

  return classes;
}

function readLeadingAttributes(source, classStart) {
  const beforeClass = source.slice(0, classStart);
  const lines = beforeClass.split(/\r?\n/);
  const attributeLines = [];

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("[")) break;
    attributeLines.push(trimmed);
  }

  return attributeLines.reverse().join("\n");
}

function extractClassBody(source, classStart) {
  const openBrace = source.indexOf("{", classStart);
  if (openBrace === -1) return "";

  let depth = 1;
  for (let i = openBrace + 1; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(openBrace + 1, i);
  }

  return source.slice(openBrace + 1);
}

function parseFile(filePath, source, modsRoot) {
  const relativePath = path.relative(modsRoot, filePath).replaceAll("\\", "/");
  const classes = parseClasses(source).map((entry) => ({
    ...entry,
    body: extractClassBody(source, entry.start),
  }));
  const itemClasses = classes.filter((entry) => /\bItem\b|WorldObjectItem</.test(entry.base) || parseHousingValue(entry.body));
  const recipeClasses = classes.filter((entry) => /\bRecipe/.test(entry.base));
  const skillClasses = classes.filter((entry) => /\bSkill\b/.test(entry.base));
  const worldObjectClasses = classes.filter((entry) => /\bWorldObject\b|WorldObject$|SettlementFoundationObject|WorldObject,/.test(entry.base) || entry.body.includes("RepresentedItemType"));
  const dynamicWorldObjectClasses = new Set(
    worldObjectClasses
      .filter((entry) => /PictureFrameObject|IHasDynamicHomeFurnishingValue|DynamicFurnishingValue/.test(`${entry.base}\n${entry.body}`))
      .map((entry) => entry.name)
  );

  const items = itemClasses.map((entry) => ({
    className: entry.name,
    friendlyName: parseClassDisplay(entry),
    description: parseClassDescription(entry),
    worldObjectClass: entry.base.match(/WorldObjectItem<([A-Za-z0-9_]+)>/)?.[1] ?? null,
    ...parseBrowserMetadata(entry),
    source: relativePath,
  }));

  const housingEntries = itemClasses
    .map((entry) => {
      const housing = parseHousingValue(entry.body);
      if (!housing) return null;
      const worldObjectClass = entry.base.match(/WorldObjectItem<([A-Za-z0-9_]+)>/)?.[1] ?? null;
      return {
        itemClass: entry.name,
        friendlyName: parseClassDisplay(entry),
        description: parseClassDescription(entry),
        worldObjectClass,
        ...housing,
        hasDynamicFurnishingValue: housing.hasDynamicFurnishingValue || dynamicWorldObjectClasses.has(worldObjectClass),
        ...parseBrowserMetadata(entry),
        source: relativePath,
      };
    })
    .filter(Boolean);

  const recipes = recipeClasses.map((entry) => {
    const skillMatch = entry.attributes.match(/RequiresSkill\s*\(\s*typeof\(([A-Za-z0-9_]+)\)\s*,\s*([0-9]+)/);
    return {
      className: entry.name,
      name:
        parseStringLiteral(entry.body.match(/this\.Initialize\s*\(\s*([^,]+),\s*typeof\(/)?.[1]) ??
        parseStringLiteral(entry.body.match(/this\.Initialize\s*\(\s*displayText:\s*([^,]+),\s*recipeType:/)?.[1]) ??
        parseStringLiteral(entry.body.match(/displayName:\s*([^,\n\r]+)/)?.[1]),
      requiredSkillClass: skillMatch?.[1] ?? null,
      requiredSkillLevel: skillMatch ? Number(skillMatch[2]) : null,
      craftingTableClass:
        entry.body.match(/CraftingComponent\.AddRecipe\s*\(\s*typeof\(([A-Za-z0-9_]+)\)/)?.[1] ??
        entry.body.match(/CraftingComponent\.AddRecipe\s*\(\s*tableType:\s*typeof\(([A-Za-z0-9_]+)\)/)?.[1] ??
        entry.body.match(/CraftingComponent\.AddTagProduct\s*\(\s*typeof\(([A-Za-z0-9_]+)\)/)?.[1] ??
        null,
      products: [
        ...parseCraftingElements(extractAssignmentBlock(entry.body, "Products")),
        ...parseCraftingElements(extractNamedListBlock(entry.body, "items", "CraftingElement")),
      ],
      ingredients: [
        ...parseCraftingElements(extractAssignmentBlock(entry.body, "Ingredients")),
        ...parseIngredientElements(extractNamedListBlock(entry.body, "ingredients", "IngredientElement")),
      ],
      source: relativePath,
    };
  });

  const skills = skillClasses.map((entry) => ({
    className: entry.name,
    friendlyName: parseClassDisplay(entry),
    tier: parseSkillTier(entry),
    isSpecialty: /\[Tag\("Specialty"\)\]/.test(entry.attributes),
    isProfession: /\[Tag\("Profession"\)\]/.test(entry.attributes),
    professionGroup: parseProfessionGroup(entry),
    parentSkillClass: parseParentSkillClass(entry),
    source: relativePath,
  }));

  const worldObjects = worldObjectClasses.map(parseWorldObjectRequirements);

  return {
    items,
    housing: housingEntries,
    recipes,
    skills,
    worldObjects,
    occupancy: parseOccupancyData(source),
    roomCategories: parseRoomCategories(source),
    roomTiers: parseRoomTiers(source),
  };
}

function sortByClassName(entries) {
  return entries.sort((a, b) => (a.className ?? a.itemClass).localeCompare(b.className ?? b.itemClass));
}

async function extract(modsPath, options = {}) {
  const resolvedModsPath = path.resolve(modsPath);
  if (!(await exists(resolvedModsPath))) {
    throw new Error(`Dossier Mods introuvable: ${resolvedModsPath}`);
  }

  const files = await listCsFiles(resolvedModsPath);
  const marketplaceBlueprintWorldObjects = await readMarketplaceBlueprintWorldObjects(options.ecoPath);
  const result = {
    meta: {
      extractorVersion: VERSION,
      extractedAt: new Date().toISOString(),
      modsPath: resolvedModsPath,
      fileCount: files.length,
      marketplaceBlueprintSource: marketplaceBlueprintWorldObjects.size > 0
        ? "Eco_Data/StreamingAssets/aa/catalog.bin: Assets/Art/IAP"
        : null,
    },
    items: [],
    housing: [],
    recipes: [],
    skills: [],
    worldObjects: [],
    occupancy: [],
    roomCategories: [],
    roomTiers: [],
    housingConfig: await readHousingConfig(options.ecoPath),
  };

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    const parsed = parseFile(file, source, resolvedModsPath);
    result.items.push(...parsed.items);
    result.housing.push(...parsed.housing);
    result.recipes.push(...parsed.recipes);
    result.skills.push(...parsed.skills);
    result.worldObjects.push(...parsed.worldObjects);
    result.occupancy.push(...parsed.occupancy);
    result.roomCategories.push(...parsed.roomCategories);
    result.roomTiers.push(...parsed.roomTiers);
  }

  const marketplaceBlueprintItems = new Set(
    result.items
      .filter((item) => marketplaceBlueprintWorldObjects.has(item.worldObjectClass))
      .map((item) => item.className)
  );

  result.items = result.items.filter((item) => !marketplaceBlueprintItems.has(item.className));
  result.housing = result.housing.filter((item) => !marketplaceBlueprintItems.has(item.itemClass));
  result.recipes = result.recipes.filter((recipe) =>
    recipe.products.length === 0 || recipe.products.some((product) => !marketplaceBlueprintItems.has(product.itemClass))
  );
  result.worldObjects = result.worldObjects.filter((worldObject) => !marketplaceBlueprintWorldObjects.has(worldObject.className));
  result.occupancy = result.occupancy.filter((entry) => !marketplaceBlueprintWorldObjects.has(entry.worldObjectClass));

  result.items = sortByClassName(result.items);
  result.housing = result.housing.sort((a, b) => a.itemClass.localeCompare(b.itemClass));
  result.recipes = sortByClassName(result.recipes);
  result.skills = sortByClassName(result.skills);
  result.worldObjects = sortByClassName(result.worldObjects);
  result.occupancy = result.occupancy.sort((a, b) => a.worldObjectClass.localeCompare(b.worldObjectClass));
  result.roomCategories = result.roomCategories.sort((a, b) => a.name.localeCompare(b.name));
  result.roomTiers = result.roomTiers.sort((a, b) => a.tier - b.tier);
  result.meta.counts = {
    items: result.items.length,
    housing: result.housing.length,
    recipes: result.recipes.length,
    skills: result.skills.length,
    worldObjects: result.worldObjects.length,
    occupancy: result.occupancy.length,
    roomCategories: result.roomCategories.length,
    roomTiers: result.roomTiers.length,
  };
  result.meta.filteredMarketplaceBlueprints = {
    worldObjects: marketplaceBlueprintWorldObjects.size,
    items: marketplaceBlueprintItems.size,
  };

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = await extract(args.modsPath, { ecoPath: args.ecoPath });
  const outPath = path.resolve(args.out);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(data, null, args.pretty ? 2 : 0), "utf8");

  console.log(`Eco data extracted: ${outPath}`);
  console.log(`Files: ${data.meta.fileCount}`);
  console.log(`Items: ${data.meta.counts.items}`);
  console.log(`Housing: ${data.meta.counts.housing}`);
  console.log(`Recipes: ${data.meta.counts.recipes}`);
  console.log(`Skills: ${data.meta.counts.skills}`);
  console.log(`World objects: ${data.meta.counts.worldObjects}`);
  console.log(`Occupancy: ${data.meta.counts.occupancy}`);
  console.log(`Room categories: ${data.meta.counts.roomCategories}`);
  console.log(`Room tiers: ${data.meta.counts.roomTiers}`);
  if (data.housingConfig?.roomCategoryDiminishingReturnRate != null) {
    console.log(`Room duplicate return rate: ${data.housingConfig.roomCategoryDiminishingReturnRate}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

export { extract, parseFile, readMarketplaceBlueprintWorldObjects };
