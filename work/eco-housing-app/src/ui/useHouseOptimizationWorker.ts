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
  const readyRef = useRef(false);
  const requestIdRef = useRef(0);
  const pendingInputRef = useRef<{ cacheKey: string; input: HouseInput } | null>(null);
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
    workerRef.current?.terminate();
    readyRef.current = false;
    pendingInputRef.current = null;
    const worker = new Worker(new URL("../workers/houseOptimizationWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<HouseWorkerResponse>) => {
      if (workerRef.current !== worker) return;
      if (event.data.type === "ready") {
        readyRef.current = true;
        const pending = pendingInputRef.current;
        if (pending) postHouseSolve(worker, pending.cacheKey, pending.input, requestIdRef);
        return;
      }
      if (event.data.type !== "result" || event.data.requestId !== requestIdRef.current) return;
      if (event.data.ok) {
        const pending = pendingInputRef.current;
        if (pending) setCachedHouseResult(resultCacheRef.current, pending.cacheKey, event.data.optimization);
        setState({ status: "ready", optimization: event.data.optimization, error: null });
      } else {
        setState({ status: "error", optimization: null, error: event.data.error });
      }
    };
    worker.onerror = (event) => {
      if (workerRef.current !== worker) return;
      setState({ status: "error", optimization: null, error: event.message || "Erreur worker optimisation maison" });
    };
    worker.postMessage({ type: "init", modelData });

    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      readyRef.current = false;
    };
  }, [modelData]);

  useEffect(() => {
    const cacheKey = houseWorkerCacheKey(input);
    const cached = resultCacheRef.current.get(cacheKey);
    if (cached) {
      resultCacheRef.current.delete(cacheKey);
      resultCacheRef.current.set(cacheKey, cached);
      requestIdRef.current += 1;
      pendingInputRef.current = null;
      setState({ status: "ready", optimization: cloneHouseOptimization(cached), error: null });
      return;
    }

    pendingInputRef.current = { cacheKey, input };
    setState({ status: "loading", optimization: null, error: null });
    const timer = window.setTimeout(() => {
      const worker = workerRef.current;
      if (worker && readyRef.current) postHouseSolve(worker, cacheKey, input, requestIdRef);
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [input]);

  return state;
}

function postHouseSolve(worker: Worker, cacheKey: string, input: HouseInput, requestIdRef: { current: number }) {
  requestIdRef.current += 1;
  worker.postMessage({ type: "solve", requestId: requestIdRef.current, input: serializeHouseInput(input) });
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
