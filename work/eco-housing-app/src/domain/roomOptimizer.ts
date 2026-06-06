import { createCraftAvailabilityIndex } from "./craftResolver";
import { byName } from "./model";
import { floorAreaWhenOnSurface, itemFootprint } from "./placementRules";
import { compatibleCategoriesForRoom, diminishingMultiplier, estimateEntriesScore, scoreSummary, supportCapPercentForCategory } from "./roomScoring";
import type { EcoModel, HousingItem, ItemClass, ItemOptimizationProfile, OptimizationEntry, OptimizationGroup, OptimizationObjective, RoomConstraints, RoomInput, RoomOptimization, RoomOptimizationRequest, RoomOptimizationResult, RoomSolver } from "./types";

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
const RESULT_CACHE_LIMIT = 50;
const optimizationCacheByModel = new WeakMap<EcoModel, Map<string, RoomOptimizationResult>>();

export function clearRoomOptimizationCache(model?: EcoModel) {
  if (model) {
    optimizationCacheByModel.delete(model);
    return;
  }
}

interface OptimizationContext {
  model: EcoModel;
  input: RoomInput;
  objective: OptimizationObjective;
  craftAvailability: ReturnType<typeof createCraftAvailabilityIndex>;
  orderedCategories: string[];
  generalSupportCategories: string[];
  duplicateScoreCache: Map<ItemClass, number[]>;
}

interface CategoryPlan {
  entries: OptimizationEntry[];
  score: number;
  constraints: RoomConstraints;
  typeCounts: Map<string, number>;
  itemCounts: Map<ItemClass, number>;
  ownedCount: number;
  stableKey: string;
  startIndex: number;
}

interface RoomPlan {
  groups: OptimizationGroup[];
  constraints: RoomConstraints;
  ownedCount: number;
  stableKey: string;
  cappedScore: number;
  afterSupportCaps: number;
  entryCount: number;
}

export class BrowserBranchAndBoundSolver implements RoomSolver {
  solve(model: EcoModel, request: RoomOptimizationRequest): RoomOptimizationResult {
    return optimizeRoom(model, request);
  }
}

export function roomOptimization(model: EcoModel, input: RoomInput): RoomOptimization {
  return optimizeRoom(model, input);
}

export function optimizeRoom(model: EcoModel, input: RoomOptimizationRequest): RoomOptimizationResult {
  const cached = getCachedOptimization(model, input);
  if (cached) return cached;
  if (input.roomType !== "Outdoor" && input.sizeMode === "materials") return optimizeWithinMaterialBudget(model, input);
  const context = buildOptimizationContext(model, input);
  const best = selectBestRoomPlan(context);
  const surfaceNormalized = normalizeSurfacePlacement(model, best.groups, best.constraints);
  const entries = surfaceNormalized.groups.flatMap((group) => group.entries);
  const resolvedSize = resolveRoomSize(model, input, entries);
  const constraints = resolvedSize ? { ...surfaceNormalized.constraints, maxWidth: resolvedSize.width, maxDepth: resolvedSize.depth, maxHeight: resolvedSize.height, maxFloor: resolvedSize.floorArea, maxVolume: resolvedSize.volume } : surfaceNormalized.constraints;
  const result = {
    roomName: input.roomType,
    groups: surfaceNormalized.groups,
    score: scoreSummary(model, surfaceNormalized.groups, input.tier, input.roomType),
    entries,
    constraints,
    resolvedSize,
  };
  setCachedOptimization(model, input, result);
  return result;
}

