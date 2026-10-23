import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix3,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  Sphere,
  Texture,
  Vector3,
  type Object3D,
} from "three";
import { BAKED_LIGHT_RANGE } from "./environment";
import { fixed, number, percent, type Described } from "./settings";
import { GUST_GLSL, windUniforms } from "./wind";

/** Copies of one thing spread over the surfaces the author marks; see GLOSSARY.md. */
export interface ScatterSettings {
  /** Copies per square metre. */
  density: number;
  /** Metres from the viewpoint where copies start to shrink away. */
  near: number;
  /** Metres from the viewpoint where they have gone. */
  far: number;
  /** Their height, as a share of the tuft's own. */
  height: number;
  /** Metres from the viewpoint where copies start to thin out. */
  thinFrom: number;
  /** Share of copies still drawn from where they start to shrink away, thinned out from `thinFrom`. */
  thin: number;
  /** How far apart the blades of a thinned-out copy move, by then, so the ground still looks covered. */
  spread: number;
  /** How much of the colour of the ground below copies take, from 0 to 1. */
  groundColour: number;
  /** How far the wind bends them, as a share of what it would. */
  sway: number;
}

export const SCATTER: ScatterSettings = {
  density: 30,
  near: 20,
  far: 40,
  height: 0.45,
  thinFrom: 10,
  thin: 0.2,
  spread: 3,
  groundColour: 0.85,
  sway: 1.7,
};

