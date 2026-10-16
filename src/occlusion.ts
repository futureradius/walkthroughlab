import {
  CustomBlending,
  DoubleSide,
  DstColorFactor,
  Mesh,
  ShaderMaterial,
  SrcColorFactor,
  Vector2,
  ZeroFactor,
  type Material,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { BLURS, Blur } from "./blur";
import { Glamarye } from "./glamarye";

/** What can be changed about ambient occlusion while it runs; see tuning.ts. */
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

/** A way of working the darkening out. */
export interface OcclusionWorkings {
  /**
   * Work the darkening out for the scene as it now shows, at this size. The
   * first picture holds it in red; the second holds, in alpha, how brightly
   * baked light falls on each surface; the third is the depths the darkening
   * was worked out from, at the first's size.
   */
  work(
    renderer: WebGLRenderer,
    width: number,
    height: number,
    settings: OcclusionSettings,
    bakedLight: Texture | null,
  ): { occlusion: Texture; brightness: Texture; depths: Texture };
}

/** The pass keeps the step that draws each of its stages to itself. */
interface PassInternals {
  _renderPass(renderer: WebGLRenderer, material: Material, ...rest: unknown[]): void;
  normalRenderTarget: WebGLRenderTarget;
}

function seeThrough(mesh: Mesh): boolean {
  const materials: Material[] = [mesh.material].flat();
  return materials.some((material) => material.transparent);
}

function show(meshes: Mesh[], visible: boolean) {
  for (const mesh of meshes) mesh.visible = visible;
}

/** Works the darkening out the way three.js does. */
class Gtao implements OcclusionWorkings {
  private readonly pass: GTAOPass;
  private readonly internals: PassInternals;
  private readonly light = { value: null as Texture | null };
  private smooth = true;

  constructor(scene: Scene, camera: PerspectiveCamera) {
    this.pass = new GTAOPass(scene, camera);
    // Work the darkening out, but leave drawing it to AmbientOcclusion.
    this.pass.output = GTAOPass.OUTPUT.Off;
    // The pass always smooths, so leaving that out means stepping over it.
    const internals = (this.internals = this.pass as unknown as PassInternals);
    const renderPass = internals._renderPass.bind(this.pass);
    internals._renderPass = (renderer, material, ...rest) => {
      if (material === this.pass.pdMaterial && !this.smooth) return;
      renderPass(renderer, material, ...rest);
    };
    // Rhino doesn't care which way a face points; see `prepare` in environment.ts.
    this.pass.normalMaterial.side = DoubleSide;
    // The picture of which way surfaces face has a spare channel, which
    // carries how brightly the baked light falls on each of them.
    this.pass.normalMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.bakedLight = this.light;
      shader.vertexShader = shader.vertexShader
        .replace(
          "void main() {",
          /* glsl */ `
          attribute vec2 uv1;
          varying vec2 vBakedUv;

          void main() {
            vBakedUv = uv1;`,
        );
      shader.fragmentShader =
        shader.fragmentShader.replace(
          "void main() {",
          /* glsl */ `
          uniform sampler2D bakedLight;
          varying vec2 vBakedUv;

          void facing() {`,
        ) +
        /* glsl */ `
          void main() {
            facing();
            gl_FragColor.a = dot(texture2D(bakedLight, vBakedUv).rgb, vec3(0.2126, 0.7152, 0.0722));
          }`;
    };
  }

  work(
    renderer: WebGLRenderer,
    width: number,
    height: number,
    settings: OcclusionSettings,
    bakedLight: Texture | null,
  ) {
    const { pass } = this;
    if (pass.width !== width || pass.height !== height) pass.setSize(width, height);
    pass.updateGtaoMaterial({
      radius: settings.reach,
      // Nothing farther in front than the reach may shade a surface, or a
      // column draws an outline on whatever stands a little way behind it.
      thickness: settings.reach,
      samples: Math.max(1, Math.round(settings.samples)),
    });
    this.smooth = settings.smooth;
    this.light.value = bakedLight;
    // The pass reads neither buffer when its output is off.
    pass.render(renderer, null!, null!, 0, false);
    return {
      occlusion: (settings.smooth ? pass.pdRenderTarget : pass.gtaoRenderTarget).texture,
      brightness: this.internals.normalRenderTarget.texture,
      depths: pass.depthTexture,
    };
  }
}

/**
 * Ambient occlusion: draws the scene to the canvas exactly as it would be
 * drawn without it, then darkens the picture where surfaces come close.
 */
