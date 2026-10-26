import type { MeshStandardMaterial } from "three";
import { fixed, number, type Described } from "./settings";
import { GUST_GLSL, windUniforms } from "./wind";

/**
 * How water's small waves are drawn (#30). They come from the environment's
 * wind: they run downwind, bigger and longer the stronger it blows, rougher
 * where its gusts pass, and none at all in still air, which is how viewers
 * who ask for reduced motion see it. Set per environment in its config file
 * under `## Water`.
 */
export interface WaterSettings {
  /** How big the waves get in a given wind: 1 as usual, 0 a mirror in any wind. */
  roughness: number;
}

export const WATER: WaterSettings = { roughness: 1 };

export const WATER_DESCRIBED: Described<WaterSettings> = {
  roughness: number({
    label: "Roughness",
    min: 0,
    max: 3,
    step: 0.05,
    show: fixed(2, "×"),
    about: "How big water's waves get in a given wind: 1 as usual, 0 a mirror in any wind. The wind sets their way and speed.",
  }),
};

/** What every water surface reads: its roughness, or 0 while waves are not drawn. */
export const waves = { value: WATER.roughness };

/**
 * The trains of waves added up on water, each as its angle off the wind in
 * radians, its length in metres in a middling wind, and its steepness: how
 * far it tilts the surface at its steepest.
 */
const TRAINS = [
  [0.0, 1.1, 0.3],
  [0.6, 0.71, 0.25],
  [-0.5, 0.47, 0.22],
  [1.2, 0.29, 0.18],
  [-1.0, 0.19, 0.15],
  [0.25, 0.12, 0.12],
];

const WAVES_GLSL = /* glsl */ `
  uniform float waves;
  varying vec2 vWaterSpot;
  ${GUST_GLSL}

  const vec3 TRAINS[${TRAINS.length}] = vec3[](${TRAINS.map((train) => `vec3(${train.map((n) => n.toFixed(2)).join(", ")})`).join(", ")});

  /** How steeply the water rises at a spot on the floor plan, along x and z. */
  vec2 waveSlope(vec2 spot) {
    // A stronger wind raises longer waves, which also run faster.
    float stretch = 0.5 + windStrength;
    // How far apart neighbouring pixels lie on the water: waves too short to
    // draw there fade out rather than flicker.
    float pixel = length(fwidth(spot));
    vec2 slope = vec2(0.0);
    for (int i = 0; i < ${TRAINS.length}; i++) {
      vec3 train = TRAINS[i];
      float c = cos(train.x), s = sin(train.x);
      vec2 heading = vec2(c * windDirection.x - s * windDirection.y, s * windDirection.x + c * windDirection.y);
      float wavelength = train.y * stretch;
      float k = 6.2832 / wavelength;
      // How fast water's waves run: by gravity, and for ripples by surface tension.
      float w = sqrt(9.81 * k + 7.4e-5 * k * k * k);
      float seen = clamp(wavelength / (4.0 * pixel) - 1.0, 0.0, 1.0);
      slope += heading * train.z * seen * cos(k * dot(heading, spot) - w * time + float(i) * 1.7);
    }
    return slope * waves * windStrength * gusting(spot);
  }
`;

/**
 * Tilt water's top by its waves where three.js has worked out the surface's
 * normal, so the sky's reflection and how much of it shows both follow them.
 * Its sides stay as they are.
 */
const TILT_GLSL = /* glsl */ `
  #include <normal_fragment_maps>
  if (waves > 0.0 && windStrength > 0.0) {
    vec2 slope = waveSlope(vWaterSpot);
    vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    float top = max(dot(normal, up), 0.0);
    normal = normalize(normal + mat3(viewMatrix) * vec3(-slope.x, 0.0, -slope.y) * top);
  }
`;

/** Give a material, already drawn as glass, water's waves, keeping what glass does to its shader. */
export function withWaves(material: MeshStandardMaterial) {
  const asGlass = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    asGlass.call(material, shader, renderer);
    Object.assign(shader.uniforms, windUniforms, { waves });
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec2 vWaterSpot;\nvoid main() {")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWaterSpot = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${WAVES_GLSL}\nvoid main() {`)
      .replace("#include <normal_fragment_maps>", TILT_GLSL);
  };
  material.customProgramCacheKey = () => "water";
  return material;
}