export const SCATTER_DESCRIBED: Described<ScatterSettings> = {
  density: number({
    label: "Density",
    min: 1,
    max: 200,
    step: 1,
    show: (copies) => `${copies} per m²`,
    about: "How many copies grow on each square metre of the marked surfaces, up close.",
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
  height: number({
    label: "Height",
    min: 0.1,
    max: 2,
    step: 0.05,
    show: fixed(2, "×"),
    about: "How tall copies grow, as a share of the tuft as it was made.",
  }),
  thinFrom: number({
    label: "Thins from",
    min: 0,
    max: 60,
    step: 1,
    show: fixed(0, " m"),
    about: "How far from the viewpoint fewer copies start to be drawn; by where they start to shrink, only the far share is left.",
  }),
  thin: number({
    label: "Far share",
    min: 0.01,
    max: 1,
    step: 0.01,
    show: percent,
    about: "Share of copies still drawn from where they start to shrink away.",
  }),
  spread: number({
    label: "Far spread",
    min: 1,
    max: 10,
    step: 0.1,
    show: fixed(1, "×"),
    about: "How far apart the blades of each copy left move by then, so the ground still looks covered.",
  }),
  groundColour: number({
    label: "Ground colour",
    min: 0,
    max: 1,
    step: 0.05,
    show: percent,
    about: "How much of the colour of the ground's texture under it a copy takes: 0 only its own, 1 only the ground's.",
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

/** Share of copies over which one fades out as their number falls, so none pops. */
const FADE_SHARE = 0.05;
/**
 * What the safety net may take, step by step, before ambient occlusion: a
 * share of the copies, and of the distance they reach (#24, #25).
 */
export const REDUCED = [
  { density: 1, far: 1 },
  { density: 2 / 3, far: 35 / 45 },
  { density: 1 / 3, far: 25 / 45 },
];
/** Seconds copies take to grow in once their file has arrived. */
const GROW_SECONDS = 1;
/** Side of the squares copies are grouped in, in metres, so those out of view or thinned out aren't drawn. */
const CHUNK = 8;
/** Surfaces steeper than this, as the upward share of their facing, grow nothing. */
const MIN_UP = 0.5;
/** Mipmap level the ground's colour is read at: an average over a patch, not one speck. */
const GROUND_COLOUR_LEVEL = 3;

/** How far along thinning out a distance is: 0 up to `thinFrom`, 1 from where copies start to shrink. */
export function thinningAt(distance: number, settings: ScatterSettings, reduced = REDUCED[0]): number {
  const end = Math.min(settings.near, settings.far - 1) * reduced.far;
  const start = Math.min(settings.thinFrom, end - 0.5);
  return Math.min(1, Math.max(0, (distance - start) / (end - start)));
}

/** The share of copies drawn at a distance: all up close, `thin` by where they shrink, times `reduced`. */
export function keptAt(distance: number, settings: ScatterSettings, reduced = REDUCED[0]): number {
  return (1 + (settings.thin - 1) * thinningAt(distance, settings, reduced)) * reduced.density;
}

/** How far apart a copy's blades move at a distance: not at all up close, `spread` by where they shrink. */
export function spreadAt(distance: number, settings: ScatterSettings, reduced = REDUCED[0]): number {
  return 1 + (settings.spread - 1) * thinningAt(distance, settings, reduced);
}

/** One surface of a scatter mark: its triangles, where they fall in the baked light picture, and its colour. */
export interface Ground {
  /** Nine numbers per triangle, in world space. */
  corners: Float32Array;
  /** Six numbers per triangle, or none where the surface wasn't baked. */
  lightCorners?: Float32Array;
  /** Six numbers per triangle: where they fall in the surface's own texture, if it has one. */
  colourCorners?: Float32Array;
  /** The surface's texture, if any, and its colour, which the texture is multiplied by. */
  map?: Texture | null;
  colour?: Color;
}

/** Where each copy stands, how it is turned and sized, and where it falls in the pictures of its ground. */
export interface Copies {
  count: number;
  /** x, y, z of each copy's root. */
  roots: Float32Array;
  /** Turn in radians and size of each copy. */
  turns: Float32Array;
  /** A random number from 0 to 1 for each copy: those with the lowest are drawn when not all are. */
  ranks: Float32Array;
  lightSpots: Float32Array;
  colourSpots: Float32Array;
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
  const { corners, lightCorners, colourCorners } = ground;
  const roots: number[] = [];
  const turns: number[] = [];
  const ranks: number[] = [];
  const lightSpots: number[] = [];
  const colourSpots: number[] = [];
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), across = new Vector3();
  const spot = (from: Float32Array | undefined, t: number, w: number, u: number, v: number, into: number[]) => {
    if (!from) return into.push(0, 0);
    const at = t * 6;
    into.push(from[at] * w + from[at + 2] * u + from[at + 4] * v, from[at + 1] * w + from[at + 3] * u + from[at + 5] * v);
  };
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
      ranks.push(random());
      spot(lightCorners, t, w, u, v, lightSpots);
      spot(colourCorners, t, w, u, v, colourSpots);
    }
  }
  return {
    count: roots.length / 3,
    roots: new Float32Array(roots),
    turns: new Float32Array(turns),
    ranks: new Float32Array(ranks),
    lightSpots: new Float32Array(lightSpots),
    colourSpots: new Float32Array(colourSpots),
  };
}

/** Each surface under a marked layer, as copies grow on it. */
export function groundsOf(layer: Object3D): Ground[] {
  layer.updateWorldMatrix(true, true);
  const grounds: Ground[] = [];
  const corner = new Vector3();
  layer.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const { geometry } = object;
    const positions = geometry.getAttribute("position");
    const light = geometry.getAttribute("uv1");
    const own = geometry.getAttribute("uv");
    const index = geometry.getIndex();
    const count = index ? index.count : positions.count;
    const corners = new Float32Array(count * 3);
    const lightCorners = light ? new Float32Array(count * 2) : undefined;
    const colourCorners = own ? new Float32Array(count * 2) : undefined;
    for (let i = 0; i < count; i++) {
      const at = index ? index.getX(i) : i;
      corner.fromBufferAttribute(positions, at).applyMatrix4(object.matrixWorld).toArray(corners, i * 3);
      lightCorners?.set([light.getX(at), light.getY(at)], i * 2);
      colourCorners?.set([own.getX(at), own.getY(at)], i * 2);
    }
    const material = object.material as MeshBasicMaterial;
    grounds.push({ corners, lightCorners, colourCorners, map: material.map, colour: material.color });
  });
  return grounds;
}

/** A copy's own shape, as the file prepared in Blender holds it, upright with its root at the origin. */
export interface Tuft {
  /** Its triangles, with each blade's root on the floor plan as `pivot`. */
  geometry: BufferGeometry;
  /** Its picture, if it is made of see-through cards, whose clear parts are cut away. */
  map: Texture | null;
  height: number;
}

