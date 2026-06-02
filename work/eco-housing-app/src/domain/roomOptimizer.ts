import { createCraftResolver } from "./craftResolver";
import { byName } from "./model";
import { canPlaceOnFloorWhenNoSurface, effectiveFloorArea, floorAreaWhenOnSurface, itemFitsRoomDimensions, itemFootprint, surfaceUnitsProvided, surfaceUnitsRequired } from "./placementRules";
import { compatibleCategoriesForRoom, diminishingMultiplier, estimateEntriesScore, scoreSummary, supportCapPercentForCategory } from "./roomScoring";
import type { EcoModel, HousingItem, ItemClass, OptimizationEntry, OptimizationGroup, OptimizationObjective, RoomConstraints, RoomInput, RoomOptimization } from "./types";

const MIN_NON_OWNED_CREDITED_SCORE = 0.1;
const MAX_ENTRIES_PER_CATEGORY = 8;
const BEAM_WIDTH = 80;
const CANDIDATE_LIMIT = 24;
const DEFAULT_OBJECTIVE: OptimizationObjective = { kind: "maximizeUsefulRoomScore" };
const AUTO_MAX_WIDTH = 24;
const AUTO_MAX_DEPTH = 24;
const AUTO_MAX_HEIGHT = 8;
const MATERIAL_MAX_WIDTH = 16;
const MATERIAL_MAX_DEPTH = 16;
const MATERIAL_MAX_HEIGHT = 6;

interface OptimizationContext {
  model: EcoModel;
  input: RoomInput;
  objective: OptimizationObjective;
  craftResolver: ReturnType<typeof createCraftResolver>;
  orderedCategories: string[];
  generalSupportCategories: string[];
}

interface CategoryPlan {
  entries: OptimizationEntry[];
  score: number;
  constraints: RoomConstraints;
  typeCounts: Map<string, number>;
  itemCounts: Map<ItemClass, number>;
  ownedCount: number;
  stableKey: string;
}

interface RoomPlan {
  groups: OptimizationGroup[];
  constraints: RoomConstraints;
  ownedCount: number;
  stableKey: string;
}

export function roomOptimization(model: EcoModel, input: RoomInput): RoomOptimization {
  if (input.roomType !== "Outdoor" && input.sizeMode === "materials") return optimizeWithinMaterialBudget(model, input);
  const context = buildOptimizationContext(model, input);
  const best = selectBestRoomPlan(context);
  const entries = best.groups.flatMap((group) => group.entries);
  const resolvedSize = resolveRoomSize(input, entries);
  const constraints = resolvedSize ? { ...best.constraints, maxWidth: resolvedSize.width, maxDepth: resolvedSize.depth, maxHeight: resolvedSize.height, maxFloor: resolvedSize.floorArea, maxVolume: resolvedSize.volume } : best.constraints;
  return {
    roomName: input.roomType,
    groups: best.groups,
    score: scoreSummary(model, best.groups, input.tier, input.roomType),
    entries,
    constraints,
    resolvedSize,
  };
}

function optimizeWithinMaterialBudget(model: EcoModel, input: RoomInput): RoomOptimization {
  const budget = Math.max(0, Math.floor(input.materialBudget ?? 0));
  if (budget <= 0) return roomOptimization(model, { ...input, sizeMode: "manual", width: 1, depth: 1, height: 2 });

  const candidate = materialBudgetSizeCandidate(budget);
  if (!candidate) return roomOptimization(model, { ...input, sizeMode: "manual", width: 1, depth: 1, height: 2 });
  const optimization = roomOptimization(model, { ...input, sizeMode: "manual", width: candidate.width, depth: candidate.depth, height: candidate.height });
  optimization.resolvedSize = candidate;
  return optimization;
}

export function buildOptimizationContext(model: EcoModel, input: RoomInput): OptimizationContext {
  const compatible = compatibleCategoriesForRoom(model, input.roomType);
  const room = model.roomCategoryByName.get(input.roomType);
  const primary = room ? [room.name] : [];
  const supports = room?.supportingRoomCategoryNames ?? [];
  const general = model.supportForAnyRoom;
  const orderedCategories = compatible
    ? [...new Set([...primary, ...supports, ...general])].filter((category) => compatible.has(category))
    : [];

  return {
    model,
    input,
    objective: input.objective ?? DEFAULT_OBJECTIVE,
    craftResolver: createCraftResolver(model, input.selectedSkills),
    orderedCategories,
    generalSupportCategories: general,
  };
}

