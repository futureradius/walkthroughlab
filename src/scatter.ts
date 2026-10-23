import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  Sphere,
  Texture,
  Vector3,
  type Object3D,
} from "three";
import { BAKED_LIGHT_RANGE } from "./environment";
import { fixed, number, type Described } from "./settings";
import { GUST_GLSL, windUniforms } from "./wind";

/** Copies of one thing spread over the surfaces the author marks; see GLOSSARY.md. */
export interface ScatterSettings {
  /** Copies per square metre. */
  density: number;
  /** Metres from the viewpoint where copies start to shrink away. */
  near: number;
  /** Metres from the viewpoint where they have gone. */
  far: number;
  /** How far the wind bends them, as a share of what it would. */
  sway: number;
}

export const SCATTER: ScatterSettings = { density: 40, near: 20, far: 30, sway: 1 };

export const SCATTER_DESCRIBED: Described<ScatterSettings> = {
  density: number({
    label: "Density",
    min: 1,
    max: 200,
    step: 1,
    show: (copies) => `${copies} per m²`,
    about: "How many copies grow on each square metre of the marked surfaces.",
  }),
  near: number({
    label: "Shrinks from",
    min: 2,
    max: 80,
    step: 1,
    show: fixed(0, " m"),
    about: "How far from the viewpoint copies start to shrink away into the ground.",
  }),
  far: number({
    label: "Gone at",
    min: 3,
    max: 100,
    step: 1,
    show: fixed(0, " m"),
    about: "How far from the viewpoint they have gone; beyond, only the ground shows.",
  }),
  sway: number({
    label: "Sway",
    min: 0,
    max: 2,
    step: 0.05,
    show: fixed(2),
    about: "How far the wind bends them: 1 as the wind says, 0 still.",
  }),
};

/** Seconds copies take to grow in once their file has arrived. */
const GROW_SECONDS = 1;
/** Side of the squares copies are grouped in, in metres, so those out of view aren't drawn. */
const CHUNK = 8;
/** Surfaces steeper than this, as the upward share of their facing, grow nothing. */
const MIN_UP = 0.5;

/** A marked surface's triangles: corners in world space, and where each falls in the baked light picture. */
export interface Ground {
  /** Nine numbers per triangle. */
  corners: Float32Array;
  /** Six numbers per triangle, or none where the surfaces weren't baked. */
  lightCorners?: Float32Array;
}

/** Where each copy stands, how it is turned and sized, and its spot in the baked light picture. */
export interface Copies {
  count: number;
  /** x, y, z of each copy's root. */
  roots: Float32Array;
  /** Turn in radians and size of each copy. */
  turns: Float32Array;
  lightSpots: Float32Array;
}

/** A random number generator that always gives the same numbers, so a lawn looks the same on every visit. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spread copies over the upward-facing triangles of the ground, `density` to the square metre. */
export function scatterOver(ground: Ground, density: number, seed = 1): Copies {
  const random = seeded(seed);
  const { corners, lightCorners } = ground;
  const roots: number[] = [];
  const turns: number[] = [];
  const lightSpots: number[] = [];
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), across = new Vector3();
  for (let t = 0; t * 9 < corners.length; t++) {
    a.fromArray(corners, t * 9);
    b.fromArray(corners, t * 9 + 3);
    c.fromArray(corners, t * 9 + 6);
    across.subVectors(b, a).cross(c.clone().sub(a));
    const area = across.length() / 2;
    // Either facing counts: Rhino doesn't care which way a face points.
    if (area === 0 || Math.abs(across.y) / (2 * area) < MIN_UP) continue;
    // Whole copies, with the remainder decided by chance, so small triangles still grow some.
    const wanted = area * density;
    const count = Math.floor(wanted) + (random() < wanted % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      let u = random(), v = random();
      if (u + v > 1) [u, v] = [1 - u, 1 - v];
      const w = 1 - u - v;
      roots.push(a.x * w + b.x * u + c.x * v, a.y * w + b.y * u + c.y * v, a.z * w + b.z * u + c.z * v);
      turns.push(random() * Math.PI * 2, 0.75 + random() * 0.5);
      if (lightCorners) {
        const l = t * 6;
        lightSpots.push(
          lightCorners[l] * w + lightCorners[l + 2] * u + lightCorners[l + 4] * v,
          lightCorners[l + 1] * w + lightCorners[l + 3] * u + lightCorners[l + 5] * v,
        );
      } else {
        lightSpots.push(0, 0);
      }
    }
  }
  return {
    count: roots.length / 3,
    roots: new Float32Array(roots),
    turns: new Float32Array(turns),
    lightSpots: new Float32Array(lightSpots),
  };
}