function normalizeSurfacePlacement(model: EcoModel, groups: OptimizationGroup[], constraints: RoomConstraints) {
  const indexedEntries = groups.flatMap((group, groupIndex) => group.entries.map((entry, entryIndex) => ({ groupIndex, entryIndex, entry })));
  const surfaceCapacity = indexedEntries.reduce((total, { entry }) => total + profileFor(model, entry.item).surfaceProvided, 0);
  const assignedToSurface = new Set<string>();
  let usedSurface = 0;

  const consumers = indexedEntries
    .filter(({ entry }) => profileFor(model, entry.item).surfaceRequired > 0)
    .sort((a, b) => Number(profileFor(model, a.entry.item).canPlaceOnFloorWhenNoSurface) - Number(profileFor(model, b.entry.item).canPlaceOnFloorWhenNoSurface));

  for (const { groupIndex, entryIndex, entry } of consumers) {
    const required = profileFor(model, entry.item).surfaceRequired;
    if (usedSurface + required > surfaceCapacity) continue;
    assignedToSurface.add(`${groupIndex}:${entryIndex}`);
    usedSurface += required;
  }

  let usedFloor = 0;
  const normalizedGroups = groups.map((group, groupIndex) => ({
    ...group,
    entries: group.entries.map((entry, entryIndex) => {
      const profile = profileFor(model, entry.item);
      const required = profile.surfaceRequired;
      const usesSurface = required > 0 && assignedToSurface.has(`${groupIndex}:${entryIndex}`);
      const floorArea = usesSurface ? profile.floorAreaWhenOnSurface : profile.effectiveFloorArea;
      usedFloor += floorArea;
      return {
        ...entry,
        placedOnFloor: required > 0 && !usesSurface && profile.canPlaceOnFloorWhenNoSurface || undefined,
        extraFloorFromSurfaceOverflow: Math.max(0, floorArea - profile.floorAreaWhenOnSurface) || undefined,
      };
    }),
  }));

  return {
    groups: normalizedGroups,
    constraints: {
      ...constraints,
      usedFloor,
      surfaceCapacity,
      usedSurface,
    },
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
    craftAvailability: createCraftAvailabilityIndex(model, input.selectedSkills),
    orderedCategories,
    generalSupportCategories: general,
    duplicateScoreCache: new Map(),
  };
}

export function optimizerGroups(model: EcoModel, input: RoomInput, constraints?: RoomConstraints): OptimizationGroup[] {
  const optimization = roomOptimization(model, input);
  if (constraints) copyConstraints(optimization.constraints, constraints);
  return optimization.groups;
}

export function selectBestRoomPlan(context: OptimizationContext): RoomPlan {
  let roomPlans: RoomPlan[] = [emptyRoomPlan(context.input)];

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
        const groups = [...plan.groups, group];
        const summary = scoreSummary(context.model, groups, context.input.tier, context.input.roomType);
        nextPlans.push({
          groups,
          constraints: categoryPlan.constraints,
          ownedCount: plan.ownedCount + categoryPlan.ownedCount,
          stableKey: [plan.stableKey, categoryPlan.stableKey].filter(Boolean).join("|"),
          cappedScore: summary.capped,
          afterSupportCaps: summary.afterSupportCaps,
          entryCount: plan.entryCount + categoryPlan.entries.length,
        });
      }
    }

    roomPlans = keepBestRoomPlans(context, nextPlans);
  }

  return keepBestRoomPlans(context, roomPlans)[0] ?? emptyRoomPlan(context.input);
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
      if (maxScore == null && completed.size >= BEAM_WIDTH) {
        const worstKeptScore = worstCategoryScore(completed);
        const upperBound = plan.score + optimisticRemainingCategoryScore(context, items, plan.startIndex, MAX_ENTRIES_PER_CATEGORY - depth);
        if (upperBound < worstKeptScore - 0.01) continue;
      }

      for (let itemIndex = plan.startIndex; itemIndex < items.length; itemIndex += 1) {
        const item = items[itemIndex]!;
        const candidate = tryAddItemToCategoryPlan(context, plan, item, remaining, itemIndex);
        if (candidate) next.push(candidate);
      }
    }

    if (!next.length) break;
    beam = keepBestCategoryPlans(context, next, maxScore);
  }

  for (const plan of beam) storeBestCategoryPlan(completed, plan);
  return keepBestCategoryPlans(context, [...completed.values()], maxScore);
}

