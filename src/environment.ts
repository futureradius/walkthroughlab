import {
  Color,
  ConstantColorFactor,
  CustomBlending,
  DoubleSide,
  EquirectangularReflectionMapping,
  Line,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OneFactor,
  OneMinusDstColorFactor,
  PMREMGenerator,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  ZeroFactor,
  type Material,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { Downloads } from "./download";
import type { DoorMotion, Leaf } from "./doors";
import { COLLISION_MESH, normalise, type Start } from "./marks";
import { withReliefAndShine, type Shiny } from "./materials";
import { readConfig, type Config } from "./settings";
/** Brightest light a baked light picture holds: LIGHT_RANGE in scripts/bake.mjs. */
export const BAKED_LIGHT_RANGE = 4;

/**
 * The kinds of surface every mesh of an environment is sorted into when it
 * loads. Each mesh stays on the usual layer 0 and is put on its kind's layer
 * too, so whatever draws the environment picks kinds by `camera.layers`
 * alone. Whatever lights the environment must be on every layer.
 */
export const LAYERS = {
  /** Everything that is not of another kind, which hides what is behind it. */
  solid: 1,
  /** See GLOSSARY.md. */
  glass: 2,
  /** Things that sway, such as scatter: drawn, but kept out of ambient occlusion's own work. */
  sway: 3,
} as const;

/** The files `npm run optimize` writes for one environment and its sky. */
export interface EnvironmentFiles {
  model: string;
  /** Small versions of the sky, in the opening download, until the sharp ones arrive. */
  smallSkyPicture: string;
  smallSkyLight: string;
  skyPicture: string;
  skyLight: string;
  /** Written by `npm run bake`; without it the sky lights the surfaces live. */
  bakedLight?: string;
}

export interface Environment {
  /** Everything of the architecture the viewer sees. */
  visible: Object3D;
  /** The collision mesh as nine numbers per triangle: the x, y, z of three corners. */
  collision: Float32Array;
  /** The sky as the viewer sees it beyond the architecture, small until the sharp one arrives. */
  skyPicture: Texture;
  /** The sky as the light that falls on the architecture and reflects in it, likewise. */
  skyLight: Texture;
  /** The baked light picture, if the environment has one. */
  bakedLight?: Texture;
  /** Where the viewpoint begins, drawn in the model. */
  start?: Start;
  /** What `npm run optimize` found wrong with the marks, for the ?config panel. */
  warnings: string[];
  /** Each scatter mark's name, such as "grass", and the layer whose surfaces it grows on. */
  scatter: { name: string; layer: Object3D }[];
  /** Each door that moves by itself: how, and its leaves, their collision meshes kept out of `collision`. */
  doors: { motion: DoorMotion; leaves: Leaf[] }[];
  /** Surfaces that may show relief or shine, and glass, for Surfaces to switch and tune. */
  shiny: Shiny[];
  glass: MeshStandardMaterial[];
}

/**
 * Read an environment's config file, written by hand, which is tiny and
 * so arrives long before the environment. A missing one is the same as an
 * empty one, so everything keeps its usual settings.
 */
export async function loadConfig(address: string): Promise<Config> {
  try {
    const response = await fetch(address);
    return readConfig(response.ok ? await response.text() : "");
  } catch (error) {
    // Without a connection it would hold up everything else, which retries.
    console.warn("The config file could not be downloaded, so settings keep their usual values.", error);
    return {};
  }
}

/** Whether an object sits somewhere under another. */
function isInside(object: Object3D, ancestor: Object3D): boolean {
  for (let at = object.parent; at; at = at.parent) if (at === ancestor) return true;
  return false;
}

/** Corner positions of every triangle under an object, in world space. */
function trianglesOf(root: Object3D): Float32Array {
  root.updateWorldMatrix(true, true);
  const corners: number[] = [];
  const corner = new Vector3();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const positions = object.geometry.getAttribute("position");
    const index = object.geometry.getIndex();
    const count = index ? index.count : positions.count;
    for (let i = 0; i < count; i++) {
      corner
        .fromBufferAttribute(positions, index ? index.getX(i) : i)
        .applyMatrix4(object.matrixWorld);
      corners.push(corner.x, corner.y, corner.z);
    }
  });
  return new Float32Array(corners);
}

