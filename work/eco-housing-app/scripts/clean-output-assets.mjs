import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const appDir = resolve(import.meta.dirname, "..");
const outputDir = resolve(import.meta.dirname, "../../../outputs");

await rm(resolve(outputDir, "assets"), { recursive: true, force: true });
await rm(resolve(outputDir, "index.html"), { force: true });
await rm(resolve(appDir, "tsconfig.tsbuildinfo"), { force: true });
await rm(resolve(appDir, "tsconfig.node.tsbuildinfo"), { force: true });
await rm(resolve(appDir, "vite.config.js"), { force: true });
await rm(resolve(appDir, "vite.config.d.ts"), { force: true });
