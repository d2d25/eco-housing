import type { HousingItem, OptimizationEntry, RoomConstraints } from "./types";

export function hasSurfaceTag(item: HousingItem, tagName: string) {
  return item.tags?.includes(`SurfaceTags.${tagName}`);
}

export function hasTag(item: HousingItem, tagName: string) {
  return item.tags?.includes(tagName);
}

export function isSmallEstimatedPlaceable(item: HousingItem) {
  return hasSurfaceTag(item, "CanBeOnSurface") || (!item.worldObjectClass && hasTag(item, "Petals"));
}

export function isPetalSurfaceOnly(item: HousingItem) {
  return !item.worldObjectClass && hasTag(item, "Petals");
}

export function canPlaceOnFloorWhenNoSurface(item: HousingItem) {
  return !isPetalSurfaceOnly(item);
}

export function surfacePlacementKind(item: HousingItem) {
  if (hasSurfaceTag(item, "Rug")) return "superposable: tapis";
  if (isPetalSurfaceOnly(item)) return "surface seulement estime";
  if (hasSurfaceTag(item, "CanBeOnSurface")) return "posable sur surface";
  if (hasSurfaceTag(item, "HasTableSurface")) return "fournit surface";
  return "";
}

export function itemFootprint(item: HousingItem) {
  if (item.occupancy) return { ...item.occupancy, estimated: false };
  if (isSmallEstimatedPlaceable(item)) return { width: 1, depth: 1, height: 1, floorArea: 1, estimated: true };
  return { width: 0, depth: 0, height: 0, floorArea: 0, estimated: false };
}

export function effectiveFloorArea(item: HousingItem) {
  if (hasSurfaceTag(item, "Rug")) return 0;
  if (isPetalSurfaceOnly(item)) return 0;
  return itemFootprint(item).floorArea;
}

export function floorAreaWhenOnSurface(item: HousingItem) {
  if (hasSurfaceTag(item, "Rug")) return 0;
  if (isSmallEstimatedPlaceable(item)) return 0;
  return effectiveFloorArea(item);
}

export function surfaceUnitsProvided(item: HousingItem) {
  if (!hasSurfaceTag(item, "HasTableSurface")) return 0;
  return Math.max(1, item.occupancy?.floorArea ?? 1);
}

export function surfaceUnitsRequired(item: HousingItem) {
  if (!isSmallEstimatedPlaceable(item)) return 0;
  return Math.max(1, itemFootprint(item).floorArea);
}

export function itemFitsRoomDimensions(item: HousingItem, constraints: Pick<RoomConstraints, "maxWidth" | "maxDepth" | "maxHeight">) {
  const footprint = itemFootprint(item);
  const width = footprint.width || 0;
  const depth = footprint.depth || 0;
  const height = footprint.height || 0;
  if (height > 0 && height > constraints.maxHeight) return false;
  if (width > 0 && depth > 0) {
    const fitsNormal = width <= constraints.maxWidth && depth <= constraints.maxDepth;
    const fitsRotated = depth <= constraints.maxWidth && width <= constraints.maxDepth;
    if (!fitsNormal && !fitsRotated) return false;
  }
  return true;
}

export function formatFootprint(item: HousingItem) {
  const footprint = itemFootprint(item);
  if (!footprint.floorArea) return "-";
  const suffix = footprint.estimated ? " estime" : "";
  return `${footprint.width}x${footprint.depth} (${footprint.floorArea})${footprint.height ? ` h${footprint.height}` : ""}${suffix}`;
}

export function surfaceSummary(entries: OptimizationEntry[]) {
  return entries.reduce((summary, entry) => ({
    capacity: summary.capacity + surfaceUnitsProvided(entry.item),
    used: summary.used + (entry.placedOnFloor ? 0 : surfaceUnitsRequired(entry.item)),
  }), { capacity: 0, used: 0 });
}

export function estimateObjectFloor(entries: OptimizationEntry[]) {
  return entries.reduce((total, entry) => total + floorAreaWhenOnSurface(entry.item) + (entry.extraFloorFromSurfaceOverflow ?? 0), 0);
}