/** Adjust a loaded material for surfaces drawn in Rhino. */
function prepare(material: Material, anisotropy: number) {
  // Rhino doesn't care which way a face points, so show both sides.
  material.side = DoubleSide;
  if (material instanceof MeshStandardMaterial && material.map) {
    material.map.anisotropy = anisotropy;
  }
}

/**
 * Glass is marked in the file by the alpha mode BLEND, which `npm run optimize`
 * gives materials that let through more than half the light and which the bake
 * reads too. three.js loads it as `transparent`.
 */
function isGlass(material: Material): material is MeshStandardMaterial {
  return material.transparent && material instanceof MeshStandardMaterial;
}

/**
 * Glass lets through the share of red, green and blue that its colour names,
 * once for each of its surfaces the view crosses, and reflects the sky on top.
 */
function asGlass(material: MeshStandardMaterial) {
  // Glass must not hide what is drawn behind it.
  material.depthWrite = false;
  // The canvas holds colours encoded for display, where taking away a share
  // of the light takes away a smaller share of the number.
  const { r, g, b } = material.color;
  material.blendColor = new Color(r ** (1 / 2.2), g ** (1 / 2.2), b ** (1 / 2.2));
  // Leaves the reflection as all the glass itself has to show.
  material.color.setScalar(0);
  material.opacity = 1;
  // What is behind is multiplied by the colour; the reflection fills in what
  // is left of white, so that it shows most over the dark.
  material.blending = CustomBlending;
  material.blendSrc = OneMinusDstColorFactor;
  material.blendDst = ConstantColorFactor;
  material.blendSrcAlpha = ZeroFactor;
  material.blendDstAlpha = OneFactor;
  material.onBeforeCompile = (shader) => {
    // Light adds up before it is encoded for display, and the canvas can only
    // add after. Over a mid-grey that would make a faint reflection several
    // times too bright, which this holds back.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <colorspace_fragment>",
      /* glsl */ `
      #include <colorspace_fragment>
      gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(1.25));`,
    );
  };
}

/**
 * A surface whose light was baked only has to show its own colour times that
 * light, which is the cheapest thing a phone can draw.
 */
function withBakedLight(material: MeshStandardMaterial, bakedLight: Texture) {
  return new MeshBasicMaterial({
    name: material.name,
    color: material.color,
    map: material.map,
    side: material.side,
    lightMap: bakedLight,
    // Undoes the division by pi three.js applies and the bake's range.
    lightMapIntensity: Math.PI * BAKED_LIGHT_RANGE,
  });
}

/** Whether a material could ever show relief or shine, so it keeps its rich version beside the plain one. */
function couldBeRich(material: MeshStandardMaterial): boolean {
  return material.normalMap !== null || material.roughnessMap !== null || material.metalness > 0.5 || material.roughness < 1;
}

/**
 * Sort every mesh of a loaded model into its kind of surface, put it on that
 * kind's layer, and give its material what the kind needs: glass blends with
 * what is behind it, and a solid surface the bake painted shows baked light.
 */
