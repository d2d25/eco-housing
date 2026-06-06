import { optimizeRoom } from "./roomOptimizer";
import { scoreSummary } from "./roomScoring";
import type { EcoModel, HouseCraftItem, HouseInput, HouseLayoutRoom, HouseMaterialSummary, HouseOptimizationResult, HouseRoomCopyScore, HouseRoomGroup, ItemClass, OptimizationEntry, OptimizationGroup, RoomConstraints, RoomInput, RoomOptimization, ResolvedRoomSize } from "./types";

const AUTO_MAX_COPIES = 4;
const SCORE_EPSILON = 0.01;
const ROOM_TARGET_RATIOS = [0.25, 0.4, 0.6, 0.8];
const MAX_CANDIDATES_PER_ROOM_TYPE = 6;
const RESULT_CACHE_LIMIT = 50;
const houseOptimizationCacheByModel = new WeakMap<EcoModel, Map<string, HouseOptimizationResult>>();

interface RoomCandidate {
  roomType: string;
  optimization: RoomOptimization;
  maxCopies: number;
  ratioCapPercent: number | null;
  profileKey: string;
}

interface RoomTypeChoice {
  candidate: RoomCandidate;
  count: number;
}

interface CountPlan {
  rooms: HouseRoomGroup[];
  layout: HouseLayoutRoom[];
  materials: HouseMaterialSummary;
  score: number;
  craftList: HouseCraftItem[];
  warnings: string[];
}

interface RoomCandidateGroup {
  roomType: string;
  candidates: RoomCandidate[];
  upperBound: number;
}

export function optimizeHouse(model: EcoModel, input: HouseInput): HouseOptimizationResult {
  const cached = getCachedHouseOptimization(model, input);
  if (cached) return cached;
  const candidates = buildRoomCandidates(model, input);
  const best = enumerateHousePlans(model, input, candidates);
  const result = best ? countPlanToResult(input, best) : emptyHouseResult(input, candidates.length ? [] : ["No room can score with the current filters."]);
  setCachedHouseOptimization(model, input, result);
  return result;
}

export function clearHouseOptimizationCache(model?: EcoModel) {
  if (model) houseOptimizationCacheByModel.delete(model);
}

export function estimateHouseMaterials(roomCopies: HouseLayoutRoom[], budget: number): HouseMaterialSummary {
  const indoorRooms = roomCopies.filter((room) => room.roomType !== "Outdoor");
  const isolatedCost = indoorRooms.reduce((total, room) => total + isolatedRoomMaterialCost(room), 0);
  const sharedSavings = estimateSharedWallSavings(indoorRooms);
  const used = Math.max(0, Math.ceil(isolatedCost - sharedSavings));
  return {
    budget,
    used,
    remaining: budget - used,
    isolatedCost: Math.ceil(isolatedCost),
    sharedSavings: Math.floor(sharedSavings),
  };
}

function buildRoomCandidates(model: EcoModel, input: HouseInput): RoomCandidate[] {
  return model.roomCategories
    .filter((room) => room.canBeRoomCategory && !room.negatesValue && room.name !== "Cultural")
    .flatMap((room) => {
      const baseInput = roomInputForHouse(input, room.name);
      const full = optimizeRoom(model, baseInput);
      const requestedMaxCopies = room.name === "Outdoor" ? 1 : input.maxCopiesPerRoomType === "auto" ? AUTO_MAX_COPIES : input.maxCopiesPerRoomType;
      const maxCopies = capRoomCopiesByEfficiency(model, input, requestedMaxCopies);
      if (maxCopies <= 0 || full.score.capped <= SCORE_EPSILON) return [];

      const targetOptimizations = targetScoresForRoom(full.score.capped).map((targetScore) => optimizeRoom(model, {
        ...baseInput,
        objective: { kind: "reachTargetScore", targetScore },
      }));

      const reducedOptimizations = reducedRoomOptimizations(model, input, full);
      return dedupeRoomOptimizations([full, ...targetOptimizations, ...reducedOptimizations]).map((optimization, index) => ({
        roomType: room.name,
        optimization,
        maxCopies,
        ratioCapPercent: room.capToPercentOfRestOfProperty ?? null,
        profileKey: `${room.name}:${index}:${roomProfileKey(optimization)}`,
      }));
    })
    .filter((candidate) => candidate.optimization.score.capped > SCORE_EPSILON);
}

