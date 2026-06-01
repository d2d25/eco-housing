import { formatRequirement } from "../domain/craftResolver";
import type { CraftResolution, EcoModel, HousingItem } from "../domain/types";

export function formatNumber(value: number, digits = 1) {
  return value.toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatAvailability(model: EcoModel, item: HousingItem, resolution: CraftResolution) {
  if (resolution.craftable) return "disponible";
  return `manque ${resolution.missing.map((req) => formatRequirement(req, model)).join(", ")}`;
}
