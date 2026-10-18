import {
  DoubleSide,
  type Material,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import type { OcclusionSettings, OcclusionWorkings } from "./occlusion";
import { MEASURE } from "./sunlit";

/** The pass keeps the step that draws each of its stages to itself. */
interface PassInternals {
  _renderPass(renderer: WebGLRenderer, material: Material, ...rest: unknown[]): void;
  normalRenderTarget: WebGLRenderTarget;
}

/**
 * Works the darkening out the way three.js does. It draws the depths itself,
 * together with which way surfaces face, rather than with depths.ts.
 */
export class Gtao implements OcclusionWorkings {
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
      shader.vertexShader = shader.vertexShader.replace(
        "void main() {",
        /* glsl */ `
        ${MEASURE.vertexHead}

        void main() {
          ${MEASURE.vertexMain}`,
      );
      shader.fragmentShader =
        shader.fragmentShader.replace(
          "void main() {",
          /* glsl */ `
          ${MEASURE.fragmentHead}

          void facing() {`,
        ) +
        /* glsl */ `
        void main() {
          facing();
          gl_FragColor.a = brightness();
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
      samples: settings.samples,
    });
    this.smooth = settings.smooth;
    this.light.value = bakedLight;
    // The pass reads neither buffer when its output is off.
    pass.render(renderer, null!, null!, 0, false);
    return {
      occlusion: (settings.smooth ? pass.pdRenderTarget : pass.gtaoRenderTarget).texture,
      brightness: this.internals.normalRenderTarget.texture,
      depths: pass.depthTexture,
      strength: settings.strength,
      brightens: false,
    };
  }
}