export function optimizerGroups(model: EcoModel, input: RoomInput, constraints?: RoomConstraints): OptimizationGroup[] {
  const optimization = roomOptimization(model, input);
  if (constraints) copyConstraints(optimization.constraints, constraints);
  return optimization.groups;
}

export function selectBestRoomPlan(context: OptimizationContext): RoomPlan {
  let roomPlans: RoomPlan[] = [{ groups: [], constraints: createInitialConstraints(context.input), ownedCount: 0, stableKey: "" }];

  for (const category of context.orderedCategories) {
    const isPrimary = category === context.input.roomType;
    const supportCapPercent = isPrimary ? null : supportCapPercentForCategory(context.model, category, context.input.roomType);
    const role = isPrimary ? "definit la piece" : context.generalSupportCategories.includes(category) ? "support general" : "support";
    const items = candidateItemsForCategory(context, category);
    const nextPlans: RoomPlan[] = [];

    for (const plan of roomPlans) {
      const primaryScore = isPrimary ? 0 : plan.groups.find((group) => group.category === context.input.roomType)?.score ?? 0;
      const supportCap = supportCapPercent == null ? null : primaryScore * supportCapPercent;
      for (const categoryPlan of generateCategoryPlans(context, items, plan.constraints, supportCap)) {
        const group: OptimizationGroup = {
          category,
          role,
          entries: categoryPlan.entries,
          score: categoryPlan.score,
          supportCap,
          supportCapPercent,
        };
        nextPlans.push({
          groups: [...plan.groups, group],
          constraints: categoryPlan.constraints,
          ownedCount: plan.ownedCount + categoryPlan.ownedCount,
          stableKey: [plan.stableKey, categoryPlan.stableKey].filter(Boolean).join("|"),
        });
      }
    }

    roomPlans = keepBestRoomPlans(context, nextPlans);
  }

  return keepBestRoomPlans(context, roomPlans)[0] ?? { groups: [], constraints: createInitialConstraints(context.input), ownedCount: 0, stableKey: "" };
}

export function generateCategoryPlans(
  context: OptimizationContext,
  items: HousingItem[],
  baseConstraints: RoomConstraints,
  maxScore: number | null,
): CategoryPlan[] {
  let beam: CategoryPlan[] = [emptyCategoryPlan(baseConstraints)];
  const completed = new Map<string, CategoryPlan>();

  for (let depth = 0; depth < MAX_ENTRIES_PER_CATEGORY; depth += 1) {
    const next: CategoryPlan[] = [];
    for (const plan of beam) {
      storeBestCategoryPlan(completed, plan);
      const remaining = maxScore == null ? Infinity : maxScore - plan.score;
      if (remaining <= 0.01) continue;

      for (const item of items) {
        const candidate = tryAddItemToCategoryPlan(context, plan, item, remaining);
        if (candidate) next.push(candidate);
      }
    }

    if (!next.length) break;
    beam = keepBestCategoryPlans(context, next, maxScore);
  }

  for (const plan of beam) storeBestCategoryPlan(completed, plan);
  return keepBestCategoryPlans(context, [...completed.values()], maxScore);
}

function candidateItemsForCategory(context: OptimizationContext, category: string) {
  return context.model.housingItems
    .filter((item) => item.category === category)
    .filter((item) => !item.variantOfItemClass)
    .filter((item) => availabilityFilter(item, context))
    .filter((item) => !context.input.disabledItems.has(item.itemClass))
    .sort((a, b) => b.value - a.value || byName(a, b))
    .slice(0, CANDIDATE_LIMIT);
}

function availabilityFilter(item: HousingItem, context: OptimizationContext) {
  const craftable = context.craftResolver.resolve(item.itemClass).craftable;
  if (context.input.availability === "available") return craftable || ownedRemaining(item.itemClass, context.input, createInitialConstraints(context.input)) > 0;
  if (context.input.availability === "locked") return !craftable;
  return true;
}

