import { BufferAttribute, Vector3, type BufferGeometry, type Material, type Mesh } from "three";
import type { Point } from "./marks";
import { fixed, number, type Described } from "./settings";
import { GUST_GLSL, windUniforms } from "./wind";

/**
 * How the cloths of one `sway-<name>` mark move, under `## sway-<name>` in the
 * config file (#31): across the cloth, more the further a corner is from the
 * line it hangs from, in waves running away from that line, with the gusts.
 */
export interface ClothSettings {
  /** How far a corner 1 m from its line moves in a full gust of a strong wind, in metres. */
  sway: number;
  /** Waves along a metre of cloth. */
  ripples: number;
  /** Metres a second the waves run away from the line. */
  speed: number;
}

/** A curtain's: a slow billow. Any name but `flags` starts with these. */
export const CURTAINS: ClothSettings = { sway: 0.06, ripples: 0.4, speed: 0.6 };
/** A flag's: lively flapping. */
export const FLAGS: ClothSettings = { sway: 0.5, ripples: 1.5, speed: 3 };

/** The mark name whose cloths turn about their pole to point downwind. */
export const TURNING = "flags";

export const CLOTH_DESCRIBED: Described<ClothSettings> = {
  sway: number({
    label: "Sway",
    min: 0,
    max: 2,
    step: 0.01,
    show: fixed(2, " m"),
    about: "How far a corner 1 m from its line moves in a full gust of a strong wind; 0 still.",
  }),
  ripples: number({
    label: "Ripples",
    min: 0,
    max: 5,
    step: 0.05,
    show: fixed(2, " /m"),
    about: "How many waves fit along a metre of cloth.",
  }),
  speed: number({
    label: "Speed",
    min: 0,
    max: 10,
    step: 0.1,
    show: fixed(1, " m/s"),
    about: "How fast the waves run away from the line the cloth hangs from.",
  }),
};

/** What `npm run optimize` notes on each cloth: its mark's name and the line it hangs from. */
export interface ClothNote {
  sway: string;
  line: [Point, Point];
}

/** The settings and shader values of each mark's cloths, by name. */
const marks = new Map<string, { settings: ClothSettings; uniforms: ClothUniforms; run: number }>();

interface ClothUniforms {
  clothSway: { value: number };
  clothRipples: { value: number };
  /** Metres the waves have run, so a change of speed doesn't make them jump. */
  clothRun: { value: number };
}

/** The settings of a mark's cloths, made with its defaults the first time its name is asked for. */
export function clothSettings(name: string): ClothSettings {
  return markOf(name).settings;
}

function markOf(name: string) {
  let mark = marks.get(name);
  if (!mark) {
    const settings = { ...(name === TURNING ? FLAGS : CURTAINS) };
    const uniforms = { clothSway: { value: settings.sway }, clothRipples: { value: settings.ripples }, clothRun: { value: 0 } };
    marks.set(name, (mark = { settings, uniforms, run: 0 }));
  }
  return mark;
}

/** Move every mark's waves on by one frame. */
export function waveCloths(seconds: number) {
  for (const mark of marks.values()) {
    const { settings, uniforms } = mark;
    mark.run += settings.speed * seconds;
    uniforms.clothRun.value = mark.run;
    uniforms.clothSway.value = settings.sway;
    uniforms.clothRipples.value = settings.ripples;
  }
}

