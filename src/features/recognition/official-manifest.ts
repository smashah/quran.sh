import type { TilawaModelManifest } from "./model-manager.ts";

const release = "https://github.com/yazinsai/tilawa/releases/download/v0.2.0";

/** Pinned upstream release assets; the model remains an explicit post-install download. */
export const TILAWA_V0_2_0_MANIFEST: TilawaModelManifest = {
  schemaVersion: 1,
  version: "v0.2.0",
  source: "https://github.com/yazinsai/tilawa/releases/tag/v0.2.0",
  license: "CC-BY-4.0 model; Tilawa code MIT; review Quran text asset provenance before redistribution",
  attribution: "Tilawa by Yazin Alirhayim; c2c-direct-mixed-tta / NVIDIA Arabic FastConformer model attribution per Tilawa v0.2.0",
  files: [
    { name: "fastconformer_full_mixed.onnx", url: `${release}/fastconformer_full_mixed.onnx`, bytes: 88_307_366, sha256: "4767182cd92975869f81a7e32700b14ca2b04e8dc97a15ff220a8697f4639488" },
    { name: "quran.json", url: `${release}/quran.json`, bytes: 3_186_385, sha256: "6e6f31f642c701b49a1ba090311ca4c7a97c6a5b79a302712dff815a9d7b3d03" },
    { name: "quran_ctc_tokens.json", url: `${release}/quran_ctc_tokens.json`, bytes: 12_211_783, sha256: "96aa32d188d075598536fcbb936dc793466fce2a8da331e48f15932022f4dce8" },
    { name: "vocab.json", url: `${release}/vocab.json`, bytes: 21_062, sha256: "c55877f3bff8bc3aaefc160e8c2fb88cb349088d092513d40210ccfe535e671b" },
  ],
};
