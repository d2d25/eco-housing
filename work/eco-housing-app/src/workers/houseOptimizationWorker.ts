import { optimizeHouse } from "../domain/houseOptimizer";
import { buildModel } from "../domain/model";
import { deserializeHouseInput, type HouseWorkerRequest, type HouseWorkerResponse } from "../ui/houseWorkerTypes";

self.onmessage = (event: MessageEvent<HouseWorkerRequest>) => {
  try {
    const model = buildModel(event.data.modelData);
    const input = deserializeHouseInput(event.data.input);
    const optimization = optimizeHouse(model, input);
    self.postMessage({ ok: true, optimization } satisfies HouseWorkerResponse);
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies HouseWorkerResponse);
  }
};