/** The triangles of every surface under a marked layer, in world space. */
export function groundOf(layer: Object3D): Ground {
  layer.updateWorldMatrix(true, true);
  const corners: number[] = [];
  const lightCorners: number[] = [];
  let baked = true;
  const corner = new Vector3();
  layer.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const positions = object.geometry.getAttribute("position");
    const light = object.geometry.getAttribute("uv1");
    baked &&= light !== undefined;
    const index = object.geometry.getIndex();
    const count = index ? index.count : positions.count;
    for (let i = 0; i < count; i++) {
      const at = index ? index.getX(i) : i;
      corner.fromBufferAttribute(positions, at).applyMatrix4(object.matrixWorld);
      corners.push(corner.x, corner.y, corner.z);
      if (light) lightCorners.push(light.getX(at), light.getY(at));
    }
  });
  return { corners: new Float32Array(corners), lightCorners: baked ? new Float32Array(lightCorners) : undefined };
}

/** A copy's own shape, as the file prepared in Blender holds it, upright with its root at the origin. */
export interface Tuft {
  geometry: BufferGeometry;
  /** Its picture, for cards, whose see-through parts are cut away. */
  map: Texture | null;
  height: number;
}

/** The tuft in a file: its first mesh, with plain numbers in place of compressed ones. */
export function tuftOf(model: Object3D): Tuft {
  let found: Mesh | undefined;
  model.updateWorldMatrix(true, true);
  model.traverse((object) => {
    if (!found && object instanceof Mesh) found = object;
  });
  if (!found) throw new Error("The scatter file holds no mesh.");
  const geometry = new BufferGeometry();
  for (const [name, attribute] of Object.entries(found.geometry.attributes)) {
    const plain = new Float32Array(attribute.count * attribute.itemSize);
    for (let i = 0; i < attribute.count; i++) {
      for (let k = 0; k < attribute.itemSize; k++) plain[i * attribute.itemSize + k] = attribute.getComponent(i, k);
    }
    geometry.setAttribute(name, new BufferAttribute(plain, attribute.itemSize));
  }
  if (found.geometry.index) geometry.setIndex(found.geometry.index.clone());
  geometry.applyMatrix4(found.matrixWorld);
  geometry.computeBoundingBox();
  const material = found.material as MeshStandardMaterial;
  return { geometry, map: material.map ?? null, height: Math.max(geometry.boundingBox!.max.y, 0.01) };
}

