import type * as ThreeNamespace from "three";

type ThreeModule = typeof ThreeNamespace;
type Mode = "arch" | "mushaf" | "focus" | "haram";
type LayoutBucket = "narrow" | "wide";

const WORDS = ["إِيَّاكَ", "نَعۡبُدُ", "وَإِيَّاكَ", "نَسۡتَعِينُ"] as const;
const YOUTUBE_VIDEO_ID = "bNY8a2BB5Gc";
const THREE_MODULE_URL = "/vendor/three.module.js";

const MODE_COPY: Record<Mode, { title: string; description: string }> = {
  arch: {
    title: "Illuminated arch",
    description: "A wide reading line becomes a two-row composition on narrow screens.",
  },
  mushaf: {
    title: "Mushaf plane",
    description: "The ayah rests on a responsive reading plane inspired by the page frame.",
  },
  focus: {
    title: "Recitation focus",
    description: "A restrained word-following study keeps the full ayah visible as focus moves.",
  },
  haram: {
    title: "Haram live",
    description: "A quiet WebGL frame surrounds the official YouTube player without altering it.",
  },
};

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const stage = requiredElement<HTMLElement>("#stage");
const canvas = requiredElement<HTMLCanvasElement>("#webgl-stage");
const loadButton = requiredElement<HTMLButtonElement>("#load-gallery");
const retryButton = requiredElement<HTMLButtonElement>("#retry-gallery");
const errorState = requiredElement<HTMLElement>("#error-state");
const errorCopy = requiredElement<HTMLElement>("#error-copy");
const sceneTitle = requiredElement<HTMLElement>("#scene-title");
const sceneDescription = requiredElement<HTMLElement>("#scene-description");
const runtimeStatus = requiredElement<HTMLElement>("#runtime-status");
const previousWordButton = requiredElement<HTMLButtonElement>("#previous-word");
const nextWordButton = requiredElement<HTMLButtonElement>("#next-word");
const livePanel = requiredElement<HTMLElement>("#live-panel");
const liveCopy = requiredElement<HTMLElement>("#live-copy");
const liveButton = requiredElement<HTMLButtonElement>("#load-live");
const videoShell = requiredElement<HTMLElement>("#video-shell");
const videoFrame = requiredElement<HTMLElement>("#video-frame");
const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-mode]"));
const domWords = Array.from(document.querySelectorAll<HTMLElement>("[data-word]"));

let THREE: ThreeModule | undefined;
let renderer: ThreeNamespace.WebGLRenderer | undefined;
let scene: ThreeNamespace.Scene | undefined;
let camera: ThreeNamespace.PerspectiveCamera | undefined;
let contentRoot: ThreeNamespace.Group | undefined;
let currentMode: Mode = "arch";
let currentWord = 0;
let wordSprites: ThreeNamespace.Sprite[] = [];
let layoutBucket: LayoutBucket = window.innerWidth <= 760 ? "narrow" : "wide";
let animationFrame = 0;
let focusStartedAt = performance.now();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function isMode(value: string | undefined): value is Mode {
  return value === "arch" || value === "mushaf" || value === "focus" || value === "haram";
}

function setActiveWord(index: number): void {
  currentWord = (index + WORDS.length) % WORDS.length;
  domWords.forEach((word, wordIndex) => {
    word.dataset.active = String(wordIndex === currentWord);
  });

  if (THREE) {
    wordSprites.forEach((sprite, wordIndex) => {
      const material = sprite.material as ThreeNamespace.SpriteMaterial;
      material.color.set(wordIndex === currentWord ? 0xf4d77f : 0xb7c8c7);
      material.opacity = currentMode === "focus" && wordIndex !== currentWord ? 0.32 : 0.78;
      sprite.scale.z = wordIndex === currentWord ? 1.08 : 1;
    });
  }
}

