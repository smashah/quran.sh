import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tempPaths: string[] = [];

afterEach(() => {
  for (const path of tempPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("CLI startup", () => {
  test("help does not initialize or log the database", async () => {
    const dataHome = mkdtempSync(join(tmpdir(), "quran-sh-cli-"));
    tempPaths.push(dataHome);

    const child = Bun.spawn([process.execPath, "src/index.ts", "--help"], {
      cwd: resolve(import.meta.dir, ".."),
      env: { ...process.env, XDG_DATA_HOME: dataHome },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("quran.sh — Read the Quran from your terminal");
    expect(stdout).not.toContain("[DB]");
    expect(stderr).toBe("");
    expect(existsSync(join(dataHome, "quran.sh"))).toBe(false);
  });
});
