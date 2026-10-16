import { describe, expect, it } from "vitest";
import { BLUR_SHIFT, BOX_READS } from "./blur";

type Picture = (x: number, y: number) => number;

/** What a device hands back when it reads a picture between pixels: pixel x covers x to x + 1. */
function between(picture: Picture, x: number, y: number): number {
  const left = Math.floor(x - 0.5);
  const below = Math.floor(y - 0.5);
  const across = x - 0.5 - left;
  const up = y - 0.5 - below;
  return (
    picture(left, below) * (1 - across) * (1 - up) +
    picture(left + 1, below) * across * (1 - up) +
    picture(left, below + 1) * (1 - across) * up +
    picture(left + 1, below + 1) * across * up
  );
}

/** The blurred value of pixel x, y, as the box blur's shader reads it. */
function blurred(reads: [number, number][], picture: Picture, x: number, y: number): number {
  const total = reads.reduce(
    (sum, [right, up]) => sum + between(picture, x + 0.5 + right, y + 0.5 + up),
    0,
  );
  return total / reads.length;
}

const mod = (value: number, by: number) => ((value % by) + by) % by;

/**
 * Glamarye's usual pattern: a checkerboard of wide and narrow circles, and
 * each 2 by 2 pixels sharing the centre they look around, over a slope.
 */
const checkerboard: Picture = (x, y) =>
  0.5 + 0.01 * x + (mod(x + y, 2) === 1 ? 0.2 : -0.2) + [0, 0.05, -0.03, 0.08][mod(x, 2) + 2 * mod(y, 2)];

/** Its bigger dither: four sizes of circle in a pattern of 2 by 4 pixels. */
const biggerDither: Picture = (x, y) =>
  0.5 + [0.1, -0.2, 0.3, -0.05, 0.15, 0.02, -0.1, -0.22][mod(x, 2) + 2 * mod(y, 4)];

/** How much the blurred picture still varies over the pixels of an area. */
function spread(reads: [number, number][], picture: Picture, slope = 0): number {
  const values: number[] = [];
  for (let x = 4; x < 12; x++) {
    for (let y = 4; y < 12; y++) values.push(blurred(reads, picture, x, y) - slope * x);
  }
  return Math.max(...values) - Math.min(...values);
}

describe("blur", () => {
  it("washes Glamarye's 2 by 2 pattern out entirely with box2 and box4", () => {
    expect(spread([[0, 0]], checkerboard, 0.01)).toBeGreaterThan(0.3);
    expect(spread(BOX_READS.box2, checkerboard, 0.01)).toBeCloseTo(0, 10);
    expect(spread(BOX_READS.box4, checkerboard, 0.01)).toBeCloseTo(0, 10);
  });

  it("washes the bigger dither out only with box4", () => {
    expect(spread(BOX_READS.box2, biggerDither)).toBeGreaterThan(0.1);
    expect(spread(BOX_READS.box4, biggerDither)).toBeCloseTo(0, 10);
  });

  it("averages squares whose middle is shifted by as much as the darkening reads back", () => {
    for (const reads of Object.values(BOX_READS)) {
      const middle = reads.reduce(([x, y], [right, up]) => [x + right, y + up], [0, 0]);
      expect(middle.map((sum) => sum / reads.length)).toEqual([BLUR_SHIFT, BLUR_SHIFT]);
    }
  });

  it("keeps a slope where it was once read back by the shift", () => {
    const slope: Picture = (x) => x + 0.5;
    for (const reads of Object.values(BOX_READS)) {
      expect(blurred(reads, slope, 6, 6)).toBeCloseTo(slope(6, 6) + BLUR_SHIFT, 10);
    }
  });
});
