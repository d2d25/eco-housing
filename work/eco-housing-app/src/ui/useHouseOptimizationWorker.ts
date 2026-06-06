import { useEffect, useMemo, useRef, useState } from "react";
import type { EcoModel, HouseInput, HouseOptimizationResult, ItemClass, SkillClass } from "../domain/types";
import { serializeHouseInput, type HouseWorkerResponse } from "./houseWorkerTypes";
import type { AppConfig } from "./storage";
import { toEcoData } from "./workerModelData";

const DEBOUNCE_MS = 300;
const RESULT_CACHE_LIMIT = 50;

export type HouseOptimizationWorkerState =
  | { status: "loading"; optimization: null; error: null }
  | { status: "ready"; optimization: HouseOptimizationResult; error: null }
  | { status: "error"; optimization: null; error: string };

export function useHouseOptimizationWorker(args: {
  model: EcoModel;
  config: AppConfig;
  selectedSkills: Set<SkillClass>;
  disabledItems: Set<ItemClass>;
  ownedItems: Map<ItemClass, number>;
}): HouseOptimizationWorkerState {
  const workerRef = useRef<Worker | null>(null);
  const resultCacheRef = useRef<Map<string, HouseOptimizationResult>>(new Map());
  const [state, setState] = useState<HouseOptimizationWorkerState>({ status: "loading", optimization: null, error: null });
  const modelData = useMemo(() => toEcoData(args.model), [args.model]);
  const input = useMemo<HouseInput>(() => ({
    constructionTier: args.config.houseConstructionTier,
    materialBudget: args.config.houseMaterialBudget,
    height: args.config.houseHeight,
    sameHeightForAllRooms: args.config.houseSameHeight,
    maxCopiesPerRoomType: args.config.houseMaxCopiesPerRoomType,
    selectedSkills: args.selectedSkills,
    ownedItems: args.ownedItems,
    disabledItems: args.disabledItems,
    availability: "available",
    minXpEfficiencyPercent: args.config.minXpEfficiencyPercent,
    allowElectricPower: args.config.allowElectricPower,
    allowMechanicalPower: args.config.allowMechanicalPower,
    allowFuel: args.config.allowFuel,
    allowWater: args.config.allowWater,
    allowChimney: args.config.allowChimney,
    disabledFuelTags: new Set(args.config.disabledFuelTags),
  }), [
    args.config.houseConstructionTier,
    args.config.houseMaterialBudget,
    args.config.houseHeight,
    args.config.houseSameHeight,
    args.config.houseMaxCopiesPerRoomType,
    args.config.minXpEfficiencyPercent,
    args.config.allowElectricPower,
    args.config.allowMechanicalPower,
    args.config.allowFuel,
    args.config.allowWater,
    args.config.allowChimney,
    args.config.disabledFuelTags,
    args.selectedSkills,
    args.ownedItems,
    args.disabledItems,
  ]);

  useEffect(() => {
    const cacheKey = houseWorkerCacheKey(input);
    const cached = resultCacheRef.current.get(cacheKey);
    if (cached) {
      resultCacheRef.current.delete(cacheKey);
      resultCacheRef.current.set(cacheKey, cached);
      workerRef.current?.terminate();
      workerRef.current = null;
      setState({ status: "ready", optimization: cloneHouseOptimization(cached), error: null });
      return;
    }

    setState({ status: "loading", optimization: null, error: null });
    const timer = window.setTimeout(() => {
      workerRef.current?.terminate();
      const worker = new Worker(new URL("../workers/houseOptimizationWorker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<HouseWorkerResponse>) => {
        if (workerRef.current !== worker) return;
        if (event.data.ok) {
          setCachedHouseResult(resultCacheRef.current, cacheKey, event.data.optimization);
          setState({ status: "ready", optimization: event.data.optimization, error: null });
        } else {
          setState({ status: "error", optimization: null, error: event.data.error });
        }
      };
      worker.onerror = (event) => {
        if (workerRef.current !== worker) return;
        setState({ status: "error", optimization: null, error: event.message || "Erreur worker optimisation maison" });
      };
      worker.postMessage({ modelData, input: serializeHouseInput(input) });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [modelData, input]);

  return state;
}

function setCachedHouseResult(cache: Map<string, HouseOptimizationResult>, key: string, result: HouseOptimizationResult) {
  cache.set(key, cloneHouseOptimization(result));
  while (cache.size > RESULT_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}

function cloneHouseOptimization(result: HouseOptimizationResult) {
  return structuredClone(result);
}

function houseWorkerCacheKey(input: HouseInput) {
  return JSON.stringify({
    constructionTier: input.constructionTier,
    materialBudget: input.materialBudget,
    height: input.height,
    sameHeightForAllRooms: input.sameHeightForAllRooms,
    maxCopiesPerRoomType: input.maxCopiesPerRoomType,
    selectedSkills: [...input.selectedSkills].sort(),
    ownedItems: [...input.ownedItems.entries()].filter(([, quantity]) => quantity > 0).sort(([a], [b]) => a.localeCompare(b)),
    disabledItems: [...input.disabledItems].sort(),
    availability: input.availability,
    minXpEfficiencyPercent: input.minXpEfficiencyPercent ?? null,
    allowElectricPower: input.allowElectricPower ?? null,
    allowMechanicalPower: input.allowMechanicalPower ?? null,
    allowFuel: input.allowFuel ?? null,
    allowWater: input.allowWater ?? null,
    allowChimney: input.allowChimney ?? null,
    disabledFuelTags: [...(input.disabledFuelTags ?? new Set<string>())].sort(),
  });
}
