import { Color } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { asWater, ripplePicture, Water } from "./water";
import { windUniforms } from "./wind";

/** One water surface and its waves, in a wind of this strength. */
function water(strength: number) {
  windUniforms.windStrength.value = strength;
  const material = asWater(new Color(0.01, 0.43, 0.48));
  return { material, water: new Water([material]) };
}

afterEach(() => {
  windUniforms.windStrength.value = 0;
});

describe("water's waves", () => {
  it("are worked out wave by wave in a wind, as usual", () => {
    const { material, water: pool } = water(0.4);
    pool.update(0.016, true, 1);
    expect(material.defines).toEqual({ WAVES_SHADER: "" });
  });

  it("are drawn from the ripple pictures when the settings ask for them", () => {
    const { material, water: pool } = water(0.4);
    pool.settings.waves = "textures";
    pool.update(0.016, true, 1);
    expect(material.defines).toEqual({ WAVES_TEXTURES: "" });
  });

  it("are not drawn at all in still air, as for reduced motion", () => {
    const { material, water: pool } = water(0);
    pool.update(0.016, true, 1);
    expect(material.defines).toEqual({});
  });

  it("are not drawn at all while the safety net takes shine away", () => {
    const { material, water: pool } = water(0.4);
    pool.update(0.016, false, 1);
    expect(material.defines).toEqual({});
  });

  it("are not drawn at all with no roughness", () => {
    const { material, water: pool } = water(1);
    pool.settings.roughness = 0;
    pool.update(0.016, true, 1);
    expect(material.defines).toEqual({});
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
