import {
  DepthTexture,
  DoubleSide,
  ShaderMaterial,
  UnsignedIntType,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from "three";
import { N8AOPass } from "n8ao";
import type { OcclusionSettings, OcclusionWorkings } from "./occlusion";

/** The pass's way of showing the darkening alone instead of on the picture. */
const DARKENING_ALONE = 1;

/**
 * Works the darkening out with N8AO. Only its sampling, smoothing and
 * enlarging are used: it would otherwise draw the whole picture off screen
 * itself, without the canvas's antialiasing.
 */
export class N8 implements OcclusionWorkings {
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly pass: N8AOPass;
  /** How far away each surface is, which is all the pass looks at. */
  private readonly depths: WebGLRenderTarget;
  /** The darkening after the pass enlarged it, when it is asked to. */
  private readonly enlarged = new WebGLRenderTarget(1, 1, { depthBuffer: false });
  private enlarging = false;
  private readonly light = { value: null as Texture | null };
  /** Drawn in place of every surface: nothing but how brightly baked light falls on it. */
  private readonly brightness = new ShaderMaterial({
    uniforms: { bakedLight: this.light },
    vertexShader: /* glsl */ `
      attribute vec2 uv1;
      varying vec2 vBakedUv;

      void main() {
        vBakedUv = uv1;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D bakedLight;
      varying vec2 vBakedUv;

      void main() {
        gl_FragColor = vec4(vec3(0.0), dot(texture2D(bakedLight, vBakedUv).rgb, vec3(0.2126, 0.7152, 0.0722)));
      }`,
    // Rhino doesn't care which way a face points; see `prepare` in environment.ts.
    side: DoubleSide,
  });

  constructor(scene: Scene, camera: PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    const pass = (this.pass = new N8AOPass(scene, camera));
    // The pass is handed its picture of the scene instead of drawing one.
    pass.configuration.autoRenderBeauty = false;
    pass.beautyRenderTarget.dispose();
    this.depths = new WebGLRenderTarget(pass.width, pass.height, {
      depthTexture: new DepthTexture(pass.width, pass.height, UnsignedIntType),
    });
    pass.beautyRenderTarget = this.depths;
    // Glass is hidden from it and drawn by AmbientOcclusion.
    pass.configuration.transparencyAware = false;
    // What it calls its mobile setting.
    pass.configuration.denoiseSamples = 4;
    // Putting the darkening on the picture is left to AmbientOcclusion, so
    // the pass's last step only runs to enlarge the darkening, as it is.
    pass.configuration.renderMode = DARKENING_ALONE;
    pass.configuration.colorMultiply = false;
    pass.configuration.gammaCorrection = false;
    pass.configuration.intensity = 1;
    const quad = pass.effectCompositerQuad;
    const enlarge = quad.render.bind(quad);
    quad.render = (renderer) => {
      if (this.enlarging) enlarge(renderer);
    };
  }

  work(
    renderer: WebGLRenderer,
    width: number,
    height: number,
    settings: OcclusionSettings,
    bakedLight: Texture | null,
  ) {
    const { scene, pass, enlarged } = this;
    // The pass can only enlarge to twice the size, guided by a picture of
    // the depths at that size, which not every device can make.
    this.enlarging =
      settings.edges && settings.detail <= 0.5 && renderer.extensions.has("EXT_color_buffer_float");
    const scale = this.enlarging ? 2 : 1;
    pass.configuration.halfRes = this.enlarging;
    if (pass.width !== width * scale || pass.height !== height * scale) {
      pass.setSize(width * scale, height * scale);
    }
    if (this.enlarging) enlarged.setSize(width * scale, height * scale);
    pass.configuration.aoRadius = settings.reach;
    pass.configuration.distanceFalloff = settings.falloff;
    pass.configuration.aoSamples = Math.max(1, Math.round(settings.samples));
    pass.configuration.denoiseIterations = settings.smooth ? 2 : 0;
    this.light.value = bakedLight;

    const override = scene.overrideMaterial;
    scene.overrideMaterial = this.brightness;
    renderer.setRenderTarget(this.depths);
    renderer.render(scene, this.camera);
    scene.overrideMaterial = override;
    pass.render(renderer, enlarged, null, 0, false);
    return {
      occlusion: (this.enlarging ? enlarged : pass.accumulationRenderTarget).texture,
      brightness: this.depths.texture,
    };
  }
}
