const ALLOWED_HOSTS = new Set(["quran.com", "www.quran.com"]);

export async function openQuranDotComUrl(value: string): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) throw new Error("Blocked an unapproved external URL");
  const platform = process.platform;
  const command = platform === "darwin"
    ? ["open", url.href]
    : platform === "win32"
      ? ["powershell", "-NoProfile", "-Command", "Start-Process", url.href]
      : ["xdg-open", url.href];
  if (!Bun.which(command[0]!)) throw new Error(`No browser opener is available; visit ${url.href}`);
  const child = Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`The browser could not open; visit ${url.href}`);
}
