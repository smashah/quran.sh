import type { RenderContext } from "@opentui/core";
import type { Mesh, MeshStandardMaterial, Object3D } from "three";
import type { VerseKey } from "../../domain/quran-coordinate.ts";
import type { VisualBackdrop } from "./types.ts";

export async function detectWebGpuCapability(
  createDevice: () => Promise<{ destroy?(): void }> = async () => {
    const { createWebGPUDevice } = await import("bun-webgpu");
    return createWebGPUDevice();
  },
): Promise<{ readonly supported: true } | { readonly supported: false; readonly reason: string }> {
  try {
    const device = await createDevice();
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

  const ambient = new THREE.AmbientLight(0xb8d8ff, 0.55);
  const key = new THREE.PointLight(0xd8b45d, 7, 30);
  key.position.set(0, 4, 4);
  scene.add(ambient, key);

  const root = new THREE.Group();
  const lineGroup = new THREE.Group();
  const lineMeshes: Mesh[] = [];
  const archMaterial = new THREE.MeshStandardMaterial({ color: 0x29404d, emissive: 0x10232b, roughness: 0.7, metalness: 0.15 });
  for (let index = 0; index < 5; index++) {
    const radius = 2.8 + index * 0.65;
    const arch = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035 + index * 0.006, 6, 64, Math.PI), archMaterial.clone());
    arch.rotation.z = Math.PI;
    arch.position.y = -1.5;
    arch.position.z = -index * 0.45;
    root.add(arch);
  }
  const starMaterial = new THREE.MeshBasicMaterial({ color: 0xd8b45d, transparent: true, opacity: 0.2 });
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
  scene.add(root, lineGroup);
  const renderable = new ThreeRenderable(context, { id: "quran-spatial-backdrop", scene, camera, width: "100%", height: "100%", autoAspect: true, live: false });
  let reducedMotion = false;

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
        material.color.setHSL(hue, 0.18, 0.23);
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
    setVisible(visible) { renderable.visible = visible; },
    setReducedMotion(reduced) { reducedMotion = reduced; if (reduced) root.rotation.set(0, 0, 0); renderable.requestRender(); },
    dispose() {
      scene.traverse((object: Object3D) => {
        const mesh = object as Mesh;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const material of materials) material.dispose();
      });
      renderable.destroy();
    },
  };
}
