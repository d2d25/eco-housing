import type { EcoData, EcoModel, HousingItem, RoomCategory } from "./types";

const EXCLUDED_ITEM_CLASSES = new Set(["EckoStatueItem"]);

export function byName(a: { friendlyName?: string; name?: string }, b: { friendlyName?: string; name?: string }) {
  return (a.friendlyName ?? a.name ?? "").localeCompare(b.friendlyName ?? b.name ?? "");
}

export function buildModel(data: EcoData): EcoModel {
  const skillsByClass = new Map(data.skills.map((skill) => [skill.className, skill]));
  const itemByClass = new Map((data.items ?? []).map((item) => [item.className, item]));
  const recipesByProduct = new Map<string, typeof data.recipes>();
  const itemByWorldObject = new Map<string, string>();
  const occupancyByWorldObject = new Map((data.occupancy ?? []).map((entry) => [entry.worldObjectClass, entry]));
  const requirementsByWorldObject = new Map<string, EcoModel["worldObjects"][number]>();
  const roomCategories: RoomCategory[] = data.roomCategories?.length
    ? data.roomCategories
    : [...new Set(data.housing.map((item) => item.category).filter(Boolean))].map((name) => ({ name, canBeRoomCategory: true }));
  const supportForAnyRoom = roomCategories.filter((room) => room.supportForAnyRoomType).map((room) => room.name);

  for (const item of data.items ?? []) {
    if (item.worldObjectClass) itemByWorldObject.set(item.worldObjectClass, item.className);
  }

  for (const entry of data.worldObjects ?? []) {
    const current = requirementsByWorldObject.get(entry.className);
    requirementsByWorldObject.set(entry.className, current ? mergeWorldObjectRequirements(current, entry) : entry);
  }

  for (const recipe of data.recipes ?? []) {
    for (const product of recipe.products ?? []) {
      if (!product.itemClass) continue;
      if (!recipesByProduct.has(product.itemClass)) recipesByProduct.set(product.itemClass, []);
      recipesByProduct.get(product.itemClass)!.push(recipe);
    }
  }

  const housingItems: HousingItem[] = data.housing
    .filter((housing) => !EXCLUDED_ITEM_CLASSES.has(housing.itemClass))
    .filter((housing) => !housing.hiddenCategory && !housing.notInBrowser)
    .filter((housing) => housing.category !== "Industrial")
    .filter((housing) => Number.isFinite(housing.value) && housing.value > 0)
    .map((housing) => {
      const recipes = recipesByProduct.get(housing.itemClass) ?? [];
      const directSkillClasses = [...new Set(recipes.map((recipe) => recipe.requiredSkillClass).filter(Boolean) as string[])];
      const skills = directSkillClasses.map((className) => skillsByClass.get(className) ?? { className, friendlyName: className });
      const minSkillLevel = recipes.reduce<number | null>((best, recipe) => {
        if (!recipe.requiredSkillLevel) return best;
        return best == null ? recipe.requiredSkillLevel : Math.min(best, recipe.requiredSkillLevel);
      }, null);
      const requirements = housing.worldObjectClass ? requirementsByWorldObject.get(housing.worldObjectClass) ?? null : null;

      return {
        ...housing,
        tags: [...new Set([...(housing.tags ?? []), ...(requirements?.tags ?? [])])],
        recipes,
        skills,
        skillClasses: directSkillClasses,
        minSkillLevel,
        occupancy: housing.worldObjectClass ? occupancyByWorldObject.get(housing.worldObjectClass) ?? null : null,
        requirements,
        craftableWithoutSkill: recipes.length > 0 && directSkillClasses.length === 0,
      };
    });
  const housingByClass = new Map(housingItems.map((item) => [item.itemClass, item]));
  const equivalenceGroupByKey = new Map((data.housingEquivalenceGroups ?? []).map((group) => [group.key, group]));
  const equivalenceGroupByItemClass = new Map<string, NonNullable<typeof data.housingEquivalenceGroups>[number]>();
  for (const group of data.housingEquivalenceGroups ?? []) {
    for (const itemClass of group.itemClasses) equivalenceGroupByItemClass.set(itemClass, group);
  }
  const variantItemsByBase = new Map<string, HousingItem[]>();
  const equivalentItemsByBase = new Map<string, HousingItem[]>();
  for (const item of housingItems) {
    if (!item.variantGroupKey || item.variantOfItemClass) continue;
    const variants = (item.variantItemClasses ?? [])
      .map((itemClass) => housingByClass.get(itemClass))
      .filter((variant): variant is HousingItem => Boolean(variant));
    if (variants.length > 1) variantItemsByBase.set(item.itemClass, variants);
  }
  for (const item of housingItems) {
    if (!item.equivalenceGroupKey || item.variantOfItemClass) continue;
    const equivalents = (item.equivalentItemClasses ?? [])
      .map((itemClass) => housingByClass.get(itemClass))
      .filter((equivalent): equivalent is HousingItem => Boolean(equivalent))
      .filter((equivalent) => !equivalent.variantOfItemClass);
    if (equivalents.length > 1) equivalentItemsByBase.set(item.itemClass, equivalents);
  }

  return {
    ...data,
    housingItems,
    skills: [...data.skills].sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || byName(a, b)),
    roomCategories,
    roomCategoryByName: new Map(roomCategories.map((room) => [room.name, room])),
    supportForAnyRoom,
    skillsByClass,
    itemByClass,
    recipesByProduct,
    itemByWorldObject,
    occupancyByWorldObject,
    requirementsByWorldObject,
    variantItemsByBase,
    equivalentItemsByBase,
    equivalenceGroupByKey,
    equivalenceGroupByItemClass,
  };
}

function mergeWorldObjectRequirements(
  current: EcoModel["worldObjects"][number],
  next: EcoModel["worldObjects"][number],
): EcoModel["worldObjects"][number] {
  return {
    ...current,
    ...next,
    displayName: next.displayName ?? current.displayName,
    representedItemClass: next.representedItemClass ?? current.representedItemClass,
    categories: [...new Set([...(current.categories ?? []), ...(next.categories ?? [])])],
    tags: [...new Set([...(current.tags ?? []), ...(next.tags ?? [])])],
    attachmentDirections: [...new Set([...(current.attachmentDirections ?? []), ...(next.attachmentDirections ?? [])])],
    requireRoomContainment: Boolean(current.requireRoomContainment || next.requireRoomContainment),
    requiredRoomVolume: next.requiredRoomVolume ?? current.requiredRoomVolume,
    requiredRoomMaterialTier: next.requiredRoomMaterialTier ?? current.requiredRoomMaterialTier,
    requiresOccupancy: Boolean(current.requiresOccupancy || next.requiresOccupancy),
    requiresRoomRequirements: Boolean(current.requiresRoomRequirements || next.requiresRoomRequirements),
    operationalRequirements: next.operationalRequirements ?? current.operationalRequirements ?? null,
  };
}
