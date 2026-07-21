import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const outdir = resolve(root, "dist");
await rm(outdir, { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [resolve(root, "src", "index.ts")],
  outdir,
  target: "bun",
  minify: true,
  splitting: true,
  sourcemap: "none",
  external: ["@opentui/core", "@opentui/react", "@opentui/three", "react", "three"],
  naming: { entry: "index.js", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
for (const output of result.outputs) console.log(`${output.kind}\t${output.size}\t${output.path.replace(`${root}/`, "")}`);
