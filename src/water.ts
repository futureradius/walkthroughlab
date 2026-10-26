import {
  Color,
  ConstantColorFactor,
  CustomBlending,
  DataTexture,
  FrontSide,
  LinearMipmapLinearFilter,
  OneFactor,
  OneMinusDstColorFactor,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  Vector4,
  ZeroFactor,
  type Texture,
} from "three";
import { choice, fixed, number, type Described } from "./settings";
import { GUST_GLSL, windUniforms } from "./wind";

/** How water's waves are drawn: worked out wave by wave, from two sliding ripple pictures, or not at all. */
export type Waves = "shader" | "textures" | "flat";

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
  /** How fast the waves run: 1 as real water's do. */
  speed: number;
  waves: Waves;
}

export const WATER: WaterSettings = { roughness: 1, speed: 1, waves: "shader" };

export const WATER_DESCRIBED: Described<WaterSettings> = {
  roughness: number({
    label: "Roughness",
    min: 0,
    max: 3,
    step: 0.05,
    show: fixed(2, "×"),
    about: "How big water's waves get in a given wind: 1 as usual, 0 a mirror in any wind. The wind sets their way.",
  }),
  speed: number({
    label: "Wave speed",
    min: 0,
    max: 2,
    step: 0.05,
    show: fixed(2, "×"),
    about: "How fast water's waves run: 1 as real water's do, 0.5 half as fast. Gust speed, under Wind, moves the rougher patches.",
  }),
  waves: choice({
    label: "Waves",
    words: ["shader", "textures", "flat"],
    about: "How the waves are drawn, to compare what each costs: worked out wave by wave, from two sliding ripple pictures, or flat water.",
    panelOnly: true,
  }),
};

/** Water's index of refraction, which `npm run optimize` gives every water material. */
const IOR = 1.33;
/** The share of light water reflects head-on. */
const HEAD_ON = ((IOR - 1) / (IOR + 1)) ** 2;

/**
 * The trains of waves added up by the shader, each as its angle off the wind
 * in radians, its length in metres in a middling wind, and its steepness:
 * how far it tilts the surface at its steepest. Short, as a pool's are, since
 * the wind has little water to raise longer ones over.
 */
const TRAINS = [
  [0.0, 0.45, 0.3],
  [0.6, 0.31, 0.25],
  [-0.5, 0.22, 0.22],
  [1.2, 0.15, 0.18],
  [-1.0, 0.1, 0.15],
  [0.25, 0.07, 0.12],
];

/**
 * The two ripple pictures' sides in metres in a middling wind, their angles
 * off the wind, and how far each tilts the surface at its steepest.
 */
const RIPPLES = [
  { side: 1.6, angle: 0, steepness: 0.35 },
  { side: 0.7, angle: 0.5, steepness: 0.25 },
];

/** How fast water's waves of this many radians per metre run, in metres a second: by gravity, and for ripples by surface tension. */
const runs = (k: number) => Math.sqrt(9.81 / k + 7.4e-5 * k);

/** What every water surface reads, shared like the wind. */
const uniforms = {
  ...windUniforms,
  /** The sky picture viewers see beyond the architecture. */
  sky: { value: null as Texture | null },
  reflection: { value: 1 },
  /** How far the waves tilt the surface: the roughness times the wind's strength. */
  rough: { value: 0 },
  /** Each train's waves per metre along x and z, its radians per metre, and how far it has run. */
  trains: { value: TRAINS.map(() => new Vector4()) },
  /** The ripple picture, made once its waves are first asked for. */
  ripples: { value: null as Texture | null },
  /** Each ripple picture's turn off the floor plan, as cos and sin, its pictures per metre and how far it has slid. */
  slides: { value: RIPPLES.map(() => new Vector4()) },
};

const VERTEX = /* glsl */ `
  varying vec3 vSpot;
  varying vec3 vNormal;

  void main() {
    vec4 spot = modelMatrix * vec4(position, 1.0);
    vSpot = spot.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * spot;
  }
`;

