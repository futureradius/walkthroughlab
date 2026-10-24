/**
 * @license
 * The darkening worked out here is translated from the fast ambient occlusion
 * in Glamarye Fast Effects for ReShade by Robert Jessop (rj200), release v6.4.2,
 * Shaders/Glamayre_Fast_Effects.fx (whose header still says 6.4.1) at commit
 * 9dd9b826fa2cbea818ef1bc487e5f2e7f427c750 of
 * https://github.com/rj200/Glamarye_Fast_Effects_for_ReShade, used under the
 * MIT licence in that repository's LICENSE file:
 *
 * Copyright (c) 2021 Robert Jessop (main shader), Alex Tuderan (blur functions)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import {
  HalfFloatType,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { Depths } from "./depths";
import type { OcclusionSettings, OcclusionWorkings } from "./occlusion";

/**
 * Works the darkening out the way Glamarye Fast Effects does: a few depths on
 * a circle around each pixel, a fixed share of the screen across, joined into
 * a fuzzy ring rather than counted one by one. Pixels alternate between a
 * wide and a narrow circle in a checkerboard, so the eye blends two circles'
 * worth of samples, and nothing is smoothed afterwards unless `blur` asks
 * for it; see blur.ts.
 *
 * Only the ambient occlusion is ported, as without the original's Fake GI.
 * Left out, because they need the picture's colours and this works before
 * the picture is drawn: "Reduce AO in bright areas" (spare sunlit does that
 * job here) and the tone-mapping compensation around applying the shade.
 */