/**
 * Where each blade of a tuft stands: a blade is a piece whose triangles touch
 * each other, and it stands where its lowest point is. Found here, so nothing
 * has to be prepared in Blender to spread blades apart.
 */
export function bladeRoots(positions: ArrayLike<number>, index: ArrayLike<number> | null): Float32Array {
  const count = positions.length / 3;
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const corners = index ?? Array.from({ length: count }, (_, i) => i);
  for (let i = 0; i + 2 < corners.length; i += 3) {
    const a = find(corners[i]);
    parent[find(corners[i + 1])] = a;
    parent[find(corners[i + 2])] = a;
  }
  const lowest = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const blade = find(i);
    const low = lowest.get(blade);
    if (low === undefined || positions[i * 3 + 1] < positions[low * 3 + 1]) lowest.set(blade, i);
  }
  const roots = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const low = lowest.get(find(i))!;
    roots[i * 2] = positions[low * 3];
    roots[i * 2 + 1] = positions[low * 3 + 2];
  }
  return roots;
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
  const positions = geometry.getAttribute("position").array;
  geometry.setAttribute("pivot", new BufferAttribute(bladeRoots(positions, geometry.index?.array ?? null), 2));
  geometry.computeBoundingBox();
  const material = found.material as MeshStandardMaterial;
  return { geometry, map: material.map ?? null, height: Math.max(geometry.boundingBox!.max.y, 0.01) };
}

