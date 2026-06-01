import type { ItemClass, SkillClass } from "../domain/types";

export type ActiveView = "room" | "objects";

export interface AppConfig {
  activeView: ActiveView;
  roomType: string;
  roomTier: number;
  width: number;
  depth: number;
  height: number;
  selectedSkills: SkillClass[];
  disabledItems: ItemClass[];
  objectSearch: string;
  objectCategory: string;
  objectAvailability: "available" | "all" | "locked";
}

export const DEFAULT_CONFIG: AppConfig = {
  activeView: "room",
  roomType: "Bedroom",
  roomTier: 2,
  width: 6,
  depth: 5,
  height: 3,
  selectedSkills: [],
  disabledItems: [],
  objectSearch: "",
  objectCategory: "all",
  objectAvailability: "available",
};

const CONFIG_KEY = "ecoHousingReactConfig";
const OWNED_KEY = "ecoHousingOwnedItems";

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed, objectAvailability: parsed.objectAvailability ?? parsed.availability ?? DEFAULT_CONFIG.objectAvailability };
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