export class Glamarye implements OcclusionWorkings {
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly depths = new Depths();
  /** The share of light left, which shine can take above 1. */
  private readonly output = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    depthBuffer: false,
  });
  private readonly quad: FullScreenQuad;
  private readonly material: ShaderMaterial;

  constructor(scene: Scene, camera: PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    this.material = new ShaderMaterial({
      defines: { POINTS: 6, BIG_DITHER: 0 },
      uniforms: {
        depths: { value: this.depths.target.depthTexture },
        size: { value: new Vector2(1, 1) },
        radius: { value: 1 },
        shape: { value: 0 },
        gap: { value: 0.5 },
        fade: { value: 0.5 },
        shade: { value: 0.6 },
        shine: { value: 0.3 },
      },
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      // The original's names are kept where they say what a thing is, so
      // the two can be read side by side.
      fragmentShader: /* glsl */ `
        uniform sampler2D depths;
        uniform vec2 size;
        uniform float radius;
        uniform float shape;
        uniform float gap;
        uniform float fade;
        uniform float shade;
        uniform float shine;

        // What ReShade::GetLinearizedDepth gives with ReShade's usual
        // settings: a far plane of 1000, which for a camera whose near plane
        // is 0.1 m makes 0.5 about 100 m away. The original's tuning is in
        // these units.
        float pointDepth(vec2 uv) {
          float depth = texture2D(depths, uv).r;
          return depth / (1000.0 - depth * 999.0);
        }

        void main() {
          vec2 pixel = 1.0 / size;
          float depth = pointDepth(gl_FragCoord.xy * pixel);
          float ao = 0.0;

          if (depth > 0.0 && depth < fade) {
            // Checkerboard: alternate pixels look on a circle of a different size.
            bool square = mod(floor(gl_FragCoord.x + gl_FragCoord.y), 2.0) == 1.0;
            #if BIG_DITHER
              bool circle = mod(floor(gl_FragCoord.y / 2.0), 2.0) == 1.0;
              vec2 aoLengths = circle ? vec2(0.0055, 0.0085) : vec2(0.01, 0.004);
            #else
              vec2 aoLengths = vec2(min(0.002 * float(POINTS), 0.01), 0.004);
            #endif
            float aoChoice = square ? aoLengths.x : aoLengths.y;
            float theVectorLen = radius * (1.0 - depth * 0.8) * aoChoice;
            const float angle = 3.14159265 / float(POINTS);
            // Each block of 2 by 2 pixels shares a centre, so neighbours read
            // some of the same depths, which phones fetch faster.
            vec2 texcoord = (floor(gl_FragCoord.xy / 2.0) * 2.0 + 0.5) * pixel;
            // From a share of the screen's diagonal to texture coordinates.
            vec2 toTexcoord = length(size) / size;
            float turn = square ? 0.5 : -0.5;

            float aoPoint[POINTS];
            float maxDepth = depth + 0.01 * gap;
            float minDepthSq = sqrt(depth) - 0.01 * gap;
            minDepthSq *= minDepthSq;
            for (int i = 0; i < POINTS; i++) {
              float a = (float(i) * 2.0 + turn) * angle;
              float point = pointDepth(texcoord + theVectorLen * toTexcoord * vec2(sin(a), cos(a)));
              // Much nearer is something else in front, which may not shade;
              // much farther counts only as far as the gap.
              aoPoint[i] = point < minDepthSq ? -depth : min(point, maxDepth);
            }

            // Something in front is replaced by a guess from the opposite
            // point, so the two cancel out.
            float settled[POINTS];
            for (int i = 0; i < POINTS; i++) {
              int across = i + POINTS / 2;
              float opposite = aoPoint[across - (across >= POINTS ? POINTS : 0)];
              #if POINTS % 2 == 1
                int beyond = across + 1;
                opposite = (opposite + aoPoint[beyond - (beyond >= POINTS ? POINTS : 0)]) / 2.0;
              #endif
              settled[i] = aoPoint[i] >= 0.0 ? aoPoint[i] : depth * 2.0 - abs(opposite);
            }

            // How much neighbouring points on the circle differ, used to
            // blur the line drawn between them.
            float variance = 0.0;
            for (int i = 0; i < POINTS; i++) {
              float difference = settled[i] - settled[i + 1 == POINTS ? 0 : i + 1];
              variance += difference * difference;
            }
            // At least this, so surfaces that are only slightly hollow stay unshaded.
            variance = sqrt(variance / float(2 * POINTS)) + shape;

            // Where the pixel's depth crosses each line between neighbours,
            // from -1 (all of it in front of the pixel) to 1 (all behind).
            for (int i = 0; i < POINTS; i++) {
              float adjPoint = settled[i + 1 == POINTS ? 0 : i + 1];
              float near = min(settled[i], adjPoint) - variance;
              float far = max(settled[i], adjPoint) + variance;
              ao += 2.0 * clamp((depth - near) / (far - near), 0.0, 1.0) - 1.0;
            }
            ao *= (50.0 * aoChoice + 0.5) / float(POINTS);
          }

          // Fade out towards the farthest distance it reaches.
          ao *= clamp((1.0 - depth / fade) * 2.0, 0.0, 1.0);

          // Hollows are shaded, never below a quarter of their light; bumps
          // are brightened by shine.
          float light = ao > 0.0
            ? clamp(1.0 - ao * shade * 1.8, 0.25, 1.0)
            : 1.0 - ao * shine * 0.5;
          gl_FragColor = vec4(light, 0.0, 0.0, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  work(
    renderer: WebGLRenderer,
    width: number,
    height: number,
    settings: OcclusionSettings,
  ) {
    const { scene, output, material } = this;
    if (output.width !== width || output.height !== height) output.setSize(width, height);
    // The number of points and the dither shape the loops, so changing
    // either builds the shader anew.
    const { points } = settings;
    const dither = settings.dither ? 1 : 0;
    if (material.defines.POINTS !== points || material.defines.BIG_DITHER !== dither) {
      material.defines.POINTS = points;
      material.defines.BIG_DITHER = dither;
      material.needsUpdate = true;
    }
    const { uniforms } = material;
    uniforms.size.value.set(width, height);
    uniforms.radius.value = settings.radius;
    // The original's slider counts in steps of the smallest float32 fraction.
    uniforms.shape.value = settings.shape * 1.1920928955078125e-7;
    uniforms.gap.value = settings.gap;
    uniforms.fade.value = settings.fade;
    uniforms.shade.value = settings.shade;
    uniforms.shine.value = settings.shine;

    const depths = this.depths.draw(renderer, scene, this.camera, width, height);
    renderer.setRenderTarget(output);
    this.quad.render(renderer);
    return {
      occlusion: output.texture,
      brightness: depths.texture,
      depths: depths.depthTexture!,
      // Pressed by `shade` as it is worked out.
      strength: 1,
      // Its shine takes the light above 1, brightening bumps.
      brightens: settings.shine > 0,
    };
  }
}
