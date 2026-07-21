import { join } from "node:path";
import { APP_DATA_DIR } from "../../data/db.ts";
import { createResourcePackManager, ResourcePackError } from "./manager.ts";

const manager = createResourcePackManager(join(APP_DATA_DIR, "resources"));

function usage(): string {
  return `Usage:
  quran resources list
  quran resources import <manifest.json> <data.json|data.sqlite>
  quran resources verify <id> [version]
  quran resources licenses
  quran resources remove <id> [version]

QUL downloads are imported from files you obtained with permission. quran.sh
does not scrape QUL or automate its sign-in flow.`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export async function runResourceCommand(args: readonly string[]): Promise<number> {
  const command = args[0] ?? "list";
  try {
    if (command === "list") {
      const packs = await manager.list();
      if (packs.length === 0) {
        console.log("No optional resource packs installed.");
        return 0;
      }
      for (const pack of packs) {
        console.log(
          `${pack.manifest.id}@${pack.manifest.version}  ${pack.manifest.kind}  ${formatBytes(pack.manifest.content.bytes)}  ${pack.manifest.title}`,
        );
      }
      return 0;
    }

    if (command === "import") {
      const manifestPath = args[1];
      const dataPath = args[2];
      if (!manifestPath || !dataPath) {
        console.error(usage());
        return 1;
      }
      const pack = await manager.importPack(manifestPath, dataPath);
      console.log(`Installed ${pack.manifest.id}@${pack.manifest.version}`);
      console.log(`License: ${pack.manifest.license.name} - ${pack.manifest.license.attribution}`);
      return 0;
    }

    if (command === "verify") {
      const id = args[1];
      if (!id) {
        console.error(usage());
        return 1;
      }
      const result = await manager.verify(id, args[2]);
      console.log(`${result.ok ? "Verified" : "FAILED"} ${result.id}@${result.version}`);
      return result.ok ? 0 : 1;
    }

    if (command === "licenses") {
      const licenses = await manager.licenses();
      if (licenses.length === 0) console.log("No optional resource-pack licenses installed.");
      for (const license of licenses) {
        console.log(`${license.id}@${license.version}`);
        console.log(`  ${license.name}: ${license.url}`);
        console.log(`  ${license.attribution}`);
        console.log(`  Redistribution: ${license.redistribution}`);
      }
      return 0;
    }

    if (command === "remove") {
      const id = args[1];
      if (!id) {
        console.error(usage());
        return 1;
      }
      await manager.remove(id, args[2]);
      console.log(`Removed ${id}${args[2] ? `@${args[2]}` : ""}`);
      return 0;
    }

    console.error(usage());
    return 1;
  } catch (error) {
    if (error instanceof ResourcePackError) {
      console.error(`${error.code}: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