function optimisticRemainingCategoryScore(context: OptimizationContext, items: HousingItem[], startIndex: number, remainingEntries: number) {
  if (remainingEntries <= 0) return 0;
  const scores: number[] = [];
  for (let itemIndex = startIndex; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex]!;
    scores.push(...cachedDuplicateScoreProfile(context, item).slice(0, remainingEntries));
  }
  return scores.sort((a, b) => b - a).slice(0, remainingEntries).reduce((total, score) => total + score, 0);
}

function worstCategoryScore(plans: Map<string, CategoryPlan>) {
  let worst = Number.POSITIVE_INFINITY;
  for (const plan of plans.values()) worst = Math.min(worst, plan.score);
  return Number.isFinite(worst) ? worst : 0;
}

function candidateItemsForCategory(context: OptimizationContext, category: string) {
  const items = (context.model.baseHousingItemsByCategory.get(category) ?? [])
    .filter((item) => availabilityFilter(item, context))
    .filter((item) => !context.input.disabledItems.has(item.itemClass))
    .sort((a, b) => compareCandidateItems(context.model, a, b));
  return dedupeEquivalentCandidates(context, items).slice(0, CANDIDATE_LIMIT);
}

function dedupeEquivalentCandidates(context: OptimizationContext, items: HousingItem[]) {
  const bestByEquivalence = new Map<string, HousingItem>();
  for (const item of items) {
    const key = item.equivalenceGroupKey ?? item.itemClass;
    const current = bestByEquivalence.get(key);
    if (!current || compareEquivalentRepresentative(context, item, current) < 0) {
      bestByEquivalence.set(key, item);
    }
  }
  return [...bestByEquivalence.values()].sort((a, b) => compareCandidateItems(context.model, a, b));
}

function compareCandidateItems(model: EcoModel, a: HousingItem, b: HousingItem) {
  const profileA = profileFor(model, a);
  const profileB = profileFor(model, b);
  return (
    profileB.surfaceProvided - profileA.surfaceProvided ||
    profileA.surfaceRequired - profileB.surfaceRequired ||
    b.value - a.value ||
    byName(a, b)
  );
}

function compareEquivalentRepresentative(context: OptimizationContext, a: HousingItem, b: HousingItem) {
  const ownedA = (context.input.ownedItems.get(a.itemClass) ?? 0) > 0;
  const ownedB = (context.input.ownedItems.get(b.itemClass) ?? 0) > 0;
  const craftableA = context.craftAvailability.isCraftable(a.itemClass);
  const craftableB = context.craftAvailability.isCraftable(b.itemClass);
  return Number(ownedB) - Number(ownedA) || Number(craftableB) - Number(craftableA) || byName(a, b);
}

function availabilityFilter(item: HousingItem, context: OptimizationContext) {
  const craftable = context.craftAvailability.isCraftable(item.itemClass);
  if (context.input.availability === "available") return craftable || (context.input.ownedItems.get(item.itemClass) ?? 0) > 0;
  if (context.input.availability === "locked") return !craftable;
  return true;
}

function tryAddItemToCategoryPlan(
  context: OptimizationContext,
  plan: CategoryPlan,
  item: HousingItem,
  remainingScore: number,
  itemIndex: number,
): CategoryPlan | null {
  const profile = profileFor(context.model, item);
  if (!passesOperationalRequirements(context.input, profile)) return null;
  if (!profileFitsRoomDimensions(profile, plan.constraints)) return null;

  const type = item.typeForRoomLimit ?? item.itemClass;
  const propertyWide = item.diminishingMultiplierAcrossFullProperty != null;
  const roomTypeCount = plan.typeCounts.get(type) ?? 0;
  const propertyTypeCount = plan.constraints.propertyTypeCounts.get(type) ?? 0;
  const typeCount = propertyWide ? propertyTypeCount : roomTypeCount;
  const duplicateScore = scoreForDuplicate(context, item, typeCount);
  const multiplier = duplicateScore.multiplier;
  const rawScore = duplicateScore.rawScore;
  if (rawScore <= 0) return null;

  const creditedScore = Math.min(rawScore, remainingScore);
  if (!passesXpEfficiencyThreshold(context.input, item, creditedScore)) return null;
  const ownedAvailable = ownedRemaining(item.itemClass, context.input, plan.constraints) > 0;
  if (!ownedAvailable && creditedScore < MIN_NON_OWNED_CREDITED_SCORE) return null;

  const placement = placementForItem(profile, plan.constraints);
  if (!placement) return null;

  const requiredVolume = profile.requiredRoomVolume;
  if ((plan.constraints.usedRequiredVolume + requiredVolume) > plan.constraints.maxVolume) return null;
  if ((plan.constraints.usedFloor + placement.floorArea) > plan.constraints.maxFloor) return null;

  const constraints = cloneConstraints(plan.constraints);
  const fromOwned = markOwnedUsed(item.itemClass, context.input, constraints);
  constraints.usedFloor += placement.floorArea;
  constraints.usedRequiredVolume += requiredVolume;
  constraints.surfaceCapacity += profile.surfaceProvided;
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
    stableKey: [plan.stableKey, item.friendlyName].filter(Boolean).join(","),
    startIndex: itemIndex,
  };
}

