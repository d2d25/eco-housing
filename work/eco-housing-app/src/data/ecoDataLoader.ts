import { buildModel } from "../domain/model";
import type { EcoData, EcoModel } from "../domain/types";

export async function loadEcoModel(): Promise<EcoModel> {
  const response = await fetch(`${import.meta.env.BASE_URL}eco-data.json`);
  if (!response.ok) throw new Error(`Impossible de charger eco-data.json (${response.status})`);
  const data = await response.json() as EcoData;
  return buildModel(data);
}