export function prepareSurfaces(
  model: Object3D,
  bakedLight: Texture | undefined,
  anisotropy: number,
): { shiny: Shiny[]; glass: MeshStandardMaterial[] } {
  const baked = new Map<Material, { plain: Material; rich?: MeshStandardMaterial }>();
  const glass = new Set<MeshStandardMaterial>();
  const shiny: Shiny[] = [];
  let bakedGlass = 0;
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const material: Material = object.material;
    prepare(material, anisotropy);
    // Glass is decided first, so it stays glass whatever coordinates it carries.
    if (isGlass(material)) {
      object.layers.enable(LAYERS.glass);
      if (!glass.has(material)) {
        glass.add(material);
        asGlass(material);
      }
      if (object.geometry.hasAttribute("uv1")) bakedGlass++;
      return;
    }
    object.layers.enable(LAYERS.solid);
    // Only surfaces the bake painted carry the second set of coordinates.
    if (
      bakedLight &&
      material instanceof MeshStandardMaterial &&
      object.geometry.hasAttribute("uv1")
    ) {
      let made = baked.get(material);
      if (!made) {
        const rich = couldBeRich(material) ? withReliefAndShine(material, bakedLight, BAKED_LIGHT_RANGE) : undefined;
        if (!rich) material.dispose();
        made = { plain: withBakedLight(material, bakedLight), rich };
        baked.set(material, made);
      }
      // Plain until the settings say otherwise; see Surfaces.
      object.material = made.plain;
      if (made.rich) shiny.push({ mesh: object, plain: made.plain, rich: made.rich });
    }
  });
  if (bakedGlass > 0) {
    console.warn(
      `${bakedGlass} glass meshes carry coordinates for baked light, which glass does not show yet (issue #20).`,
    );
  }
  return { shiny, glass: [...glass] };
}

/**
 * The unpacked size of every file the walkthrough downloads, by its address
 * under the page; see vite.config.ts. Without it the bar sweeps to and fro.
 */
async function sizesOf(downloads: Downloads): Promise<Record<string, number>> {
  try {
    return JSON.parse(new TextDecoder().decode(await downloads.get(SIZES)));
  } catch {
    return {};
  }
}

const SIZES = `${import.meta.env.BASE_URL}sizes.json`;

/** A picture or a sky light from its downloaded bytes, by the loader that reads such files. */
async function decoded<T>(bytes: ArrayBuffer, loader: { loadAsync: (address: string) => Promise<T> }): Promise<T> {
  const address = URL.createObjectURL(new Blob([bytes]));
  try {
    return await loader.loadAsync(address);
  } finally {
    URL.revokeObjectURL(address);
  }
}

/** A sky picture ready to show beyond the architecture. */
function asSkyPicture(picture: Texture): Texture {
  picture.colorSpace = SRGBColorSpace;
  picture.mapping = EquirectangularReflectionMapping;
  return picture;
}

/** Blurred copies of the sky at every roughness, so lighting costs one lookup. */
function asSkyLight(light: Texture, renderer: WebGLRenderer): Texture {
  light.mapping = EquirectangularReflectionMapping;
  const generator = new PMREMGenerator(renderer);
  const blurred = generator.fromEquirectangular(light).texture;
  generator.dispose();
  light.dispose();
  return blurred;
}

/**
 * Download the opening download of an environment: everything the viewer
 * needs before they can move (#14). Split the environment into what the
 * viewer sees and its collision mesh, and sort what the viewer sees into
 * kinds of surface; see LAYERS. `onProgress` gets the fraction
 * downloaded, or undefined while the sizes are unknown. A download that
 * fails is tried again until it arrives.
 */
