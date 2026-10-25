import {
  BufferAttribute,
  type InterleavedBufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix3,
  Mesh,
  ShaderMaterial,
  Sphere,
  Vector3,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from "three";
import { BAKED_LIGHT_RANGE } from "./environment";
import type { Point } from "./marks";
import { fixed, toggle, number, type Described } from "./settings";
import { GUST_GLSL, windUniforms } from "./wind";

/** A prop's settings, under `## prop-<name>` in the config file (#28). */
export interface PropSettings {
  /** Whether it casts a still baked shadow; read by `npm run optimize`, so it takes a new bake. */
  shadow: boolean;
  /** How far the wind moves its swaying parts, as a share of what it would. */
  sway: number;
}

export const PROP: PropSettings = { shadow: true, sway: 1 };

const SHADOW = toggle({
  label: "Shadow",
  about: "Whether it casts a still baked shadow. Read when the environment is optimized, so it takes a new bake to show.",
});

export const PROP_DESCRIBED: Described<PropSettings> = {
  shadow: SHADOW,
  sway: number({
    label: "Sway",
    min: 0,
    max: 3,
    step: 0.05,
    show: fixed(2),
    about: "How far the wind moves it: 1 as the wind and its paint say, 0 still.",
  }),
};

/** For a prop with nothing that sways. */
export const STILL_PROP_DESCRIBED: Described<Pick<PropSettings, "shadow">> = { shadow: SHADOW };

/** One copy of a prop, as `npm run optimize` noted it from its line. */
export interface PropCopy {
  /** Where its origin stands. */
  at: Point;
  /** Radians about the upright, from facing +z towards +x. */
  turn: number;
  /** Its size as a share of its own. */
  size: number;
  /** Where the light probe above its crown lies in the baked light, if the environment was baked. */
  probe?: { picture: number; spot: [number, number] };
}

const shares = new Map<string, { value: number }>();

/** How far a prop's parts sway, as its settings say, shared by every shader that sways it. */
export function propSway(name: string): { value: number } {
  let share = shares.get(name);
  if (!share) shares.set(name, (share = { value: PROP.sway }));
  return share;
}

/**
 * GLSL for how a point of a prop moves: `swayed(spot, reach)` is where a
 * point resting at `spot` is now, `reach` being how far it moves in a full
 * gust of a strong wind, in metres. Its baked parts and its leaves both take
 * the gust where each point rests, so where they meet they move as one.
 */
const SWAY_GLSL = /* glsl */ `
  uniform float swayShare;
  ${GUST_GLSL}

  vec3 swayed(vec3 spot, float reach) {
    float push = gust(spot.xz, dot(spot.xz, vec2(0.37, 0.61))) * swayShare * reach;
    spot.xz += windDirection * push;
    return spot;
  }
`;

/**
 * A prop's baked part that is painted to sway, such as a trunk (#28): the
 * same picture of baked light, which travels with it, moved in the wind by
 * its `sway` attribute, how far each corner moves at the prop's own size.
 */
export function withSway<M extends Material>(material: M, share: { value: number }): M {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms, { swayShare: share });
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", `attribute float sway;\n${SWAY_GLSL}\nvoid main() {`)
      .replace(
        "#include <project_vertex>",
        /* glsl */ `
        vec4 spot = modelMatrix * vec4(transformed, 1.0);
        // A copy placed at twice the size moves twice as far.
        vec4 mvPosition = viewMatrix * vec4(swayed(spot.xyz, sway * length(modelMatrix[0].xyz)), 1.0);
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  material.customProgramCacheKey = () => "sway";
  return material;
}

/** Seconds a crown takes to fade in once its file has arrived. */
const FADE_SECONDS = 1;

const VERTEX = /* glsl */ `
  attribute float sway;
  attribute vec3 root;
  attribute float turn;
  attribute float size;
  attribute vec2 lightSpot;
  uniform sampler2D bakedLight;
  uniform float lightRange;
  uniform mat3 mapTransform;
  uniform vec3 crownCentre;
  uniform vec3 crownRadii;
  varying vec2 vUv;
  varying vec3 vLight;
  varying float vShade;
  varying float vSeed;
  ${SWAY_GLSL}

  void main() {
    float c = cos(turn), s = sin(turn);
    vec3 local = position * size;
    vec3 spot = root + vec3(c * local.x + s * local.z, local.y, -s * local.x + c * local.z);
    float reach = sway * size;
    vec3 moved = swayed(spot, reach);
    // Each leaf flutters a little of its own as well.
    float seed = fract(sin(dot(position, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    moved.y += windStrength * swayShare * min(reach, 0.1) * 0.3 * sin(time * (5.0 + 3.0 * seed) + seed * 6.2832);
    // Shaded as if each leaf faced out from the crown's centre: lighter on
    // top, darker underneath and deep inside.
    vec3 fromCentre = (position - crownCentre) / crownRadii;
    float outward = length(fromCentre);
    float up = fromCentre.y / max(outward, 0.001);
    vShade = mix(0.45, 1.0, 0.5 + 0.5 * up) * mix(0.65, 1.0, clamp(outward, 0.0, 1.0));
    #ifdef BAKED
      // The light the probe above the crown was baked with, as surfaces show it.
      vLight = textureLod(bakedLight, lightSpot, 0.0).rgb * lightRange;
    #else
      vLight = vec3(1.0);
    #endif
    vUv = (mapTransform * vec3(uv, 1.0)).xy;
    vSeed = seed;
    gl_Position = projectionMatrix * viewMatrix * vec4(moved, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 tint;
  uniform vec3 glow;
  uniform float grown;
  varying vec2 vUv;
  varying vec3 vLight;
  varying float vShade;
  varying float vSeed;

  void main() {
    vec4 colour = vec4(tint, 1.0);
    #ifdef USE_MAP
      colour *= texture2D(map, vUv);
      // Solid or cut away, never see-through, so leaves hide what is behind them.
      if (colour.a < 0.5) discard;
    #endif
    // Leaves appear a few at a time as the crown fades in.
    if (vSeed > grown) discard;
    gl_FragColor = vec4(colour.rgb * vShade * vLight + (gl_FrontFacing ? glow : vec3(0.0)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** One material's leaves in a prop's file, in the prop's own space, with how far each corner sways. */
interface Leaves {
  geometry: BufferGeometry;
  map: Texture | null;
  tint: Color;
  /** Its glow, if it is a lamp: it glows, but lights nothing (#29). */
  glow: Color;
}

/** Every swaying part in a prop's file, by material, with corners where they are in the prop. */
export function leavesOf(model: Object3D): Leaves[] {
  model.updateWorldMatrix(true, true);
  const found: Leaves[] = [];
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = new BufferGeometry();
    const attributes: Record<string, BufferAttribute | InterleavedBufferAttribute> = object.geometry.attributes;
    for (const [name, attribute] of Object.entries(attributes)) {
      if (!["position", "uv", "_sway"].includes(name)) continue;
      // Plain numbers in place of compressed ones.
      const plain = new Float32Array(attribute.count * attribute.itemSize);
      for (let i = 0; i < attribute.count; i++) {
        for (let k = 0; k < attribute.itemSize; k++) plain[i * attribute.itemSize + k] = attribute.getComponent(i, k);
      }
      geometry.setAttribute(name === "_sway" ? "sway" : name, new BufferAttribute(plain, attribute.itemSize));
    }
    if (object.geometry.index) geometry.setIndex(object.geometry.index.clone());
    geometry.applyMatrix4(object.matrixWorld);
    const material = object.material as MeshStandardMaterial;
    found.push({
      geometry,
      map: material.map ?? null,
      tint: material.color.clone(),
      glow: material.emissive.clone().multiplyScalar(material.emissiveIntensity),
    });
  });
  return found;
}

/**
 * The swaying parts of every copy of one prop, such as a tree's crown,
 * drawn in one go for each of its materials and each baked light picture
 * its copies' probes are in, lit by the probe above each crown, fading in
 * once their file has arrived (#28). Out of baked light and of ambient
 * occlusion's own work, like grass.
 */
export class Crowns {
  /** Everything drawn, to add to the scene once. */
  readonly group = new Group();

  private readonly copies: PropCopy[];
  private readonly bakedLight: Texture[];
  private readonly share: { value: number };
  private readonly layer: number;
  private readonly grown = { value: 0 };
  private grownFor = 0;
  private growing = false;

  /** `layer` is the camera layer they are drawn on besides the usual one. */
  constructor(copies: PropCopy[], bakedLight: Texture[], share: { value: number }, layer: number) {
    this.copies = copies;
    this.bakedLight = bakedLight;
    this.share = share;
    this.layer = layer;
  }

  /** The prop's swaying parts have arrived: draw them at every copy, fading in. */
  grow(leaves: Leaves[]) {
    if (leaves.length === 0) return;
    const low = new Vector3(Infinity, Infinity, Infinity);
    const high = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const { geometry } of leaves) {
      geometry.computeBoundingBox();
      low.min(geometry.boundingBox!.min);
      high.max(geometry.boundingBox!.max);
    }
    const centre = low.clone().add(high).multiplyScalar(0.5);
    const radii = high.clone().sub(low).multiplyScalar(0.5).max(new Vector3(0.01, 0.01, 0.01));
    // Copies whose probes are in the same picture are drawn together.
    const byPicture = new Map<number, PropCopy[]>();
    for (const copy of this.copies) {
      const picture = copy.probe && this.bakedLight[copy.probe.picture] ? copy.probe.picture : -1;
      if (!byPicture.has(picture)) byPicture.set(picture, []);
      byPicture.get(picture)!.push(copy);
    }
    for (const { geometry: shape, map, tint, glow } of leaves) {
      map?.updateMatrix();
      for (const [picture, copies] of byPicture) {
        const geometry = new InstancedBufferGeometry();
        geometry.index = shape.index;
        for (const [name, attribute] of Object.entries(shape.attributes)) geometry.setAttribute(name, attribute);
        if (!shape.hasAttribute("sway")) geometry.setAttribute("sway", new BufferAttribute(new Float32Array(shape.getAttribute("position").count), 1));
        const each = (size: number, value: (copy: PropCopy) => number[]) =>
          new InstancedBufferAttribute(Float32Array.from(copies.flatMap(value)), size);
        geometry.setAttribute("root", each(3, ({ at }) => [...at]));
        geometry.setAttribute("turn", each(1, ({ turn }) => [turn]));
        geometry.setAttribute("size", each(1, ({ size }) => [size]));
        geometry.setAttribute("lightSpot", each(2, ({ probe }) => probe?.spot ?? [0, 0]));
        geometry.instanceCount = copies.length;
        // Copies move in the shader, so their bounds are worked out here, with room for them.
        const middle = new Vector3();
        for (const { at } of copies) middle.add(new Vector3(...at));
        middle.divideScalar(copies.length);
        let reach = 0;
        for (const { at, size } of copies) reach = Math.max(reach, middle.distanceTo(new Vector3(...at)) + (high.length() + 1) * size);
        geometry.boundingSphere = new Sphere(middle, reach);
        const material = new ShaderMaterial({
          vertexShader: VERTEX,
          fragmentShader: FRAGMENT,
          side: DoubleSide,
          defines: { ...(map ? { USE_MAP: "" } : {}), ...(picture >= 0 ? { BAKED: "" } : {}) },
          uniforms: {
            ...windUniforms,
            swayShare: this.share,
            grown: this.grown,
            map: { value: map },
            mapTransform: { value: map ? map.matrix : new Matrix3() },
            tint: { value: tint },
            glow: { value: glow },
            bakedLight: { value: picture >= 0 ? this.bakedLight[picture] : null },
            lightRange: { value: BAKED_LIGHT_RANGE },
            crownCentre: { value: centre },
            crownRadii: { value: radii },
          },
        });
        const mesh = new Mesh(geometry, material);
        mesh.layers.enable(this.layer);
        this.group.add(mesh);
      }
    }
    this.growing = true;
  }

  /** Move on by one frame: fade in once arrived. */
  update(seconds: number) {
    if (!this.growing) return;
    this.grownFor += seconds;
    this.grown.value = Math.min(1, this.grownFor / FADE_SECONDS);
  }
}
