import { uniqueRequirements } from "./craftResolver";
import type { CraftRequirement, EcoEconomyData, EcoModel, ItemClass, Recipe, SkillClass } from "./types";

export interface CostSource {
  kind: "owned" | "buy" | "craft" | "unavailable";
  itemClass: ItemClass;
  quantity: number;
  unitCost: number | null;
  totalCost: number | null;
  currency: string | null;
  storeName?: string | null;
  seller?: string | null;
}

export interface CostResolution {
  itemClass: ItemClass;
  quantity: number;
  availableQuantity: number;
  unitCost: number | null;
  totalCost: number | null;
  currency: string | null;
  source: CostSource["kind"];
  sources: CostSource[];
  canBuy: boolean;
  canCraft: boolean;
  missing: CraftRequirement[];
  stockBlocking: boolean;
}

export interface CostResolver {
  resolve(itemClass: ItemClass, quantity?: number): CostResolution;
  cheapestListing(itemClass: ItemClass): CostSource | null;
}

const BASELINE_RESOURCE_TAGS = new Set(["Crop", "NaturalFiber", "Wood"]);

export function createCostResolver(args: {
  model: EcoModel;
  economyData?: EcoEconomyData | null;
  selectedSkills: Set<SkillClass>;
  ownedItems?: Map<ItemClass, number>;
  currency?: string | null;
}): CostResolver {
  const { model, economyData, selectedSkills, ownedItems = new Map(), currency = null } = args;
  const listingsByItem = buildListingsByItem(economyData, currency);
  const itemClassesByTag = buildItemClassesByTag(model);
  const cache = new Map<string, CostResolution>();

  function resolve(itemClass: ItemClass, quantity = 1, stack: string[] = []): CostResolution {
    const cacheKey = `${itemClass}:${quantity}:${stack.join(">")}`;
    const cached = cache.get(cacheKey);
    if (cached) return cloneResolution(cached);
    if (stack.includes(itemClass)) return unavailable(itemClass, quantity, []);

    const ownedQuantity = ownedItems.get(itemClass) ?? 0;
    const ownedUsed = Math.min(quantity, ownedQuantity);
    const remaining = quantity - ownedUsed;
    const sources: CostSource[] = [];
    if (ownedUsed > 0) sources.push({ kind: "owned", itemClass, quantity: ownedUsed, unitCost: 0, totalCost: 0, currency: null });

    if (remaining <= 0) return storeResult({ itemClass, quantity, availableQuantity: ownedUsed, sources, missing: [] });

    const buy = resolveBuy(itemClass, remaining);
    const craft = resolveCraft(itemClass, remaining, [...stack, itemClass]);
    const best = chooseBest(buy, craft);
    sources.push(...best.sources);
    const result = storeResult({
      itemClass,
      quantity,
      availableQuantity: ownedUsed + best.availableQuantity,
      sources,
      missing: best.missing,
    });
    cache.set(cacheKey, result);
    return cloneResolution(result);
  }

  function resolveBuy(itemClass: ItemClass, quantity: number): CostResolution {
    const listings = listingsByItem.get(itemClass) ?? [];
    let remaining = quantity;
    const sources: CostSource[] = [];
    for (const listing of listings) {
      if (remaining <= 0) break;
      const used = Math.min(remaining, listing.quantity);
      sources.push({ ...listing, quantity: used, totalCost: used * (listing.unitCost ?? 0) });
      remaining -= used;
    }
    return storeResult({ itemClass, quantity, availableQuantity: quantity - remaining, sources, missing: [] });
  }

  function resolveCraft(itemClass: ItemClass, quantity: number, stack: string[]): CostResolution {
    const recipes = model.recipesByProduct.get(itemClass) ?? [];
    if (!recipes.length) return unavailable(itemClass, quantity, []);

    const attempts = recipes.map((recipe) => resolveRecipeCost(recipe, itemClass, quantity, stack));
    const craftable = attempts.filter((attempt) => attempt.availableQuantity >= quantity);
    if (craftable.length) return craftable.sort(compareCost)[0]!;
    return attempts.sort((a, b) => b.availableQuantity - a.availableQuantity || compareCost(a, b))[0] ?? unavailable(itemClass, quantity, []);
  }

  function resolveRecipeCost(recipe: Recipe, itemClass: ItemClass, quantity: number, stack: string[]): CostResolution {
    const missing: CraftRequirement[] = [];
    const sources: CostSource[] = [];
    addRecipeSkillRequirement(recipe, missing);
    if (missing.length) return storeResult({ itemClass, quantity, availableQuantity: 0, sources, missing });
    let availableQuantity = quantity;

    for (const ingredient of recipe.ingredients ?? []) {
      const ingredientQuantity = Math.max(1, Math.ceil((ingredient.quantity ?? 1) * quantity));
      const resolved = ingredient.itemClass
        ? resolve(ingredient.itemClass, ingredientQuantity, stack)
        : ingredient.tag
          ? resolveIngredientTag(ingredient.tag, ingredientQuantity, stack)
          : null;
      if (!resolved) continue;
      sources.push(...resolved.sources);
      missing.push(...resolved.missing);
      if (resolved.availableQuantity < ingredientQuantity) availableQuantity = 0;
    }

    if (availableQuantity <= 0) return storeResult({ itemClass, quantity, availableQuantity: 0, sources, missing });
    sources.push({ kind: "craft", itemClass, quantity, unitCost: null, totalCost: null, currency: null });
    return storeResult({ itemClass, quantity, availableQuantity: quantity, sources, missing });
  }

  function addRecipeSkillRequirement(recipe: Recipe, missing: CraftRequirement[]) {
    const skillClass = recipe.requiredSkillClass;
    if (!skillClass || skillClass === "Skill") return;
    const skill = model.skillsByClass.get(skillClass);
    if (skill?.isProfession) return;
    if (!selectedSkills.has(skillClass)) missing.push({ skillClass, level: recipe.requiredSkillLevel ?? null });
  }

  function resolveIngredientTag(tag: string, quantity: number, stack: string[]) {
    if (BASELINE_RESOURCE_TAGS.has(tag)) {
      return storeResult({
        itemClass: tag,
        quantity,
        availableQuantity: quantity,
        sources: [{ kind: "craft", itemClass: tag, quantity, unitCost: 0, totalCost: 0, currency: null }],
        missing: [],
      });
    }
    const candidates = itemClassesByTag.get(tag) ?? [];
    if (!candidates.length) return unavailable(tag, quantity, []);
    const attempts = candidates.map((candidate) => resolve(candidate, quantity, stack));
    return attempts.sort((a, b) => (b.availableQuantity >= quantity ? 1 : 0) - (a.availableQuantity >= quantity ? 1 : 0) || compareCost(a, b))[0] ?? unavailable(tag, quantity, []);
  }

  function cheapestListing(itemClass: ItemClass) {
    return listingsByItem.get(itemClass)?.[0] ?? null;
  }

  return { resolve: (itemClass, quantity = 1) => resolve(itemClass, quantity), cheapestListing };
}

