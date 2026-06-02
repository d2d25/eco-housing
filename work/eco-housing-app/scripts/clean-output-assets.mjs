import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const appDir = resolve(import.meta.dirname, "..");
const outputDir = resolve(import.meta.dirname, "../../../outputs");

const assetsDir = resolve(outputDir, "assets");
try {
  const entries = await readdir(assetsDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.name !== "eco-icons")
      .map((entry) => rm(resolve(assetsDir, entry.name), { recursive: true, force: true })),
  );
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await rm(resolve(outputDir, "index.html"), { force: true });
await rm(resolve(appDir, "tsconfig.tsbuildinfo"), { force: true });
await rm(resolve(appDir, "tsconfig.node.tsbuildinfo"), { force: true });
await rm(resolve(appDir, "vite.config.js"), { force: true });
await rm(resolve(appDir, "vite.config.d.ts"), { force: true });