const VERTEX = /* glsl */ `
  attribute vec2 pivot;
  attribute vec3 root;
  attribute vec2 turn;
  attribute float rank;
  attribute vec2 lightSpot;
  attribute vec2 colourSpot;
  uniform sampler2D bakedLight;
  uniform float lightRange;
  uniform sampler2D groundMap;
  uniform mat3 groundMapTransform;
  uniform vec3 groundTint;
  uniform float height;
  uniform float tall;
  uniform float near;
  uniform float far;
  uniform float thinFrom;
  uniform float thin;
  uniform float density;
  uniform float spread;
  uniform float grown;
  uniform float sway;
  varying vec2 vUv;
  varying vec3 vLight;
  varying vec3 vColour;
  varying vec3 vGround;
  varying float vUp;
  ${GUST_GLSL}

  void main() {
    float away = distance(root, cameraPosition);
    // Fewer copies the further away, those with the lowest rank kept, each
    // fading out as the share passes it; the rest spread their blades.
    float shrinkFrom = min(near, far - 1.0);
    float thinning = clamp((away - thinFrom) / max(shrinkFrom - thinFrom, 0.5), 0.0, 1.0);
    float kept = mix(1.0, thin, thinning) * density;
    float shown = clamp((kept - rank) / ${FADE_SHARE.toFixed(3)}, 0.0, 1.0);
    float spreadBy = mix(1.0, spread, thinning);
    // How far up the tuft this point is: the root stays put, the tip moves most.
    float up = clamp(position.y / height, 0.0, 1.0);
    vec3 local = position;
    local.y *= tall;
    local.xz += pivot * (spreadBy - 1.0);
    float c = cos(turn.x), s = sin(turn.x);
    vec3 p = vec3(c * local.x - s * local.z, local.y, s * local.x + c * local.z) * turn.y;
    // Shrinks away into the ground with distance, and grows in once arrived.
    p *= (1.0 - smoothstep(shrinkFrom, far, away)) * grown * shown;
    float tallness = height * tall * turn.y;
    float push = gust(root.xz, turn.x * 7.0) * sway * up * up * tallness;
    p.xz += windDirection * push;
    p.y -= 0.5 * push * push / max(tallness, 0.01);
    vUv = uv;
    vUp = up;
    #ifdef USE_COLOR
      vColour = color;
    #else
      vColour = vec3(1.0);
    #endif
    #ifdef GROUND_MAP
      // The ground's colour round the root, averaged over a patch.
      vGround = groundTint * textureLod(groundMap, (groundMapTransform * vec3(colourSpot, 1.0)).xy, ${GROUND_COLOUR_LEVEL.toFixed(1)}).rgb;
    #else
      vGround = groundTint;
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
  uniform float groundShare;
  varying vec2 vUv;
  varying vec3 vLight;
  varying vec3 vColour;
  varying vec3 vGround;
  varying float vUp;

  void main() {
    vec4 colour = vec4(vColour, 1.0);
    #ifdef USE_MAP
      colour *= texture2D(map, vUv);
      // Solid or cut away, never see-through, so grass hides what is behind it.
      if (colour.a < 0.5) discard;
    #endif
    // The tuft's own colour is a little darker towards the root, where blades
    // shade each other. The ground's is its own at the root, so blades grow
    // out of it seamlessly, and lighter and greener towards the tip.
    vec3 own = colour.rgb * mix(0.55, 1.0, vUp);
    vec3 ground = vGround * mix(vec3(1.0), vec3(1.15, 1.35, 1.05), vUp);
    gl_FragColor = vec4(mix(own, ground, groundShare) * vLight, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Copies on one surface, with the material that knows its colour, grouped in squares of the floor plan. */
interface Patch {
  material: ShaderMaterial;
  chunks: { mesh: Mesh; geometry: InstancedBufferGeometry; centre: Vector3; reach: number; count: number }[];
}

/**
 * Copies of one tuft grown over the surfaces of a scatter mark, swaying in the
 * wind, lit by the baked light of the ground at their roots and taking some
 * of its colour, thinning out and spreading with distance. Out of baked light
 * and of ambient occlusion's own work: they take the darkening of the ground
 * behind them.
 */
export class Scatter {
  readonly settings: ScatterSettings = { ...SCATTER };
  /** Everything drawn, to add to the scene once. */
  readonly group = new Group();

  private readonly grounds: Ground[];
  private readonly bakedLight: Texture | undefined;
  private readonly layer: number;
  private tuft?: Tuft;
  private patches: Patch[] = [];
  private grownFor = 0;
  private builtDensity = 0;
  private reduced = REDUCED[0];

  /** `layer` is the camera layer copies are drawn on besides the usual one. */
  constructor(grounds: Ground[], bakedLight: Texture | undefined, layer: number) {
    this.grounds = grounds;
    this.bakedLight = bakedLight;
    this.layer = layer;
  }

  /** The tuft has arrived: grow copies of it, fading in. */
  grow(tuft: Tuft) {
    this.tuft = tuft;
    this.build();
  }

  /** Take the safety net's step: 0 is all, 1 and 2 fewer copies reaching less far. */
  reduce(step: number) {
    this.reduced = REDUCED[Math.min(step, REDUCED.length - 1)];
  }

  /** Move on by one frame, seen from `viewpoint`: grow in, thin out, and follow the settings. */
  update(seconds: number, viewpoint: Vector3) {
    if (!this.tuft) return;
    if (this.settings.density !== this.builtDensity) this.build();
    this.grownFor += seconds;
    const { settings, reduced } = this;
    for (const { material, chunks } of this.patches) {
      const { uniforms } = material;
      uniforms.grown.value = Math.min(1, this.grownFor / GROW_SECONDS);
      uniforms.near.value = settings.near * reduced.far;
      uniforms.far.value = settings.far * reduced.far;
      uniforms.tall.value = settings.height;
      uniforms.thinFrom.value = settings.thinFrom * reduced.far;
      uniforms.thin.value = settings.thin;
      uniforms.density.value = reduced.density;
      uniforms.spread.value = settings.spread;
      uniforms.groundShare.value = settings.groundColour;
      uniforms.sway.value = settings.sway;
      // Copies are in order of rank, so drawing the first few draws those kept.
      for (const chunk of chunks) {
        const nearest = Math.max(0, chunk.centre.distanceTo(viewpoint) - chunk.reach);
        const kept = Math.min(1, keptAt(nearest, settings, reduced) + 0.05);
        chunk.geometry.instanceCount = nearest > settings.far * reduced.far ? 0 : Math.ceil(chunk.count * kept);
        chunk.mesh.visible = chunk.geometry.instanceCount > 0;
      }
    }
  }

  private material(ground: Ground, tuft: Tuft): ShaderMaterial {
    const map = ground.colourCorners ? (ground.map ?? null) : null;
    map?.updateMatrix();
    return new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: DoubleSide,
      vertexColors: tuft.geometry.hasAttribute("color"),
      defines: {
        ...(tuft.map ? { USE_MAP: "" } : {}),
        ...(this.bakedLight && ground.lightCorners ? { BAKED: "" } : {}),
        ...(map ? { GROUND_MAP: "" } : {}),
      },
      uniforms: {
        ...windUniforms,
        map: { value: tuft.map },
        bakedLight: { value: this.bakedLight ?? null },
        lightRange: { value: BAKED_LIGHT_RANGE },
        groundMap: { value: map },
        groundMapTransform: { value: map ? map.matrix : new Matrix3() },
        groundTint: { value: ground.colour ?? new Color(1, 1, 1) },
        groundShare: { value: this.settings.groundColour },
        height: { value: tuft.height },
        near: { value: this.settings.near },
        far: { value: this.settings.far },
        tall: { value: this.settings.height },
        thinFrom: { value: this.settings.thinFrom },
        thin: { value: this.settings.thin },
        density: { value: 1 },
        spread: { value: this.settings.spread },
        grown: { value: 0 },
        sway: { value: this.settings.sway },
      },
    });
  }

  /** Copies grouped in squares of the floor plan, each drawn in one go and skipped out of view. */
  private build() {
    const { tuft } = this;
    if (!tuft) return;
    for (const { material, chunks } of this.patches) {
      material.dispose();
      for (const { geometry } of chunks) geometry.dispose();
    }
    this.group.clear();
    this.builtDensity = this.settings.density;
    this.patches = this.grounds.map((ground, g) => {
      const material = this.material(ground, tuft);
      const copies = scatterOver(ground, this.settings.density, g + 1);
      const cells = new Map<string, number[]>();
      for (let i = 0; i < copies.count; i++) {
        const key = `${Math.floor(copies.roots[i * 3] / CHUNK)},${Math.floor(copies.roots[i * 3 + 2] / CHUNK)}`;
        let cell = cells.get(key);
        if (!cell) cells.set(key, (cell = []));
        cell.push(i);
      }
      const chunks = [...cells.values()].map((which) => {
        // Lowest rank first, so the first few drawn are the ones kept.
        which.sort((a, b) => copies.ranks[a] - copies.ranks[b]);
        const pick = (from: Float32Array, size: number) => {
          const picked = new Float32Array(which.length * size);
          which.forEach((i, n) => picked.set(from.subarray(i * size, i * size + size), n * size));
          return picked;
        };
        const geometry = new InstancedBufferGeometry();
        geometry.index = tuft.geometry.index;
        for (const [name, attribute] of Object.entries(tuft.geometry.attributes)) geometry.setAttribute(name, attribute);
        const roots = pick(copies.roots, 3);
        geometry.setAttribute("root", new InstancedBufferAttribute(roots, 3));
        geometry.setAttribute("turn", new InstancedBufferAttribute(pick(copies.turns, 2), 2));
        geometry.setAttribute("rank", new InstancedBufferAttribute(pick(copies.ranks, 1), 1));
        geometry.setAttribute("lightSpot", new InstancedBufferAttribute(pick(copies.lightSpots, 2), 2));
        geometry.setAttribute("colourSpot", new InstancedBufferAttribute(pick(copies.colourSpots, 2), 2));
        geometry.instanceCount = which.length;
        // Copies move in the shader, so the chunk's bounds are worked out here, with room for them.
        const lowest = new Vector3(Infinity, Infinity, Infinity);
        const highest = new Vector3(-Infinity, -Infinity, -Infinity);
        const spot = new Vector3();
        for (let i = 0; i < roots.length; i += 3) {
          spot.fromArray(roots, i);
          lowest.min(spot);
          highest.max(spot);
        }
        const centre = lowest.clone().add(highest).multiplyScalar(0.5);
        const reach = centre.distanceTo(highest);
        // Room for the tallest and most spread out copies the settings allow.
      geometry.boundingSphere = new Sphere(centre, reach + tuft.height * 4 + 2);
        const mesh = new Mesh(geometry, material);
        mesh.layers.enable(this.layer);
        this.group.add(mesh);
        return { mesh, geometry, centre, reach, count: which.length };
      });
      return { material, chunks };
    });
  }
}