function capRoomCopiesByEfficiency(model: EcoModel, input: HouseInput, requestedMaxCopies: number) {
  const minEfficiency = clampPercent(input.minXpEfficiencyPercent ?? 0) / 100;
  if (minEfficiency <= 0) return requestedMaxCopies;
  const rate = model.housingConfig?.roomCategoryDiminishingReturnRate ?? 0.5;
  let allowed = 0;
  for (let index = 0; index < requestedMaxCopies; index += 1) {
    const multiplier = index === 0 ? 1 : rate ** index;
    if (multiplier + SCORE_EPSILON < minEfficiency) break;
    allowed += 1;
  }
  return allowed;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function reducedRoomOptimizations(model: EcoModel, input: HouseInput, full: RoomOptimization) {
  if (full.roomName === "Outdoor" || full.entries.length <= 1) return [];
  const counts = [...new Set([1, 2, 3, 4, Math.ceil(full.entries.length / 2)])]
    .filter((count) => count > 0 && count < full.entries.length);
  return counts.map((count) => optimizationFromEntries(model, input, full, full.entries.slice(0, count)));
}

function optimizationFromEntries(model: EcoModel, input: HouseInput, source: RoomOptimization, entries: OptimizationEntry[]): RoomOptimization {
  const entrySet = new Set(entries);
  const groups = source.groups
    .map((group): OptimizationGroup => {
      const groupEntries = group.entries.filter((entry) => entrySet.has(entry));
      return {
        ...group,
        entries: groupEntries,
        score: groupEntries.reduce((total, entry) => total + entry.score, 0),
      };
    })
    .filter((group) => group.entries.length > 0);
  const resolvedSize = estimateReducedRoomSize(model, input, source.roomName, entries);
  const constraints = constraintsFromEntries(model, input, entries, resolvedSize);
  return {
    roomName: source.roomName,
    groups,
    score: scoreSummary(model, groups, input.constructionTier, source.roomName),
    entries,
    constraints,
    resolvedSize,
  };
}

function estimateReducedRoomSize(model: EcoModel, input: HouseInput, roomType: string, entries: OptimizationEntry[]): ResolvedRoomSize | null {
  if (roomType === "Outdoor") return null;
  const requiredFloor = entries.reduce((total, entry) => total + profileFor(model, entry).effectiveFloorArea, 0);
  const requiredVolume = entries.reduce((total, entry) => total + profileFor(model, entry).requiredRoomVolume, 0);
  const minDimensions = entries.reduce((limits, entry) => {
    const profile = profileFor(model, entry);
    return {
      width: Math.max(limits.width, profile.width || 1),
      depth: Math.max(limits.depth, profile.depth || 1),
      height: Math.max(limits.height, profile.height || 2),
    };
  }, { width: 1, depth: 1, height: 2 });

  let best: ResolvedRoomSize | null = null;
  for (let height = minDimensions.height; height <= Math.max(input.height, minDimensions.height, 8); height += 1) {
    for (let width = minDimensions.width; width <= 24; width += 1) {
      for (let depth = minDimensions.depth; depth <= 24; depth += 1) {
        const floorArea = width * depth;
        if (floorArea < requiredFloor) continue;
        if (floorArea * height < requiredVolume) continue;
        const candidate = sizeCandidate(width, depth, height);
        if (!best || compareRoomSize(candidate, best) < 0) best = candidate;
      }
    }
  }
  return best ?? sizeCandidate(minDimensions.width, minDimensions.depth, minDimensions.height);
}

function constraintsFromEntries(model: EcoModel, input: HouseInput, entries: OptimizationEntry[], size: ResolvedRoomSize | null): RoomConstraints {
  const usedFloor = entries.reduce((total, entry) => total + profileFor(model, entry).effectiveFloorArea, 0);
  const usedRequiredVolume = entries.reduce((total, entry) => total + profileFor(model, entry).requiredRoomVolume, 0);
  const surfaceCapacity = entries.reduce((total, entry) => total + profileFor(model, entry).surfaceProvided, 0);
  const usedSurface = entries.reduce((total, entry) => total + profileFor(model, entry).surfaceRequired, 0);
  const ownedUsage = new Map<ItemClass, number>();
  const propertyTypeCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.fromOwned) ownedUsage.set(entry.item.itemClass, (ownedUsage.get(entry.item.itemClass) ?? 0) + 1);
    propertyTypeCounts.set(entry.type, (propertyTypeCounts.get(entry.type) ?? 0) + 1);
  }
  return {
    maxWidth: size?.width ?? input.height,
    maxDepth: size?.depth ?? input.height,
    maxHeight: size?.height ?? input.height,
    maxFloor: size?.floorArea ?? Infinity,
    maxVolume: size?.volume ?? Infinity,
    usedFloor,
    usedRequiredVolume,
    surfaceCapacity,
    usedSurface,
    ownedUsage,
    propertyTypeCounts,
  };
}