const CLOTH_GLSL = /* glsl */ `
  uniform float clothSway;
  uniform float clothRipples;
  uniform float clothRun;
  /** How far the corner is from the edge held still, in metres. */
  attribute float reach;
  /** Which way the cloth as a whole faces. */
  attribute vec3 facing;
  /** Where a flag's pole stands on the floor plan, and the angle it was modelled pointing at. */
  attribute vec3 pole;
  ${GUST_GLSL}

  vec3 clothed(vec3 spot) {
    vec3 across = facing;
    #ifdef TURNS
      // Turned about the pole to point downwind.
      float turn = atan(windDirection.y, windDirection.x) - pole.z;
      float c = cos(turn), s = sin(turn);
      vec2 away = spot.xz - pole.xy;
      spot.xz = pole.xy + vec2(c * away.x - s * away.y, s * away.x + c * away.y);
      across.xz = vec2(c * facing.x - s * facing.z, s * facing.x + c * facing.z);
    #endif
    float push = gust(spot.xz, 0.0) * clothSway * reach;
    // Waves running away from the line, over a billow with the wind where it
    // meets the cloth face on.
    float wave = sin(6.2832 * clothRipples * (reach - clothRun));
    return spot + across * push * (0.5 * dot(windDirection, across.xz) + wave);
  }
`;

/**
 * A cloth's baked material, moved in the wind by its mark's settings: it keeps
 * its baked light, which travels with it, as a prop's trunk does.
 */
export function withCloth<M extends Material>(material: M, name: string): M {
  const { uniforms } = markOf(name);
  const turns = name === TURNING;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", `${turns ? "#define TURNS\n" : ""}${CLOTH_GLSL}\nvoid main() {`)
      .replace(
        "#include <project_vertex>",
        /* glsl */ `
        vec4 spot = modelMatrix * vec4(transformed, 1.0);
        vec4 mvPosition = viewMatrix * vec4(clothed(spot.xyz), 1.0);
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  material.customProgramCacheKey = () => (turns ? "cloth-turns" : "cloth");
  return material;
}

/**
 * Give a cloth's mesh what its shader needs, worked out from where it lies:
 * each corner's reach from the edge held still, how the cloth faces as a
 * whole, and for a flag where its pole stands. A curtain's reach is how far a
 * corner hangs below its rod; a flag's, how far it lies out from its pole;
 * either less the nearest corner's, so the edge nearest the line stays still
 * however far off it the cloth was modelled.
 */
export function prepareCloth(mesh: Mesh, note: ClothNote) {
  mesh.updateWorldMatrix(true, false);
  const geometry: BufferGeometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  const [a, b] = note.line.map((point) => new Vector3(...point));
  const along = b.clone().sub(a);
  const turns = note.sway === TURNING;
  const corner = new Vector3();
  const corners: Vector3[] = [];
  for (let i = 0; i < position.count; i++) corners.push(corner.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).clone());

  const reaches = corners.map((at) => {
    const t = Math.min(1, Math.max(0, at.clone().sub(a).dot(along) / Math.max(along.lengthSq(), 1e-9)));
    const onLine = a.clone().addScaledVector(along, t);
    return turns ? Math.hypot(at.x - onLine.x, at.z - onLine.z) : onLine.y - at.y;
  });
  const nearest = Math.min(...reaches);
  const reach = new Float32Array(reaches.map((each) => Math.max(0, each - nearest)));

  // Facing: the sum of the triangles' fronts, each as long as its area.
  const facing = new Vector3();
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const at = (i: number) => corners[index ? index.getX(i) : i];
  const u = new Vector3();
  const v = new Vector3();
  for (let i = 0; i + 2 < count; i += 3) {
    u.subVectors(at(i + 1), at(i));
    v.subVectors(at(i + 2), at(i));
    facing.add(u.cross(v));
  }
  if (turns) facing.y = 0;
  facing.normalize();

  const centre = corners.reduce((sum, each) => sum.add(each), new Vector3()).divideScalar(Math.max(corners.length, 1));
  const pointing = Math.atan2(centre.z - a.z, centre.x - a.x);

  const faces = new Float32Array(position.count * 3);
  const poles = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    faces.set([facing.x, facing.y, facing.z], i * 3);
    poles.set([a.x, a.z, pointing], i * 3);
  }
  geometry.setAttribute("reach", new BufferAttribute(reach, 1));
  geometry.setAttribute("facing", new BufferAttribute(faces, 3));
  geometry.setAttribute("pole", new BufferAttribute(poles, 3));
  // It moves in the shader, and a flag turns about its pole, past its bounds.
  mesh.frustumCulled = false;
}
