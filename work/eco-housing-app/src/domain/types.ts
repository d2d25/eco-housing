export type SkillClass = string;
export type ItemClass = string;
export type WorldObjectClass = string;

export interface EcoItem {
  className: ItemClass;
  friendlyName: string;
  localizedName?: Record<string, string>;
  description?: string | null;
  worldObjectClass?: WorldObjectClass | null;
  categories?: string[];
  tags?: string[];
  hiddenCategory?: boolean;
  notInBrowser?: boolean;
  noIcon?: boolean;
  iconUrl?: string | null;
  variantGroupKey?: string | null;
  variantOfItemClass?: ItemClass | null;
  variantItemClasses?: ItemClass[];
  source?: string;
}

export interface HousingValue {
  itemClass: ItemClass;
  friendlyName: string;
  localizedName?: Record<string, string>;
  description?: string | null;
  worldObjectClass?: WorldObjectClass | null;
  category: string;
  value: number;
  typeForRoomLimit?: string | null;
  diminishingReturnPercent?: number | null;
  diminishingMultiplierAcrossFullProperty?: number | null;
  hasDynamicFurnishingValue?: boolean;
  categories?: string[];
  tags?: string[];
  hiddenCategory?: boolean;
  notInBrowser?: boolean;
  noIcon?: boolean;
  iconUrl?: string | null;
  variantGroupKey?: string | null;
  variantOfItemClass?: ItemClass | null;
  variantItemClasses?: ItemClass[];
  source?: string;
}

export interface RecipeElement {
  itemClass?: ItemClass | null;
  tag?: string | null;
  quantity?: number | null;
  raw?: string;
}

export interface Recipe {
  className: string;
  name: string;
  localizedName?: Record<string, string>;
  requiredSkillClass?: SkillClass | null;
  requiredSkillLevel?: number | null;
  craftingTableClass?: WorldObjectClass | null;
  variantBaseRecipeClass?: string | null;
  products?: RecipeElement[];
  ingredients?: RecipeElement[];
  source?: string;
}

export interface Skill {
  className: SkillClass;
  friendlyName: string;
  localizedName?: Record<string, string>;
  tier?: number | null;
  isSpecialty?: boolean;
  isProfession?: boolean;
  professionGroup?: string | null;
  parentSkillClass?: SkillClass | null;
  iconUrl?: string | null;
  source?: string;
}

export interface RoomCategory {
  name: string;
  localizedName?: Record<string, string>;
  colorHex?: string | null;
  colorSource?: string | null;
  canBeRoomCategory: boolean;
  canAutoChooseCategory?: boolean;
  supportForAnyRoomType?: boolean;
  negatesValue?: boolean;
  shouldCapFromRoomMaterials?: boolean;
  maxSupportPercentOfPrimary?: number | null;
  maxSupportPercentOfPrimaryPerCategory?: Record<string, number>;
  capToPercentOfRestOfProperty?: number | null;
  supportingRoomCategoryNames?: string[];
}

export interface RoomTier {
  tier: number;
  softCap: number;
  hardCap: number;
  diminishingReturnPercent: number;
}

export interface WorldObjectRequirement {
  className: WorldObjectClass;
  displayName?: string | null;
  representedItemClass?: ItemClass | null;
  categories?: string[];
  tags?: string[];
  requireRoomContainment?: boolean;
  requiredRoomVolume?: number | null;
  requiredRoomMaterialTier?: number | null;
  requiresOccupancy?: boolean;
  requiresRoomRequirements?: boolean;
}

export interface Occupancy {
  worldObjectClass: WorldObjectClass;
  blockCount: number;
  floorArea: number;
  width: number;
  depth: number;
  height: number;
}

export interface EcoData {
  meta?: { counts?: Record<string, number>; [key: string]: unknown };
  housingConfig?: {
    roomCategoryDiminishingReturnRate?: number | null;
    housePointsMultiplierPerResidentsCount?: number[];
  };
  housing: HousingValue[];
  items: EcoItem[];
  recipes: Recipe[];
  skills: Skill[];
  roomCategories: RoomCategory[];
  roomTiers: RoomTier[];
  worldObjects: WorldObjectRequirement[];
  occupancy: Occupancy[];
}

export interface HousingItem extends HousingValue {
  tags: string[];
  recipes: Recipe[];
  skills: Skill[];
  skillClasses: SkillClass[];
  minSkillLevel: number | null;
  occupancy: Occupancy | null;
  requirements: WorldObjectRequirement | null;
  craftableWithoutSkill: boolean;
}

export interface EcoModel extends EcoData {
  housingItems: HousingItem[];
  roomCategoryByName: Map<string, RoomCategory>;
  supportForAnyRoom: string[];
  skillsByClass: Map<SkillClass, Skill>;
  itemByClass: Map<ItemClass, EcoItem>;
  recipesByProduct: Map<ItemClass, Recipe[]>;
  itemByWorldObject: Map<WorldObjectClass, ItemClass>;
  occupancyByWorldObject: Map<WorldObjectClass, Occupancy>;
  requirementsByWorldObject: Map<WorldObjectClass, WorldObjectRequirement>;
  variantItemsByBase: Map<ItemClass, HousingItem[]>;
}

export interface CraftRequirement {
  skillClass: SkillClass;
  level: number | null;
}

export interface CraftResolution {
  craftable: boolean;
  missing: CraftRequirement[];
  required: CraftRequirement[];
}

export interface RoomInput {
  roomType: string;
  tier: number;
  width: number;
  depth: number;
  height: number;
  selectedSkills: Set<SkillClass>;
  ownedItems: Map<ItemClass, number>;
  disabledItems: Set<ItemClass>;
  availability: "available" | "all" | "locked";
  objective?: OptimizationObjective;
}

export type OptimizationObjectiveKind = "maximizeUsefulRoomScore";

export interface OptimizationObjective {
  kind: OptimizationObjectiveKind;
}

export interface OptimizationEntry {
  item: HousingItem;
  type: string;
  itemCount: number;
  typeCount: number;
  multiplier: number;
  baseScore: number;
  rawScore: number;
  score: number;
  capped: boolean;
  supportCapLoss: number;
  fromOwned: boolean;
  placedOnFloor?: boolean;
  extraFloorFromSurfaceOverflow?: number;
}

export interface OptimizationGroup {
  category: string;
  role: string;
  entries: OptimizationEntry[];
  score: number;
  supportCap: number | null;
  supportCapPercent: number | null;
}

export interface ScoreSummary {
  raw: number;
  afterDiminishing: number;
  afterSupportCaps: number;
  capped: number;
  duplicateLoss: number;
  supportCapLoss: number;
  capLoss: number;
  tier: RoomTier | null;
}

export interface RoomOptimization {
  roomName: string;
  groups: OptimizationGroup[];
  score: ScoreSummary;
  entries: OptimizationEntry[];
  constraints: RoomConstraints;
}

export interface RoomConstraints {
  maxWidth: number;
  maxDepth: number;
  maxHeight: number;
  maxFloor: number;
  maxVolume: number;
  usedFloor: number;
  usedRequiredVolume: number;
  surfaceCapacity: number;
  usedSurface: number;
  ownedUsage: Map<ItemClass, number>;
  propertyTypeCounts: Map<string, number>;
}