function profileFor(model: EcoModel, entry: OptimizationEntry) {
  return model.optimizationProfileByItemClass.get(entry.item.itemClass) ?? {
    width: entry.item.occupancy?.width ?? 1,
    depth: entry.item.occupancy?.depth ?? 1,
    height: entry.item.occupancy?.height ?? 2,
    effectiveFloorArea: entry.item.occupancy?.floorArea ?? 0,
    requiredRoomVolume: entry.item.requirements?.requiredRoomVolume ?? 0,
    surfaceProvided: 0,
    surfaceRequired: 0,
  };
}

function sizeCandidate(width: number, depth: number, height: number): ResolvedRoomSize {
  return {
    width,
    depth,
    height,
    volume: width * depth * height,
    floorArea: width * depth,
    materialCount: isolatedRoomMaterialCost({ id: "", roomType: "", width, depth, height, x: 0, y: 0, score: 0 }),
    mode: "auto",
  };
}

function compareRoomSize(a: ResolvedRoomSize, b: ResolvedRoomSize) {
  return a.materialCount - b.materialCount || a.floorArea - b.floorArea || a.volume - b.volume || a.width - b.width || a.depth - b.depth;
}

function roomInputForHouse(input: HouseInput, roomType: string): RoomInput {
  return {
    roomType,
    tier: input.constructionTier,
    width: 1,
    depth: 1,
    height: input.height,
    sizeMode: roomType === "Outdoor" ? "manual" : "auto",
    selectedSkills: input.selectedSkills,
    ownedItems: input.ownedItems,
    disabledItems: input.disabledItems,
    availability: input.availability,
    minXpEfficiencyPercent: input.minXpEfficiencyPercent,
    allowElectricPower: input.allowElectricPower,
    allowMechanicalPower: input.allowMechanicalPower,
    allowFuel: input.allowFuel,
    allowWater: input.allowWater,
    allowChimney: input.allowChimney,
    disabledFuelTags: input.disabledFuelTags,
  };
}

function targetScoresForRoom(fullScore: number) {
  return ROOM_TARGET_RATIOS
    .map((ratio) => fullScore * ratio)
    .filter((score) => score > SCORE_EPSILON && score < fullScore - SCORE_EPSILON);
}

function dedupeRoomOptimizations(optimizations: RoomOptimization[]) {
  const byKey = new Map<string, RoomOptimization>();
  for (const optimization of optimizations) {
    const key = roomProfileKey(optimization);
    const current = byKey.get(key);
    if (!current || optimization.score.capped > current.score.capped) byKey.set(key, optimization);
  }
  return [...byKey.values()].sort((a, b) => b.score.capped - a.score.capped || (a.resolvedSize?.materialCount ?? 0) - (b.resolvedSize?.materialCount ?? 0));
}