export class AmbientOcclusion {
  readonly settings: OcclusionSettings = {
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

  /** The environment's baked light, which tells sunlit surfaces from shaded ones. */
  bakedLight: Texture | null = null;

  private readonly renderer: WebGLRenderer;
  private gtao: OcclusionWorkings | null = null;
  private n8ao: OcclusionWorkings | null = null;
  private glamarye: OcclusionWorkings | null = null;
  private blur: Blur | null = null;
  private fetched: Promise<void> | null = null;
  private readonly darken: FullScreenQuad;
  private readonly size = new Vector2();
  private readonly glass: Mesh[] = [];
  private readonly solid: Mesh[] = [];

  /** Whether this device can work out ambient occlusion at all. */
  static supported(renderer: WebGLRenderer): boolean {
    return (
      renderer.extensions.has("EXT_color_buffer_half_float") ||
      renderer.extensions.has("EXT_color_buffer_float")
    );
  }

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
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
          uniform float spare;
          uniform float sunlit;
          uniform float headroom;
          uniform vec2 shift;
          varying vec2 vUv;

          void main() {
            float light = pow(texture2D(occlusion, vUv - shift).r, strength);
            // Ambient occlusion only dims light from all around, and a
            // surface in the sun gets nearly all its light from one place.
            float inSun = smoothstep(sunlit - 0.05, sunlit + 0.05, texture2D(brightness, vUv).a);
            light = mix(light, 1.0, spare * inSun);
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

  /** The way the settings ask for, or nothing while it is still on its way. */
  private workings(scene: Scene, camera: PerspectiveCamera): OcclusionWorkings | null {
    switch (this.settings.method) {
      case "n8ao":
        if (!this.n8ao) void this.fetch(scene, camera);
        return this.n8ao;
      case "glamarye":
        return (this.glamarye ??= new Glamarye(scene, camera));
      default:
        return (this.gtao ??= new Gtao(scene, camera));
    }
  }

  private fetch(scene: Scene, camera: PerspectiveCamera): Promise<void> {
    return (this.fetched ??= import("./n8").then(({ N8 }) => {
      this.n8ao = new N8(scene, camera);
    }));
  }

  /**
   * Fetch what the settings' method needs, so that the first frame drawn
   * already has ambient occlusion. If it cannot be had, frames go without.
   */
  async ready(scene: Scene, camera: PerspectiveCamera): Promise<void> {
    if (this.settings.method === "n8ao") await this.fetch(scene, camera).catch(() => {});
  }

  /** Draw the scene to the canvas with ambient occlusion over it. */
  render(scene: Scene, camera: PerspectiveCamera) {
    const { renderer, settings } = this;
    const workings = settings.on ? this.workings(scene, camera) : null;
    if (!workings) {
      renderer.render(scene, camera);
      return;
    }
    renderer.getDrawingBufferSize(this.size);
    const width = Math.max(1, Math.round(this.size.x * settings.detail));
    const height = Math.max(1, Math.round(this.size.y * settings.detail));

    // Glass neither shades what is near it nor hides what is behind it, and
    // the sky is too far away to shade anything.
    scene.traverse((object) => {
      if (!object.visible || !(object instanceof Mesh)) return;
      (seeThrough(object) ? this.glass : this.solid).push(object);
    });
    show(this.glass, false);
    const background = scene.background;
    scene.background = null;
    const { occlusion, brightness, depths } = workings.work(
      renderer,
      width,
      height,
      settings,
      this.bakedLight,
    );
    scene.background = background;
    const { uniforms } = this.darken.material as ShaderMaterial;
    if (settings.blur !== "off" && BLURS.includes(settings.blur)) {
      const blur = (this.blur ??= new Blur());
      uniforms.occlusion.value = blur.blur(renderer, settings.blur, occlusion, depths, camera);
      uniforms.shift.value.copy(blur.shift);
    } else {
      uniforms.occlusion.value = occlusion;
      uniforms.shift.value.set(0, 0);
    }
    uniforms.brightness.value = brightness;
    // Glamarye presses its darkening by `shade` as it works it out.
    const glamarye = settings.method === "glamarye";
    uniforms.strength.value = glamarye ? 1 : settings.strength;
    // Its shine brightens, which a colour cannot hold. Halved, the colour is
    // added twice, at the cost of coarser steps in the darkening.
    const brighten = glamarye && settings.shine > 0;
    uniforms.headroom.value = brighten ? 2 : 1;
    this.darken.material.blendDst = brighten ? SrcColorFactor : ZeroFactor;
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
    show(this.glass, true);
    if (!settings.alone) {
      // Glass goes on last, so the darkening behind it is seen through it
      // like everything else there rather than lying on top of it.
      show(this.solid, false);
      scene.background = null;
      renderer.render(scene, camera);
      scene.background = background;
      show(this.solid, true);
    }
    renderer.autoClear = autoClear;
    this.glass.length = 0;
    this.solid.length = 0;
  }
}
