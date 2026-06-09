import type { CraftRequirement, CraftResolution, EcoModel, ItemClass, Recipe, SkillClass, WorldObjectClass } from "./types";

const ALWAYS_AVAILABLE_SKILLS = new Set(["SurvivalistSkill", "SelfImprovementSkill"]);
const BASELINE_STATION_OBJECTS = new Set<WorldObjectClass>(["CampsiteObject", "WorkbenchObject"]);
const BASELINE_RESOURCE_TAGS = new Set(["Crop", "NaturalFiber", "Wood"]);

export interface CraftResolver {
  resolve(itemClass: ItemClass, mode?: "full" | "ingredient" | "station"): CraftResolution;
}

export interface CraftAvailabilityIndex {
  resolver: CraftResolver;
  byItemClass: Map<ItemClass, CraftResolution>;
  resolve(itemClass: ItemClass, mode?: "full" | "ingredient" | "station"): CraftResolution;
  isCraftable(itemClass: ItemClass): boolean;
}

export function createCraftResolver(model: EcoModel, selectedSkills: Set<SkillClass>): CraftResolver {
  const cache = new Map<string, CraftResolution>();
  const itemClassesByTag = buildItemClassesByTag();

  function resolve(itemClass: ItemClass, mode: "full" | "ingredient" | "station" = "full", stack: string[] = []): CraftResolution {
    if (stack.includes(itemClass)) return { craftable: true, missing: [], required: [] };
    const cacheKey = `${mode}:${itemClass}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    if (mode === "ingredient" && isBaselineResource(itemClass)) {
      const raw = { craftable: true, missing: [], required: [] };
      cache.set(cacheKey, raw);
      return raw;
    }

    const recipes = model.recipesByProduct.get(itemClass) ?? [];
    if (!recipes.length) {
      const raw = { craftable: true, missing: [], required: [] };
      cache.set(cacheKey, raw);
      return raw;
    }

    const attempts = recipes.map((recipe) => (
      mode === "ingredient"
        ? resolveIngredientRecipe(recipe)
        : mode === "station"
          ? resolveStationRecipe(recipe)
          : resolveRecipe(recipe, [...stack, itemClass])
    ));
    const craftable = attempts.find((attempt) => attempt.craftable);
    const result = craftable ?? attempts.sort((a, b) => a.missing.length - b.missing.length)[0] ?? { craftable: false, missing: [], required: [] };
    cache.set(cacheKey, result);
    return result;
  }

  function isBaselineResource(itemClass: ItemClass) {
    const item = model.itemByClass.get(itemClass);
    return Boolean(item?.tags?.some((tag) => BASELINE_RESOURCE_TAGS.has(tag)));
  }

  function resolveIngredientRecipe(recipe: Recipe): CraftResolution {
    const missing: CraftRequirement[] = [];
    const required: CraftRequirement[] = [];
    addSkillRequirement(recipe.requiredSkillClass, recipe.requiredSkillLevel, missing, required);
    return { craftable: missing.length === 0, missing: uniqueRequirements(missing), required: uniqueRequirements(required) };
  }

  function resolveStationRecipe(recipe: Recipe): CraftResolution {
    const missing: CraftRequirement[] = [];
    const required: CraftRequirement[] = [];
    addSkillRequirement(recipe.requiredSkillClass, recipe.requiredSkillLevel, missing, required);
    return { craftable: missing.length === 0, missing: uniqueRequirements(missing), required: uniqueRequirements(required) };
  }

  function resolveRecipe(recipe: Recipe, stack: string[]): CraftResolution {
    const missing: CraftRequirement[] = [];
    const required: CraftRequirement[] = [];
    addSkillRequirement(recipe.requiredSkillClass, recipe.requiredSkillLevel, missing, required);

    const tableItemClass = recipe.craftingTableClass ? model.itemByWorldObject.get(recipe.craftingTableClass) : null;
    if (tableItemClass && recipe.craftingTableClass && !BASELINE_STATION_OBJECTS.has(recipe.craftingTableClass)) {
      mergeResolution(resolve(tableItemClass, "station", stack), missing, required);
    }

    for (const ingredient of recipe.ingredients ?? []) {
      if (ingredient.itemClass) mergeResolution(resolve(ingredient.itemClass, "ingredient", stack), missing, required);
      else if (ingredient.tag) mergeResolution(resolveIngredientTag(ingredient.tag, stack), missing, required);
    }

    return { craftable: missing.length === 0, missing: uniqueRequirements(missing), required: uniqueRequirements(required) };
  }

  function resolveIngredientTag(tag: string, stack: string[]): CraftResolution {
    if (BASELINE_RESOURCE_TAGS.has(tag)) return { craftable: true, missing: [], required: [] };
    const candidates = itemClassesByTag.get(tag) ?? [];
    if (!candidates.length) return { craftable: true, missing: [], required: [] };
    const attempts = candidates.map((itemClass) => resolve(itemClass, "ingredient", stack));
    const craftable = attempts.find((attempt) => attempt.craftable);
    return craftable ?? attempts.sort((a, b) => a.missing.length - b.missing.length)[0] ?? { craftable: true, missing: [], required: [] };
  }

  function addSkillRequirement(skillClass: SkillClass | null | undefined, level: number | null | undefined, missing: CraftRequirement[], required: CraftRequirement[]) {
    if (!skillClass || skillClass === "Skill") return;
    if (ALWAYS_AVAILABLE_SKILLS.has(skillClass) || isProfessionCategory(skillClass)) return;
    const requirement = { skillClass, level: level ?? null };
    required.push(requirement);
    if (!selectedSkills.has(skillClass)) missing.push(requirement);
  }

  function isProfessionCategory(skillClass: SkillClass) {
    const skill = model.skillsByClass.get(skillClass);
    return Boolean(skill?.isProfession);
  }

  function buildItemClassesByTag() {
    const byTag = new Map<string, Set<ItemClass>>();
    const add = (tag: string, itemClass: ItemClass) => {
      const values = byTag.get(tag) ?? new Set<ItemClass>();
      values.add(itemClass);
      byTag.set(tag, values);
    };

    for (const item of model.items ?? []) {
      for (const tag of item.tags ?? []) add(tag, item.className);
    }

    for (const recipe of model.recipes ?? []) {
      for (const product of recipe.products ?? []) {
        if (!product.itemClass?.endsWith("Item")) continue;
        add(product.itemClass.slice(0, -"Item".length), product.itemClass);
      }
    }

    return new Map([...byTag.entries()].map(([tag, values]) => [tag, [...values].sort()]));
  }

  return { resolve };
}

export function createCraftAvailabilityIndex(model: EcoModel, selectedSkills: Set<SkillClass>): CraftAvailabilityIndex {
  const resolver = createCraftResolver(model, selectedSkills);
  const byItemClass = new Map<ItemClass, CraftResolution>();

  for (const item of model.housingItems) {
    byItemClass.set(item.itemClass, resolver.resolve(item.itemClass));
  }

  return {
    resolver,
    byItemClass,
    resolve(itemClass, mode = "full") {
      if (mode === "full") {
        const cached = byItemClass.get(itemClass);
        if (cached) return cached;
        const resolved = resolver.resolve(itemClass);
        byItemClass.set(itemClass, resolved);
        return resolved;
      }
      return resolver.resolve(itemClass, mode);
    },
    isCraftable(itemClass) {
      return this.resolve(itemClass).craftable;
    },
  };
}

export function mergeResolution(resolution: CraftResolution, missing: CraftRequirement[], required: CraftRequirement[]) {
  missing.push(...resolution.missing);
  required.push(...resolution.required);
}

export function uniqueRequirements(requirements: CraftRequirement[]) {
  const bySkill = new Map<SkillClass, CraftRequirement>();
  for (const requirement of requirements) {
    const current = bySkill.get(requirement.skillClass);
    if (!current || (requirement.level ?? 0) > (current.level ?? 0)) bySkill.set(requirement.skillClass, requirement);
  }
  return [...bySkill.values()].sort((a, b) => a.skillClass.localeCompare(b.skillClass));
}

export function formatRequirement(requirement: CraftRequirement, model: EcoModel) {
  const skill = model.skillsByClass.get(requirement.skillClass);
  return `${skill?.friendlyName ?? requirement.skillClass}${requirement.level ? ` ${requirement.level}` : ""}`;
}