function roomProfileKey(optimization: RoomOptimization) {
  const size = optimization.resolvedSize;
  const entries = optimization.entries.map((entry) => entry.item.itemClass).sort().join(",");
  return `${size?.width ?? 0}x${size?.depth ?? 0}x${size?.height ?? 0}:${entries}`;
}

function enumerateHousePlans(model: EcoModel, input: HouseInput, candidates: RoomCandidate[]) {
  let best: CountPlan | null = null;
  const groups = groupCandidatesByRoomType(candidates);
  const suffixUpperBounds = buildSuffixUpperBounds(groups);
  const choices: RoomTypeChoice[] = [];

  function visit(index: number, optimisticScore: number) {
    if (best && optimisticScore + suffixUpperBounds[index]! <= best.score + SCORE_EPSILON) return;
    if (index >= groups.length) {
      const plan = evaluateChoicePlan(model, input, candidates, choices);
      if (plan && isBetterPlan(plan, best)) best = plan;
      return;
    }

    visit(index + 1, optimisticScore);
    for (const candidate of groups[index]!.candidates) {
      for (let count = 1; count <= candidate.maxCopies; count += 1) {
        choices.push({ candidate, count });
        visit(index + 1, optimisticScore + optimisticRoomScore(model, candidate, count));
        choices.pop();
      }
    }
  }

  visit(0, 0);
  return best;
}

function groupCandidatesByRoomType(candidates: RoomCandidate[]) {
  const byRoomType = new Map<string, RoomCandidate[]>();
  for (const candidate of candidates) {
    const entries = byRoomType.get(candidate.roomType) ?? [];
    entries.push(candidate);
    byRoomType.set(candidate.roomType, entries);
  }
  return [...byRoomType.entries()]
    .map(([roomType, entries]) => {
      const candidates = limitRoomCandidates(pruneDominatedRoomCandidates(entries).sort(compareRoomCandidates));
      return { roomType, candidates, upperBound: roomTypeUpperBound(candidates) };
    })
    .filter((group) => group.candidates.length > 0)
    .sort((a, b) => a.roomType.localeCompare(b.roomType));
}

function pruneDominatedRoomCandidates(candidates: RoomCandidate[]) {
  return candidates.filter((candidate) => !candidates.some((other) => other !== candidate && dominatesRoomCandidate(other, candidate)));
}

function dominatesRoomCandidate(a: RoomCandidate, b: RoomCandidate) {
  const scoreA = a.optimization.score.capped;
  const scoreB = b.optimization.score.capped;
  const materialA = candidateMaterialCost(a);
  const materialB = candidateMaterialCost(b);
  const entriesA = a.optimization.entries.length;
  const entriesB = b.optimization.entries.length;
  return scoreA >= scoreB - SCORE_EPSILON
    && materialA <= materialB
    && entriesA <= entriesB
    && (scoreA > scoreB + SCORE_EPSILON || materialA < materialB || entriesA < entriesB);
}

function limitRoomCandidates(candidates: RoomCandidate[]) {
  if (candidates.length <= MAX_CANDIDATES_PER_ROOM_TYPE) return candidates;
  const selected = new Map<string, RoomCandidate>();
  const add = (candidate: RoomCandidate | undefined) => {
    if (candidate) selected.set(candidate.profileKey, candidate);
  };
  const byScore = [...candidates].sort(compareRoomCandidates);
  const byEfficiency = [...candidates].sort((a, b) => scorePerMaterial(b) - scorePerMaterial(a) || compareRoomCandidates(a, b));
  const bySmallest = [...candidates].sort((a, b) => candidateMaterialCost(a) - candidateMaterialCost(b) || compareRoomCandidates(a, b));
  const byScorePerObject = [...candidates].sort((a, b) => scorePerObject(b) - scorePerObject(a) || compareRoomCandidates(a, b));

  add(byScore[0]);
  add(byEfficiency[0]);
  add(bySmallest[0]);
  add(byScorePerObject[0]);

  for (const candidate of byEfficiency) {
    add(candidate);
    if (selected.size >= MAX_CANDIDATES_PER_ROOM_TYPE) break;
  }
  for (const candidate of byScore) {
    add(candidate);
    if (selected.size >= MAX_CANDIDATES_PER_ROOM_TYPE) break;
  }

  return [...selected.values()].sort(compareRoomCandidates);
}

