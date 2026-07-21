export async function readBoundedResponse(
  response: Response,
  options: {
    readonly maxBytes: number;
    readonly signal: AbortSignal;
    readonly label: string;
  },
): Promise<Buffer> {
  if (!response.body) throw new Error(`${options.label} returned an empty response`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    await response.body.cancel().catch(() => {});
    throw new Error(`${options.label} exceeded the ${options.maxBytes}-byte safety limit`);
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      options.signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > options.maxBytes) {
        await reader.cancel("response limit exceeded");
        throw new Error(`${options.label} exceeded the ${options.maxBytes}-byte safety limit`);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
