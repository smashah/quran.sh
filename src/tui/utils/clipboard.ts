import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";

/**
 * Download the ayah image from surahquran.com and copy the PNG bytes
 * directly into the system clipboard.
 *
 * URL format: https://surahquran.com/img/ayah/{surahId}-{verseId}.png
 */
export async function copyAyahImage(surahId: number, verseId: number): Promise<void> {
  const url = `https://surahquran.com/img/ayah/${surahId}-${verseId}.png`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

  const buffer = Buffer.from(await response.arrayBuffer());

  // Write to a temp file — all platform commands read from a path
  const tempPath = join(tmpdir(), `quran-ayah-${randomUUID()}.png`);
  await Bun.write(tempPath, buffer);

  try {
    await writeToClipboard(tempPath, buffer);
  } finally {
    unlink(tempPath).catch(() => {});
  }
}

async function writeToClipboard(tempPath: string, buffer: Buffer): Promise<void> {
  const platform = process.platform;

  if (platform === "win32") {
    // PowerShell: load System.Drawing to put a PNG into the clipboard
    const safePath = tempPath.replace(/\\/g, "\\\\");
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      `$img = [System.Drawing.Image]::FromFile('${safePath}')`,
      "[System.Windows.Forms.Clipboard]::SetImage($img)",
      "$img.Dispose()",
    ].join("; ");

    const proc = Bun.spawn(["powershell", "-NoProfile", "-Command", script], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const err = await new Response(proc.stderr).text();
      throw new Error(`PowerShell clipboard failed: ${err.trim()}`);
    }
    return;
  }

  if (platform === "darwin") {
    // osascript: read file as PNG data class and set clipboard
    const proc = Bun.spawn(
      ["osascript", "-e", `set the clipboard to (read (POSIX file "${tempPath}") as «class PNGf»)`],
      { stdout: "ignore", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const err = await new Response(proc.stderr).text();
      throw new Error(`osascript clipboard failed: ${err.trim()}`);
    }
    return;
  }

  // Linux: try wl-copy (Wayland) then xclip (X11)
  const tried: string[] = [];
  for (const [cmd, args] of [
    ["wl-copy", ["--type", "image/png"]],
    ["xclip", ["-selection", "clipboard", "-t", "image/png"]],
  ] as [string, string[]][]) {
    try {
      const proc = Bun.spawn([cmd, ...args], {
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      proc.stdin.write(buffer);
      proc.stdin.end();
      const exitCode = await proc.exited;
      if (exitCode === 0) return;
      tried.push(cmd);
    } catch {
      tried.push(cmd);
    }
  }
  throw new Error(`No clipboard tool worked (tried: ${tried.join(", ")})`);
}
