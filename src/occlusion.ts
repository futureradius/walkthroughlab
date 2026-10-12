import {
  CustomBlending,
  DoubleSide,
  DstColorFactor,
  Mesh,
  ShaderMaterial,
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

/** What can be changed about ambient occlusion while it runs; see tuning.ts. */
export interface OcclusionSettings {
  /** Off draws the scene as if there were no ambient occlusion. */
  on: boolean;
  /** Show the darkening alone, on white, to judge it while tuning. */
  alone: boolean;
  /** How the darkening is worked out: `gtao` is three.js's own way, `n8ao` is N8AO, on trial beside it. */
  method: string;
  /** How far a surface looks for neighbours that shade it, in metres. */
  reach: number;
  /** How hard the darkening is pressed: 0 leaves the picture alone, 1 is as worked out, more is darker. */
  strength: number;
  /** How much of the darkening sunlit surfaces are let off: 0 is none, 1 is all. */
  spare: number;
  /** How bright baked light must be for a surface to count as sunlit, from 0 to 1 of what the picture holds. */
  sunlit: number;
  /** How many spots around each pixel are checked for neighbours. */
  samples: number;
  /** The share of the canvas's width and height the darkening is worked out at. */
  detail: number;
  /** Whether the speckle left by so few samples is smoothed away. */
  smooth: boolean;
  /**
   * With `n8ao` only: how much nearer than a spot a neighbour may be and
   * still shade it fully, in fifths of the reach. Smaller leaves less of an
   * outline around whatever stands in front of a wall, and less darkening
   * altogether.
   */
  falloff: number;
}

/** A way of working the darkening out. */
export interface OcclusionWorkings {
  /**
   * Work the darkening out for the scene as it now shows, at this size. The
   * first picture holds it in red; the second holds, in alpha, how brightly
   * baked light falls on each surface.
   */
  work(
    renderer: WebGLRenderer,
    width: number,
    height: number,
    settings: OcclusionSettings,
    bakedLight: Texture | null,
  ): { occlusion: Texture; brightness: Texture };
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
    method: "gtao",
    reach: 0.2,
    strength: 2,
    spare: 1,
    sunlit: 0.2,
    samples: 8,
    detail: 0.5,
    smooth: true,
    falloff: 1,
  };

  /** The environment's baked light, which tells sunlit surfaces from shaded ones. */
  bakedLight: Texture | null = null;

  private readonly renderer: WebGLRenderer;
  private gtao: OcclusionWorkings | null = null;
  private n8ao: OcclusionWorkings | null = null;
  private fetching = false;
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
          varying vec2 vUv;

          void main() {
            float light = pow(texture2D(occlusion, vUv).r, strength);
            // Ambient occlusion only dims light from all around, and a
            // surface in the sun gets nearly all its light from one place.
            float inSun = smoothstep(sunlit - 0.05, sunlit + 0.05, texture2D(brightness, vUv).a);
            light = mix(light, 1.0, spare * inSun);
            // The canvas holds colours encoded for display, where taking away
            // a share of the light takes away a smaller share of the number.
            gl_FragColor = vec4(vec3(pow(light, 1.0 / 2.2)), 1.0);
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
    if (this.settings.method !== "n8ao") return (this.gtao ??= new Gtao(scene, camera));
    if (!this.n8ao && !this.fetching) {
      this.fetching = true;
      // Only those who try it out download it.
      import("./n8").then(({ N8 }) => (this.n8ao = new N8(scene, camera)));
    }
    return this.n8ao;
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
    const { occlusion, brightness } = workings.work(
      renderer,
      width,
      height,
      settings,
      this.bakedLight,
    );
    scene.background = background;
    const { uniforms } = this.darken.material as ShaderMaterial;
    uniforms.occlusion.value = occlusion;
    uniforms.brightness.value = brightness;
    uniforms.strength.value = settings.strength;
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
