import type { RenderContext } from "@opentui/core";
import type { Mesh, MeshStandardMaterial, Object3D } from "three";
import type { VerseKey } from "../../domain/quran-coordinate.ts";
import type { VisualBackdrop } from "./types.ts";

export const THREE_BACKDROP_LAYOUT = {
  position: "absolute" as const,
  top: 0,
  left: 0,
  width: "100%" as const,
  height: "100%" as const,
  zIndex: -100,
} as const;

export async function detectWebGpuCapability(
  createDevice?: () => Promise<{ destroy?(): void }>,
  initialize?: () => Promise<void>,
): Promise<{ readonly supported: true } | { readonly supported: false; readonly reason: string }> {
  try {
    const load = createDevice
      ? { createDevice, initialize: initialize ?? (async () => {}) }
      : await import("bun-webgpu").then(({ createWebGPUDevice, setupGlobals }) => ({
        createDevice: createWebGPUDevice,
        initialize: () => setupGlobals(),
      }));
    await load.initialize();
    const device = await load.createDevice();
    device.destroy?.();
    return { supported: true };
  } catch (cause) {
    return { supported: false, reason: cause instanceof Error ? cause.message : "WebGPU device unavailable" };
  }
}

export async function createThreeBackdrop(context: RenderContext): Promise<VisualBackdrop & { readonly renderable: import("@opentui/core").Renderable }> {
  const capability = await detectWebGpuCapability();
  if (!capability.supported) throw new Error(`WebGPU is unavailable: ${capability.reason}`);
  const { ThreeRenderable, THREE } = await import("@opentui/three");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070b);
  scene.fog = new THREE.FogExp2(0x05070b, 0.075);
  const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 100);
  camera.position.set(0, 1.5, 11);

  const ambient = new THREE.AmbientLight(0xcceeff, 0.9);
  const key = new THREE.PointLight(0xf1cc72, 10, 30);
  key.position.set(0, 4, 4);
  scene.add(ambient, key);

  const root = new THREE.Group();
  const lineGroup = new THREE.Group();
  const readingGroup = new THREE.Group();
  const lineMeshes: Mesh[] = [];
  const archMaterial = new THREE.MeshStandardMaterial({ color: 0x4f7d80, emissive: 0x183c42, emissiveIntensity: 1.4, roughness: 0.6, metalness: 0.18 });
  for (let index = 0; index < 5; index++) {
    const radius = 3.2 + index * 0.68;
    const arch = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.055 + index * 0.008, 8, 72, Math.PI), archMaterial.clone());
    // TorusGeometry's 0..π arc is the upper half. Lowering its centre keeps
    // the crown and pillars around the reader instead of below the viewport.
    arch.position.y = -2.25;
    arch.position.z = -index * 0.45;
    root.add(arch);
  }
  const starMaterial = new THREE.MeshBasicMaterial({ color: 0xf1cc72, transparent: true, opacity: 0.72 });
  for (let index = 0; index < 18; index++) {
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.025 + (index % 3) * 0.01), starMaterial.clone());
    star.position.set(((index * 37) % 100) / 10 - 5, ((index * 61) % 60) / 10 - 1, -2 - (index % 5));
    root.add(star);
  }
  for (let index = 0; index < 15; index++) {
    const material = new THREE.MeshStandardMaterial({ color: 0x25363d, emissive: 0x071014, roughness: 0.8 });
    const rail = new THREE.Mesh(new THREE.BoxGeometry(5.2 - Math.abs(7 - index) * 0.08, 0.018, 0.025), material);
    rail.position.set(0, 2.3 - index * 0.31, -1.6);
    lineMeshes.push(rail);
    lineGroup.add(rail);
  }
  lineGroup.rotation.x = -0.12;
  lineGroup.visible = false;
  scene.add(root, lineGroup, readingGroup);
  const renderable = new ThreeRenderable(context, {
    id: "quran-spatial-backdrop",
    scene,
    camera,
    ...THREE_BACKDROP_LAYOUT,
    autoAspect: true,
    live: false,
  });
  let reducedMotion = false;
  let readingGeneration = 0;
  let readingController: AbortController | null = null;
  let clearReadingResources: (() => void) | null = null;

  return {
    kind: "opentui-three",
    renderable,
    setVerse(verseKey: VerseKey, progress: number) {
      const [surah = 1, ayah = 1] = verseKey.split(":").map(Number);
      root.rotation.y = reducedMotion ? 0 : ((surah + ayah) % 7 - 3) * 0.006;
      key.intensity = 4 + Math.max(0, Math.min(1, progress)) * 4;
      root.children.forEach((child: Object3D, index: number) => { child.visible = index < 5 || progress > (index - 5) / 18; });
      const hue = ((surah * 13) % 360) / 360;
      for (const arch of root.children.slice(0, 5)) {
        const material = (arch as Mesh).material as MeshStandardMaterial;
        material.color.setHSL(hue, 0.32, 0.42);
      }
      renderable.requestRender();
    },
    setMushafContext(context) {
      lineGroup.visible = context !== null;
      if (!context) { renderable.requestRender(); return; }
      const { activeLine, totalLines } = context;
      for (let index = 0; index < lineMeshes.length; index++) {
        const mesh = lineMeshes[index]!;
        mesh.visible = index < totalLines;
        const material = mesh.material as MeshStandardMaterial;
        if (index + 1 === activeLine) {
          material.color.set(0xd8b45d);
          material.emissive.set(0x5b4214);
          mesh.scale.y = 3;
        } else if (index + 1 < activeLine) {
          material.color.set(0x42606a);
          material.emissive.set(0x0c171b);
          mesh.scale.y = 1;
        } else {
          material.color.set(0x25363d);
          material.emissive.set(0x071014);
          mesh.scale.y = 1;
        }
      }
      renderable.requestRender();
    },
    async setReadingSurface(surface) {
      readingGeneration++;
      const current = readingGeneration;
      readingController?.abort(new Error("Replaced by a newer Quran reading surface"));
      const controller = new AbortController();
      readingController = controller;
      const { buildArabicReadingGroup, disposeArabicReadingGroup, clearQuranFontCache } = await import("./arabic-text.ts");
      clearReadingResources = clearQuranFontCache;
      const next = await buildArabicReadingGroup(THREE, surface, controller.signal);
      if (controller.signal.aborted || current !== readingGeneration) {
        disposeArabicReadingGroup(next);
        return;
      }
      const previous = readingGroup.children.slice();
      readingGroup.clear();
      readingGroup.add(next);
      readingGroup.position.y = surface.layout === "ayah" ? 0.72 : 0.28;
      for (const child of previous) disposeArabicReadingGroup(child);
      lineGroup.visible = false;
      root.position.z = -1.4;
      root.children.forEach((child) => {
        const mesh = child as Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const material of materials) {
          if ("opacity" in material) {
            material.transparent = true;
            material.opacity = 0.34;
          }
        }
      });
      readingController = null;
      renderable.requestRender();
    },
    setVisible(visible) { renderable.visible = visible; },
    setReducedMotion(reduced) { reducedMotion = reduced; if (reduced) root.rotation.set(0, 0, 0); renderable.requestRender(); },
    dispose() {
      readingGeneration++;
      readingController?.abort(new Error("Spatial Quran reader disposed"));
      readingController = null;
      clearReadingResources?.();
      clearReadingResources = null;
      // Three's WebGPU renderer owns the GPU node/cache lifecycle. Disposing
      // individual materials after renderer teardown triggers an upstream
      // double-release in three.webgpu; engine.destroy() releases those GPU
      // resources as one unit, then clearing the scene releases our JS graph.
      renderable.destroy();
      scene.clear();
    },
  };
}