function compareRoomCandidates(a: RoomCandidate, b: RoomCandidate) {
  return b.optimization.score.capped - a.optimization.score.capped || candidateMaterialCost(a) - candidateMaterialCost(b) || a.profileKey.localeCompare(b.profileKey);
}

function buildSuffixUpperBounds(groups: RoomCandidateGroup[]) {
  const suffix = Array.from({ length: groups.length + 1 }, () => 0);
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    suffix[index] = suffix[index + 1]! + groups[index]!.upperBound;
  }
  return suffix;
}

function roomTypeUpperBound(candidates: RoomCandidate[]) {
  return Math.max(0, ...candidates.map((candidate) => optimisticRoomScoreFromCandidate(candidate)));
}

function optimisticRoomScore(model: EcoModel, candidate: RoomCandidate, count: number) {
  return roomCopyScores(model, candidate.optimization.score.capped, count).reduce((total, copy) => total + copy.score, 0);
}

function optimisticRoomScoreFromCandidate(candidate: RoomCandidate) {
  return candidate.optimization.score.capped * candidate.maxCopies;
}

function candidateMaterialCost(candidate: RoomCandidate) {
  return candidate.roomType === "Outdoor" ? 0 : candidate.optimization.resolvedSize?.materialCount ?? Infinity;
}

function scorePerMaterial(candidate: RoomCandidate) {
  return candidate.optimization.score.capped / Math.max(1, candidateMaterialCost(candidate));
}

function scorePerObject(candidate: RoomCandidate) {
  return candidate.optimization.score.capped / Math.max(1, candidate.optimization.entries.length);
}

function evaluateChoicePlan(model: EcoModel, input: HouseInput, allCandidates: RoomCandidate[], choices: RoomTypeChoice[]): CountPlan | null {
  if (!choices.length) return null;

  const layout = buildSimpleLayout(choices.flatMap(({ candidate, count }) => createLayoutCopies(candidate, count, input)));
  const materials = estimateHouseMaterials(layout, input.materialBudget);
  if (materials.used > input.materialBudget) return null;

  const preliminaryGroups = choices.map(({ candidate, count }) => createRoomGroup(model, candidate, count));
  const cappedGroups = applyRatioRoomCaps(model, preliminaryGroups);
  const score = cappedGroups.reduce((total, group) => total + group.totalScore, 0);
  if (score <= SCORE_EPSILON) return null;

  return {
    rooms: cappedGroups,
    layout,
    materials,
    score,
    craftList: buildCraftList(input, cappedGroups),
    warnings: buildWarnings(allCandidates, cappedGroups, materials),
  };
}

function createRoomGroup(model: EcoModel, candidate: RoomCandidate, quantity: number): HouseRoomGroup {
  const copyScores = roomCopyScores(model, candidate.optimization.score.capped, quantity);
  return {
    roomType: candidate.roomType,
    quantity,
    tier: candidate.optimization.score.tier?.tier ?? 0,
    optimization: candidate.optimization,
    copyScores,
    totalScore: sumCopyScores(copyScores),
    ratioCap: candidate.ratioCapPercent,
  };
}

function applyRatioRoomCaps(model: EcoModel, groups: HouseRoomGroup[]): HouseRoomGroup[] {
  return groups.map((group) => {
    const capPercent = model.roomCategoryByName.get(group.roomType)?.capToPercentOfRestOfProperty ?? null;
    if (capPercent == null) return group;
    const restScore = groups.filter((other) => other.roomType !== group.roomType).reduce((total, other) => total + other.totalScore, 0);
    const cap = restScore * capPercent;
    if (group.totalScore <= cap + SCORE_EPSILON) return { ...group, ratioCap: cap };
    return {
      ...group,
      totalScore: cap,
      cappedByRatio: true,
      ratioCap: cap,
      copyScores: distributeCappedCopyScores(group.copyScores, cap),
    };
  });
}

