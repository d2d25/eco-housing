import type { CraftRequirement, CraftResolution, EcoModel, ItemClass, Recipe, SkillClass, WorldObjectClass } from "./types";

const ALWAYS_AVAILABLE_SKILLS = new Set(["SurvivalistSkill", "SelfImprovementSkill"]);
const BASELINE_STATION_OBJECTS = new Set<WorldObjectClass>(["CampsiteObject", "WorkbenchObject"]);
const BASELINE_RESOURCE_TAGS = new Set(["Crop", "NaturalFiber"]);

export interface CraftResolver {
  resolve(itemClass: ItemClass, mode?: "full" | "ingredient" | "station"): CraftResolution;
}

export function createCraftResolver(model: EcoModel, selectedSkills: Set<SkillClass>): CraftResolver {
  const cache = new Map<string, CraftResolution>();

  function resolve(itemClass: ItemClass, mode: "full" | "ingredient" | "station" = "full", stack: string[] = []): CraftResolution {
    if (stack.includes(itemClass)) return { craftable: true, missing: [], required: [] };
    const cacheKey = `${mode}:${itemClass}:${[...selectedSkills].sort().join(",")}`;
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
      if (!ingredient.itemClass) continue;
      mergeResolution(resolve(ingredient.itemClass, "ingredient", stack), missing, required);
    }

    return { craftable: missing.length === 0, missing: uniqueRequirements(missing), required: uniqueRequirements(required) };
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

  return { resolve };
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