const FRAGMENT = /* glsl */ `
  #include <common>
  uniform sampler2D sky;
  uniform float reflection;
  uniform float rough;
  varying vec3 vSpot;
  varying vec3 vNormal;
  ${GUST_GLSL}

  #if defined( WAVES_SHADER )
    uniform vec4 trains[${TRAINS.length}];
    const float STEEPNESS[${TRAINS.length}] = float[](${TRAINS.map(([, , steepness]) => steepness.toFixed(2)).join(", ")});

    /** How steeply the water rises at a spot on the floor plan, along x and z. */
    vec2 waveSlope(vec2 spot) {
      // How far apart neighbouring pixels lie on the water: waves too short
      // to draw there fade out rather than flicker.
      float pixel = length(fwidth(spot));
      vec2 slope = vec2(0.0);
      for (int i = 0; i < ${TRAINS.length}; i++) {
        vec4 train = trains[i];
        float seen = clamp(1.5708 / (pixel * train.z) - 1.0, 0.0, 1.0);
        slope += train.xy / train.z * (STEEPNESS[i] * seen * cos(dot(train.xy, spot) - train.w));
      }
      return slope;
    }
  #elif defined( WAVES_TEXTURES )
    uniform sampler2D ripples;
    uniform vec4 slides[${RIPPLES.length}];
    const float STEEPNESS[${RIPPLES.length}] = float[](${RIPPLES.map(({ steepness }) => steepness.toFixed(2)).join(", ")});

    vec2 waveSlope(vec2 spot) {
      vec2 slope = vec2(0.0);
      for (int i = 0; i < ${RIPPLES.length}; i++) {
        vec4 slide = slides[i];
        // Into the picture's own turn, along it and across, and its slope back out.
        mat2 turn = mat2(slide.x, -slide.y, slide.y, slide.x);
        vec2 tilt = texture2D(ripples, (turn * spot) * slide.z - vec2(slide.w, 0.0)).rg * 2.0 - 1.0;
        slope += transpose(turn) * tilt * STEEPNESS[i];
      }
      return slope;
    }
  #endif

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 toEye = normalize(cameraPosition - vSpot);
    #if defined( WAVES_SHADER ) || defined( WAVES_TEXTURES )
      // Only the water's top tilts with its waves; its sides stay as they are.
      vec2 slope = waveSlope(vSpot.xz) * rough * gusting(vSpot.xz) * max(normal.y, 0.0);
      normal = normalize(normal + vec3(-slope.x, 0.0, -slope.y));
    #endif
    vec3 bounced = reflect(-toEye, normal);
    // A wave tilted far enough to bounce the view down shows the sky just above the horizon.
    bounced.y = abs(bounced.y);
    // How much of the sky water reflects: little head-on, nearly all at a grazing angle.
    float facing = max(dot(normal, toEye), 0.0);
    float share = ${HEAD_ON.toFixed(4)} + ${(1 - HEAD_ON).toFixed(4)} * pow(1.0 - facing, 5.0);
    // Where three.js finds a direction in the sky picture.
    vec2 uv = vec2(atan(bounced.z, bounced.x) * RECIPROCAL_PI2 + 0.5, asin(clamp(bounced.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5);
    // Across the picture's seam its x jumps by 1, which is no real change.
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    dx.x -= floor(dx.x + 0.5);
    dy.x -= floor(dy.x + 0.5);
    gl_FragColor = vec4(textureGrad(sky, uv, dx, dy).rgb * share * reflection, 1.0);
    #include <colorspace_fragment>
    // Light adds up before it is encoded for display, and the canvas can only
    // add after. Over a mid-grey that would make a faint reflection several
    // times too bright, which this holds back, as for glass.
    gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(1.25));
  }
`;

/**
 * Water that tints what lies below it by the share of red, green and blue its
 * colour names, once, and reflects the sky picture through its waves on top.
 * Its faces point out of the water, so drawn from the front alone the view
 * crosses its top once, and its sides and floor stay unseen.
 */
export function asWater(colour: Color, name = "water"): ShaderMaterial {
  const material = new ShaderMaterial({
    name,
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: definesFor(WATER.waves),
    side: FrontSide,
    depthWrite: false,
    toneMapped: false,
  });
  // The canvas holds colours encoded for display, where taking away a share
  // of the light takes away a smaller share of the number.
  material.blendColor = new Color(colour.r ** (1 / 2.2), colour.g ** (1 / 2.2), colour.b ** (1 / 2.2));
  // What is below is multiplied by the colour; the reflection fills in what
  // is left of white, so that it shows most over the dark.
  material.blending = CustomBlending;
  material.blendSrc = OneMinusDstColorFactor;
  material.blendDst = ConstantColorFactor;
  material.blendSrcAlpha = ZeroFactor;
  material.blendDstAlpha = OneFactor;
  return material;
}

function definesFor(waves: Waves): Record<string, string> {
  return waves === "shader" ? { WAVES_SHADER: "" } : waves === "textures" ? { WAVES_TEXTURES: "" } : {};
}