function roomCopyScores(model: EcoModel, baseScore: number, quantity: number): HouseRoomCopyScore[] {
  const rate = model.housingConfig?.roomCategoryDiminishingReturnRate ?? 0.5;
  return Array.from({ length: quantity }, (_, index) => {
    const multiplier = index === 0 ? 1 : rate ** index;
    return { index: index + 1, multiplier, score: baseScore * multiplier };
  });
}

function distributeCappedCopyScores(copyScores: HouseRoomCopyScore[], cap: number): HouseRoomCopyScore[] {
  const total = sumCopyScores(copyScores);
  if (total <= 0) return copyScores;
  const ratio = cap / total;
  return copyScores.map((copy) => ({ ...copy, score: copy.score * ratio }));
}

function sumCopyScores(copyScores: HouseRoomCopyScore[]) {
  return copyScores.reduce((total, copy) => total + copy.score, 0);
}

function createLayoutCopies(candidate: RoomCandidate, quantity: number, input: HouseInput): HouseLayoutRoom[] {
  const size = candidate.optimization.resolvedSize;
  return Array.from({ length: quantity }, (_, index) => ({
    id: `${candidate.roomType}-${candidate.profileKey}-${index + 1}`,
    roomType: candidate.roomType,
    width: candidate.roomType === "Outdoor" ? 3 : size?.width ?? 1,
    depth: candidate.roomType === "Outdoor" ? 3 : size?.depth ?? 1,
    height: candidate.roomType === "Outdoor" ? 0 : input.sameHeightForAllRooms ? input.height : size?.height ?? input.height,
    x: 0,
    y: 0,
    score: 0,
  }));
}

function buildSimpleLayout(rooms: HouseLayoutRoom[]) {
  const indoor = rooms.filter((room) => room.roomType !== "Outdoor").sort((a, b) => b.width * b.depth - a.width * a.depth || a.roomType.localeCompare(b.roomType));
  const outdoor = rooms.filter((room) => room.roomType === "Outdoor");
  const columns = Math.max(1, Math.ceil(Math.sqrt(indoor.length || 1)));
  let y = 0;
  const laidOut: HouseLayoutRoom[] = [];

  for (let rowStart = 0; rowStart < indoor.length; rowStart += columns) {
    const row = indoor.slice(rowStart, rowStart + columns);
    let x = 0;
    let rowDepth = 0;
    for (const room of row) {
      laidOut.push({ ...room, x, y });
      x += room.width;
      rowDepth = Math.max(rowDepth, room.depth);
    }
    y += rowDepth;
  }

  return [...laidOut, ...outdoor.map((room, index) => ({ ...room, x: index * room.width, y: y + 1 }))];
}

function isolatedRoomMaterialCost(room: HouseLayoutRoom) {
  return (2 * room.width * room.depth) + (2 * room.height * (room.width + room.depth));
}

function estimateSharedWallSavings(rooms: HouseLayoutRoom[]) {
  let savings = 0;
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      savings += sharedWallArea(rooms[i]!, rooms[j]!);
    }
  }
  return savings;
}

function sharedWallArea(a: HouseLayoutRoom, b: HouseLayoutRoom) {
  const verticalTouch = a.x + a.width === b.x || b.x + b.width === a.x;
  if (verticalTouch) {
    const overlap = Math.max(0, Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y));
    return overlap * Math.min(a.height, b.height);
  }
  const horizontalTouch = a.y + a.depth === b.y || b.y + b.depth === a.y;
  if (horizontalTouch) {
    const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    return overlap * Math.min(a.height, b.height);
  }
  return 0;
}

