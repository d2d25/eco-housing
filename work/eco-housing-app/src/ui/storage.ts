import type { HouseMaxCopiesPerRoomType, ItemClass, SkillClass } from "../domain/types";
import { isLanguage, type Language } from "./i18n";

export type ActiveView = "house" | "room" | "objects";

export interface AppConfig {
  language: Language;
  activeView: ActiveView;
  houseConstructionTier: number;
  houseMaterialBudget: number;
  houseHeight: number;
  houseSameHeight: boolean;
  houseMaxCopiesPerRoomType: HouseMaxCopiesPerRoomType;
  roomType: string;
  roomTier: number;
  width: number;
  depth: number;
  height: number;
  roomSizeMode: "auto" | "manual" | "materials";
  materialBudget: number;
  minXpEfficiencyPercent: number;
  allowElectricPower: boolean;
  allowMechanicalPower: boolean;
  allowFuel: boolean;
  allowWater: boolean;
  allowChimney: boolean;
  disabledFuelTags: string[];
  devMode: boolean;
  selectedSkills: SkillClass[];
  disabledItems: ItemClass[];
  objectSearch: string;
  objectCategories: string[];
  objectCraftSkills: string[];
  objectSort: "name-asc" | "name-desc" | "xp-desc" | "xp-asc" | "floor-desc" | "floor-asc" | "volume-desc" | "volume-asc";
}

export const DEFAULT_CONFIG: AppConfig = {
  language: "fr",
  activeView: "room",
  houseConstructionTier: 2,
  houseMaterialBudget: 200,
  houseHeight: 3,
  houseSameHeight: true,
  houseMaxCopiesPerRoomType: "auto",
  roomType: "Bedroom",
  roomTier: 2,
  width: 6,
  depth: 5,
  height: 3,
  roomSizeMode: "auto",
  materialBudget: 120,
  minXpEfficiencyPercent: 50,
  allowElectricPower: true,
  allowMechanicalPower: true,
  allowFuel: true,
  allowWater: true,
  allowChimney: true,
  disabledFuelTags: [],
  devMode: false,
  selectedSkills: [],
  disabledItems: [],
  objectSearch: "",
  objectCategories: [],
  objectCraftSkills: [],
  objectSort: "name-asc",
};

const CONFIG_KEY = "ecoHousingReactConfig";
const OWNED_KEY = "ecoHousingOwnedItems";

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      objectCategories: Array.isArray(parsed.objectCategories)
        ? parsed.objectCategories
        : parsed.objectCategory && parsed.objectCategory !== "all"
          ? [parsed.objectCategory]
          : DEFAULT_CONFIG.objectCategories,
      objectCraftSkills: Array.isArray(parsed.objectCraftSkills)
        ? parsed.objectCraftSkills
        : parsed.objectCraftSkill && parsed.objectCraftSkill !== "all"
          ? [parsed.objectCraftSkill]
          : DEFAULT_CONFIG.objectCraftSkills,
      language: isLanguage(parsed.language) ? parsed.language : DEFAULT_CONFIG.language,
      activeView: parsed.activeView === "house" || parsed.activeView === "room" || parsed.activeView === "objects" ? parsed.activeView : DEFAULT_CONFIG.activeView,
      houseConstructionTier: normalizeInteger(parsed.houseConstructionTier, DEFAULT_CONFIG.houseConstructionTier, 0, 5),
      houseMaterialBudget: normalizeInteger(parsed.houseMaterialBudget, DEFAULT_CONFIG.houseMaterialBudget, 0, 10000),
      houseHeight: normalizeInteger(parsed.houseHeight, DEFAULT_CONFIG.houseHeight, 2, 8),
      houseSameHeight: parsed.houseSameHeight ?? DEFAULT_CONFIG.houseSameHeight,
      houseMaxCopiesPerRoomType: normalizeHouseMaxCopies(parsed.houseMaxCopiesPerRoomType),
      roomSizeMode: parsed.roomSizeMode === "auto" || parsed.roomSizeMode === "manual" || parsed.roomSizeMode === "materials" ? parsed.roomSizeMode : DEFAULT_CONFIG.roomSizeMode,
      materialBudget: Number.isFinite(Number(parsed.materialBudget)) ? Number(parsed.materialBudget) : DEFAULT_CONFIG.materialBudget,
      minXpEfficiencyPercent: normalizePercent(parsed.minXpEfficiencyPercent, DEFAULT_CONFIG.minXpEfficiencyPercent),
      allowElectricPower: parsed.allowElectricPower ?? DEFAULT_CONFIG.allowElectricPower,
      allowMechanicalPower: parsed.allowMechanicalPower ?? DEFAULT_CONFIG.allowMechanicalPower,
      allowFuel: parsed.allowFuel ?? DEFAULT_CONFIG.allowFuel,
      allowWater: parsed.allowWater ?? DEFAULT_CONFIG.allowWater,
      allowChimney: parsed.allowChimney ?? DEFAULT_CONFIG.allowChimney,
      disabledFuelTags: Array.isArray(parsed.disabledFuelTags) ? parsed.disabledFuelTags.filter((value: unknown): value is string => typeof value === "string") : DEFAULT_CONFIG.disabledFuelTags,
      devMode: Boolean(parsed.devMode),
      objectSort: parsed.objectSort === "name" ? DEFAULT_CONFIG.objectSort : parsed.objectSort ?? DEFAULT_CONFIG.objectSort,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function normalizePercent(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, numeric));
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function normalizeHouseMaxCopies(value: unknown): HouseMaxCopiesPerRoomType {
  if (value === "auto") return "auto";
  const numeric = Number(value);
  return numeric === 1 || numeric === 2 || numeric === 3 || numeric === 4 ? numeric : DEFAULT_CONFIG.houseMaxCopiesPerRoomType;
}

export function saveConfig(config: AppConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function loadOwnedItems() {
  try {
    const raw = localStorage.getItem(OWNED_KEY);
    if (!raw) return new Map<ItemClass, number>();
    return new Map<ItemClass, number>(Object.entries(JSON.parse(raw)).map(([key, value]) => [key, Number(value) || 0]));
  } catch {
    return new Map<ItemClass, number>();
  }
}

export function saveOwnedItems(items: Map<ItemClass, number>) {
  localStorage.setItem(OWNED_KEY, JSON.stringify(Object.fromEntries(items)));
}
