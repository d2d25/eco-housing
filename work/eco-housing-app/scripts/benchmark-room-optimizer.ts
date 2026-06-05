import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildModel } from "../src/domain/model";
import { roomOptimization } from "../src/domain/roomOptimizer";
import type { EcoData, ItemClass, RoomInput, SkillClass } from "../src/domain/types";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const dataPath = path.join(repoRoot, "outputs", "eco-data.json");
const data = JSON.parse(readFileSync(dataPath, "utf8")) as EcoData;
const model = buildModel(data);

const WARMUP_RUNS = 1;
const MEASURE_RUNS = 3;

const allSkills = new Set<SkillClass>(model.skills.map((skill) => skill.className));
const carpenterMason = new Set<SkillClass>(
  model.skills
    .filter((skill) => ["Carpenter", "Mason"].includes(skill.professionGroup ?? ""))
    .map((skill) => skill.className),
);

const scenarios = [
  ["Bathroom T2 auto, all skills", baseInput({ roomType: "Bathroom", tier: 2, sizeMode: "auto", selectedSkills: allSkills })],
  ["Living Room T5 auto, all skills", baseInput({ roomType: "Living Room", tier: 5, sizeMode: "auto", selectedSkills: allSkills })],
  ["Bedroom T5 auto, owned items", baseInput({
    roomType: "Bedroom",
    tier: 5,
    sizeMode: "auto",
    selectedSkills: allSkills,
    ownedItems: owned([
      ["ElkStatuetteItem", 5],
      ["NylonFutonBedItem", 2],
      ["HewnNightstandItem", 3],
    ]),
  })],
  ["Living Room T5 manual 8x8x3, carpenter+mason", baseInput({ roomType: "Living Room", tier: 5, width: 8, depth: 8, height: 3, sizeMode: "manual", selectedSkills: carpenterMason })],
  ["Outdoor all skills", baseInput({ roomType: "Outdoor", tier: 5, sizeMode: "auto", selectedSkills: allSkills })],
] as const;

console.log("Room optimizer benchmark");
console.log(`Data: ${path.relative(repoRoot, dataPath)}`);
console.log(`Warmup: ${WARMUP_RUNS}, runs: ${MEASURE_RUNS}`);
console.log("");

for (const [name, input] of scenarios) {
  for (let i = 0; i < WARMUP_RUNS; i += 1) roomOptimization(model, input);

  const samples: number[] = [];
  let score = 0;
  let entries = 0;
  for (let i = 0; i < MEASURE_RUNS; i += 1) {
    const started = performance.now();
    const result = roomOptimization(model, input);
    samples.push(performance.now() - started);
    score = result.score.capped;
    entries = result.entries.length;
  }

  const stats = summarize(samples);
  console.log(`${name.padEnd(48)} avg ${formatMs(stats.avg).padStart(8)}  p95 ${formatMs(stats.p95).padStart(8)}  min ${formatMs(stats.min).padStart(8)}  max ${formatMs(stats.max).padStart(8)}  score ${score.toFixed(1).padStart(5)}  items ${String(entries).padStart(2)}`);
}

function baseInput(partial: Partial<RoomInput>): RoomInput {
  return {
    roomType: "Bathroom",
    tier: 1,
    width: 4,
    depth: 4,
    height: 3,
    sizeMode: "auto",
    materialBudget: 100,
    selectedSkills: new Set(),
    ownedItems: new Map(),
    disabledItems: new Set(),
    availability: "available",
    ...partial,
  };
}

function owned(entries: Array<[ItemClass, number]>) {
  return new Map<ItemClass, number>(entries);
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, sample) => total + sample, 0);
  return {
    avg: sum / sorted.length,
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
  };
}

function formatMs(value: number) {
  return `${value.toFixed(1)}ms`;
}