function tryAddItemToCategoryPlan(
  context: OptimizationContext,
  plan: CategoryPlan,
  item: HousingItem,
  remainingScore: number,
): CategoryPlan | null {
  if (!itemFitsRoomDimensions(item, plan.constraints)) return null;

  const type = item.typeForRoomLimit ?? item.itemClass;
  const propertyWide = item.diminishingMultiplierAcrossFullProperty != null;
  const roomTypeCount = plan.typeCounts.get(type) ?? 0;
  const propertyTypeCount = plan.constraints.propertyTypeCounts.get(type) ?? 0;
  const typeCount = propertyWide ? propertyTypeCount : roomTypeCount;
  const multiplier = propertyWide
    ? (item.diminishingMultiplierAcrossFullProperty ?? 1) ** typeCount
    : diminishingMultiplier(item, typeCount);
  const rawScore = item.value * multiplier;
  if (rawScore <= 0) return null;

  const creditedScore = Math.min(rawScore, remainingScore);
  const ownedAvailable = ownedRemaining(item.itemClass, context.input, plan.constraints) > 0;
  if (!ownedAvailable && creditedScore < MIN_NON_OWNED_CREDITED_SCORE) return null;

  const placement = placementForItem(item, plan.constraints);
  if (!placement) return null;

  const requiredVolume = item.requirements?.requiredRoomVolume ?? 0;
  if ((plan.constraints.usedRequiredVolume + requiredVolume) > plan.constraints.maxVolume) return null;
  if ((plan.constraints.usedFloor + placement.floorArea) > plan.constraints.maxFloor) return null;

  const constraints = cloneConstraints(plan.constraints);
  const fromOwned = markOwnedUsed(item.itemClass, context.input, constraints);
  constraints.usedFloor += placement.floorArea;
  constraints.usedRequiredVolume += requiredVolume;
  constraints.surfaceCapacity += surfaceUnitsProvided(item);
  constraints.usedSurface += placement.surfaceUsed;

  if (propertyWide) constraints.propertyTypeCounts.set(type, typeCount + 1);

  const entry: OptimizationEntry = {
    item,
    type,
    itemCount: (plan.itemCounts.get(item.itemClass) ?? 0) + 1,
    typeCount: typeCount + 1,
    multiplier,
    baseScore: item.value,
    rawScore,
    score: creditedScore,
    capped: creditedScore < rawScore,
    supportCapLoss: Math.max(0, rawScore - creditedScore),
    fromOwned,
    placedOnFloor: placement.placedOnFloor || undefined,
    extraFloorFromSurfaceOverflow: placement.extraFloorFromSurfaceOverflow || undefined,
  };

  const typeCounts = new Map(plan.typeCounts);
  typeCounts.set(type, typeCount + 1);
  const itemCounts = new Map(plan.itemCounts);
  itemCounts.set(item.itemClass, (itemCounts.get(item.itemClass) ?? 0) + 1);
  const entries = [...plan.entries, entry];

  return {
    entries,
    score: plan.score + creditedScore,
    constraints,
    typeCounts,
    itemCounts,
    ownedCount: plan.ownedCount + (fromOwned ? 1 : 0),
    stableKey: entries.map((selected) => selected.item.friendlyName).sort().join(","),
  };
}

function placementForItem(item: HousingItem, constraints: RoomConstraints) {
  const requiredSurface = surfaceUnitsRequired(item);
  if (requiredSurface > 0) {
    const availableSurface = constraints.surfaceCapacity - constraints.usedSurface;
    if (availableSurface >= requiredSurface) {
      return { floorArea: floorAreaWhenOnSurface(item), surfaceUsed: requiredSurface, placedOnFloor: false, extraFloorFromSurfaceOverflow: 0 };
    }
    if (!canPlaceOnFloorWhenNoSurface(item)) return null;
    const floorArea = effectiveFloorArea(item);
    return {
      floorArea,
      surfaceUsed: 0,
      placedOnFloor: true,
      extraFloorFromSurfaceOverflow: Math.max(0, floorArea - floorAreaWhenOnSurface(item)),
    };
  }

  return { floorArea: floorAreaWhenOnSurface(item), surfaceUsed: 0, placedOnFloor: false, extraFloorFromSurfaceOverflow: 0 };
}

function keepBestRoomPlans(context: OptimizationContext, plans: RoomPlan[]) {
  return dedupePlans(plans, roomPlanKey, (a, b) => compareRoomPlans(context, a, b)).slice(0, BEAM_WIDTH);
}

function keepBestCategoryPlans(context: OptimizationContext, plans: CategoryPlan[], maxScore: number | null) {
  return dedupePlans(plans, categoryPlanKey, (a, b) => compareCategoryPlans(context, a, b, maxScore)).slice(0, BEAM_WIDTH);
}

function compareRoomPlans(context: OptimizationContext, a: RoomPlan, b: RoomPlan) {
  if (context.objective.kind === "maximizeUsefulRoomScore") {
    const scoreA = scoreSummary(context.model, a.groups, context.input.tier, context.input.roomType);
    const scoreB = scoreSummary(context.model, b.groups, context.input.tier, context.input.roomType);
    return (
      scoreB.capped - scoreA.capped ||
      scoreB.afterSupportCaps - scoreA.afterSupportCaps ||
      a.groups.flatMap((group) => group.entries).length - b.groups.flatMap((group) => group.entries).length ||
      b.ownedCount - a.ownedCount ||
      a.stableKey.localeCompare(b.stableKey)
    );
  }
  return 0;
}