function disposeObject(root: ThreeNamespace.Object3D): void {
  const geometries = new Set<ThreeNamespace.BufferGeometry>();
  const materials = new Set<ThreeNamespace.Material>();
  const textures = new Set<ThreeNamespace.Texture>();

  root.traverse((object) => {
    const mesh = object as ThreeNamespace.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const objectMaterial = (object as ThreeNamespace.Mesh).material;
    const values = Array.isArray(objectMaterial) ? objectMaterial : objectMaterial ? [objectMaterial] : [];
    values.forEach((material) => {
      materials.add(material);
      const map = (material as ThreeNamespace.MeshBasicMaterial).map;
      if (map) textures.add(map);
    });
  });

  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

function clearScene(): void {
  if (!scene || !contentRoot) return;
  scene.remove(contentRoot);
  disposeObject(contentRoot);
  contentRoot = undefined;
  wordSprites = [];
}

function addLights(root: ThreeNamespace.Group): void {
  if (!THREE) return;
  root.add(new THREE.AmbientLight(0x88a5ae, 1.2));
  const key = new THREE.PointLight(0xd8b45d, 7, 24);
  key.position.set(0, 4, 6);
  root.add(key);
  const fill = new THREE.PointLight(0x2f8f83, 5, 18);
  fill.position.set(-5, -2, 3);
  root.add(fill);
}

function makeWordSprite(word: string): ThreeNamespace.Sprite {
  if (!THREE) throw new Error("Three.js is not loaded.");

  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 768;
  textureCanvas.height = 256;
  const context = textureCanvas.getContext("2d");
  if (!context) throw new Error("The browser could not create a text canvas.");

  context.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
  context.direction = "rtl";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#e7ede9";
  context.font = '112px "Quran Uthmani", "Geeza Pro", serif';
  context.fillText(word, textureCanvas.width / 2, 126);

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0xb7c8c7,
    transparent: true,
    depthWrite: false,
    opacity: 0.78,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.1, 1.04, 1);
  return sprite;
}

function addResponsiveWords(root: ThreeNamespace.Group, y = 0): void {
  wordSprites = WORDS.map((word) => makeWordSprite(word));
  if (layoutBucket === "wide") {
    const spacing = 2.75;
    wordSprites.forEach((sprite, index) => {
      sprite.position.set((1.5 - index) * spacing, y, 0.8);
      root.add(sprite);
    });
  } else {
    wordSprites.forEach((sprite, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      sprite.position.set(column === 0 ? 1.65 : -1.65, y + (0.58 - row) * 1.8, 0.8);
      sprite.scale.multiplyScalar(0.9);
      root.add(sprite);
    });
  }
  setActiveWord(currentWord);
}

function buildArch(root: ThreeNamespace.Group): void {
  if (!THREE) return;
  addLights(root);

  for (let index = 0; index < 7; index += 1) {
    const geometry = new THREE.TorusGeometry(4.8 + index * 0.52, 0.035, 8, 96, Math.PI);
    const material = new THREE.MeshBasicMaterial({
      color: index % 2 === 0 ? 0xd8b45d : 0x355663,
      transparent: true,
      opacity: 0.34 - index * 0.025,
    });
    const arch = new THREE.Mesh(geometry, material);
    arch.rotation.z = Math.PI;
    arch.position.y = -2.8;
    root.add(arch);
  }

  const starGeometry = new THREE.OctahedronGeometry(0.035, 0);
  const starMaterial = new THREE.MeshBasicMaterial({ color: 0xd8b45d, transparent: true, opacity: 0.54 });
  const stars = new THREE.InstancedMesh(starGeometry, starMaterial, 70);
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < 70; index += 1) {
    const angle = index * 2.399;
    const radius = 2.8 + (index % 11) * 0.54;
    matrix.makeTranslation(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.48 + 0.8, -1.4);
    stars.setMatrixAt(index, matrix);
  }
  root.add(stars);
  addResponsiveWords(root, 0.15);
}

