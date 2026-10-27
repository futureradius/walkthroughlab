import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { FOOTSTEPS, gainOf, heard, nearest, Strides } from "./sound";

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

describe("footsteps", () => {
  const speeds = { walking: 1.4, running: 3.5 };
  /** How many steps fall in `seconds` at `speed`, frame by frame. */
  const steps = (strides: Strides, speed: number, seconds: number, frame = 1 / 60) => {
    let count = 0;
    for (let t = 0; t < seconds - 1e-9; t += frame) if (strides.step(speed * frame, frame, speeds, false)) count++;
    return count;
  };

  it("fall once per walking stride, the first within half a stride", () => {
    const strides = new Strides({ ...FOOTSTEPS });
    // Half a stride, 0.375 m, takes about 0.27 s at 1.4 m/s.
    expect(steps(strides, 1.4, 0.3)).toBe(1);
    // Then one every 0.75 m: 7 m in 5 s.
    expect(steps(strides, 1.4, 5)).toBe(9);
  });

  it("fall less often per metre at a full run", () => {
    const strides = new Strides({ ...FOOTSTEPS });
    steps(strides, 3.5, 0.2);
    // 12 m at 1.2 m a stride.
    expect(steps(strides, 3.5, 12 / 3.5)).toBe(10);
  });

  it("stay silent standing still, and begin again within half a stride", () => {
    const strides = new Strides({ ...FOOTSTEPS });
    steps(strides, 1.4, 1);
    expect(steps(strides, 0, 3)).toBe(0);
    expect(steps(strides, 1.4, 0.3)).toBe(1);
  });

  it("fall once on landing from a fall", () => {
    const strides = new Strides({ ...FOOTSTEPS });
    expect(strides.step(0, 1 / 60, speeds, true)).toBe(true);
    expect(strides.step(0, 1 / 60, speeds, false)).toBe(false);
  });
});
