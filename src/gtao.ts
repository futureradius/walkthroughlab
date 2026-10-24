import {
  DoubleSide,
  ShaderMaterial,
  type Material,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import type { OcclusionSettings, OcclusionWorkings } from "./occlusion";
import { BAKED_LIGHT, MEASURE, measuring } from "./sunlit";

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
    // The picture of which way surfaces face, as three.js's own draws it,
    // with its spare channel carrying how brightly the baked light falls on
    // each surface. A ShaderMaterial, so each surface can hand over its own
    // baked light picture (#27).
    this.pass.normalMaterial = measuring(
      new ShaderMaterial({
        uniforms: { bakedLight: BAKED_LIGHT },
        vertexShader: /* glsl */ `
          ${MEASURE.vertexHead}
          varying vec3 vNormal;

          void main() {
            ${MEASURE.vertexMain}
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          ${MEASURE.fragmentHead}
          varying vec3 vNormal;

          void main() {
            // Rhino doesn't care which way a face points; see \`prepare\` in environment.ts.
            vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
            gl_FragColor = vec4(normal * 0.5 + 0.5, brightness());
          }`,
        side: DoubleSide,
      }),
    ) as unknown as typeof this.pass.normalMaterial;
  }

  work(
    renderer: WebGLRenderer,
    width: number,
    height: number,
    settings: OcclusionSettings,
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
