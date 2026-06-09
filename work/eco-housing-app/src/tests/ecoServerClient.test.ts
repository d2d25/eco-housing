import { afterEach, describe, expect, test, vi } from "vitest";
import { loadServerRuntimeData, normalizeServerUrl } from "../data/ecoServerClient";
import type { EcoData, EcoEconomyData, EcoServerStatus } from "../domain/types";

const ecoData: EcoData = {
  housing: [],
  items: [],
  recipes: [],
  skills: [],
  roomCategories: [],
  roomTiers: [],
  worldObjects: [],
  occupancy: [],
};

const economyData: EcoEconomyData = {
  fetchedAt: "2026-01-01T00:00:00.000Z",
  currencies: ["Credits"],
  listings: [{ itemClass: "ChairItem", quantity: 3, price: 10, currency: "Credits" }],
};

const status: EcoServerStatus = {
  serverName: "Test Server",
  ecoVersion: "1.0",
  exporterVersion: "0.2",
  warnings: ["mock warning"],
};

describe("eco server client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("normalizes server urls", () => {
    expect(normalizeServerUrl("localhost:3001/")).toBe("http://localhost:3001");
    expect(normalizeServerUrl("https://eco.example.test/base/")).toBe("https://eco.example.test/base");
  });

  test("loads status, data, and economy from exporter endpoints", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url.endsWith("/status") ? status : url.endsWith("/data") ? ecoData : economyData;
      return { ok: true, json: async () => body } as Response;
    }));

    const runtime = await loadServerRuntimeData("http://server.test");

    expect(runtime.source).toBe("server");
    expect(runtime.status?.serverName).toBe("Test Server");
    expect(runtime.economyData?.listings[0]?.itemClass).toBe("ChairItem");
    expect(runtime.warnings).toContain("mock warning");
  });

  test("rejects invalid economy payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url.endsWith("/status") ? status : url.endsWith("/data") ? ecoData : { fetchedAt: "x", currencies: [] };
      return { ok: true, json: async () => body } as Response;
    }));

    await expect(loadServerRuntimeData("http://server.test")).rejects.toThrow("missing listings");
  });
});