function compareCategoryPlans(_context: OptimizationContext, a: CategoryPlan, b: CategoryPlan, maxScore: number | null) {
  const scoreDelta = b.score - a.score;
  const capDelta = maxScore == null ? scoreDelta : Math.abs(maxScore - a.score) - Math.abs(maxScore - b.score);
  return (
    (maxScore == null ? scoreDelta : capDelta || scoreDelta) ||
    a.entries.length - b.entries.length ||
    b.ownedCount - a.ownedCount ||
    a.stableKey.localeCompare(b.stableKey)
  );
}

function dedupePlans<T>(plans: T[], keyFn: (plan: T) => string, compare: (a: T, b: T) => number) {
  const bestByKey = new Map<string, T>();
  for (const plan of plans) {
    const key = keyFn(plan);
    const current = bestByKey.get(key);
    if (!current || compare(plan, current) < 0) bestByKey.set(key, plan);
  }
  return [...bestByKey.values()].sort(compare);
}

function roomPlanKey(plan: RoomPlan) {
  return [
    plan.groups.map((group) => `${group.category}:${group.entries.map((entry) => entry.item.itemClass).sort().join(",")}`).join("|"),
    constraintKey(plan.constraints),
  ].join("#");
}

function categoryPlanKey(plan: CategoryPlan) {
  return [plan.entries.map((entry) => entry.item.itemClass).sort().join(","), constraintKey(plan.constraints)].join("#");
}

function constraintKey(constraints: RoomConstraints) {
  return [
    constraints.usedFloor,
    constraints.usedRequiredVolume,
    constraints.surfaceCapacity,
    constraints.usedSurface,
    [...constraints.ownedUsage.entries()].sort().map(([key, value]) => `${key}:${value}`).join(","),
    [...constraints.propertyTypeCounts.entries()].sort().map(([key, value]) => `${key}:${value}`).join(","),
  ].join("/");
}

function storeBestCategoryPlan(plans: Map<string, CategoryPlan>, plan: CategoryPlan) {
  const key = categoryPlanKey(plan);
  const current = plans.get(key);
  if (!current || plan.score > current.score) plans.set(key, plan);
}

function createInitialConstraints(input: RoomInput): RoomConstraints {
  const unlimited = input.roomType === "Outdoor" || input.sizeMode === "auto";
  const maxWidth = unlimited ? Number.POSITIVE_INFINITY : input.width;
  const maxDepth = unlimited ? Number.POSITIVE_INFINITY : input.depth;
  const maxHeight = unlimited ? Number.POSITIVE_INFINITY : input.height;
  const maxFloor = unlimited ? Number.POSITIVE_INFINITY : input.width * input.depth;
  const maxVolume = unlimited ? Number.POSITIVE_INFINITY : input.width * input.depth * input.height;
  return {
    maxWidth,
    maxDepth,
    maxHeight,
    maxFloor,
    maxVolume,
    usedFloor: 0,
    usedRequiredVolume: 0,
    surfaceCapacity: 0,
    usedSurface: 0,
    ownedUsage: new Map(),
    propertyTypeCounts: new Map(),
  };
}

function resolveRoomSize(input: RoomInput, entries: OptimizationEntry[]) {
  if (input.roomType === "Outdoor") return null;
  if (input.sizeMode === "manual" || input.sizeMode === "materials") {
    return {
      width: input.width,
      depth: input.depth,
      height: input.height,
      volume: input.width * input.depth * input.height,
      floorArea: input.width * input.depth,
      materialCount: roomMaterialCount(input.width, input.depth, input.height),
      mode: input.sizeMode ?? "manual",
    };
  }
  return findMinimumRoomSize(entries, "auto");
}