export async function loadEnvironment(
  files: EnvironmentFiles,
  renderer: WebGLRenderer,
  downloads: Downloads,
  onProgress: (fraction: number | undefined) => void,
): Promise<Environment> {
  const sizes = await sizesOf(downloads);
  const addresses = [files.model, files.smallSkyLight, files.smallSkyPicture, files.bakedLight].filter(
    (address): address is string => address !== undefined,
  );
  const base = import.meta.env.BASE_URL;
  const totals = addresses.map((address) => sizes[address.slice(base.length)]);
  const arrived = addresses.map(() => 0);
  const known = totals.every((total) => total > 0);
  const whole = totals.reduce((sum, total) => sum + (total ?? 0), 0);
  const track = (index: number) => (bytes: number) => {
    arrived[index] = bytes;
    onProgress(known ? Math.min(1, arrived.reduce((sum, part) => sum + part, 0) / whole) : undefined);
  };
  onProgress(known ? 0 : undefined);
  const [model, light, picture, baked] = await Promise.all(
    addresses.map((address, index) => downloads.get(address, track(index))),
  );

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [gltf, skyLight, skyPicture, bakedLight] = await Promise.all([
    loader.parseAsync(model, ""),
    decoded(light, new HDRLoader()),
    decoded(picture, new TextureLoader()),
    baked ? decoded(baked, new TextureLoader()) : undefined,
  ]);

  // `npm run optimize` read the marks and noted what they say in the file:
  // which layers are collision meshes, the start spot, and the warnings.
  const collisionLayers: Object3D[] = [];
  const lines: Object3D[] = [];
  const scatter: Environment["scatter"] = [];
  const doorLayers: Object3D[] = [];
  gltf.scene.traverse((object) => {
    if (object.userData.walkthrough === "door") doorLayers.push(object);
    if (object.userData.walkthrough === "scatter") scatter.push({ name: object.userData.scatter, layer: object });
    if (object.userData.walkthrough === COLLISION_MESH) collisionLayers.push(object);
    else if (object instanceof Line) lines.push(object);
  });
  // A door's collision mesh moves with it, so it stays out of the still one.
  const inDoor = (object: Object3D) => doorLayers.some((door) => door !== object && isInside(object, door));
  const doors = doorLayers.map((door) => {
    const motion = door.userData.door as DoorMotion;
    const child = (of: Object3D, name: string) => of.children.find((inner) => normalise(inner.userData.name ?? "") === name);
    const leaves = motion.parts.map(({ leaf }) => {
      const layer = (leaf ? child(door, normalise(leaf)) : door) ?? door;
      const walls = child(layer, COLLISION_MESH);
      return { model: child(layer, "model"), walls: walls ? trianglesOf(walls) : new Float32Array() };
    });
    return { motion, leaves };
  });
  const still = collisionLayers.filter((layer) => !inDoor(layer));
  if (still.length === 0) {
    throw new Error("The environment has no collision mesh; run `npm run optimize` again.");
  }
  const collision = Float32Array.from(still.flatMap((layer) => Array.from(trianglesOf(layer))));
  // Collision meshes stop the viewpoint unseen, and lines are only marks.
  for (const object of [...collisionLayers, ...lines]) object.removeFromParent();
  const { start, warnings = [] } = gltf.scene.userData.walkthrough ?? {};

  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  if (bakedLight) {
    bakedLight.colorSpace = SRGBColorSpace;
    // Laid out like the environment's own textures, top row first.
    bakedLight.flipY = false;
    // The second set of texture coordinates, written by `npm run optimize`.
    bakedLight.channel = 1;
  }
  const { shiny, glass } = prepareSurfaces(gltf.scene, bakedLight, anisotropy);

  return {
    visible: gltf.scene,
    collision,
    skyPicture: asSkyPicture(skyPicture),
    skyLight: asSkyLight(skyLight, renderer),
    bakedLight,
    start,
    warnings,
    scatter,
    doors,
    shiny,
    glass,
  };
}

/** A small model such as a scatter tuft, downloaded and unpacked. */
export async function loadModel(address: string, downloads: Downloads): Promise<Object3D> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return (await loader.parseAsync(await downloads.get(address), "")).scene;
}

/**
 * Download the sharp sky that replaces the small one, in the trailing
 * download: first the light, which sharpens reflections on glass and metal,
 * then the picture beyond the architecture (#14).
 */
export async function loadSharpSky(
  files: EnvironmentFiles,
  renderer: WebGLRenderer,
  downloads: Downloads,
  onLight: (light: Texture) => void,
  onPicture: (picture: Texture) => void,
) {
  onLight(asSkyLight(await decoded(await downloads.get(files.skyLight), new HDRLoader()), renderer));
  onPicture(asSkyPicture(await decoded(await downloads.get(files.skyPicture), new TextureLoader())));
}
