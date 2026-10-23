import { describe, expect, it } from "vitest";
import { scatterOver, type Ground } from "./scatter";

/** A flat square of ground `size` metres across at height `y`, as two triangles, its light spots spanning the picture. */
function square(size: number, y = 0): Ground {
  const s = size;
  return {
    corners: new Float32Array([0, y, 0, s, y, 0, s, y, s, 0, y, 0, s, y, s, 0, y, s]),
    lightCorners: new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]),
  };
}

describe("scattering copies", () => {
  it("grows about as many copies as the density asks, all on the ground", () => {
    const copies = scatterOver(square(10), 40);
    expect(copies.count).toBeGreaterThan(3800);
    expect(copies.count).toBeLessThan(4200);
    for (let i = 0; i < copies.count; i++) {
      const [x, y, z] = copies.roots.subarray(i * 3, i * 3 + 3);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(10);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(10);
      expect(y).toBe(0);
    }
  });

  it("grows the same copies on every visit", () => {
    expect(scatterOver(square(4), 20).roots).toEqual(scatterOver(square(4), 20).roots);
  });

  it("finds each copy's spot in the baked light picture where it stands", () => {
    const copies = scatterOver(square(10), 5);
    for (let i = 0; i < copies.count; i++) {
      expect(copies.lightSpots[i * 2]).toBeCloseTo(copies.roots[i * 3] / 10, 5);
      expect(copies.lightSpots[i * 2 + 1]).toBeCloseTo(copies.roots[i * 3 + 2] / 10, 5);
    }
  });

  it("grows nothing on walls", () => {
    const wall: Ground = { corners: new Float32Array([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 0, 0, 5, 5, 0, 0, 5, 0]) };
    expect(scatterOver(wall, 40).count).toBe(0);
  });
});
