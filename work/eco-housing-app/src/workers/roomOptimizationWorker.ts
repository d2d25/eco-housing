import { buildModel } from "../domain/model";
import { roomOptimization } from "../domain/roomOptimizer";
import { deserializeRoomInput, type RoomWorkerRequest, type RoomWorkerResponse } from "../ui/roomWorkerTypes";

self.onmessage = (event: MessageEvent<RoomWorkerRequest>) => {
  try {
    const model = buildModel(event.data.modelData);
    const input = deserializeRoomInput(event.data.input);
    const optimization = roomOptimization(model, input);
    self.postMessage({ ok: true, optimization } satisfies RoomWorkerResponse);
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies RoomWorkerResponse);
  }
};
