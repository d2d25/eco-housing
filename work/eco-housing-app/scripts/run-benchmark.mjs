import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, ".tmp");
const outFile = path.join(outDir, "room-optimizer-benchmark.mjs");

await mkdir(outDir, { recursive: true });
await build({
  entryPoints: [path.join(root, "scripts", "benchmark-room-optimizer.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  logLevel: "silent",
});

await import(pathToFileURL(outFile).href);