function buildMushaf(root: ThreeNamespace.Group): void {
  if (!THREE) return;
  addLights(root);
  const wide = layoutBucket === "wide";
  const pageWidth = wide ? 11 : 6.6;
  const pageHeight = wide ? 6.4 : 9.3;

  const page = new THREE.Mesh(
    new THREE.PlaneGeometry(pageWidth, pageHeight),
    new THREE.MeshStandardMaterial({ color: 0x102126, roughness: 0.72, metalness: 0.08 }),
  );
  page.position.z = -0.45;
  page.rotation.x = -0.1;
  root.add(page);

  const frameMaterial = new THREE.MeshBasicMaterial({ color: 0xd8b45d, transparent: true, opacity: 0.65 });
  const horizontal = new THREE.BoxGeometry(pageWidth - 0.35, 0.025, 0.025);
  const vertical = new THREE.BoxGeometry(0.025, pageHeight - 0.35, 0.025);
  for (const y of [-pageHeight / 2 + 0.18, pageHeight / 2 - 0.18]) {
    const edge = new THREE.Mesh(horizontal, frameMaterial);
    edge.position.set(0, y, -0.38);
    root.add(edge);
  }
  for (const x of [-pageWidth / 2 + 0.18, pageWidth / 2 - 0.18]) {
    const edge = new THREE.Mesh(vertical, frameMaterial);
    edge.position.set(x, 0, -0.38);
    root.add(edge);
  }

  const guideMaterial = new THREE.MeshBasicMaterial({ color: 0x355663, transparent: true, opacity: 0.34 });
  for (let line = -2; line <= 2; line += 1) {
    const guide = new THREE.Mesh(new THREE.BoxGeometry(pageWidth * 0.68, 0.018, 0.018), guideMaterial);
    guide.position.set(0, line * (wide ? 0.82 : 1.15), -0.34);
    root.add(guide);
  }
  addResponsiveWords(root, wide ? 0.15 : 0.4);
}

function buildFocus(root: ThreeNamespace.Group): void {
  if (!THREE) return;
  addLights(root);
  for (let index = 0; index < 5; index += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.45 + index * 0.86, 0.025, 6, 80),
      new THREE.MeshBasicMaterial({
        color: index % 2 === 0 ? 0x2f8f83 : 0xd8b45d,
        transparent: true,
        opacity: 0.24 - index * 0.026,
      }),
    );
    ring.position.z = -0.7 - index * 0.1;
    root.add(ring);
  }
  addResponsiveWords(root, 0.1);
  focusStartedAt = performance.now() - currentWord * 1650;
}

function buildHaramFrame(root: ThreeNamespace.Group): void {
  if (!THREE) return;
  addLights(root);
  const material = new THREE.MeshBasicMaterial({ color: 0xd8b45d, transparent: true, opacity: 0.42 });
  const teal = new THREE.MeshBasicMaterial({ color: 0x2f8f83, transparent: true, opacity: 0.3 });
  for (let index = 0; index < 9; index += 1) {
    const column = new THREE.Mesh(new THREE.BoxGeometry(0.055, 5.8, 0.055), index % 2 === 0 ? material : teal);
    column.position.set(-6.4 + index * 1.6, 0, -1.2);
    root.add(column);
  }
  for (let index = 0; index < 3; index += 1) {
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(4.5 + index * 0.7, 0.04, 6, 72, Math.PI),
      index % 2 === 0 ? material : teal,
    );
    arch.rotation.z = Math.PI;
    arch.position.set(0, -2.4, -1.4 - index * 0.1);
    root.add(arch);
  }
}

function buildMode(mode: Mode): void {
  if (!THREE || !scene) return;
  clearScene();
  currentMode = mode;
  stage.dataset.mode = mode;
  sceneTitle.textContent = MODE_COPY[mode].title;
  sceneDescription.textContent = MODE_COPY[mode].description;
  modeButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.mode === mode));
  livePanel.hidden = mode !== "haram";

  contentRoot = new THREE.Group();
  scene.add(contentRoot);
  if (mode === "arch") buildArch(contentRoot);
  if (mode === "mushaf") buildMushaf(contentRoot);
  if (mode === "focus") buildFocus(contentRoot);
  if (mode === "haram") buildHaramFrame(contentRoot);
  setActiveWord(currentWord);
  renderOnce();
}

function resizeRenderer(): void {
  if (!renderer || !camera) return;
  const bounds = stage.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.position.z = layoutBucket === "narrow" ? 12.5 : 10.5;
  camera.updateProjectionMatrix();
  renderOnce();
}

