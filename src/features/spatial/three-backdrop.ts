import type { RenderContext } from "@opentui/core";
import type { Mesh, MeshStandardMaterial, Object3D } from "three";
import type { VerseKey } from "../../domain/quran-coordinate.ts";
import type { VisualBackdrop } from "./types.ts";

export const THREE_BACKDROP_LAYOUT = {
  position: "absolute" as const,
  top: 3,
  bottom: 8,
  left: 0,
  width: "100%" as const,
  zIndex: 2,
} as const;

const READING_SURFACE_HORIZONTAL_INSET = 0.96;
const READING_SURFACE_VERTICAL_INSET = 0.92;

export function fitReadingSurfaceToViewport(
  THREE: typeof import("three"),
  surface: Object3D,
  camera: import("three").PerspectiveCamera,
  aspectRatio: number,
): boolean {
  surface.scale.setScalar(1);
  surface.updateWorldMatrix(true, true);
  camera.updateWorldMatrix(true, false);
  const bounds = new THREE.Box3().setFromObject(surface);
  if (bounds.isEmpty()) return false;

  const size = bounds.getSize(new THREE.Vector3());
  // Extruded glyphs are built in font units and may temporarily extend past
  // the camera before this fit is applied. Their unscaled bounds centre is
  // therefore not a valid projection plane. The surface anchor is stable
  // across scaling, so measure its camera-space depth instead.
  const anchorInCameraSpace = surface
    .getWorldPosition(new THREE.Vector3())
    .applyMatrix4(camera.matrixWorldInverse);
  const distance = Math.max(0.1, -anchorInCameraSpace.z);
  const verticalSpan = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance;
  const horizontalSpan = verticalSpan * aspectRatio;
  const fitScale = Math.min(
    horizontalSpan * READING_SURFACE_HORIZONTAL_INSET / Math.max(size.x, 0.001),
    verticalSpan * READING_SURFACE_VERTICAL_INSET / Math.max(size.y, 0.001),
  );
  if (!Number.isFinite(fitScale) || fitScale <= 0) return false;

  surface.scale.setScalar(fitScale);
  surface.updateWorldMatrix(true, true);
  return true;
}

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
  const { ThreeRenderable, THREE } = await import("@opentui/three");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070b);
  scene.fog = new THREE.FogExp2(0x05070b, 0.075);
  const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 100);
  camera.position.set(0, 0.72, 10.5);

  const ambient = new THREE.AmbientLight(0xe8f5f2, 1.35);
  const key = new THREE.PointLight(0xf4d77f, 14, 30);
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
  let refitReadingSurface: (() => void) | null = null;
  let scheduleResponsiveReflow: (() => void) | null = null;
  const renderable = new ThreeRenderable(context, {
    id: "quran-spatial-backdrop",
    scene,
    camera,
    ...THREE_BACKDROP_LAYOUT,
    autoAspect: true,
    live: false,
    onSizeChange() {
      refitReadingSurface?.();
      scheduleResponsiveReflow?.();
    },
  });
  // OpenTUI Three v0.4.5 initializes lazily on its first frame and does not
  // expose that failure to the feature loader. The upstream house-demo branch
  // makes init single-flight. Backport that small behavior here so activation
  // waits for the real renderer, and the first frame reuses the same device.
  const engine = renderable.renderer;
  const initialize = engine.init.bind(engine);
  let initialization: Promise<void> | null = null;
  engine.init = () => {
    initialization ??= initialize();
    return initialization;
  };
  try {
    await engine.init();
  } catch (cause) {
    renderable.destroy();
    scene.clear();
    throw new Error("OpenTUI Three could not initialize its WebGPU renderer", { cause });
  }
  let reducedMotion = false;
  let readingGeneration = 0;
  let readingController: AbortController | null = null;
  let clearReadingResources: (() => void) | null = null;
  let activeWordPosition: number | null = null;
  let currentReadingSurface: Object3D | null = null;
  let currentReadingSpec: Parameters<VisualBackdrop["setReadingSurface"]>[0] | null = null;
  let lastResponsiveAspect = 0;
  let responsiveReflowTimer: ReturnType<typeof setTimeout> | null = null;

  const viewportAspect = (): number => {
    // OpenTUI folds the terminal cell's pixel dimensions into this value. A
    // plain column/row ratio makes wide glyph cells look several times wider
    // than the space the user actually sees and prevents useful wrapping.
    const terminalPixelAspect = renderable.aspectRatio;
    return Number.isFinite(terminalPixelAspect) && terminalPixelAspect > 0 ? terminalPixelAspect : 2;
  };

  refitReadingSurface = () => {
    if (!currentReadingSurface || renderable.width < 1 || renderable.height < 1) return;
    if (!fitReadingSurfaceToViewport(THREE, currentReadingSurface, camera, renderable.aspectRatio)) return;
    renderable.requestRender();
  };

  const applyActiveWord = () => {
    readingGroup.traverse((child) => {
      const mesh = child as Mesh;
      const wordPosition = Number(mesh.userData.quranWordPosition);
      if (!Number.isSafeInteger(wordPosition) || wordPosition < 1 || !mesh.material || Array.isArray(mesh.material)) return;
      const material = mesh.material as MeshStandardMaterial;
      const selected = activeWordPosition === wordPosition;
      material.emissive.set(selected ? 0xd8b45d : Number(mesh.userData.baseEmissive));
      material.emissiveIntensity = selected ? 7 : Number(mesh.userData.baseEmissiveIntensity);
      mesh.position.z = Number(mesh.userData.baseZ) + (selected ? 0.24 : 0);
    });
  };

  const setReadingSurface = async (surface: Parameters<VisualBackdrop["setReadingSurface"]>[0]): Promise<void> => {
    readingGeneration++;
    const current = readingGeneration;
    readingController?.abort(new Error("Replaced by a newer Quran reading surface"));
    const controller = new AbortController();
    readingController = controller;
    currentReadingSpec = surface;
    const aspect = viewportAspect();
    const { buildArabicReadingGroup, disposeArabicReadingGroup, clearQuranFontCache } = await import("./arabic-text.ts");
    clearReadingResources = clearQuranFontCache;
    let next;
    try {
      next = await buildArabicReadingGroup(THREE, surface, controller.signal, { viewportAspect: aspect });
    } catch (cause) {
      if (readingController === controller) readingController = null;
      throw cause;
    }
    if (controller.signal.aborted || current !== readingGeneration) {
      disposeArabicReadingGroup(next);
      return;
    }
    const previous = readingGroup.children.slice();
    readingGroup.clear();
    readingGroup.add(next);
    readingGroup.position.y = surface.layout === "ayah" ? 0.15 : 0.28;
    currentReadingSurface = next;
    lastResponsiveAspect = aspect;
    refitReadingSurface?.();
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
    applyActiveWord();
    renderable.requestRender();
  };

  scheduleResponsiveReflow = () => {
    // Mounting the renderable itself emits a size change. Do not let that
    // lifecycle event supersede the explicit surface load that activated the
    // feature; responsive rebuilds begin only after a surface is committed.
    if (!currentReadingSurface || readingController || currentReadingSpec?.layout !== "ayah") return;
    const aspect = viewportAspect();
    if (lastResponsiveAspect > 0 && Math.abs(Math.log(aspect / lastResponsiveAspect)) < 0.08) return;
    if (responsiveReflowTimer) clearTimeout(responsiveReflowTimer);
    responsiveReflowTimer = setTimeout(() => {
      responsiveReflowTimer = null;
      if (!currentReadingSpec) return;
      void setReadingSurface(currentReadingSpec).catch(() => refitReadingSurface?.());
    }, 140);
  };

  return {
    kind: "opentui-three",
    renderable,
    setVerse(verseKey: VerseKey, progress: number) {
      const [surah = 1, ayah = 1] = verseKey.split(":").map(Number);
      root.rotation.y = reducedMotion ? 0 : ((surah + ayah) % 7 - 3) * 0.006;
      key.intensity = 14 + Math.max(0, Math.min(1, progress)) * 6;
      root.children.forEach((child: Object3D, index: number) => { child.visible = index < 5 || progress > (index - 5) / 18; });
      const hue = ((surah * 13) % 360) / 360;
      for (const arch of root.children.slice(0, 5)) {
        const material = (arch as Mesh).material as MeshStandardMaterial;
        material.color.setHSL(hue, 0.32, 0.42);
      }
      renderable.requestRender();
    },
    setActiveWord(wordPosition) {
      if (activeWordPosition === wordPosition) return;
      activeWordPosition = wordPosition;
      applyActiveWord();
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
    setReadingSurface,
    setVisible(visible) { renderable.visible = visible; },
    setReducedMotion(reduced) { reducedMotion = reduced; if (reduced) root.rotation.set(0, 0, 0); renderable.requestRender(); },
    dispose() {
      readingGeneration++;
      readingController?.abort(new Error("Spatial Quran reader disposed"));
      readingController = null;
      if (responsiveReflowTimer) clearTimeout(responsiveReflowTimer);
      responsiveReflowTimer = null;
      currentReadingSpec = null;
      currentReadingSurface = null;
      refitReadingSurface = null;
      scheduleResponsiveReflow = null;
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