/** Pixels along each side of the ripple picture. */
const RIPPLE_SIZE = 128;

/**
 * A picture of small waves that repeats seamlessly, each pixel holding how
 * steeply they rise along it and across it, in red and green. Made of waves
 * that fit the picture a whole number of times, mostly running along it.
 */
export function ripplePicture(size = RIPPLE_SIZE): DataTexture {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const waves: { m: number; n: number; height: number; phase: number }[] = [];
  while (waves.length < 40) {
    const m = Math.round(1 + random() * 9);
    const n = Math.round((random() * 2 - 1) * 6);
    const k = Math.hypot(m, n);
    // Fewer and smaller short waves, and few running across.
    const along = m / k;
    waves.push({ m, n, height: (along * along) / k ** 2.5, phase: random() * Math.PI * 2 });
  }
  const slopes = new Float32Array(size * size * 2);
  let steepest = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sx = 0;
      let sy = 0;
      for (const { m, n, height, phase } of waves) {
        const turn = Math.cos((2 * Math.PI * (m * x + n * y)) / size + phase) * height * 2 * Math.PI;
        sx += m * turn;
        sy += n * turn;
      }
      const at = (y * size + x) * 2;
      slopes[at] = sx;
      slopes[at + 1] = sy;
      steepest = Math.max(steepest, Math.abs(sx), Math.abs(sy));
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round((slopes[i * 2] / steepest) * 127.5 + 127.5);
    data[i * 4 + 1] = Math.round((slopes[i * 2 + 1] / steepest) * 127.5 + 127.5);
    data[i * 4 + 3] = 255;
  }
  const picture = new DataTexture(data, size, size, RGBAFormat);
  picture.wrapS = picture.wrapT = RepeatWrapping;
  picture.minFilter = LinearMipmapLinearFilter;
  picture.generateMipmaps = true;
  picture.needsUpdate = true;
  return picture;
}

/**
 * Every water surface of an environment: moves its waves on with the wind
 * each frame, and draws them as the settings and the safety net allow.
 */
export class Water {
  readonly settings: WaterSettings = { ...WATER };
  private readonly materials: ShaderMaterial[];
  /** How far each train of waves, and each ripple picture, has run, in radians or pictures. */
  private readonly run = TRAINS.map(() => 0);
  private readonly slid = RIPPLES.map(() => 0);
  private drawn: Waves = WATER.waves;

  constructor(materials: ShaderMaterial[]) {
    this.materials = materials;
  }

  /** Whether there is any water, so the safety net has its waves to take. */
  get any(): boolean {
    return this.materials.length > 0;
  }

  /** The sky picture to reflect: the small one first, then the sharp one. */
  set sky(picture: Texture) {
    uniforms.sky.value = picture;
  }

  /**
   * Move the waves on by one frame, after the wind has blown. Without
   * `wavesAllowed` the water lies flat; `reflection` is the strength
   * reflections are set to.
   */
  update(seconds: number, wavesAllowed: boolean, reflection: number) {
    const { roughness, speed, waves } = this.settings;
    const strength = windUniforms.windStrength.value;
    const drawn = wavesAllowed && roughness * strength > 0 ? waves : "flat";
    if (drawn !== this.drawn) {
      this.drawn = drawn;
      if (drawn === "textures") uniforms.ripples.value ??= ripplePicture();
      for (const material of this.materials) {
        material.defines = definesFor(drawn);
        material.needsUpdate = true;
      }
    }
    uniforms.reflection.value = reflection;
    uniforms.rough.value = roughness * strength;
    // A stronger wind raises longer waves, which also run faster.
    const stretch = 0.5 + strength;
    const { x, y } = windUniforms.windDirection.value;
    TRAINS.forEach(([angle, length], i) => {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const k = (2 * Math.PI) / (length * stretch);
      this.run[i] = (this.run[i] + k * runs(k) * seconds * speed) % (2 * Math.PI);
      uniforms.trains.value[i].set((c * x - s * y) * k, (s * x + c * y) * k, k, this.run[i]);
    });
    RIPPLES.forEach(({ side, angle }, i) => {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const metres = side * stretch;
      // The picture's longest waves are a quarter of its side.
      const k = (2 * Math.PI) / (metres / 4);
      this.slid[i] = (this.slid[i] + (runs(k) * seconds * speed) / metres) % 1;
      // Its x runs along the wind turned by its angle.
      uniforms.slides.value[i].set(c * x - s * y, s * x + c * y, 1 / metres, this.slid[i]);
    });
  }
}
