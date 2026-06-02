import type { ItemClass, SkillClass } from "../domain/types";
import { isLanguage, type Language } from "./i18n";

export type ActiveView = "room" | "objects";

export interface AppConfig {
  language: Language;
  activeView: ActiveView;
  roomType: string;
  roomTier: number;
  width: number;
  depth: number;
  height: number;
  roomSizeMode: "auto" | "manual" | "materials";
  materialBudget: number;
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
  roomType: "Bedroom",
  roomTier: 2,
  width: 6,
  depth: 5,
  height: 3,
  roomSizeMode: "auto",
  materialBudget: 120,
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
      roomSizeMode: parsed.roomSizeMode === "auto" || parsed.roomSizeMode === "manual" || parsed.roomSizeMode === "materials" ? parsed.roomSizeMode : DEFAULT_CONFIG.roomSizeMode,
      materialBudget: Number.isFinite(Number(parsed.materialBudget)) ? Number(parsed.materialBudget) : DEFAULT_CONFIG.materialBudget,
      devMode: Boolean(parsed.devMode),
      objectSort: parsed.objectSort === "name" ? DEFAULT_CONFIG.objectSort : parsed.objectSort ?? DEFAULT_CONFIG.objectSort,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
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
