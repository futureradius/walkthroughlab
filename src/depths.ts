import {
  DepthTexture,
  DoubleSide,
  ShaderMaterial,
  UnsignedIntType,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { BAKED_LIGHT, MEASURE, measuring } from "./sunlit";

/**
 * Draws how far away each surface is, for whatever works from the depths
 * rather than the picture, such as the darkening of ambient occlusion. The
 * same drawing measures how brightly baked light falls on each surface; see
 * sunlit.ts.
 */
export class Depths {
  /** Its depth texture holds the depths; its alpha, the brightness. */
  readonly target = new WebGLRenderTarget(1, 1, {
    depthTexture: new DepthTexture(1, 1, UnsignedIntType),
  });
  /** Drawn in place of every surface. */
  private readonly material = measuring(new ShaderMaterial({
    uniforms: { bakedLight: BAKED_LIGHT },
    vertexShader: /* glsl */ `
      ${MEASURE.vertexHead}

      void main() {
        ${MEASURE.vertexMain}
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${MEASURE.fragmentHead}

      void main() {
        gl_FragColor = vec4(vec3(0.0), brightness());
      }`,
    // Rhino doesn't care which way a face points; see `prepare` in environment.ts.
    side: DoubleSide,
  }));

  /** Draw the scene as the camera sees it, at this size. */
  draw(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    width: number,
    height: number,
  ): WebGLRenderTarget {
    const { target } = this;
    if (target.width !== width || target.height !== height) target.setSize(width, height);
    const override = scene.overrideMaterial;
    scene.overrideMaterial = this.material;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    scene.overrideMaterial = override;
    return target;
  }
}
