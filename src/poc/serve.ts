import { dirname, join } from "node:path";
import { readBoundedResponse } from "../features/network/bounded-response.ts";

const WEB_ROOT = join(import.meta.dir, "web");
const QURAN_FONT_URL = "https://quran.com/fonts/quran/hafs/uthmanic_hafs/UthmanicHafs1Ver18.woff2";
const DEFAULT_PORT = 4173;
const MAX_FONT_BYTES = 512 * 1024;

function requestedPort(): number {
  const parsed = Number(process.env.QURAN_POC_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(parsed) || parsed < 1_024 || parsed > 65_535) {
    throw new Error("QURAN_POC_PORT must be an integer between 1024 and 65535");
  }
  return parsed;
}

const browserBuild = await Bun.build({
  entrypoints: [join(WEB_ROOT, "app.ts")],
  target: "browser",
  format: "esm",
  minify: false,
  sourcemap: "none",
  external: ["three"],
});

if (!browserBuild.success) {
  for (const log of browserBuild.logs) console.error(log);
  throw new Error("Could not build the browser POC");
}

const browserEntry = browserBuild.outputs.find((output) => output.kind === "entry-point");
if (!browserEntry) throw new Error("The browser POC build produced no entry point");

const [html, css, appJavaScript] = await Promise.all([
  Bun.file(join(WEB_ROOT, "index.html")).text(),
  Bun.file(join(WEB_ROOT, "styles.css")).text(),
  browserEntry.text(),
]);
const threeEntry = Bun.resolveSync("three", import.meta.dir);
const threeModule = Bun.file(threeEntry);
const threeCore = Bun.file(join(dirname(threeEntry), "three.core.js"));
let fontPromise: Promise<Uint8Array> | null = null;

function securityHeaders(contentType: string, cacheControl = "no-store"): HeadersInit {
  return {
    "cache-control": cacheControl,
    "content-type": contentType,
    "cross-origin-opener-policy": "same-origin",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "font-src 'self'",
      "img-src 'self' data: https://i.ytimg.com",
      "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
      "connect-src 'self'",
      "media-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; "),
  };
}

async function quranFont(): Promise<Uint8Array> {
  fontPromise ??= (async () => {
    const signal = AbortSignal.timeout(10_000);
    const response = await fetch(QURAN_FONT_URL, {
      headers: { accept: "font/woff2" },
      redirect: "error",
      signal,
    });
    if (!response.ok) throw new Error(`Quran font request failed with HTTP ${response.status}`);
    return readBoundedResponse(response, { maxBytes: MAX_FONT_BYTES, signal, label: "The Quran font" });
  })().catch((cause) => {
    fontPromise = null;
    throw cause;
  });
  return fontPromise;
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: requestedPort(),
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const { pathname } = new URL(request.url);
    const head = request.method === "HEAD";
    if (pathname === "/" || pathname === "/index.html") {
      return new Response(head ? null : html, { headers: securityHeaders("text/html; charset=utf-8") });
    }
    if (pathname === "/styles.css") {
      return new Response(head ? null : css, { headers: securityHeaders("text/css; charset=utf-8") });
    }
    if (pathname === "/app.js") {
      return new Response(head ? null : appJavaScript, { headers: securityHeaders("text/javascript; charset=utf-8") });
    }
    if (pathname === "/vendor/three.module.js") {
      return new Response(head ? null : threeModule, {
        headers: securityHeaders("text/javascript; charset=utf-8", "public, max-age=31536000, immutable"),
      });
    }
    if (pathname === "/vendor/three.core.js") {
      return new Response(head ? null : threeCore, {
        headers: securityHeaders("text/javascript; charset=utf-8", "public, max-age=31536000, immutable"),
      });
    }
    if (pathname === "/fonts/uthmani.woff2") {
      const headers = securityHeaders("font/woff2", "public, max-age=86400");
      if (head) return new Response(null, { headers });
      try {
        const font = await quranFont();
        return new Response(Uint8Array.from(font).buffer, { headers });
      } catch (cause) {
        return new Response(cause instanceof Error ? cause.message : "Quran font unavailable", { status: 502 });
      }
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`quran.sh single-ayah POCs: ${server.url}`);
console.log("Press Ctrl+C to stop the local server.");
