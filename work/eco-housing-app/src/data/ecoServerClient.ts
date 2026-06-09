import type { EcoData, EcoEconomyData, EcoEconomyListing, EcoRuntimeData, EcoServerStatus } from "../domain/types";

const API_PREFIX = "/api/v1/eco-housing";

export async function loadServerRuntimeData(serverUrl: string): Promise<EcoRuntimeData> {
  const baseUrl = normalizeServerUrl(serverUrl);
  const [status, ecoData, economyData] = await Promise.all([
    fetchJson<EcoServerStatus>(`${baseUrl}${API_PREFIX}/status`),
    fetchJson<EcoData>(`${baseUrl}${API_PREFIX}/data`),
    fetchJson<EcoEconomyData>(`${baseUrl}${API_PREFIX}/economy`),
  ]);
  validateEcoData(ecoData);
  validateEconomyData(economyData);
  return {
    source: "server",
    serverUrl: baseUrl,
    status,
    ecoData,
    economyData,
    loadedAt: new Date().toISOString(),
    warnings: [...(status.warnings ?? []), ...(economyData.warnings ?? [])],
  };
}

export function normalizeServerUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Server URL is required.");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return new URL(withProtocol).toString().replace(/\/+$/, "");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return await response.json() as T;
}

function validateEcoData(data: EcoData) {
  if (!Array.isArray(data.housing)) throw new Error("Server /data response is missing housing.");
  if (!Array.isArray(data.items)) throw new Error("Server /data response is missing items.");
  if (!Array.isArray(data.recipes)) throw new Error("Server /data response is missing recipes.");
}

function validateEconomyData(data: EcoEconomyData) {
  if (!Array.isArray(data.listings)) throw new Error("Server /economy response is missing listings.");
  for (const listing of data.listings) validateListing(listing);
}

function validateListing(listing: EcoEconomyListing) {
  if (!listing.itemClass) throw new Error("Economy listing is missing itemClass.");
  if (!Number.isFinite(listing.quantity) || listing.quantity < 0) throw new Error(`Invalid stock for ${listing.itemClass}.`);
  if (!Number.isFinite(listing.price) || listing.price < 0) throw new Error(`Invalid price for ${listing.itemClass}.`);
  if (!listing.currency) throw new Error(`Missing currency for ${listing.itemClass}.`);
}
