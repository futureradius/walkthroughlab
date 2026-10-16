import {
  HalfFloatType,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

/** The ways the darkening can be blurred; see `blur` in OcclusionSettings. */
export const BLURS = ["off", "box2", "box4", "depth4"];

/**
 * Where the box blurs read the darkening, in its own pixels from the centre
 * of the pixel being drawn. Each read lands on the corner of four pixels,
 * where the device's smoothing between pixels hands back their average in
 * one fetch: `box2` averages a square of 2 by 2 pixels with one read,
 * `box4` a square of 4 by 4 with four.
 */
export const BOX_READS: Record<string, [number, number][]> = {
  box2: [[0.5, 0.5]],
  box4: [
    [-0.5, -0.5],
    [1.5, -0.5],
    [-0.5, 1.5],
    [1.5, 1.5],
  ],
};

/**
 * Every blur's squares are this far to the right of and above the pixel
 * they are drawn into, in pixels of the darkening, so it has to be read back
 * this far the other way.
 */
export const BLUR_SHIFT = 0.5;

/**
 * How much farther or nearer than the pixel being drawn a neighbour may be
 * and still count fully with `depth4`, as a share of the pixel's distance.
 * Twice as much counts not at all. A floor seen at a shallow angle 30 m away
 * changes by about this much from one pixel to the next.
 */
const NEAR_ENOUGH = 0.05;

const vertexShader = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

function boxShader(reads: [number, number][]) {
  const fetches = reads
    .map(
      ([x, y]) =>
        `light += texture2D(occlusion, (gl_FragCoord.xy + vec2(${x.toFixed(1)}, ${y.toFixed(1)})) * pixel).r;`,
    )
    .join("\n");
  return /* glsl */ `
    uniform sampler2D occlusion;
    uniform vec2 size;

    void main() {
      vec2 pixel = 1.0 / size;
      float light = 0.0;
      ${fetches}
      gl_FragColor = vec4(light / ${reads.length.toFixed(1)}, 0.0, 0.0, 1.0);
    }`;
}

/**
 * The same four reads as `box4`, but each square of 2 by 2 counts only as
 * much as its pixel nearest the middle lies at the distance of the pixel
 * being drawn. A square on something nearer or farther is something else,
 * which is left out, so the darkening is not smeared over the edges of
 * things. The four pixels whose distance is read make a square of 2 by 2,
 * which is the pixel being drawn and three neighbours.
 */
const depthShader = /* glsl */ `
  uniform sampler2D occlusion;
  uniform sampler2D depths;
  uniform vec2 size;
  uniform float near;
  uniform float far;

  float distanceAt(ivec2 texel) {
    float depth = texelFetch(depths, texel, 0).r;
    return near * far / (far - depth * (far - near));
  }

  void main() {
    vec2 pixel = 1.0 / size;
    ivec2 texel = ivec2(gl_FragCoord.xy);
    ivec2 last = ivec2(size) - 1;
    float middle = distanceAt(texel);
    float light = texture2D(occlusion, (gl_FragCoord.xy - 0.5) * pixel).r;
    float counted = 1.0;
    for (int i = 1; i < 4; i++) {
      ivec2 square = ivec2(i % 2, i / 2);
      float away = abs(distanceAt(min(texel + square, last)) - middle);
      float weight = clamp(2.0 - away / (middle * ${NEAR_ENOUGH.toFixed(2)}), 0.0, 1.0);
      light += texture2D(occlusion, (gl_FragCoord.xy + vec2(square) * 2.0 - 0.5) * pixel).r * weight;
      counted += weight;
    }
    gl_FragColor = vec4(light / counted, 0.0, 0.0, 1.0);
  }`;

/**
 * Blurs the darkening a little after it is worked out, whichever way that
 * was, to wash out the pattern a method leaves when it checks different
 * spots in neighbouring pixels. It works at the darkening's own size, before
 * it is enlarged onto the picture.
 */
export class Blur {
  /** The blurred share of light left, which can be above 1 like Glamarye's. */
  private readonly output = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    depthBuffer: false,
  });
  private readonly materials = new Map<string, ShaderMaterial>();
  private readonly quad = new FullScreenQuad();
  /** How far back the blurred darkening is to be read, as a share of its width and height. */
  readonly shift = new Vector2();

  private material(blur: string): ShaderMaterial {
    let material = this.materials.get(blur);
    if (!material) {
      material = new ShaderMaterial({
        uniforms: {
          occlusion: { value: null },
          depths: { value: null },
          size: { value: new Vector2(1, 1) },
          near: { value: 0.1 },
          far: { value: 1 },
        },
        vertexShader,
        fragmentShader: blur === "depth4" ? depthShader : boxShader(BOX_READS[blur]),
        depthTest: false,
        depthWrite: false,
      });
      this.materials.set(blur, material);
    }
    return material;
  }

  /**
   * Blur the darkening, held in red, in the way named, which must be one of
   * BLURS other than `off`. The depths are those it was worked out from, at
   * its size.
   */
  blur(
    renderer: WebGLRenderer,
    blur: string,
    occlusion: Texture,
    depths: Texture,
    camera: PerspectiveCamera,
  ): Texture {
    const { output } = this;
    const { width, height } = occlusion.image as { width: number; height: number };
    if (output.width !== width || output.height !== height) output.setSize(width, height);
    const material = this.material(blur);
    const { uniforms } = material;
    uniforms.occlusion.value = occlusion;
    uniforms.depths.value = depths;
    uniforms.size.value.set(width, height);
    uniforms.near.value = camera.near;
    uniforms.far.value = camera.far;
    this.quad.material = material;
    renderer.setRenderTarget(output);
    this.quad.render(renderer);
    this.shift.set(BLUR_SHIFT / width, BLUR_SHIFT / height);
    return output.texture;
  }
}
