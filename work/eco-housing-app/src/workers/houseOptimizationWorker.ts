import { optimizeHouse } from "../domain/houseOptimizer";
import { buildModel } from "../domain/model";
import type { EcoModel } from "../domain/types";
import { deserializeHouseInput, type HouseWorkerRequest, type HouseWorkerResponse } from "../ui/houseWorkerTypes";

let model: EcoModel | null = null;

self.onmessage = (event: MessageEvent<HouseWorkerRequest>) => {
  try {
    if (event.data.type === "init") {
      model = buildModel(event.data.modelData);
      self.postMessage({ type: "ready" } satisfies HouseWorkerResponse);
      return;
    }
    if (!model) throw new Error("House worker is not initialized.");
    const input = deserializeHouseInput(event.data.input);
    const optimization = optimizeHouse(model, input);
    self.postMessage({ type: "result", requestId: event.data.requestId, ok: true, optimization } satisfies HouseWorkerResponse);
  } catch (error) {
    self.postMessage({
      type: "result",
      requestId: event.data.type === "solve" ? event.data.requestId : -1,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies HouseWorkerResponse);
  }
};
