import { floorAreaWhenOnSurface, surfaceUnitsProvided, surfaceUnitsRequired } from "./placementRules";
import type { EcoModel, OptimizationEntry, OptimizationGroup, RoomTier, ScoreSummary } from "./types";

export function compatibleCategoriesForRoom(model: EcoModel, roomName: string) {
  if (roomName === "all") return null;
  const room = model.roomCategoryByName.get(roomName);
  if (!room) return new Set([roomName]);
  return new Set([room.name, ...(room.supportingRoomCategoryNames ?? []), ...model.supportForAnyRoom]);
}

export function supportCapPercentForCategory(model: EcoModel, category: string, primaryRoomName: string) {
  const roomCategory = model.roomCategoryByName.get(category);
  return roomCategory?.maxSupportPercentOfPrimaryPerCategory?.[primaryRoomName] ?? roomCategory?.maxSupportPercentOfPrimary ?? null;
}

export function selectedTier(model: EcoModel, tierValue: number): RoomTier | null {
  return model.roomTiers.find((tier) => tier.tier === tierValue) ?? model.roomTiers.at(-1) ?? null;
}

export function diminishingMultiplier(item: { diminishingReturnPercent?: number | null }, countBefore: number) {
  if (countBefore <= 0) return 1;
  return (item.diminishingReturnPercent ?? 1) ** countBefore;
}

export function estimateEntriesScore(entries: OptimizationEntry[]) {
  return entries.reduce((total, entry) => total + entry.score, 0);
}

export function applyTierCap(model: EcoModel, value: number, tierValue: number) {
  const tier = selectedTier(model, tierValue);
  if (!tier) return value;
  if (value <= tier.softCap) return value;
  const overflow = value - tier.softCap;
  const range = tier.hardCap - tier.softCap;
  if (range <= 0) return tier.hardCap;
  return tier.hardCap - range * (tier.diminishingReturnPercent ** (overflow / range));
}

export function roomUsesMaterialTier(model: EcoModel, roomName: string) {
  return model.roomCategoryByName.get(roomName)?.shouldCapFromRoomMaterials !== false;
}

export function scoreSummary(model: EcoModel, groups: OptimizationGroup[], tierValue: number, roomName?: string): ScoreSummary {
  const allEntries = groups.flatMap((group) => group.entries);
  const raw = allEntries.reduce((total, entry) => total + (entry.baseScore ?? entry.item.value ?? 0), 0);
  const afterDiminishing = allEntries.reduce((total, entry) => total + (entry.rawScore ?? entry.score), 0);
  const afterSupportCaps = estimateEntriesScore(allEntries);
  const usesMaterialTier = roomName ? roomUsesMaterialTier(model, roomName) : true;
  const capped = usesMaterialTier ? applyTierCap(model, afterSupportCaps, tierValue) : afterSupportCaps;
  return {
    raw,
    afterDiminishing,
    afterSupportCaps,
    capped,
    tier: usesMaterialTier ? selectedTier(model, tierValue) : null,
    duplicateLoss: Math.max(0, raw - afterDiminishing),
    supportCapLoss: Math.max(0, afterDiminishing - afterSupportCaps),
    capLoss: Math.max(0, afterSupportCaps - capped),
  };
}

export function summarizeEntries(entries: OptimizationEntry[]) {
  const byItem = new Map<string, {
    item: OptimizationEntry["item"];
    quantityPerRoom: number;
    score: number;
    rawScore: number;
    fromOwned: number;
    capped: boolean;
    placedOnFloor: boolean;
    lastMultiplier: number;
    totalFloor: number;
    totalRequiredVolume: number;
    totalSurfaceProvided: number;
    totalSurfaceRequired: number;
    rows: { index: number; multiplier: number; score: number; rawScore: number }[];
  }>();

  for (const entry of entries) {
    const current = byItem.get(entry.item.itemClass) ?? {
      item: entry.item,
      quantityPerRoom: 0,
      score: 0,
      rawScore: 0,
      fromOwned: 0,
      capped: false,
      placedOnFloor: false,
      lastMultiplier: 1,
      totalFloor: 0,
      totalRequiredVolume: 0,
      totalSurfaceProvided: 0,
      totalSurfaceRequired: 0,
      rows: [],
    };
    current.quantityPerRoom += 1;
    current.score += entry.score;
    current.rawScore += entry.rawScore;
    current.fromOwned += entry.fromOwned ? 1 : 0;
    current.capped = current.capped || entry.capped;
    current.placedOnFloor = current.placedOnFloor || Boolean(entry.placedOnFloor);
    current.lastMultiplier = entry.multiplier;
    current.totalFloor += floorAreaWhenOnSurface(entry.item) + (entry.extraFloorFromSurfaceOverflow ?? 0);
    current.totalRequiredVolume += entry.item.requirements?.requiredRoomVolume ?? 0;
    current.totalSurfaceProvided += surfaceUnitsProvided(entry.item);
    current.totalSurfaceRequired += entry.placedOnFloor ? 0 : surfaceUnitsRequired(entry.item);
    current.rows.push({ index: current.quantityPerRoom, multiplier: entry.multiplier, score: entry.score, rawScore: entry.rawScore });
    byItem.set(entry.item.itemClass, current);
  }

  return [...byItem.values()];
}
