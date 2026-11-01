import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { gainOf, heard, nearest } from "./sound";

describe("loudness in decibels", () => {
  it("plays 0 dB at the sound's own level, -20 dB at a tenth of it, and -6 dB at about half", () => {
    expect(gainOf(0)).toBe(1);
    expect(gainOf(-20)).toBeCloseTo(0.1);
    expect(gainOf(-6)).toBeCloseTo(0.5, 1);
  });

  it("is silent at the bottom of its range", () => {
    expect(gainOf(-60)).toBe(0);
    expect(gainOf(-59)).toBeGreaterThan(0);
  });
});

describe("how loud a sound is with distance", () => {
  const carries = { realistic: 20, silent: 25 };

  it("is at full strength within a metre", () => {
    expect(heard(0, carries)).toBe(1);
    expect(heard(1, carries)).toBe(1);
  });

  it("halves with each doubling of distance up to the realistic distance", () => {
    expect(heard(2, carries)).toBeCloseTo(0.5);
    expect(heard(4, carries)).toBeCloseTo(0.25);
    expect(heard(20, carries)).toBeCloseTo(0.05);
  });

  it("then fades in a straight line to silence", () => {
    expect(heard(22.5, carries)).toBeCloseTo(0.025);
    expect(heard(25, carries)).toBe(0);
    expect(heard(100, carries)).toBe(0);
  });

  it("is cut off at the silent distance when that comes first", () => {
    expect(heard(10, { realistic: 20, silent: 12 })).toBeCloseTo(0.1);
    expect(heard(12, { realistic: 20, silent: 12 })).toBe(0);
  });
});

describe("which placed sounds play", () => {
  const spot = (x: number, silent = 25) => ({ at: new Vector3(x, 0, 0), silent });

  it("plays the nearest few within their silent distance", () => {
    const spots = [spot(10), spot(3), spot(30), spot(5), spot(1)];
    expect(nearest(spots, new Vector3(), 3)).toEqual(new Set([4, 1, 3]));
  });

  it("leaves out a near sound that carries less far than the distance to it", () => {
    expect(nearest([spot(10, 8), spot(20)], new Vector3(), 4)).toEqual(new Set([1]));
  });
});
