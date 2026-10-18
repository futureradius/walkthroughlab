import {
  CustomBlending,
  DstColorFactor,
  ShaderMaterial,
  SrcColorFactor,
  Vector2,
  ZeroFactor,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { BLURS, Blur } from "./blur";
import { LAYERS } from "./environment";
import { choice, fixed, number, percent, toggle, type Described } from "./settings";
import { LET_OFF } from "./sunlit";

export interface OcclusionSettings {
  /** Off draws the scene as if there were no ambient occlusion. */
  on: boolean;
  /** Show the darkening alone, on white, to judge it while tuning. */
  alone: boolean;
  /**
   * How the darkening is worked out: `n8ao` is N8AO, `gtao` is three.js's own
   * way, `glamarye` is the one in Glamarye Fast Effects for ReShade.
   */
  method: string;
  /** How far a surface looks for neighbours that shade it, in metres. Not with `glamarye`. */
  reach: number;
  /**
   * How hard the darkening is pressed: 0 leaves the picture alone, 1 is as
   * worked out, more is darker. Not with `glamarye`, which has `shade`.
   */
  strength: number;
  /** How much of the darkening sunlit surfaces are let off: 0 is none, 1 is all. */
  spare: number;
  /** How bright baked light must be for a surface to count as sunlit, from 0 to 1 of what the picture holds. */
  sunlit: number;
  /** How many spots around each pixel are checked for neighbours. Not with `glamarye`, which has `points`. */
  samples: number;
  /** The share of the canvas's width and height the darkening is worked out at. */
  detail: number;
  /** Whether the speckle left by so few samples is smoothed away. Not with `glamarye`, which never smooths. */
  smooth: boolean;
  /**
   * How the darkening is blurred once worked out, with any method, to wash
   * out the pattern of neighbouring pixels checking different spots:
   * `off`; `box2`, an average of 2 by 2 pixels; `box4`, of 4 by 4; or
   * `depth4`, the 4 by 4 that leaves out neighbours much nearer or farther.
   * See blur.ts.
   */
  blur: string;
  /**
   * With `n8ao` only: how much nearer than a spot a neighbour may be and
   * still shade it fully, in fifths of the reach. Smaller leaves less of an
   * outline around whatever stands in front of a wall, and less darkening
   * altogether.
   */
  falloff: number;
  /**
   * With `n8ao` only, and a detail of half or less: whether the darkening is
   * enlarged with an eye on where surfaces end, so it stays within their
   * edges. The depths it goes by are drawn at twice the detail.
   */
  edges: boolean;
  /**
   * The rest are for `glamarye` only, named after its own settings with the
   * same usual values. `shade` is its "AO strength": how deep hollows are
   * shaded, from 0 to 1 and more.
   */
  shade: number;
  /** "AO shine": how much bumps facing the viewpoint are brightened, from 0. */
  shine: number;
  /**
   * "AO radius": how far around each pixel it looks, as a share of the screen
   * rather than in metres. 1 is a hundredth of its diagonal.
   */
  radius: number;
  /** FAST_AO_POINTS: how many spots on a circle around each pixel are checked, from 2 to 16. */
  points: number;
  /** "AO shape modifier": how deep a hollow must be before it is shaded, from 1 to 4000. */
  shape: number;
  /**
   * "AO max depth diff": how much nearer or farther a spot may be and still
   * count, in hundredths of the depth. Smaller leaves less of a dark outline
   * around whatever stands in front of a wall.
   */
  gap: number;
  /** "AO max distance": the depth at which the darkening has faded out; 0.5 is about 100 m. */
  fade: number;
  /** "AO bigger dither": four sizes of circle in a pattern of 2 by 4 pixels instead of two in a checkerboard. */
  dither: boolean;
}

/** The usual settings, unless an environment's config file says otherwise. */
export const OCCLUSION: OcclusionSettings = {
  on: true,
  alone: false,
  method: "n8ao",
  reach: 0.2,
  strength: 4,
  spare: 1,
  sunlit: 0.2,
  samples: 12,
  detail: 0.5,
  smooth: true,
  blur: "off",
  falloff: 3,
  edges: false,
  shade: 0.6,
  shine: 0.3,
  radius: 1,
  points: 6,
  shape: 1000,
  gap: 0.5,
  fade: 0.5,
  dither: false,
};

/** The darkening a method worked out for one frame, and how it is to be put on the picture. */
export interface Darkening {
  /** The share of light left at each pixel, in red. */
  occlusion: Texture;
  /** How brightly baked light falls on each surface, in alpha; see sunlit.ts. */
  brightness: Texture;
  /** The depths the darkening was worked out from, at its size. */
  depths: Texture;
  /** What the share of light left is raised to the power of: how hard the darkening is pressed. */
  strength: number;
  /** Whether the share of light left can be above 1, brightening the picture. */
  brightens: boolean;
}

/** A way of working the darkening out, set up for a scene. */
export interface OcclusionWorkings {
  /** Work the darkening out for the scene as it now shows, at this size. */
  work(
    renderer: WebGLRenderer,
    width: number,
    height: number,
    settings: OcclusionSettings,
    bakedLight: Texture | null,
  ): Darkening;
}

/** A way of working the darkening out, as the `method` setting names it. */
export interface Method {
  name: string;
  /**
   * The settings it uses that not every method does. The ?config panel
   * shows each of them only while a method that uses it is chosen.
   */
  uses: readonly (keyof OcclusionSettings)[];
  /** Fetch its code and set it up for the scene. */
  load(scene: Scene, camera: PerspectiveCamera): Promise<OcclusionWorkings>;
}

/** Every way of working the darkening out. Each is its own download, fetched only once chosen. */
export const METHODS: readonly Method[] = [
  {
    name: "gtao",
    uses: ["reach", "strength", "samples", "smooth"],
    load: async (scene, camera) => new (await import("./gtao")).Gtao(scene, camera),
  },
  {
    name: "n8ao",
    uses: ["reach", "strength", "samples", "smooth", "falloff", "edges"],
    load: async (scene, camera) => new (await import("./n8")).N8(scene, camera),
  },
  {
    name: "glamarye",
    uses: ["shade", "shine", "radius", "points", "shape", "gap", "fade", "dither"],
    load: async (scene, camera) => new (await import("./glamarye")).Glamarye(scene, camera),
  },
];

export const OCCLUSION_DESCRIBED: Described<OcclusionSettings> = {
  on: toggle({ label: "On", about: "Off leaves ambient occlusion out altogether." }),
  alone: toggle({
    label: "Only the darkening",
    about: "Shows the darkening alone, on white, to judge it while tuning.",
    panelOnly: true,
  }),
  method: choice({
    label: "Method",
    words: METHODS.map(({ name }) => name),
    about: "How the darkening is worked out: three.js's own GTAO, N8AO, or Glamarye Fast Effects'.",
  }),
  reach: number({
    label: "Reach",
    min: 0.05,
    max: 2,
    step: 0.05,
    show: fixed(2, " m"),
    about: "How far a surface looks for neighbours that shade it.",
  }),
  strength: number({
    label: "Strength",
    min: 0,
    max: 8,
    step: 0.1,
    show: fixed(1),
    about: "How hard the darkening is pressed: 0 is none, 1 is as worked out, more is darker.",
  }),
  spare: number({
    label: "Spare sunlit",
    min: 0,
    max: 1,
    step: 0.05,
    show: percent,
    about: "How much of the darkening sunlit surfaces are let off.",
  }),
  sunlit: number({
    label: "Sunlit above",
    min: 0.05,
    max: 0.4,
    step: 0.01,
    show: fixed(2),
    about: "How bright the baked light must be for a surface to count as sunlit; lower spares more.",
  }),
  samples: number({
    label: "Samples",
    min: 1,
    max: 32,
    step: 1,
    show: String,
    about: "How many spots around each pixel are checked: more is smoother and slower.",
  }),
  detail: number({
    label: "Detail",
    min: 0.25,
    max: 1,
    step: 0.25,
    show: percent,
    about: "The share of the screen's width and height the darkening is worked out at: 50 % is a quarter of the pixels.",
  }),
  smooth: toggle({
    label: "Smoothing",
    about: "Smooths away the speckle that few samples leave.",
  }),
  blur: choice({
    label: "Blur",
    words: BLURS,
    about: "How the darkening is blurred once worked out: box2 washes out a 2 by 2 pattern, box4 reaches twice as far, depth4 keeps to the edges of things.",
  }),
  falloff: number({
    label: "Falloff",
    min: 0.1,
    max: 5,
    step: 0.1,
    show: fixed(1),
    about: "Smaller leaves less of a dark outline around whatever stands in front of a wall, and less darkening altogether.",
  }),
  edges: toggle({
    label: "Edge-aware",
    about: "At a detail of 50 % or less, keeps the darkening within the edges of surfaces, at twice the cost of the depths.",
  }),
  shade: number({
    label: "Shade",
    min: 0,
    max: 2,
    step: 0.05,
    show: fixed(2),
    about: "How deep hollows are shaded, in place of strength.",
  }),
  shine: number({
    label: "Shine",
    min: 0,
    max: 1,
    step: 0.05,
    show: fixed(2),
    about: "How much bumps facing the viewpoint are brightened.",
  }),
  radius: number({
    label: "Radius",
    min: 0.1,
    max: 4,
    step: 0.05,
    show: fixed(2, " %"),
    about: "How far around each pixel it looks, in place of reach: 1 is a hundredth of the screen's diagonal.",
  }),
  points: number({
    label: "Points",
    min: 2,
    max: 16,
    step: 1,
    show: String,
    about: "How many spots on a circle around each pixel are checked, in place of samples.",
  }),
  shape: number({
    label: "Shape",
    min: 1,
    max: 4000,
    step: 1,
    show: String,
    about: "How deep a hollow must be before it is shaded.",
  }),
  gap: number({
    label: "Gap",
    min: 0,
    max: 2,
    step: 0.01,
    show: fixed(2),
    about: "How much nearer or farther a spot may be and still count, in hundredths of the depth; smaller leaves less of an outline.",
  }),
  fade: number({
    label: "Fade",
    min: 0.05,
    max: 2,
    step: 0.05,
    show: fixed(2),
    about: "The depth at which the darkening has faded out: 0.5 is about 100 m.",
  }),
  dither: toggle({
    label: "Bigger dither",
    about: "Uses four sizes of circle in a 2 by 4 pattern instead of two in a checkerboard; box4 blurs it away.",
  }),
};

// A setting some methods use is shown only while one of them is chosen.
for (const setting of Object.keys(OCCLUSION_DESCRIBED) as (keyof OcclusionSettings)[]) {
  const usedBy = METHODS.filter(({ uses }) => uses.includes(setting)).map(({ name }) => name);
  if (usedBy.length > 0) OCCLUSION_DESCRIBED[setting].when = { method: usedBy };
}

/**
 * The kinds of surface drawn over the darkening rather than under it: they
 * neither shade what is near them nor hide what is behind them, and are not
 * darkened themselves. Solid surfaces are drawn under it.
 */
const OVER_DARKENING = [LAYERS.glass];

/**
 * Ambient occlusion: draws the scene to the canvas exactly as it would be
 * drawn without it, then darkens the picture where surfaces come close.
 */
export class AmbientOcclusion {
  readonly settings: OcclusionSettings = { ...OCCLUSION };

  /** The environment's baked light, which tells sunlit surfaces from shaded ones. */
  bakedLight: Texture | null = null;

  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly methods: readonly Method[];
  /** Each method asked for so far, by name, until it has arrived or failed to. */
  private readonly loading = new Map<string, Promise<void>>();
  /** Each method that has arrived, by name, set up for the scene. */
  private readonly loaded = new Map<string, OcclusionWorkings>();
  private blur: Blur | null = null;
  private readonly darken: FullScreenQuad;
  private readonly size = new Vector2();

  /** Whether this device can work out ambient occlusion at all. */
  static supported(renderer: WebGLRenderer): boolean {
    return (
      renderer.extensions.has("EXT_color_buffer_half_float") ||
      renderer.extensions.has("EXT_color_buffer_float")
    );
  }

  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    methods: readonly Method[] = METHODS,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.methods = methods;
    this.darken = new FullScreenQuad(
      new ShaderMaterial({
        uniforms: {
          occlusion: { value: null },
          strength: { value: this.settings.strength },
          brightness: { value: null },
          spare: { value: this.settings.spare },
          sunlit: { value: this.settings.sunlit },
          headroom: { value: 1 },
          shift: { value: new Vector2() },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;

          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D occlusion;
          uniform float strength;
          uniform sampler2D brightness;
          uniform float headroom;
          uniform vec2 shift;
          varying vec2 vUv;
          ${LET_OFF}

          void main() {
            float light = pow(texture2D(occlusion, vUv - shift).r, strength);
            light = spared(light, texture2D(brightness, vUv));
            // The canvas holds colours encoded for display, where taking away
            // a share of the light takes away a smaller share of the number.
            gl_FragColor = vec4(vec3(pow(light, 1.0 / 2.2) / headroom), 1.0);
          }`,
        // Multiplies what is already on the canvas.
        blending: CustomBlending,
        blendSrc: DstColorFactor,
        blendDst: ZeroFactor,
        depthTest: false,
        depthWrite: false,
      }),
    );
  }

  /** Fetch a method and set it up, once however often it is asked for. */
  private load(name: string): Promise<void> {
    let loading = this.loading.get(name);
    if (!loading) {
      loading = (async () => {
        const method = this.methods.find((method) => method.name === name);
        if (!method) throw new Error(`There is no method named ${name}.`);
        this.loaded.set(name, await method.load(this.scene, this.camera));
      })().catch((error: unknown) => {
        console.warn(`Ambient occlusion could not load ${name}, so frames go without it.`, error);
      });
      this.loading.set(name, loading);
    }
    return loading;
  }

  /**
   * Fetch the method the settings ask for, and nothing while they turn
   * ambient occlusion off, so that the first frame drawn already has it.
   * A method chosen later is fetched then, and frames go without until it
   * arrives.
   */
  async ready(): Promise<void> {
    if (this.settings.on) await this.load(this.settings.method);
  }

  /** Draw the scene to the canvas with ambient occlusion over it. */
  render() {
    const { renderer, scene, camera, settings } = this;
    const workings = settings.on ? this.loaded.get(settings.method) : undefined;
    if (!workings) {
      if (settings.on) void this.load(settings.method);
      renderer.render(scene, camera);
      return;
    }
    renderer.getDrawingBufferSize(this.size);
    const width = Math.max(1, Math.round(this.size.x * settings.detail));
    const height = Math.max(1, Math.round(this.size.y * settings.detail));

    // Only solid surfaces shade what is near them, and the sky is too far
    // away to shade anything.
    const layers = camera.layers.mask;
    camera.layers.set(LAYERS.solid);
    const background = scene.background;
    scene.background = null;
    const darkening = workings.work(renderer, width, height, settings, this.bakedLight);
    scene.background = background;
    const { uniforms } = this.darken.material as ShaderMaterial;
    if (settings.blur !== "off") {
      const blur = (this.blur ??= new Blur());
      const blurred = blur.blur(renderer, settings.blur, darkening.occlusion, darkening.depths, camera);
      uniforms.occlusion.value = blurred.texture;
      uniforms.shift.value.copy(blurred.shift);
    } else {
      uniforms.occlusion.value = darkening.occlusion;
      uniforms.shift.value.set(0, 0);
    }
    uniforms.brightness.value = darkening.brightness;
    uniforms.strength.value = darkening.strength;
    // Light above 1 is more than a colour can hold. Halved, the colour is
    // added twice, at the cost of coarser steps in the darkening.
    uniforms.headroom.value = darkening.brightens ? 2 : 1;
    this.darken.material.blendDst = darkening.brightens ? SrcColorFactor : ZeroFactor;
    uniforms.spare.value = settings.spare;
    uniforms.sunlit.value = settings.sunlit;

    // Everything bound for the canvas is drawn in one go, after the work off
    // screen, so a phone never has to set a half-drawn canvas aside.
    renderer.setRenderTarget(null);
    if (settings.alone) {
      renderer.setClearColor(0xffffff);
      renderer.clear();
    } else {
      renderer.render(scene, camera);
    }
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.darken.render(renderer);
    if (!settings.alone) {
      // Glass goes on last, so the darkening behind it is seen through it
      // like everything else there rather than lying on top of it.
      camera.layers.disableAll();
      for (const layer of OVER_DARKENING) camera.layers.enable(layer);
      scene.background = null;
      renderer.render(scene, camera);
      scene.background = background;
    }
    camera.layers.mask = layers;
    renderer.autoClear = autoClear;
  }
}
