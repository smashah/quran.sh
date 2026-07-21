import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../../src/data/db.ts";

export function createTempDatabase(prefix: string): { path: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const path = join(directory, "quran.db");
  return {
    path,
    cleanup: () => {
      closeDatabase(path);
      // bun:sqlite caches prepared statements and closes their file handles
      // during finalization, which can happen after Database.close() on Windows.
      Bun.gc(true);
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (process.platform === "win32" && (code === "EBUSY" || code === "EPERM")) return;
        throw error;
      }
    },
  };
}