function passesOperationalRequirements(input: RoomInput, profile: ItemOptimizationProfile) {
  if (profile.needsElectricPower && input.allowElectricPower === false) return false;
  if (profile.needsMechanicalPower && input.allowMechanicalPower === false) return false;
  if (profile.needsFuel && input.allowFuel === false) return false;
  if (profile.needsWater && input.allowWater === false) return false;
  if (profile.needsChimney && input.allowChimney === false) return false;

  const disabledFuelTags = input.disabledFuelTags ?? new Set<string>();
  if (profile.fuelTags.some((tag) => disabledFuelTags.has(tag))) return false;
  return true;
}

function passesXpEfficiencyThreshold(input: RoomInput, item: HousingItem, creditedScore: number) {
  const minPercent = clampPercent(input.minXpEfficiencyPercent ?? 0);
  if (minPercent <= 0 || item.value <= 0) return true;
  return (creditedScore / item.value) * 100 >= minPercent;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function scoreForDuplicate(context: OptimizationContext, item: HousingItem, countBefore: number) {
  const scores = cachedDuplicateScoreProfile(context, item);
  const cached = scores[countBefore];
  if (cached != null) return { rawScore: cached, multiplier: item.value ? cached / item.value : 0 };
  const multiplier = item.diminishingMultiplierAcrossFullProperty != null
    ? (item.diminishingMultiplierAcrossFullProperty ?? 1) ** countBefore
    : diminishingMultiplier(item, countBefore);
  return { rawScore: item.value * multiplier, multiplier };
}

export function duplicateScoreProfile(item: HousingItem, maxCount = MAX_ENTRIES_PER_CATEGORY) {
  const scores: number[] = [];
  for (let countBefore = 0; countBefore < maxCount; countBefore += 1) {
    const multiplier = item.diminishingMultiplierAcrossFullProperty != null
      ? (item.diminishingMultiplierAcrossFullProperty ?? 1) ** countBefore
      : diminishingMultiplier(item, countBefore);
    scores.push(item.value * multiplier);
  }
  return scores;
}

function cachedDuplicateScoreProfile(context: OptimizationContext, item: HousingItem) {
  const cached = context.duplicateScoreCache.get(item.itemClass);
  if (cached) return cached;
  const scores = duplicateScoreProfile(item);
  context.duplicateScoreCache.set(item.itemClass, scores);
  return scores;
}

function profileFor(model: EcoModel, item: HousingItem) {
  return model.optimizationProfileByItemClass.get(item.itemClass) ?? fallbackProfile(item);
}

function fallbackProfile(item: HousingItem): ItemOptimizationProfile {
  const footprint = itemFootprint(item);
  return {
    itemClass: item.itemClass,
    category: item.category,
    width: footprint.width || 0,
    depth: footprint.depth || 0,
    height: footprint.height || 0,
    floorArea: footprint.floorArea || 0,
    estimatedFootprint: Boolean(footprint.estimated),
    requiredRoomVolume: item.requirements?.requiredRoomVolume ?? 0,
    effectiveFloorArea: floorAreaWhenOnSurface(item),
    floorAreaWhenOnSurface: floorAreaWhenOnSurface(item),
    surfaceProvided: 0,
    surfaceRequired: 0,
    isRug: false,
    isPetalSurfaceOnly: false,
    isWallOrCeilingAttached: false,
    canPlaceOnFloorWhenNoSurface: true,
    needsElectricPower: false,
    needsMechanicalPower: false,
    needsFuel: false,
    fuelTags: [],
    needsWater: false,
    needsChimney: false,
  };
}

function profileFitsRoomDimensions(profile: ItemOptimizationProfile, constraints: Pick<RoomConstraints, "maxWidth" | "maxDepth" | "maxHeight">) {
  if (profile.height > 0 && profile.height > constraints.maxHeight) return false;
  if (profile.width > 0 && profile.depth > 0) {
    const fitsNormal = profile.width <= constraints.maxWidth && profile.depth <= constraints.maxDepth;
    const fitsRotated = profile.depth <= constraints.maxWidth && profile.width <= constraints.maxDepth;
    if (!fitsNormal && !fitsRotated) return false;
  }
  return true;
}

function placementForItem(profile: ItemOptimizationProfile, constraints: RoomConstraints) {
  const requiredSurface = profile.surfaceRequired;
  if (requiredSurface > 0) {
    const availableSurface = constraints.surfaceCapacity - constraints.usedSurface;
    if (availableSurface >= requiredSurface) {
      return { floorArea: profile.floorAreaWhenOnSurface, surfaceUsed: requiredSurface, placedOnFloor: false, extraFloorFromSurfaceOverflow: 0 };
    }
    if (!profile.canPlaceOnFloorWhenNoSurface) return null;
    const floorArea = profile.effectiveFloorArea;
    return {
      floorArea,
      surfaceUsed: 0,
      placedOnFloor: true,
      extraFloorFromSurfaceOverflow: Math.max(0, floorArea - profile.floorAreaWhenOnSurface),
    };
  }

  return { floorArea: profile.floorAreaWhenOnSurface, surfaceUsed: 0, placedOnFloor: false, extraFloorFromSurfaceOverflow: 0 };
}

function keepBestRoomPlans(context: OptimizationContext, plans: RoomPlan[]) {
  return dedupePlans(plans, roomPlanKey, (a, b) => compareRoomPlans(context, a, b)).slice(0, BEAM_WIDTH);
}

function keepBestCategoryPlans(context: OptimizationContext, plans: CategoryPlan[], maxScore: number | null) {
  return dedupePlans(plans, categoryPlanKey, (a, b) => compareCategoryPlans(context, a, b, maxScore)).slice(0, BEAM_WIDTH);
}

function compareRoomPlans(context: OptimizationContext, a: RoomPlan, b: RoomPlan) {
  if (context.objective.kind === "reachTargetScore") {
    const target = Math.max(0, context.objective.targetScore ?? context.objective.minScore ?? 0);
    const aMeets = a.cappedScore >= target;
    const bMeets = b.cappedScore >= target;
    if (aMeets !== bMeets) return Number(bMeets) - Number(aMeets);
    if (aMeets && bMeets) {
      return (
        a.cappedScore - b.cappedScore ||
        a.entryCount - b.entryCount ||
        b.ownedCount - a.ownedCount ||
        a.stableKey.localeCompare(b.stableKey)
      );
    }
  }

  if (context.objective.kind === "maximizeScorePerObject") {
    const ratioA = a.cappedScore / Math.max(1, a.entryCount);
    const ratioB = b.cappedScore / Math.max(1, b.entryCount);
    return ratioB - ratioA || b.cappedScore - a.cappedScore || a.entryCount - b.entryCount || a.stableKey.localeCompare(b.stableKey);
  }

  if (context.objective.kind === "maximizeUsefulRoomScore" || context.objective.kind === "maximizeScorePerCost" || context.objective.kind === "reachTargetScore") {
    return (
      b.cappedScore - a.cappedScore ||
      b.afterSupportCaps - a.afterSupportCaps ||
      a.entryCount - b.entryCount ||
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

function resolveRoomSize(model: EcoModel, input: RoomInput, entries: OptimizationEntry[]) {
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
  return findMinimumRoomSize(model, entries, "auto");
}

function findMinimumRoomSize(model: EcoModel, entries: OptimizationEntry[], mode: "auto" | "materials") {
  const requiredFloor = entries.reduce((total, entry) => total + profileFor(model, entry.item).floorAreaWhenOnSurface + (entry.extraFloorFromSurfaceOverflow ?? 0), 0);
  const requiredVolume = entries.reduce((total, entry) => total + profileFor(model, entry.item).requiredRoomVolume, 0);
  const minDimensions = entries.reduce((limits, entry) => {
    const profile = profileFor(model, entry.item);
    return {
      width: Math.max(limits.width, profile.width || 1),
      depth: Math.max(limits.depth, profile.depth || 1),
      height: Math.max(limits.height, profile.height || 2),
    };
  }, { width: 1, depth: 1, height: 2 });

  let best: ReturnType<typeof sizeCandidate> | null = null;
  for (let height = minDimensions.height; height <= AUTO_MAX_HEIGHT; height += 1) {
    for (let width = minDimensions.width; width <= AUTO_MAX_WIDTH; width += 1) {
      for (let depth = minDimensions.depth; depth <= AUTO_MAX_DEPTH; depth += 1) {
        const floorArea = width * depth;
        if (floorArea < requiredFloor) continue;
        if (floorArea * height < requiredVolume) continue;
        if (!entries.every((entry) => profileFitsRoomDimensions(profileFor(model, entry.item), { maxWidth: width, maxDepth: depth, maxHeight: height }))) continue;
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

function getCachedOptimization(model: EcoModel, input: RoomOptimizationRequest) {
  const cache = optimizationCacheByModel.get(model);
  const key = optimizationCacheKey(input);
  const cached = cache?.get(key);
  if (!cached || !cache) return null;
  cache.delete(key);
  cache.set(key, cached);
  return cloneOptimizationResult(cached);
}

function setCachedOptimization(model: EcoModel, input: RoomOptimizationRequest, result: RoomOptimizationResult) {
  const key = optimizationCacheKey(input);
  const cache = optimizationCacheByModel.get(model) ?? new Map<string, RoomOptimizationResult>();
  if (!optimizationCacheByModel.has(model)) optimizationCacheByModel.set(model, cache);
  cache.set(key, cloneOptimizationResult(result));
  while (cache.size > RESULT_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}

function cloneOptimizationResult(result: RoomOptimizationResult): RoomOptimizationResult {
  return structuredClone(result);
}

function optimizationCacheKey(input: RoomOptimizationRequest) {
  return JSON.stringify({
    roomType: input.roomType,
    tier: input.tier,
    width: input.width,
    depth: input.depth,
    height: input.height,
    sizeMode: input.sizeMode,
    materialBudget: input.materialBudget ?? null,
    selectedSkills: [...input.selectedSkills].sort(),
    ownedItems: [...input.ownedItems.entries()].filter(([, quantity]) => quantity > 0).sort(([a], [b]) => a.localeCompare(b)),
    disabledItems: [...input.disabledItems].sort(),
    availability: input.availability,
    minXpEfficiencyPercent: input.minXpEfficiencyPercent ?? null,
    allowElectricPower: input.allowElectricPower ?? null,
    allowMechanicalPower: input.allowMechanicalPower ?? null,
    allowFuel: input.allowFuel ?? null,
    allowWater: input.allowWater ?? null,
    allowChimney: input.allowChimney ?? null,
    disabledFuelTags: [...(input.disabledFuelTags ?? new Set<string>())].sort(),
    objective: input.objective ?? DEFAULT_OBJECTIVE,
  });
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
    startIndex: 0,
  };
}

function emptyRoomPlan(input: RoomInput): RoomPlan {
  return {
    groups: [],
    constraints: createInitialConstraints(input),
    ownedCount: 0,
    stableKey: "",
    cappedScore: 0,
    afterSupportCaps: 0,
    entryCount: 0,
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
