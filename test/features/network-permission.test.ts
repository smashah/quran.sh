import { describe, expect, test } from "bun:test";
import { networkPlaybackIdentity } from "../../src/features/audio/network-permission.ts";

describe("network playback permission", () => {
  test("scopes consent to the normalized provider and HTTPS origin", () => {
    const row = {
      raw: {},
      provenance: {
        packId: "recitation.test",
        version: "v1",
        provider: "Example Provider",
        sourceUrl: "https://provider.example/catalogue",
        license: "Example",
        attribution: "Example reciter",
      },
    };
    const first = networkPlaybackIdentity("https://AUDIO.example:443/ayah/1.mp3", row);
    const sameScope = networkPlaybackIdentity("https://audio.example/ayah/2.mp3", row);
    const otherProvider = networkPlaybackIdentity("https://audio.example/ayah/1.mp3", {
      ...row,
      provenance: { ...row.provenance, provider: "Another Provider" },
    });
    expect(first.origin).toBe("https://audio.example");
    expect(first.hostname).toBe("audio.example");
    expect(first.preferenceKey).toBe(sameScope.preferenceKey);
    expect(first.preferenceKey).not.toBe(otherProvider.preferenceKey);
  });

  test("rejects insecure, local, and malformed audio locations", () => {
    expect(() => networkPlaybackIdentity("http://audio.example/1.mp3")).toThrow("must use HTTPS");
    expect(() => networkPlaybackIdentity("file:///tmp/1.mp3")).toThrow("must use HTTPS");
    expect(() => networkPlaybackIdentity("not a URL")).toThrow("must use HTTPS");
  });
});
