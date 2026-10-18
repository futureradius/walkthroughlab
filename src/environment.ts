import {
  Color,
  ConstantColorFactor,
  CustomBlending,
  DoubleSide,
  EquirectangularReflectionMapping,
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
import { readConfig, type Config } from "./settings";

/** The Rhino layer whose contents are the collision mesh rather than something to see. */
const COLLISION_LAYER = "Collision Mesh";
/** Brightest light a baked light picture holds: LIGHT_RANGE in scripts/bake.mjs. */
const BAKED_LIGHT_RANGE = 4;

/** The files `npm run optimize` writes for one environment and its sky. */
export interface EnvironmentFiles {
  model: string;
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
  /** The sky as the viewer sees it beyond the architecture. */
  skyPicture: Texture;
  /** The sky as the light that falls on the architecture and reflects in it. */
  skyLight: Texture;
  /** The baked light picture, if the environment has one. */
  bakedLight?: Texture;
}

/**
 * Read an environment's config file, written by hand, which is tiny and
 * so arrives long before the environment. A missing one is the same as an
 * empty one, so everything keeps its usual settings.
 */
export async function loadConfig(address: string): Promise<Config> {
  const response = await fetch(address);
  return readConfig(response.ok ? await response.text() : "");
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
  // See-through surfaces must not hide what is drawn behind them.
  material.depthWrite = !material.transparent;
  if (material instanceof MeshStandardMaterial && material.map) {
    material.map.anisotropy = anisotropy;
  }
}

/**
 * Glass lets through the share of red, green and blue that its colour names,
 * once for each of its surfaces the view crosses, and reflects the sky on top.
 */
function asGlass(material: MeshStandardMaterial) {
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
  const baked = new MeshBasicMaterial({
    name: material.name,
    color: material.color,
    map: material.map,
    side: material.side,
    lightMap: bakedLight,
    // Undoes the division by pi three.js applies and the bake's range.
    lightMapIntensity: Math.PI * BAKED_LIGHT_RANGE,
  });
  material.dispose();
  return baked;
}

/**
 * Download an environment and its sky, and split the environment into what
 * the viewer sees and its collision mesh. `onProgress` gets the fraction
 * downloaded, or undefined while the server hasn't said how big the files are.
 */
export async function loadEnvironment(
  files: EnvironmentFiles,
  renderer: WebGLRenderer,
  onProgress: (fraction: number | undefined) => void,
): Promise<Environment> {
  // The sky picture loads as an image, which reports no progress, so the bar
  // follows the other two files.
  const downloads = [
    { loaded: 0, total: 0 },
    { loaded: 0, total: 0 },
  ];
  const track = (download: { loaded: number; total: number }) => (event: ProgressEvent) => {
    download.loaded = event.loaded;
    download.total = event.lengthComputable ? event.total : 0;
    const known = downloads.every(({ total }) => total > 0);
    onProgress(
      known
        ? downloads.reduce((sum, { loaded }) => sum + loaded, 0) /
            downloads.reduce((sum, { total }) => sum + total, 0)
        : undefined,
    );
  };
  const [gltf, light, skyPicture, bakedLight] = await Promise.all([
    new GLTFLoader().loadAsync(files.model, track(downloads[0])),
    new HDRLoader().loadAsync(files.skyLight, track(downloads[1])),
    new TextureLoader().loadAsync(files.skyPicture),
    files.bakedLight ? new TextureLoader().loadAsync(files.bakedLight) : undefined,
  ]);

  // The loader rewrites names; the one written in Rhino is kept in userData.
  let collisionLayer: Object3D | undefined;
  gltf.scene.traverse((object) => {
    if (object.userData.name === COLLISION_LAYER) collisionLayer = object;
  });
  if (!collisionLayer) {
    throw new Error(`The environment has no "${COLLISION_LAYER}" layer.`);
  }
  const collision = trianglesOf(collisionLayer);
  collisionLayer.removeFromParent();

  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  if (bakedLight) {
    bakedLight.colorSpace = SRGBColorSpace;
    // Laid out like the environment's own textures, top row first.
    bakedLight.flipY = false;
    // The second set of texture coordinates, written by `npm run optimize`.
    bakedLight.channel = 1;
  }
  const baked = new Map<Material, Material>();
  const glass = new Set<Material>();
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const material: Material = object.material;
    prepare(material, anisotropy);
    if (material.transparent && material instanceof MeshStandardMaterial && !glass.has(material)) {
      glass.add(material);
      asGlass(material);
    }
    // Only surfaces the bake painted carry the second set of coordinates.
    if (
      bakedLight &&
      material instanceof MeshStandardMaterial &&
      object.geometry.hasAttribute("uv1")
    ) {
      if (!baked.has(material)) baked.set(material, withBakedLight(material, bakedLight));
      object.material = baked.get(material);
    }
  });

  skyPicture.colorSpace = SRGBColorSpace;
  skyPicture.mapping = EquirectangularReflectionMapping;
  // Blurred copies of the sky at every roughness, so lighting costs one lookup.
  light.mapping = EquirectangularReflectionMapping;
  const generator = new PMREMGenerator(renderer);
  const skyLight = generator.fromEquirectangular(light).texture;
  generator.dispose();
  light.dispose();

  return {
    visible: gltf.scene,
    collision,
    skyPicture,
    skyLight,
    bakedLight,
  };
}
