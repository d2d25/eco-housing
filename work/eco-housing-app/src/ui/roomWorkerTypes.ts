import type { EcoData, ItemClass, RoomInput, RoomOptimization, SkillClass } from "../domain/types";

export interface SerializedRoomInput {
  roomType: string;
  tier: number;
  width: number;
  depth: number;
  height: number;
  selectedSkills: SkillClass[];
  ownedItems: [ItemClass, number][];
  disabledItems: ItemClass[];
  availability: RoomInput["availability"];
}

export interface RoomWorkerRequest {
  modelData: EcoData;
  input: SerializedRoomInput;
}

export type RoomWorkerResponse =
  | { ok: true; optimization: RoomOptimization }
  | { ok: false; error: string };

export function serializeRoomInput(input: RoomInput): SerializedRoomInput {
  return {
    roomType: input.roomType,
    tier: input.tier,
    width: input.width,
    depth: input.depth,
    height: input.height,
    selectedSkills: [...input.selectedSkills],
    ownedItems: [...input.ownedItems.entries()],
    disabledItems: [...input.disabledItems],
    availability: input.availability,
  };
}

export function deserializeRoomInput(input: SerializedRoomInput): RoomInput {
  return {
    roomType: input.roomType,
    tier: input.tier,
    width: input.width,
    depth: input.depth,
    height: input.height,
    selectedSkills: new Set(input.selectedSkills),
    ownedItems: new Map(input.ownedItems),
    disabledItems: new Set(input.disabledItems),
    availability: input.availability,
  };
}
