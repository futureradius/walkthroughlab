import {
  CustomBlending,
  DoubleSide,
  DstColorFactor,
  Mesh,
  ShaderMaterial,
  Vector2,
  ZeroFactor,
  type Material,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

/** What can be changed about ambient occlusion while it runs; see tuning.ts. */
export interface OcclusionSettings {
  /** Off draws the scene as if ambient occlusion had never been asked for. */
  on: boolean;
  /** Show the darkening alone, on white, to judge it while tuning. */
  alone: boolean;
  /** How far a surface looks for neighbours that shade it, in metres. */
  reach: number;
  /** How dark full ambient occlusion gets: 0 leaves the picture alone, 1 is black. */
  strength: number;
  /** How many spots around each pixel are checked for neighbours. */
  samples: number;
  /** The share of the canvas's width and height the darkening is worked out at. */
  detail: number;
  /** Whether the speckle left by so few samples is smoothed away. */
  smooth: boolean;
}

/** The pass keeps the step that draws each of its stages to itself. */
interface PassInternals {
  _renderPass(renderer: WebGLRenderer, material: Material, ...rest: unknown[]): void;
}

function seeThrough(object: Object3D): object is Mesh {
  if (!(object instanceof Mesh)) return false;
  const materials: Material[] = [object.material].flat();
  return materials.some((material) => material.transparent);
}

/**
 * Ambient occlusion: draws the scene to the canvas exactly as it would be
 * drawn without it, then darkens the picture where surfaces come close.
 */
export class AmbientOcclusion {
  readonly settings: OcclusionSettings = {
    on: true,
    alone: false,
    reach: 0.4,
    strength: 0.7,
    samples: 16,
    detail: 1,
    smooth: true,
  };

  private readonly renderer: WebGLRenderer;
  private readonly pass: GTAOPass;
  private readonly darken: FullScreenQuad;
  private readonly size = new Vector2();
  private readonly hidden: Object3D[] = [];

  /** Whether this device can work out ambient occlusion at all. */
  static supported(renderer: WebGLRenderer): boolean {
    return (
      renderer.extensions.has("EXT_color_buffer_half_float") ||
      renderer.extensions.has("EXT_color_buffer_float")
    );
  }

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    this.renderer = renderer;
    renderer.getDrawingBufferSize(this.size);
    this.pass = new GTAOPass(scene, camera, this.size.x, this.size.y);
    // Work the darkening out, but leave drawing it to `darken`.
    this.pass.output = GTAOPass.OUTPUT.Off;
    // The pass always smooths, so leaving that out means stepping over it.
    const internals = this.pass as unknown as PassInternals;
    const renderPass = internals._renderPass.bind(this.pass);
    internals._renderPass = (renderer, material, ...rest) => {
      if (material === this.pass.pdMaterial && !this.settings.smooth) return;
      renderPass(renderer, material, ...rest);
    };
    // Rhino doesn't care which way a face points; see `prepare` in environment.ts.
    this.pass.normalMaterial.side = DoubleSide;
    this.darken = new FullScreenQuad(
      new ShaderMaterial({
        uniforms: {
          occlusion: { value: this.pass.gtaoMap },
          strength: { value: this.settings.strength },
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
          varying vec2 vUv;

          void main() {
            float light = mix(1.0, texture2D(occlusion, vUv).r, strength);
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

  /** Draw the scene to the canvas with ambient occlusion over it. */
  render(scene: Scene, camera: PerspectiveCamera) {
    const { renderer, pass, settings } = this;
    if (!settings.on) {
      renderer.render(scene, camera);
      return;
    }
    renderer.getDrawingBufferSize(this.size);
    const width = Math.max(1, Math.round(this.size.x * settings.detail));
    const height = Math.max(1, Math.round(this.size.y * settings.detail));
    if (pass.width !== width || pass.height !== height) pass.setSize(width, height);
    pass.updateGtaoMaterial({ radius: settings.reach, samples: settings.samples });
    const { uniforms } = this.darken.material as ShaderMaterial;
    uniforms.occlusion.value = (
      settings.smooth ? pass.pdRenderTarget : pass.gtaoRenderTarget
    ).texture;
    uniforms.strength.value = settings.strength;

    // Glass neither shades what is near it nor hides what is behind it, and
    // the sky is too far away to shade anything.
    scene.traverse((object) => {
      if (object.visible && seeThrough(object)) {
        object.visible = false;
        this.hidden.push(object);
      }
    });
    const background = scene.background;
    scene.background = null;
    // The pass reads neither buffer when its output is off.
    pass.render(renderer, null!, null!, 0, false);
    scene.background = background;
    for (const object of this.hidden) object.visible = true;
    this.hidden.length = 0;

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
    renderer.autoClear = autoClear;
  }
}
