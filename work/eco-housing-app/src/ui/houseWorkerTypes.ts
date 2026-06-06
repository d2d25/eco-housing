import type { EcoData, HouseInput, HouseMaxCopiesPerRoomType, HouseOptimizationResult, ItemClass, SkillClass } from "../domain/types";

export interface SerializedHouseInput {
  constructionTier: number;
  materialBudget: number;
  height: number;
  sameHeightForAllRooms: boolean;
  maxCopiesPerRoomType: HouseMaxCopiesPerRoomType;
  selectedSkills: SkillClass[];
  ownedItems: [ItemClass, number][];
  disabledItems: ItemClass[];
  availability: HouseInput["availability"];
  minXpEfficiencyPercent?: number;
  allowElectricPower?: boolean;
  allowMechanicalPower?: boolean;
  allowFuel?: boolean;
  allowWater?: boolean;
  allowChimney?: boolean;
  disabledFuelTags?: string[];
}

export interface HouseWorkerRequest {
  modelData: EcoData;
  input: SerializedHouseInput;
}

export type HouseWorkerResponse =
  | { ok: true; optimization: HouseOptimizationResult }
  | { ok: false; error: string };

export function serializeHouseInput(input: HouseInput): SerializedHouseInput {
  return {
    constructionTier: input.constructionTier,
    materialBudget: input.materialBudget,
    height: input.height,
    sameHeightForAllRooms: input.sameHeightForAllRooms,
    maxCopiesPerRoomType: input.maxCopiesPerRoomType,
    selectedSkills: [...input.selectedSkills],
    ownedItems: [...input.ownedItems.entries()],
    disabledItems: [...input.disabledItems],
    availability: input.availability,
    minXpEfficiencyPercent: input.minXpEfficiencyPercent,
    allowElectricPower: input.allowElectricPower,
    allowMechanicalPower: input.allowMechanicalPower,
    allowFuel: input.allowFuel,
    allowWater: input.allowWater,
    allowChimney: input.allowChimney,
    disabledFuelTags: [...(input.disabledFuelTags ?? [])],
  };
}

export function deserializeHouseInput(input: SerializedHouseInput): HouseInput {
  return {
    constructionTier: input.constructionTier,
    materialBudget: input.materialBudget,
    height: input.height,
    sameHeightForAllRooms: input.sameHeightForAllRooms,
    maxCopiesPerRoomType: input.maxCopiesPerRoomType,
    selectedSkills: new Set(input.selectedSkills),
    ownedItems: new Map(input.ownedItems),
    disabledItems: new Set(input.disabledItems),
    availability: input.availability,
    minXpEfficiencyPercent: input.minXpEfficiencyPercent,
    allowElectricPower: input.allowElectricPower,
    allowMechanicalPower: input.allowMechanicalPower,
    allowFuel: input.allowFuel,
    allowWater: input.allowWater,
    allowChimney: input.allowChimney,
    disabledFuelTags: new Set(input.disabledFuelTags ?? []),
  };
}
