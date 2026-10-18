/**
 * Sunlit surfaces are let off ambient occlusion, which only dims light from
 * all around, while a surface in the sun gets nearly all its light from one
 * place. The baked light tells them apart, in two halves that must agree:
 * while the depths are drawn, each surface's brightness is measured into
 * alpha, from 0 to 1 of what the baked light picture holds; and once the
 * darkening is worked out, it is let off by as much as that is above
 * `sunlit`, with `spare` saying how much.
 */

/** The first half, added to the shaders that draw the depths. */
export const MEASURE = {
  /** Goes before the vertex shader's `main`. */
  vertexHead: /* glsl */ `
    attribute vec2 uv1;
    varying vec2 vBakedUv;`,
  /** Goes at the start of the vertex shader's `main`. */
  vertexMain: /* glsl */ `
    vBakedUv = uv1;`,
  /**
   * Goes before the fragment shader's `main`, which writes `brightness()`
   * into alpha. Needs the `bakedLight` uniform.
   */
  fragmentHead: /* glsl */ `
    uniform sampler2D bakedLight;
    varying vec2 vBakedUv;

    float brightness() {
      return dot(texture2D(bakedLight, vBakedUv).rgb, vec3(0.2126, 0.7152, 0.0722));
    }`,
};

/**
 * The second half, which goes before the main of the shader that puts the
 * darkening on the picture: `spared(light, measured)` is the share of light
 * left once sunlit surfaces are let off, given what the depths hold. Needs
 * the `spare` and `sunlit` uniforms.
 */
export const LET_OFF = /* glsl */ `
  uniform float spare;
  uniform float sunlit;

  float spared(float light, vec4 measured) {
    float inSun = smoothstep(sunlit - 0.05, sunlit + 0.05, measured.a);
    return mix(light, 1.0, spare * inSun);
  }`;