const VERTEX = /* glsl */ `
  attribute vec3 root;
  attribute vec2 turn;
  attribute vec2 lightSpot;
  uniform sampler2D bakedLight;
  uniform float lightRange;
  uniform float height;
  uniform float near;
  uniform float far;
  uniform float grown;
  uniform float sway;
  varying vec2 vUv;
  varying vec3 vLight;
  varying vec3 vColour;
  varying float vUp;
  ${GUST_GLSL}

  void main() {
    // How far up the tuft this point is: the root stays put, the tip moves most.
    float up = clamp(position.y / height, 0.0, 1.0);
    float c = cos(turn.x), s = sin(turn.x);
    vec3 p = vec3(c * position.x - s * position.z, position.y, s * position.x + c * position.z) * turn.y;
    // Shrinks away into the ground with distance, and grows in once arrived.
    p *= (1.0 - smoothstep(near, far, distance(root, cameraPosition))) * grown;
    float push = gust(root.xz, turn.x * 7.0) * sway * up * up * height * turn.y;
    p.xz += windDirection * push;
    p.y -= 0.5 * push * push / max(height * turn.y, 0.01);
    vUv = uv;
    vUp = up;
    #ifdef USE_COLOR
      vColour = color;
    #else
      vColour = vec3(1.0);
    #endif
    #ifdef BAKED
      // The ground's light at the root, as surfaces show it: picture times its range.
      vLight = textureLod(bakedLight, lightSpot, 0.0).rgb * lightRange;
    #else
      vLight = vec3(1.0);
    #endif
    gl_Position = projectionMatrix * viewMatrix * vec4(root + p, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec3 vLight;
  varying vec3 vColour;
  varying float vUp;

  void main() {
    vec4 colour = vec4(vColour, 1.0);
    #ifdef USE_MAP
      colour *= texture2D(map, vUv);
      // Solid or cut away, never see-through, so grass hides what is behind it.
      if (colour.a < 0.5) discard;
    #endif
    // A little darker towards the root, where blades shade each other.
    gl_FragColor = vec4(colour.rgb * vLight * mix(0.55, 1.0, vUp), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Copies of one tuft grown over the surfaces of a scatter mark, swaying in the
 * wind and lit by the baked light of the ground at their roots. Out of baked
 * light and ambient occlusion: they take the darkening of the ground behind them.
 */
export class Scatter {
  readonly settings: ScatterSettings = { ...SCATTER };
  /** Everything drawn, to add to the scene once. */
  readonly group = new Group();

  private readonly ground: Ground;
  private readonly bakedLight: Texture | undefined;
  private readonly layer: number;
  private tuft?: Tuft;
  private material?: ShaderMaterial;
  private grownFor = 0;
  private builtDensity = 0;

  /** `layer` is the camera layer copies are drawn on besides the usual one. */
  constructor(ground: Ground, bakedLight: Texture | undefined, layer: number) {
    this.ground = ground;
    this.bakedLight = ground.lightCorners ? bakedLight : undefined;
    this.layer = layer;
  }

  /** The tuft has arrived: grow copies of it, fading in. */
  grow(tuft: Tuft) {
    this.tuft = tuft;
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: DoubleSide,
      vertexColors: tuft.geometry.hasAttribute("color"),
      defines: {
        ...(tuft.map ? { USE_MAP: "" } : {}),
        ...(this.bakedLight ? { BAKED: "" } : {}),
      },
      uniforms: {
        ...windUniforms,
        map: { value: tuft.map },
        bakedLight: { value: this.bakedLight ?? null },
        lightRange: { value: BAKED_LIGHT_RANGE },
        height: { value: tuft.height },
        near: { value: this.settings.near },
        far: { value: this.settings.far },
        grown: { value: 0 },
        sway: { value: this.settings.sway },
      },
    });
    this.build();
  }

  /** Move on by one frame: grow in, and follow the settings. */
  update(seconds: number) {
    if (!this.material) return;
    if (this.settings.density !== this.builtDensity) this.build();
    this.grownFor += seconds;
    const { uniforms } = this.material;
    uniforms.grown.value = Math.min(1, this.grownFor / GROW_SECONDS);
    uniforms.near.value = Math.min(this.settings.near, this.settings.far - 1);
    uniforms.far.value = this.settings.far;
    uniforms.sway.value = this.settings.sway;
  }

  /** Copies grouped in squares of the floor plan, each drawn in one go and skipped out of view. */
  private build() {
    const { tuft, material } = this;
    if (!tuft || !material) return;
    for (const mesh of this.group.children) (mesh as Mesh).geometry.dispose();
    this.group.clear();
    this.builtDensity = this.settings.density;
    const copies = scatterOver(this.ground, this.settings.density);
    const chunks = new Map<string, number[]>();
    for (let i = 0; i < copies.count; i++) {
      const key = `${Math.floor(copies.roots[i * 3] / CHUNK)},${Math.floor(copies.roots[i * 3 + 2] / CHUNK)}`;
      let chunk = chunks.get(key);
      if (!chunk) chunks.set(key, (chunk = []));
      chunk.push(i);
    }
    const pick = (from: Float32Array, size: number, which: number[]) => {
      const picked = new Float32Array(which.length * size);
      which.forEach((i, n) => picked.set(from.subarray(i * size, i * size + size), n * size));
      return picked;
    };
    for (const which of chunks.values()) {
      const geometry = new InstancedBufferGeometry();
      geometry.index = tuft.geometry.index;
      for (const [name, attribute] of Object.entries(tuft.geometry.attributes)) geometry.setAttribute(name, attribute);
      const roots = pick(copies.roots, 3, which);
      geometry.setAttribute("root", new InstancedBufferAttribute(roots, 3));
      geometry.setAttribute("turn", new InstancedBufferAttribute(pick(copies.turns, 2, which), 2));
      geometry.setAttribute("lightSpot", new InstancedBufferAttribute(pick(copies.lightSpots, 2, which), 2));
      geometry.instanceCount = which.length;
      // The tuft moves in the shader, so the chunk's bounds are worked out here, with room for it.
      const lowest = new Vector3(Infinity, Infinity, Infinity);
      const highest = new Vector3(-Infinity, -Infinity, -Infinity);
      const spot = new Vector3();
      for (let i = 0; i < roots.length; i += 3) {
        spot.fromArray(roots, i);
        lowest.min(spot);
        highest.max(spot);
      }
      const centre = lowest.clone().add(highest).multiplyScalar(0.5);
      geometry.boundingSphere = new Sphere(centre, centre.distanceTo(highest) + tuft.height * 2);
      const mesh = new Mesh(geometry, material);
      mesh.layers.enable(this.layer);
      this.group.add(mesh);
    }
  }
}
