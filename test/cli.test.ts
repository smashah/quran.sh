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

  test("help is also a command", async () => {
    const result = await runCli(["help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:\n  quran [command]");
  });
});

async function runCli(
  args: string[],
  dataHome = mkdtempSync(join(tmpdir(), "quran-sh-cli-")),
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (!tempPaths.includes(dataHome)) tempPaths.push(dataHome);
  const child = Bun.spawn([process.execPath, "src/index.ts", ...args], {
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
  return { exitCode, stdout, stderr };
}

describe("CLI read", () => {
  test("keeps the default output and accepts forgiving names", async () => {
    const byNumber = await runCli(["read", "1"]);
    const byName = await runCli(["read", "fatiha"]);
    expect(byNumber.exitCode).toBe(0);
    expect(byNumber.stdout).toStartWith("Surah 1: Al-Fatihah (The Opener)\n\nIn the name of Allah");
    expect(byName.stdout).toBe(byNumber.stdout);
  });

  test("adds Arabic, numbers and other languages on request", async () => {
    const arabic = await runCli(["read", "1:1", "--arabic"]);
    expect(arabic.stdout).toContain("[1:1]\nبِسۡمِ");
    const numbered = await runCli(["read", "1", "-n"]);
    expect(numbered.stdout).toContain("[1:2] [All] praise");
    const french = await runCli(["read", "1:1", "--lang", "fr"]);
    expect(french.stdout).toContain("Au nom d'Allah");
  });

  test("explains bad references and unknown options", async () => {
    const overflow = await runCli(["read", "2:300"]);
    expect(overflow.exitCode).toBe(1);
    expect(overflow.stderr).toContain("Al-Baqarah (2) has 286 verses");
    const option = await runCli(["read", "1", "--bogus"]);
    expect(option.exitCode).toBe(1);
    expect(option.stderr).toContain('Unknown option "--bogus"');
    const language = await runCli(["read", "1", "--lang", "xx"]);
    expect(language.stderr).toContain("--lang needs one of");
  });

  test("streak pluralises days", async () => {
    const dataHome = mkdtempSync(join(tmpdir(), "quran-sh-cli-"));
    await runCli(["log", "1:1"], dataHome);
    const streak = await runCli(["streak"], dataHome);
    expect(streak.stdout).toContain("Current Streak: 1 day\n");
    expect(streak.stdout).not.toContain("1 days");
  });
});
