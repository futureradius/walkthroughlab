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
import { fixed, number, type Described } from "./settings";
import { GUST_GLSL, windUniforms } from "./wind";

/**
 * How water's small waves are drawn (#30): two ripple pictures sliding over
 * each other, made in the trailing download. They come from the
 * environment's wind: they run downwind, bigger and longer the stronger it
 * blows, rougher where its gusts pass, and none at all in still air, which is
 * how viewers who ask for reduced motion see it. Set per environment in its
 * config file under `## Water`.
 */
export interface WaterSettings {
  /** How big the waves get in a given wind: 1 a lively pool, 0 a mirror in any wind. */
  roughness: number;
  /** How fast the waves run: 1 as real water's do. */
  speed: number;
}

/** As tuned on the Redmi Note 8 in the test environment (#30). */
export const WATER: WaterSettings = { roughness: 0.6, speed: 0.45 };

export const WATER_DESCRIBED: Described<WaterSettings> = {
  roughness: number({
    label: "Roughness",
    min: 0,
    max: 3,
    step: 0.05,
    show: fixed(2, "×"),
    about: "How big water's waves get in a given wind: 1 a lively pool, 0 a mirror in any wind. The wind sets their way.",
  }),
  speed: number({
    label: "Wave speed",
    min: 0,
    max: 2,
    step: 0.05,
    show: fixed(2, "×"),
    about: "How fast water's waves run: 1 as real water's do, 0.5 half as fast. Gust speed, under Wind, moves the rougher patches.",
  }),
};

/** Water's index of refraction, which `npm run optimize` gives every water material. */
const IOR = 1.33;
/** The share of light water reflects head-on. */
const HEAD_ON = ((IOR - 1) / (IOR + 1)) ** 2;
/** Seconds the waves take to rise once their pictures are made (#14). */
const GROW_SECONDS = 1;

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
  /** How far the waves tilt the surface: the roughness times the wind's strength, as far as they have risen. */
  rough: { value: 0 },
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

  #ifdef WAVES
    uniform sampler2D ripples;
    uniform vec4 slides[${RIPPLES.length}];
    const float STEEPNESS[${RIPPLES.length}] = float[](${RIPPLES.map(({ steepness }) => steepness.toFixed(2)).join(", ")});

    /** How steeply the water rises at a spot on the floor plan, along x and z. */
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
    #ifdef WAVES
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
 * colour names, once, and reflects the sky picture through its waves on top:
 * one read of the picture, far cheaper on a phone than three.js's physical
 * material (#30). Its faces point out of the water, so drawn from the front
 * alone the view crosses its top once, and its sides and floor stay unseen.
 */
export function asWater(colour: Color, name = "water"): ShaderMaterial {
  const material = new ShaderMaterial({
    name,
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
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

/** Pixels along each side of the ripple picture. */
const RIPPLE_SIZE = 128;

/**
 * A picture of small waves that repeats seamlessly, each pixel holding how
 * steeply they rise along it and across it, in red and green. Made of waves
 * that fit the picture a whole number of times, mostly running along it.
 */
export function ripplePicture(size = RIPPLE_SIZE): DataTexture {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
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
 * Every water surface of an environment: flat until its ripple pictures are
 * made, then moves its waves on with the wind each frame, drawn as the
 * settings and the safety net allow.
 */
export class Water {
  readonly settings: WaterSettings = { ...WATER };
  private readonly materials: ShaderMaterial[];
  /** How far each ripple picture has slid, in pictures. */
  private readonly slid = RIPPLES.map(() => 0);
  /** How far the waves have risen since their pictures were made, from 0 to 1. */
  private risen = 0;
  private waving = false;

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

  /** Make the ripple pictures, in the trailing download; the waves rise from then on. */
  grow() {
    if (this.any) uniforms.ripples.value ??= ripplePicture();
  }

  /**
   * Move the waves on by one frame, after the wind has blown. Without
   * `wavesAllowed` the water lies flat; `reflection` is the strength
   * reflections are set to.
   */
  update(seconds: number, wavesAllowed: boolean, reflection: number) {
    const { roughness, speed } = this.settings;
    const strength = windUniforms.windStrength.value;
    const made = uniforms.ripples.value !== null;
    if (made) this.risen = Math.min(1, this.risen + seconds / GROW_SECONDS);
    // Flat water leaves out the waves' work altogether.
    const waving = made && wavesAllowed && roughness * strength > 0;
    if (waving !== this.waving) {
      this.waving = waving;
      for (const material of this.materials) {
        material.defines = waving ? { WAVES: "" } : {};
        material.needsUpdate = true;
      }
    }
    uniforms.reflection.value = reflection;
    uniforms.rough.value = roughness * strength * this.risen;
    // A stronger wind raises longer waves, which also run faster.
    const stretch = 0.5 + strength;
    const { x, y } = windUniforms.windDirection.value;
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
