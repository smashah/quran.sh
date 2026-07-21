import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const dist = resolve(root, "dist");
const startup = await readFile(resolve(dist, "index.js"), "utf8");
const forbidden = ["@opentui/three", "onnxruntime-node", "quran_bn.json", "quran_fr.json", "quran_ur.json", "quranTransliteration"];
const violations = forbidden.filter((marker) => startup.includes(marker));
const chunks = (await readdir(dist)).filter((file) => file.endsWith(".js"));
if (violations.length) throw new Error(`Startup chunk contains lazy-only markers: ${violations.join(", ")}`);
if (Buffer.byteLength(startup) > 32 * 1024) throw new Error(`Startup chunk is ${Buffer.byteLength(startup)} bytes; budget is 32768`);
if (chunks.length < 4) throw new Error("Expected code-split feature and language chunks");
console.log(`Lazy graph verified: ${Buffer.byteLength(startup)}-byte startup chunk, ${chunks.length - 1} deferred chunks.`);
