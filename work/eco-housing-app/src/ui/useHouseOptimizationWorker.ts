import { useEffect, useMemo, useRef, useState } from "react";
import type { EcoModel, HouseInput, HouseOptimizationResult, ItemClass, SkillClass } from "../domain/types";
import { serializeHouseInput, type HouseWorkerResponse } from "./houseWorkerTypes";
import type { AppConfig } from "./storage";
import { toEcoData } from "./workerModelData";

const DEBOUNCE_MS = 300;

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
    setState({ status: "loading", optimization: null, error: null });
    const timer = window.setTimeout(() => {
      workerRef.current?.terminate();
      const worker = new Worker(new URL("../workers/houseOptimizationWorker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<HouseWorkerResponse>) => {
        if (workerRef.current !== worker) return;
        if (event.data.ok) setState({ status: "ready", optimization: event.data.optimization, error: null });
        else setState({ status: "error", optimization: null, error: event.data.error });
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
