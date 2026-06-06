import type { EcoData, EcoModel } from "../domain/types";

export function toEcoData(model: EcoModel): EcoData {
  return {
    meta: model.meta,
    housingConfig: model.housingConfig,
    housing: model.housing,
    items: model.items,
    recipes: model.recipes,
    skills: model.skills,
    roomCategories: model.roomCategories,
    roomTiers: model.roomTiers,
    worldObjects: model.worldObjects,
    occupancy: model.occupancy,
    housingEquivalenceGroups: model.housingEquivalenceGroups,
  };
}
