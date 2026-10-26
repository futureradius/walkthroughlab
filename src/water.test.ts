import { Color } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { asWater, ripplePicture, Water } from "./water";
import { windUniforms } from "./wind";

/** One water surface and its waves, their pictures made, in a wind of this strength. */
function water(strength: number, grown = true) {
  windUniforms.windStrength.value = strength;
  const material = asWater(new Color(0.01, 0.43, 0.48));
  const pool = new Water([material]);
  if (grown) pool.grow();
  return { material, pool };
}

afterEach(() => {
  windUniforms.windStrength.value = 0;
});

describe("water's waves", () => {
  it("are drawn in a wind once their pictures are made", () => {
    const { material, pool } = water(0.4);
    pool.update(0.016, true, 1);
    expect(material.defines).toEqual({ WAVES: "" });
  });

  it("are not drawn at all in still air, as for reduced motion", () => {
    const { material, pool } = water(0);
    pool.update(0.016, true, 1);
    expect(material.defines).toEqual({});
  });

  it("are not drawn at all while the safety net takes shine away", () => {
    const { material, pool } = water(0.4);
    pool.update(0.016, false, 1);
    expect(material.defines).toEqual({});
  });

  it("are not drawn at all with no roughness", () => {
    const { material, pool } = water(1);
    pool.settings.roughness = 0;
    pool.update(0.016, true, 1);
    expect(material.defines).toEqual({});
  });

  it("rise over a second rather than appearing at once", () => {
    const { material, pool } = water(0.5);
    pool.update(0.25, true, 1);
    const early = material.uniforms.rough.value;
    pool.update(1, true, 1);
    expect(early).toBeGreaterThan(0);
    expect(material.uniforms.rough.value).toBeCloseTo(0.5 * pool.settings.roughness);
    expect(early).toBeLessThan(material.uniforms.rough.value);
  });
});

describe("the ripple picture", () => {
  it("repeats without a seam", () => {
    const size = 32;
    const { data } = ripplePicture(size).image as { data: Uint8Array };
    const at = (x: number, y: number, channel: number) => data[(y * size + x) * 4 + channel];
    // Across the edge it changes no more than between neighbours inside.
    let edge = 0;
    let inside = 0;
    for (let y = 0; y < size; y++) {
      edge = Math.max(edge, Math.abs(at(size - 1, y, 0) - at(0, y, 0)));
      inside = Math.max(inside, Math.abs(at(1, y, 0) - at(0, y, 0)));
    }
    expect(edge).toBeLessThanOrEqual(inside + 1);
  });
});
