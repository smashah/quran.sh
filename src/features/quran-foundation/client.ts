import { readBoundedResponse } from "../network/bounded-response.ts";

const PRODUCTION_AUTH_ORIGIN = "https://oauth2.quran.foundation";
const PRODUCTION_API_ORIGIN = "https://apis.quran.foundation";
const PRELIVE_AUTH_ORIGIN = "https://prelive-oauth2.quran.foundation";
const PRELIVE_API_ORIGIN = "https://apis-prelive.quran.foundation";
const TOKEN_LIMIT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

interface ProviderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly environment: "production" | "prelive";
  readonly authOrigin: string;
  readonly apiOrigin: string;
}

let token: { readonly value: string; readonly expiresAt: number; readonly clientId: string; readonly environment: string } | null = null;

export function hasQuranFoundationCredentials(): boolean {
  return Boolean(process.env.QF_CLIENT_ID?.trim() && process.env.QF_CLIENT_SECRET?.trim());
}

function providerConfig(): ProviderConfig {
  const clientId = process.env.QF_CLIENT_ID?.trim();
  const clientSecret = process.env.QF_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Set QF_CLIENT_ID and QF_CLIENT_SECRET to use the official Quran Foundation Content API");
  }
  const environment = process.env.QF_ENV?.trim().toLowerCase() ?? "production";
  if (environment !== "production" && environment !== "prelive") {
    throw new Error("QF_ENV must be either production or prelive");
  }
  return environment === "prelive"
    ? { clientId, clientSecret, environment, authOrigin: PRELIVE_AUTH_ORIGIN, apiOrigin: PRELIVE_API_ORIGIN }
    : { clientId, clientSecret, environment, authOrigin: PRODUCTION_AUTH_ORIGIN, apiOrigin: PRODUCTION_API_ORIGIN };
}

async function boundedJson(response: Response, signal: AbortSignal, maxBytes: number, label: string): Promise<{ value: unknown; bytes: number }> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`${label} returned an unexpected content type`);
  }
  const body = await readBoundedResponse(response, { maxBytes, signal, label });
  try { return { value: JSON.parse(body.toString("utf8")), bytes: body.byteLength }; }
  catch (cause) { throw new Error(`${label} returned invalid JSON`, { cause }); }
}

async function accessToken(config: ProviderConfig, signal: AbortSignal): Promise<string> {
  if (token && token.clientId === config.clientId && token.environment === config.environment && token.expiresAt - 30_000 > Date.now()) return token.value;
  const url = `${config.authOrigin}/oauth2/token`;
  const response = await fetch(url, {
    method: "POST",
    signal,
    redirect: "error",
    headers: {
      accept: "application/json",
      authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=content",
  });
  if (new URL(response.url || url).origin !== config.authOrigin) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Quran Foundation authentication left its approved HTTPS origin");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Quran Foundation authentication failed with HTTP ${response.status}`);
  }
  const { value } = await boundedJson(response, signal, TOKEN_LIMIT_BYTES, "Quran Foundation authentication");
  if (!value || typeof value !== "object") throw new Error("Quran Foundation authentication returned an invalid token");
  const raw = value as Record<string, unknown>;
  if (typeof raw.access_token !== "string" || !raw.access_token) throw new Error("Quran Foundation authentication returned no access token");
  const expiresIn = typeof raw.expires_in === "number" && Number.isFinite(raw.expires_in) ? Math.max(60, raw.expires_in) : 3_600;
  token = { value: raw.access_token, expiresAt: Date.now() + expiresIn * 1_000, clientId: config.clientId, environment: config.environment };
  return token.value;
}

async function requestJson(
  config: ProviderConfig,
  path: string,
  signal: AbortSignal,
  maxBytes: number,
  label: string,
  retryAuth: boolean,
): Promise<{ value: unknown; bytes: number }> {
  const authToken = await accessToken(config, signal);
  const url = new URL(path, `${config.apiOrigin}/`);
  if (url.origin !== config.apiOrigin || !url.pathname.startsWith("/content/api/v4/")) {
    throw new Error("Blocked an invalid Quran Foundation Content API path");
  }
  const response = await fetch(url, {
    signal,
    redirect: "error",
    headers: { accept: "application/json", "x-auth-token": authToken, "x-client-id": config.clientId },
  });
  if (new URL(response.url || url).origin !== config.apiOrigin) {
    await response.body?.cancel().catch(() => {});
    throw new Error("The Quran Foundation API left its approved HTTPS origin");
  }
  if (response.status === 401 && retryAuth) {
    await response.body?.cancel().catch(() => {});
    token = null;
    return requestJson(config, path, signal, maxBytes, label, false);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }
  return boundedJson(response, signal, maxBytes, label);
}

export async function fetchQuranFoundationJson(
  path: string,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number; readonly maxBytes: number; readonly label: string },
): Promise<{ readonly value: unknown; readonly bytes: number }> {
  const config = providerConfig();
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    return await requestJson(config, path, signal, options.maxBytes, options.label, true);
  } catch (cause) {
    if (options.signal?.aborted) throw new Error(`${options.label} was cancelled`, { cause: options.signal.reason });
    if (timeout.aborted) throw new Error(`${options.label} timed out`, { cause });
    throw cause;
  }
}

export function clearQuranFoundationClient(): void {
  token = null;
}