function buildListingsByItem(economyData?: EcoEconomyData | null, currency?: string | null) {
  const byItem = new Map<ItemClass, CostSource[]>();
  for (const listing of economyData?.listings ?? []) {
    if (currency && listing.currency !== currency) continue;
    const entries = byItem.get(listing.itemClass) ?? [];
    entries.push({
      kind: "buy",
      itemClass: listing.itemClass,
      quantity: listing.quantity,
      unitCost: listing.price,
      totalCost: listing.price * listing.quantity,
      currency: listing.currency,
      storeName: listing.storeName,
      seller: listing.seller,
    });
    byItem.set(listing.itemClass, entries);
  }
  for (const entries of byItem.values()) entries.sort((a, b) => (a.unitCost ?? Infinity) - (b.unitCost ?? Infinity));
  return byItem;
}

function buildItemClassesByTag(model: EcoModel) {
  const byTag = new Map<string, Set<ItemClass>>();
  const add = (tag: string, itemClass: ItemClass) => {
    const values = byTag.get(tag) ?? new Set<ItemClass>();
    values.add(itemClass);
    byTag.set(tag, values);
  };
  for (const item of model.items ?? []) for (const tag of item.tags ?? []) add(tag, item.className);
  for (const recipe of model.recipes ?? []) {
    for (const product of recipe.products ?? []) {
      if (product.itemClass?.endsWith("Item")) add(product.itemClass.slice(0, -"Item".length), product.itemClass);
    }
  }
  return new Map([...byTag.entries()].map(([tag, values]) => [tag, [...values].sort()]));
}

function chooseBest(a: CostResolution, b: CostResolution) {
  if (a.availableQuantity >= a.quantity && b.availableQuantity < b.quantity) return a;
  if (b.availableQuantity >= b.quantity && a.availableQuantity < a.quantity) return b;
  return compareCost(a, b) <= 0 ? a : b;
}

function compareCost(a: CostResolution, b: CostResolution) {
  return (a.totalCost ?? Infinity) - (b.totalCost ?? Infinity) || b.availableQuantity - a.availableQuantity;
}

function unavailable(itemClass: ItemClass, quantity: number, missing: CraftRequirement[]): CostResolution {
  return storeResult({ itemClass, quantity, availableQuantity: 0, sources: [{ kind: "unavailable", itemClass, quantity, unitCost: null, totalCost: null, currency: null }], missing });
}

function storeResult(args: { itemClass: ItemClass; quantity: number; availableQuantity: number; sources: CostSource[]; missing: CraftRequirement[] }): CostResolution {
  const paidSources = args.sources.filter((source) => source.totalCost != null && source.totalCost > 0);
  const totalCost = paidSources.length ? paidSources.reduce((total, source) => total + (source.totalCost ?? 0), 0) : args.availableQuantity >= args.quantity ? 0 : null;
  const currency = paidSources.find((source) => source.currency)?.currency ?? null;
  const source = args.sources.some((entry) => entry.kind === "buy")
    ? "buy"
    : args.sources.some((entry) => entry.kind === "craft")
      ? "craft"
      : args.sources.some((entry) => entry.kind === "owned")
        ? "owned"
        : "unavailable";
  return {
    itemClass: args.itemClass,
    quantity: args.quantity,
    availableQuantity: args.availableQuantity,
    unitCost: totalCost != null && args.quantity > 0 ? totalCost / args.quantity : null,
    totalCost,
    currency,
    source,
    sources: args.sources,
    canBuy: args.sources.some((entry) => entry.kind === "buy"),
    canCraft: args.sources.some((entry) => entry.kind === "craft"),
    missing: uniqueRequirements(args.missing),
    stockBlocking: args.availableQuantity < args.quantity,
  };
}

function cloneResolution(value: CostResolution): CostResolution {
  return { ...value, sources: value.sources.map((source) => ({ ...source })), missing: value.missing.map((entry) => ({ ...entry })) };
}
