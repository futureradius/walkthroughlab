import {
  DoubleSide,
  EquirectangularReflectionMapping,
  Mesh,
  MeshStandardMaterial,
  PMREMGenerator,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

/** The Rhino layer whose contents are the collision mesh rather than something to see. */
const COLLISION_LAYER = "Collision Mesh";

/** The files `npm run optimize` writes for one environment and its sky. */
export interface EnvironmentFiles {
  model: string;
  skyPicture: string;
  skyLight: string;
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
  const [gltf, light, skyPicture] = await Promise.all([
    new GLTFLoader().loadAsync(files.model, track(downloads[0])),
    new HDRLoader().loadAsync(files.skyLight, track(downloads[1])),
    new TextureLoader().loadAsync(files.skyPicture),
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
  gltf.scene.traverse((object) => {
    if (object instanceof Mesh) prepare(object.material, anisotropy);
  });

  skyPicture.colorSpace = SRGBColorSpace;
  skyPicture.mapping = EquirectangularReflectionMapping;
  // Blurred copies of the sky at every roughness, so lighting costs one lookup.
  light.mapping = EquirectangularReflectionMapping;
  const generator = new PMREMGenerator(renderer);
  const skyLight = generator.fromEquirectangular(light).texture;
  generator.dispose();
  light.dispose();

  return { visible: gltf.scene, collision, skyPicture, skyLight };
}
