import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { beat, FLOCK, homesOf, longestPause, Loop, restingWings, seeded, type Along } from "./flock";
import type { Point } from "./marks";

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const spot = (): Along => ({ at: new Vector3(), ahead: new Vector3(), climb: 0, turn: 0 });

describe("how long a bird pauses between bursts", () => {
  const settings = { ...FLOCK, climb: 30, pause: 4, dive: 20 };

  it("never pauses climbing steeply, pauses up to the longest pause level, and only glides sinking steeply", () => {
    expect(longestPause(radians(35), settings)).toBe(0);
    expect(longestPause(radians(30), settings)).toBe(0);
    expect(longestPause(0, settings)).toBe(4);
    expect(longestPause(radians(-20), settings)).toBe(Infinity);
    expect(longestPause(radians(-25), settings)).toBe(Infinity);
  });

  it("slides between them", () => {
    expect(longestPause(radians(15), settings)).toBeCloseTo(2);
    expect(longestPause(radians(-10), settings)).toBeCloseTo(8);
  });
});

describe("a bird's wings", () => {
  const flap = (climb: number, seconds: number) => {
    const random = seeded(1);
    const wings = restingWings(random);
    const flapping: boolean[] = [];
    for (let t = 0; t < seconds; t += 1 / 60) {
      beat(wings, 1 / 60, radians(climb), FLOCK, random);
      flapping.push(wings.flapping);
    }
    return { wings, flapping };
  };

  it("flaps without a pause while climbing steeply", () => {
    const { flapping } = flap(FLOCK.climb + 5, 20);
    expect(flapping.slice(1).every(Boolean)).toBe(true);
  });

  it("never flaps while sinking steeply", () => {
    const { flapping, wings } = flap(-(FLOCK.dive + 5), 20);
    expect(flapping.some(Boolean)).toBe(false);
    expect(wings.beating).toBe(0);
  });

  it("flaps in bursts between pauses while level", () => {
    const { flapping } = flap(0, 60);
    const changes = flapping.filter((each, i) => i > 0 && each !== flapping[i - 1]).length;
    expect(changes).toBeGreaterThan(6);
    // Bursts last up to 1 s and pauses up to 2.5 s, so it flaps less than half the time.
    const share = flapping.filter(Boolean).length / flapping.length;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.6);
  });

  it("eases between flapping and the glide over a quarter of a second", () => {
    const random = seeded(2);
    const wings = restingWings(random);
    beat(wings, 0.1, radians(FLOCK.climb + 5), FLOCK, random);
    expect(wings.beating).toBeCloseTo(0.4);
    beat(wings, 0.2, radians(FLOCK.climb + 5), FLOCK, random);
    expect(wings.beating).toBe(1);
  });
});

describe("a loop, smoothed", () => {
  /** A polygon of `sides` corners round the origin, `radius` out, going round to the left. */
  const polygon = (sides: number, radius: number, height = (_: number) => 12): Point[] =>
    Array.from({ length: sides }, (_, k) => {
      const angle = (k / sides) * Math.PI * 2;
      return [radius * Math.sin(angle), height(angle), radius * Math.cos(angle)];
    });

  it("cuts the corners, so it is shorter than the polyline, and runs round at an even pace", () => {
    const square: Point[] = [[0, 12, 0], [20, 12, 0], [20, 12, 20], [0, 12, 20]];
    const loop = new Loop(square);
    expect(loop.length).toBeLessThan(80);
    expect(loop.length).toBeGreaterThan(40);
    const a = loop.along(1, spot()).at.clone();
    const b = loop.along(2, spot()).at.clone();
    expect(a.distanceTo(b)).toBeCloseTo(1, 1);
    // It never goes outside the corners.
    for (let d = 0; d < loop.length; d += 0.5) {
      const { at } = loop.along(d, spot());
      expect(Math.min(at.x, at.z)).toBeGreaterThanOrEqual(-1e-3);
      expect(Math.max(at.x, at.z)).toBeLessThanOrEqual(20 + 1e-3);
    }
  });

  it("goes round as often as it takes, either way", () => {
    const loop = new Loop(polygon(8, 20));
    expect(loop.along(loop.length * 3 + 5, spot()).at.distanceTo(loop.along(5, spot()).at)).toBeLessThan(1e-3);
    expect(loop.along(-5, spot()).at.distanceTo(loop.along(loop.length - 5, spot()).at)).toBeLessThan(1e-3);
  });

  it("knows how sharply it turns, to the left above 0", () => {
    const loop = new Loop(polygon(24, 20));
    const { at, turn, ahead } = loop.along(10, spot());
    const radius = Math.hypot(at.x, at.z);
    expect(turn).toBeCloseTo(1 / radius, 2);
    expect(ahead.length()).toBeCloseTo(1);
    const backwards = new Loop(polygon(24, 20).reverse());
    expect(backwards.along(10, spot()).turn).toBeCloseTo(-1 / radius, 2);
  });

  it("climbs and sinks with its corners' heights", () => {
    const loop = new Loop(polygon(24, 20, (angle) => 12 + 3 * Math.sin(angle)));
    const climbs: number[] = [];
    for (let d = 0; d < loop.length; d += 1) climbs.push(loop.along(d, spot()).climb);
    // 3 m up and down round a loop of some 124 m: at most about 8.7°.
    expect(Math.max(...climbs)).toBeGreaterThan(radians(6));
    expect(Math.min(...climbs)).toBeLessThan(radians(-6));
    expect(Math.max(...climbs)).toBeLessThan(radians(9.5));
  });
});

describe("where birds keep to in their flock", () => {
  it("lies within the spread, half as far up and down, the first few well apart", () => {
    const homes = homesOf(40, seeded(7));
    for (const home of homes) {
      expect(home.length()).toBeLessThanOrEqual(1);
      expect(Math.abs(home.y)).toBeLessThanOrEqual(0.5);
    }
    const first = homes.slice(0, 9);
    const closest = Math.min(...first.flatMap((a, i) => first.slice(i + 1).map((b) => a.distanceTo(b))));
    expect(closest).toBeGreaterThan(0.3);
  });
});