function findMinimumRoomSize(entries: OptimizationEntry[], mode: "auto" | "materials") {
  const requiredFloor = entries.reduce((total, entry) => total + floorAreaWhenOnSurface(entry.item) + (entry.extraFloorFromSurfaceOverflow ?? 0), 0);
  const requiredVolume = entries.reduce((total, entry) => total + (entry.item.requirements?.requiredRoomVolume ?? 0), 0);
  const minDimensions = entries.reduce((limits, entry) => {
    const footprint = itemFootprint(entry.item);
    return {
      width: Math.max(limits.width, footprint.width || 1),
      depth: Math.max(limits.depth, footprint.depth || 1),
      height: Math.max(limits.height, footprint.height || 2),
    };
  }, { width: 1, depth: 1, height: 2 });

  let best: ReturnType<typeof sizeCandidate> | null = null;
  for (let height = minDimensions.height; height <= AUTO_MAX_HEIGHT; height += 1) {
    for (let width = minDimensions.width; width <= AUTO_MAX_WIDTH; width += 1) {
      for (let depth = minDimensions.depth; depth <= AUTO_MAX_DEPTH; depth += 1) {
        const floorArea = width * depth;
        if (floorArea < requiredFloor) continue;
        if (floorArea * height < requiredVolume) continue;
        if (!entries.every((entry) => itemFitsRoomDimensions(entry.item, { maxWidth: width, maxDepth: depth, maxHeight: height }))) continue;
        const candidate = sizeCandidate(width, depth, height, mode);
        if (!best || compareRoomSizes(candidate, best) < 0) best = candidate;
      }
    }
  }

  return best ?? sizeCandidate(minDimensions.width, minDimensions.depth, minDimensions.height, mode);
}

function sizeCandidate(width: number, depth: number, height: number, mode: "auto" | "materials") {
  return {
    width,
    depth,
    height,
    volume: width * depth * height,
    floorArea: width * depth,
    materialCount: roomMaterialCount(width, depth, height),
    mode,
  };
}

function compareRoomSizes(a: ReturnType<typeof sizeCandidate>, b: ReturnType<typeof sizeCandidate>) {
  return a.materialCount - b.materialCount || a.floorArea - b.floorArea || a.volume - b.volume || a.width - b.width || a.depth - b.depth;
}

function roomMaterialCount(width: number, depth: number, height: number) {
  return (2 * width * depth) + (2 * height * (width + depth));
}

function materialBudgetSizeCandidate(budget: number) {
  const candidates = [];
  for (let height = 2; height <= MATERIAL_MAX_HEIGHT; height += 1) {
    for (let width = 1; width <= MATERIAL_MAX_WIDTH; width += 1) {
      for (let depth = width; depth <= MATERIAL_MAX_DEPTH; depth += 1) {
        const candidate = sizeCandidate(width, depth, height, "materials");
        if (candidate.materialCount <= budget) candidates.push(candidate);
      }
    }
  }

  return candidates
    .sort((a, b) => b.volume - a.volume || b.floorArea - a.floorArea || a.materialCount - b.materialCount || Math.abs(a.width - a.depth) - Math.abs(b.width - b.depth))
    .at(0) ?? null;
}

function emptyCategoryPlan(constraints: RoomConstraints): CategoryPlan {
  return {
    entries: [],
    score: 0,
    constraints: cloneConstraints(constraints),
    typeCounts: new Map(),
    itemCounts: new Map(),
    ownedCount: 0,
    stableKey: "",
  };
}

function cloneConstraints(constraints: RoomConstraints): RoomConstraints {
  return {
    ...constraints,
    ownedUsage: new Map(constraints.ownedUsage),
    propertyTypeCounts: new Map(constraints.propertyTypeCounts),
  };
}

function copyConstraints(source: RoomConstraints, target: RoomConstraints) {
  target.maxWidth = source.maxWidth;
  target.maxDepth = source.maxDepth;
  target.maxHeight = source.maxHeight;
  target.maxFloor = source.maxFloor;
  target.maxVolume = source.maxVolume;
  target.usedFloor = source.usedFloor;
  target.usedRequiredVolume = source.usedRequiredVolume;
  target.surfaceCapacity = source.surfaceCapacity;
  target.usedSurface = source.usedSurface;
  target.ownedUsage = new Map(source.ownedUsage);
  target.propertyTypeCounts = new Map(source.propertyTypeCounts);
}

function ownedRemaining(itemClass: ItemClass, input: RoomInput, constraints: RoomConstraints) {
  const used = constraints.ownedUsage.get(itemClass) ?? 0;
  return Math.max(0, (input.ownedItems.get(itemClass) ?? 0) - used);
}

function markOwnedUsed(itemClass: ItemClass, input: RoomInput, constraints: RoomConstraints) {
  if (ownedRemaining(itemClass, input, constraints) <= 0) return false;
  constraints.ownedUsage.set(itemClass, (constraints.ownedUsage.get(itemClass) ?? 0) + 1);
  return true;
}
