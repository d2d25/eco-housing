import type { EcoData, EcoEconomyData, ItemClass, RoomInput, RoomOptimization, SkillClass } from "../domain/types";

export interface SerializedRoomInput {
  roomType: string;
  tier: number;
  width: number;
  depth: number;
  height: number;
  sizeMode?: RoomInput["sizeMode"];
  materialBudget?: number | null;
  selectedSkills: SkillClass[];
  ownedItems: [ItemClass, number][];
  disabledItems: ItemClass[];
  availability: RoomInput["availability"];
  minXpEfficiencyPercent?: number;
  allowElectricPower?: boolean;
  allowMechanicalPower?: boolean;
  allowFuel?: boolean;
  allowWater?: boolean;
  allowChimney?: boolean;
  disabledFuelTags?: string[];
  economyEnabled?: boolean;
  economyBudget?: number | null;
  economyCurrency?: string | null;
  economyObjective?: RoomInput["economyObjective"];
  economyData?: EcoEconomyData | null;
}

export interface RoomWorkerRequest {
  modelData: EcoData;
  input: SerializedRoomInput;
}

export type RoomWorkerResponse =
  | { ok: true; optimization: RoomOptimization }
  | { ok: false; error: string };

export function serializeRoomInput(input: RoomInput): SerializedRoomInput {
  return {
    roomType: input.roomType,
    tier: input.tier,
    width: input.width,
    depth: input.depth,
    height: input.height,
    sizeMode: input.sizeMode,
    materialBudget: input.materialBudget,
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
    economyEnabled: input.economyEnabled,
    economyBudget: input.economyBudget,
    economyCurrency: input.economyCurrency,
    economyObjective: input.economyObjective,
    economyData: input.economyData ?? null,
  };
}

export function deserializeRoomInput(input: SerializedRoomInput): RoomInput {
  return {
    roomType: input.roomType,
    tier: input.tier,
    width: input.width,
    depth: input.depth,
    height: input.height,
    sizeMode: input.sizeMode,
    materialBudget: input.materialBudget,
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
    economyEnabled: input.economyEnabled,
    economyBudget: input.economyBudget,
    economyCurrency: input.economyCurrency,
    economyObjective: input.economyObjective,
    economyData: input.economyData ?? null,
  };
}
