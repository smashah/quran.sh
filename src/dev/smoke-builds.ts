import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "../..");
const distDirectory = join(projectRoot, "dist");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "quran-sh-build-smoke-"));
const binaryPath = [join(distDirectory, "quran"), join(distDirectory, "quran.exe")]
  .find(existsSync);

async function assertReadsVerse(label: string, command: string[]): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: temporaryDirectory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  if (exitCode !== 0 || !stdout.includes("[1:1] In the name of Allah")) {
    throw new Error(
      `${label} smoke test failed (exit ${exitCode})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
}

try {
  if (!binaryPath) throw new Error("Standalone executable was not created in dist/");

  await assertReadsVerse("JavaScript bundle", [
    process.execPath,
    join(distDirectory, "index.js"),
    "read",
    "1:1",
  ]);
  await assertReadsVerse("Standalone executable", [binaryPath, "read", "1:1"]);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
