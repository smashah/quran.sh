import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDataHome = mkdtempSync(join(tmpdir(), "quran-sh-tests-"));
process.env["XDG_DATA_HOME"] = testDataHome;
process.on("exit", () => rmSync(testDataHome, { recursive: true, force: true }));
