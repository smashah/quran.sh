import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { APP_DATA_DIR } from "../../data/db.ts";
import { installTilawaModel, verifyTilawaModel, type TilawaModelManifest } from "./model-manager.ts";
import { TILAWA_V0_2_0_MANIFEST } from "./official-manifest.ts";

const root = join(APP_DATA_DIR, "models", "tilawa");

async function loadManifest(source: string): Promise<TilawaModelManifest> {
  if (source === "official") return TILAWA_V0_2_0_MANIFEST;
  const text = URL.canParse(source)
    ? await fetch(source).then((response) => {
        if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
        return response.text();
      })
    : await readFile(source, "utf8");
  return JSON.parse(text) as TilawaModelManifest;
}

export async function runModelCommand(args: string[]): Promise<number> {
  const command = args[0] ?? "status";
  if (command === "status") {
    const versions = await readdir(root).catch(() => []);
    for (const version of versions.filter((name) => !name.startsWith("."))) {
      const directory = join(root, version);
      console.log(`${version}\t${await verifyTilawaModel(directory).catch(() => false) ? "verified" : "corrupt"}`);
    }
    if (!versions.length) console.log("No Tilawa model installed (text reading is unaffected).");
    return 0;
  }
  if (command === "install") {
    const source = args[1];
    if (!source) throw new Error("Usage: quran models install <official|manifest-file-or-url> --yes");
    const manifest = await loadManifest(source);
    const total = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
    console.log(`Tilawa ${manifest.version}: ${total} bytes · ${manifest.license} · ${manifest.attribution}`);
    if (!args.includes("--yes")) throw new Error("Review the size, source, license, and attribution, then repeat with --yes");
    const directory = await installTilawaModel(root, manifest, {
      onProgress: (received, bytes) => process.stderr.write(`\r${Math.round(received / bytes * 100)}% ${received}/${bytes} bytes`),
    });
    process.stderr.write("\n");
    console.log(`Installed and verified ${manifest.version} in quran.sh's private model store.`);
    return 0;
  }
  if (command === "verify") {
    const version = args[1] ?? "v0.2.0";
    const ok = await verifyTilawaModel(join(root, version));
    console.log(ok ? `${version} verified` : `${version} failed verification`);
    return ok ? 0 : 1;
  }
  if (command === "remove") {
    const version = args[1];
    if (!version || !/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/.test(version)) throw new Error("Usage: quran models remove <version>");
    await rm(join(root, version), { recursive: true, force: true });
    console.log(`Removed Tilawa ${version}; reading history and Quran resources were not changed.`);
    return 0;
  }
  throw new Error("Usage: quran models status|install|verify|remove");
}
