import {
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** The Rhino layer whose contents are the collision mesh rather than something to see. */
const COLLISION_LAYER = "Collision Mesh";
/** Polished metal is blurred this much so its made-up reflection never reads as a mirror. */
const MIN_METAL_ROUGHNESS = 0.3;
const SKY_LIGHT = 0xffffff;
const GROUND_LIGHT = 0x9c968c;

export interface Environment {
  /** Everything the viewer sees, lights included. */
  visible: Group;
  /** The collision mesh as nine numbers per triangle: the x, y, z of three corners. */
  collision: Float32Array;
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

/**
 * Swap a loaded material for the cheapest one that still looks right on an
 * old phone: metal keeps a soft reflection, everything else is plainly lit.
 */
function simplify(material: Material, reflection: Texture): Material {
  if (!(material instanceof MeshStandardMaterial)) return material;
  // Rhino doesn't care which way a face points, so show both sides.
  const shared = {
    color: material.color,
    map: material.map,
    side: DoubleSide,
    transparent: material.transparent,
    opacity: material.opacity,
    depthWrite: !material.transparent,
  };
  const simple =
    material.metalness > 0.5
      ? new MeshStandardMaterial({
          ...shared,
          metalness: 1,
          roughness: Math.max(material.roughness, MIN_METAL_ROUGHNESS),
          envMap: reflection,
        })
      : new MeshLambertMaterial(shared);
  simple.name = material.name;
  material.dispose();
  return simple;
}

function lights(): Object3D[] {
  const sun = new DirectionalLight(SKY_LIGHT, 2);
  sun.position.set(-3, 6, 4);
  return [new HemisphereLight(SKY_LIGHT, GROUND_LIGHT, 2.2), sun];
}

/**
 * Download an environment and split it into what the viewer sees and its
 * collision mesh. `onProgress` gets the fraction downloaded, or undefined
 * when the server doesn't say how big the file is.
 */
export async function loadEnvironment(
  url: string,
  renderer: WebGLRenderer,
  onProgress: (fraction: number | undefined) => void,
): Promise<Environment> {
  const gltf = await new GLTFLoader().loadAsync(url, (event) =>
    onProgress(event.lengthComputable ? event.loaded / event.total : undefined),
  );

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

  const generator = new PMREMGenerator(renderer);
  const reflection = generator.fromScene(new RoomEnvironment()).texture;
  generator.dispose();

  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const simplified = new Map<Material, Material>();
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const original = object.material as Material;
    if (!simplified.has(original)) {
      simplified.set(original, simplify(original, reflection));
    }
    object.material = simplified.get(original);
    const map = (object.material as MeshLambertMaterial).map;
    if (map) map.anisotropy = anisotropy;
  });

  const visible = new Group();
  visible.add(gltf.scene, ...lights());
  return { visible, collision };
}
