import { useEffect, useMemo, useRef, useState } from "react";
import type { EcoData, EcoModel, ItemClass, RoomInput, RoomOptimization, SkillClass } from "../domain/types";
import { serializeRoomInput, type RoomWorkerResponse } from "./roomWorkerTypes";
import type { AppConfig } from "./storage";

const DEBOUNCE_MS = 300;

export type RoomOptimizationWorkerState =
  | { status: "loading"; optimization: null; error: null }
  | { status: "ready"; optimization: RoomOptimization; error: null }
  | { status: "error"; optimization: null; error: string };

export function useRoomOptimizationWorker(args: {
  model: EcoModel;
  config: AppConfig;
  selectedSkills: Set<SkillClass>;
  disabledItems: Set<ItemClass>;
  ownedItems: Map<ItemClass, number>;
}): RoomOptimizationWorkerState {
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<RoomOptimizationWorkerState>({ status: "loading", optimization: null, error: null });
  const modelData = useMemo(() => toEcoData(args.model), [args.model]);
  const input = useMemo<RoomInput>(() => ({
    roomType: args.config.roomType,
    tier: args.config.roomTier,
    width: args.config.width,
    depth: args.config.depth,
    height: args.config.height,
    sizeMode: args.config.roomSizeMode,
    materialBudget: args.config.materialBudget,
    selectedSkills: args.selectedSkills,
    ownedItems: args.ownedItems,
    disabledItems: args.disabledItems,
    availability: "available",
    minXpEfficiencyPercent: args.config.minXpEfficiencyPercent,
  }), [
    args.config.roomType,
    args.config.roomTier,
    args.config.width,
    args.config.depth,
    args.config.height,
    args.config.roomSizeMode,
    args.config.materialBudget,
    args.config.minXpEfficiencyPercent,
    args.selectedSkills,
    args.ownedItems,
    args.disabledItems,
  ]);

  useEffect(() => {
    setState({ status: "loading", optimization: null, error: null });
    const timer = window.setTimeout(() => {
      workerRef.current?.terminate();
      const worker = new Worker(new URL("../workers/roomOptimizationWorker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<RoomWorkerResponse>) => {
        if (workerRef.current !== worker) return;
        if (event.data.ok) setState({ status: "ready", optimization: event.data.optimization, error: null });
        else setState({ status: "error", optimization: null, error: event.data.error });
      };
      worker.onerror = (event) => {
        if (workerRef.current !== worker) return;
        setState({ status: "error", optimization: null, error: event.message || "Erreur worker optimisation" });
      };
      worker.postMessage({ modelData, input: serializeRoomInput(input) });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [modelData, input]);

  return state;
}

function toEcoData(model: EcoModel): EcoData {
  return {
    meta: model.meta,
    housingConfig: model.housingConfig,
    housing: model.housing,
    items: model.items,
    recipes: model.recipes,
    skills: model.skills,
    roomCategories: model.roomCategories,
    roomTiers: model.roomTiers,
    worldObjects: model.worldObjects,
    occupancy: model.occupancy,
    housingEquivalenceGroups: model.housingEquivalenceGroups,
  };
}
