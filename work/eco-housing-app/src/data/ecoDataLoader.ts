import { buildModel } from "../domain/model";
import type { EcoData, EcoModel, EcoRuntimeData } from "../domain/types";

export async function loadEcoModel(): Promise<EcoModel> {
  const runtime = await loadVanillaRuntimeData();
  return buildModel(runtime.ecoData);
}

export async function loadVanillaRuntimeData(): Promise<EcoRuntimeData> {
  const response = await fetch(`${import.meta.env.BASE_URL}eco-data.json`);
  if (!response.ok) throw new Error(`Impossible de charger eco-data.json (${response.status})`);
  const data = await response.json() as EcoData;
  return {
    source: "vanilla",
    ecoData: data,
    loadedAt: new Date().toISOString(),
    warnings: readWarnings(data),
  };
}

function readWarnings(data: EcoData) {
  const warnings = data.meta?.warnings;
  return Array.isArray(warnings) ? warnings.filter((entry): entry is string => typeof entry === "string") : [];
}