function renderOnce(): void {
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function animate(now: number): void {
  if (!contentRoot) return;
  const elapsed = now * 0.001;
  contentRoot.rotation.y = Math.sin(elapsed * 0.25) * 0.025;
  contentRoot.position.y = Math.sin(elapsed * 0.42) * 0.045;

  if (currentMode === "focus") {
    const nextWord = Math.floor((now - focusStartedAt) / 1650) % WORDS.length;
    if (nextWord !== currentWord) setActiveWord(nextWord);
  }
  renderOnce();
  animationFrame = requestAnimationFrame(animate);
}

function updateMotion(): void {
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  if (!reducedMotion.matches && renderer) animationFrame = requestAnimationFrame(animate);
  else renderOnce();
}

async function loadGallery(): Promise<void> {
  loadButton.disabled = true;
  retryButton.disabled = true;
  stage.dataset.state = "loading";
  runtimeStatus.textContent = "Loading the visual renderer and Quran typeface...";
  errorState.hidden = true;

  try {
    THREE = await import(THREE_MODULE_URL) as ThreeModule;
    await document.fonts.load('112px "Quran Uthmani"').catch(() => []);

    renderer?.dispose();
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x071014, 0);
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x071014, 0.038);
    camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
    camera.position.z = 10.5;

    resizeRenderer();
    buildMode(currentMode);
    stage.dataset.state = "ready";
    modeButtons.forEach((button) => { button.disabled = false; });
    previousWordButton.disabled = false;
    nextWordButton.disabled = false;
    runtimeStatus.textContent = "Renderer ready. The ayah remains live HTML for clarity and assistive technology.";
    updateMotion();
  } catch (error) {
    renderer?.dispose();
    renderer = undefined;
    scene = undefined;
    camera = undefined;
    stage.dataset.state = "error";
    errorState.hidden = false;
    errorCopy.textContent = error instanceof Error ? `WebGL could not start: ${error.message}` : "WebGL could not start.";
    runtimeStatus.textContent = "The readable Arabic remains available without WebGL.";
    retryButton.disabled = false;
  }
}

function loadYouTubeStream(): void {
  if (videoFrame.querySelector("iframe")) return;
  liveButton.disabled = true;
  runtimeStatus.textContent = "Connecting to the official YouTube player...";
  const iframe = document.createElement("iframe");
  const origin = encodeURIComponent(window.location.origin);
  iframe.src = `https://www.youtube-nocookie.com/embed/${YOUTUBE_VIDEO_ID}?autoplay=1&playsinline=1&rel=0&origin=${origin}`;
  iframe.title = "Live view of Al-Masjid al-Haram on YouTube";
  iframe.allow = "autoplay; encrypted-media; picture-in-picture";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.allowFullscreen = true;
  const connectionTimer = window.setTimeout(() => {
    runtimeStatus.textContent = "YouTube has not confirmed playback yet. Use the direct YouTube link below the player if it remains unavailable.";
  }, 8_000);
  iframe.addEventListener("load", () => {
    window.clearTimeout(connectionTimer);
    runtimeStatus.textContent = "Official YouTube player loaded. Its video is not captured or frame-throttled.";
  }, { once: true });
  videoFrame.append(iframe);
  liveCopy.hidden = true;
  videoShell.hidden = false;
}

loadButton.addEventListener("click", () => { void loadGallery(); });
retryButton.addEventListener("click", () => { void loadGallery(); });
liveButton.addEventListener("click", loadYouTubeStream);
previousWordButton.addEventListener("click", () => setActiveWord(currentWord - 1));
nextWordButton.addEventListener("click", () => setActiveWord(currentWord + 1));

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;
    if (isMode(mode)) buildMode(mode);
  });
});

new ResizeObserver(() => {
  const nextBucket: LayoutBucket = stage.clientWidth <= 760 ? "narrow" : "wide";
  const bucketChanged = nextBucket !== layoutBucket;
  layoutBucket = nextBucket;
  resizeRenderer();
  if (bucketChanged && renderer) buildMode(currentMode);
}).observe(stage);

canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  cancelAnimationFrame(animationFrame);
  runtimeStatus.textContent = "WebGL paused because the graphics context was lost. Waiting for the browser to restore it.";
});

canvas.addEventListener("webglcontextrestored", () => {
  if (renderer) {
    buildMode(currentMode);
    updateMotion();
    runtimeStatus.textContent = "WebGL restored.";
  }
});

reducedMotion.addEventListener("change", updateMotion);
setActiveWord(0);
