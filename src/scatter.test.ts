import { describe, expect, it } from "vitest";
import { bladeRoots, keptAt, REDUCED, SCATTER, scatterOver, spreadFor, type Ground } from "./scatter";

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

  it("gives each copy a rank, so the same ones are kept when fewer are drawn", () => {
    const { ranks } = scatterOver(square(10), 10);
    expect(Math.min(...ranks)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ranks)).toBeLessThan(1);
  });

  it("grows nothing on walls", () => {
    const wall: Ground = { corners: new Float32Array([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 0, 0, 5, 5, 0, 0, 5, 0]) };
    expect(scatterOver(wall, 40).count).toBe(0);
  });
});

describe("thinning out with distance", () => {
  it("keeps every copy up close and a third where they end", () => {
    expect(keptAt(5, SCATTER)).toBe(1);
    expect(keptAt(10, SCATTER)).toBe(1);
    expect(keptAt(SCATTER.far, SCATTER)).toBeCloseTo(SCATTER.thin);
    expect(keptAt(27.5, SCATTER)).toBeCloseTo((1 + SCATTER.thin) / 2);
  });

  it("keeps fewer, ending sooner, at the safety net's steps", () => {
    expect(keptAt(5, SCATTER, REDUCED[1])).toBeCloseTo(2 / 3);
    expect(keptAt(25, SCATTER, REDUCED[2])).toBeCloseTo(SCATTER.thin / 3);
  });

  it("spreads blades apart as copies thin out, so they still cover the ground, but no further than the setting", () => {
    expect(spreadFor(1, SCATTER)).toBe(1);
    expect(spreadFor(0.5, SCATTER)).toBeCloseTo(Math.SQRT2);
    expect(spreadFor(0.1, SCATTER)).toBe(SCATTER.spread);
  });
});

describe("finding the blades of a tuft", () => {
  it("roots every point of a blade where its lowest point stands", () => {
    // Two blades, each two triangles, the first leaning.
    const positions = [
      0, 0, 0, 0.1, 0, 0, 0.2, 1, 0.1, 0.3, 1, 0.1,
      1, 0, 1, 1.1, 0, 1, 1, 1, 1, 1.1, 1, 1,
    ];
    const index = [0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6];
    const roots = bladeRoots(positions, index);
    expect([...roots.subarray(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...roots.subarray(8, 16)]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });
});