function buildCraftList(input: HouseInput, groups: HouseRoomGroup[]): HouseCraftItem[] {
  const required = new Map<ItemClass, { item: HouseCraftItem["item"]; quantity: number }>();
  for (const group of groups) {
    for (const entry of group.optimization.entries) {
      const current = required.get(entry.item.itemClass) ?? { item: entry.item, quantity: 0 };
      current.quantity += group.quantity;
      required.set(entry.item.itemClass, current);
    }
  }

  return [...required.values()]
    .map(({ item, quantity }) => {
      const ownedUsed = Math.min(quantity, input.ownedItems.get(item.itemClass) ?? 0);
      return { item, quantity, ownedUsed, craftQuantity: quantity - ownedUsed };
    })
    .filter((entry) => entry.quantity > 0)
    .sort((a, b) => a.item.friendlyName.localeCompare(b.item.friendlyName));
}

function buildWarnings(candidates: RoomCandidate[], groups: HouseRoomGroup[], materials: HouseMaterialSummary) {
  const warnings: string[] = [];
  if (groups.some((group) => group.cappedByRatio)) warnings.push("Some rooms were capped by property ratio rules.");
  if (candidates.some((candidate) => candidate.roomType === "Outdoor" && candidate.maxCopies === 1)) warnings.push("Outdoor is limited to one copy in House V1.");
  if (materials.remaining < 0) warnings.push("Material budget exceeded.");
  return warnings;
}

function isBetterPlan(plan: CountPlan, current: CountPlan | null) {
  if (!current) return true;
  return plan.score > current.score + SCORE_EPSILON
    || Math.abs(plan.score - current.score) <= SCORE_EPSILON && plan.materials.used < current.materials.used
    || Math.abs(plan.score - current.score) <= SCORE_EPSILON && plan.materials.used === current.materials.used && totalRooms(plan) < totalRooms(current);
}

function totalRooms(plan: CountPlan) {
  return plan.rooms.reduce((total, group) => total + group.quantity, 0);
}

function emptyHouseResult(input: HouseInput, warnings: string[] = []): HouseOptimizationResult {
  return {
    score: 0,
    constructionTier: input.constructionTier,
    materials: { budget: input.materialBudget, used: 0, remaining: input.materialBudget, isolatedCost: 0, sharedSavings: 0 },
    rooms: [],
    layout: [],
    craftList: [],
    warnings,
  };
}

function countPlanToResult(input: HouseInput, plan: CountPlan): HouseOptimizationResult {
  return {
    score: plan.score,
    constructionTier: input.constructionTier,
    materials: plan.materials,
    rooms: plan.rooms.map((room) => ({ ...room, tier: input.constructionTier })),
    layout: plan.layout,
    craftList: plan.craftList,
    warnings: plan.warnings,
  };
}

function getCachedHouseOptimization(model: EcoModel, input: HouseInput) {
  const cache = houseOptimizationCacheByModel.get(model);
  const key = houseOptimizationCacheKey(input);
  const cached = cache?.get(key);
  if (!cache || !cached) return null;
  cache.delete(key);
  cache.set(key, cached);
  return cloneHouseOptimizationResult(cached);
}

function setCachedHouseOptimization(model: EcoModel, input: HouseInput, result: HouseOptimizationResult) {
  const key = houseOptimizationCacheKey(input);
  const cache = houseOptimizationCacheByModel.get(model) ?? new Map<string, HouseOptimizationResult>();
  if (!houseOptimizationCacheByModel.has(model)) houseOptimizationCacheByModel.set(model, cache);
  cache.set(key, cloneHouseOptimizationResult(result));
  while (cache.size > RESULT_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}

function cloneHouseOptimizationResult(result: HouseOptimizationResult): HouseOptimizationResult {
  return structuredClone(result);
}

function houseOptimizationCacheKey(input: HouseInput) {
  return JSON.stringify({
    constructionTier: input.constructionTier,
    materialBudget: input.materialBudget,
    height: input.height,
    sameHeightForAllRooms: input.sameHeightForAllRooms,
    maxCopiesPerRoomType: input.maxCopiesPerRoomType,
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
  });
}
