import { describe, expect, it } from "vitest";
import { STRIDES, Strides } from "./strides";

const speeds = { walking: 1.4, running: 3.5 };
const FRAME = 1 / 60;
const fresh = () => new Strides({ ...STRIDES });

/** How many footfalls in `seconds` at `speed`, frame by frame. */
function steps(strides: Strides, speed: number, seconds: number, frame = FRAME) {
  let count = 0;
  for (let t = 0; t < seconds - 1e-9; t += frame) if (strides.step(speed * frame, frame, speeds, false)) count++;
  return count;
}

describe("footfalls", () => {
  it("fall once per walking stride, the first within half a stride", () => {
    const strides = fresh();
    // Half a stride, 0.375 m, takes about 0.27 s at 1.4 m/s.
    expect(steps(strides, 1.4, 0.3)).toBe(1);
    // Then one every 0.75 m: 7 m in 5 s.
    expect(steps(strides, 1.4, 5)).toBe(9);
  });

  it("fall less often per metre at a full run", () => {
    const strides = fresh();
    steps(strides, 3.5, 0.2);
    // 12 m at 1.2 m a stride.
    expect(steps(strides, 3.5, 12 / 3.5)).toBe(10);
  });

  it("come closer together per metre below walking pace", () => {
    const strides = fresh();
    steps(strides, 0.7, 1);
    // At half a walk the stride is halfway from 0.25 m to 0.75 m: 7 m at 0.5 m.
    expect(steps(strides, 0.7, 10)).toBe(14);
  });

  it("keep coming at the very slowest push", () => {
    const strides = fresh();
    steps(strides, 0.14, 2);
    // A tenth of a walk: 0.3 m a stride, so one every 2.1 s or so.
    expect(steps(strides, 0.14, 21)).toBe(10);
  });

  it("stay silent standing still, and begin again within half a stride", () => {
    const strides = fresh();
    steps(strides, 1.4, 1);
    expect(steps(strides, 0, 3)).toBe(0);
    expect(steps(strides, 1.4, 0.3)).toBe(1);
  });

  it("fall once on landing from a fall", () => {
    const strides = fresh();
    expect(strides.step(0, FRAME, speeds, true)).toBe(true);
    expect(strides.step(0, FRAME, speeds, false)).toBe(false);
  });
});

describe("head bob", () => {
  /** Walk at `speed` until the footfalls have settled in. */
  const walking = (speed: number) => {
    const strides = fresh();
    steps(strides, speed, 2);
    return strides;
  };

  it("is at rest before setting off", () => {
    const strides = fresh();
    expect(strides.bob.up + 0).toBe(0);
    expect(strides.bob.right + 0).toBe(0);
    expect(strides.settled).toBe(true);
  });

  it("is lowest as a foot falls", () => {
    const strides = walking(1.4);
    let { up } = strides.bob;
    let lowest = up;
    for (let frames = 0; frames < 200; frames++) {
      const fell = strides.step(1.4 * FRAME, FRAME, speeds, false);
      up = strides.bob.up;
      lowest = Math.min(lowest, up);
      if (fell) expect(up).toBeLessThan(-STRIDES.bobWalking * 0.95);
    }
    expect(lowest).toBeCloseTo(-STRIDES.bobWalking, 3);
  });

  it("is bigger at a run than at a walk, and small at a slow push", () => {
    const biggest = (speed: number) => {
      const strides = walking(speed);
      let most = 0;
      for (let frames = 0; frames < 200; frames++) {
        strides.step(speed * FRAME, FRAME, speeds, false);
        most = Math.max(most, Math.abs(strides.bob.up));
      }
      return most;
    };
    expect(biggest(3.5)).toBeCloseTo(STRIDES.bobRunning, 3);
    expect(biggest(1.4)).toBeCloseTo(STRIDES.bobWalking, 3);
    expect(biggest(0.14)).toBeCloseTo(STRIDES.bobWalking * 0.1, 3);
  });

  it("sways one way on one stride and the other way on the next", () => {
    const strides = walking(1.4);
    let most = 0;
    let least = 0;
    for (let frames = 0; frames < 200; frames++) {
      strides.step(1.4 * FRAME, FRAME, speeds, false);
      most = Math.max(most, strides.bob.right);
      least = Math.min(least, strides.bob.right);
    }
    expect(most).toBeCloseTo(STRIDES.bobWalking * STRIDES.sway, 3);
    expect(least).toBeCloseTo(-STRIDES.bobWalking * STRIDES.sway, 3);
  });

  it("sways by its own setting", () => {
    const strides = new Strides({ ...STRIDES, sway: 0 });
    steps(strides, 1.4, 2);
    expect(strides.bob.right).toBe(0);
    expect(strides.bob.up).not.toBe(0);
  });

  it("never jumps, also on running into a wall", () => {
    const strides = walking(3.5);
    let { up, right } = strides.bob;
    let biggest = 0;
    for (let frames = 0; frames < 60; frames++) {
      strides.step(0, FRAME, speeds, false);
      biggest = Math.max(biggest, Math.abs(strides.bob.up - up), Math.abs(strides.bob.right - right));
      ({ up, right } = strides.bob);
    }
    // No more than the share of its size it settles by in a frame.
    expect(biggest).toBeLessThan(STRIDES.bobRunning * 2 * (1 - Math.exp(-20 * FRAME)));
  });

  it("comes to rest soon after stopping", () => {
    const strides = walking(1.4);
    expect(strides.settled).toBe(false);
    steps(strides, 0, 1);
    expect(strides.settled).toBe(true);
    expect(strides.bob.up + 0).toBe(0);
    expect(strides.bob.right + 0).toBe(0);
  });

  it("stays still when asked, and the footfalls go on", () => {
    const strides = fresh();
    let fell = 0;
    for (let frames = 0; frames < 120; frames++) {
      if (strides.step(1.4 * FRAME, FRAME, speeds, false, true)) fell++;
      expect(strides.settled).toBe(true);
    }
    expect(fell).toBeGreaterThan(0);
  });

  it("is the same at any frame rate", () => {
    const after = (frame: number) => {
      const strides = fresh();
      for (let t = 0; t < 3 - 1e-9; t += frame) strides.step(1.4 * frame, frame, speeds, false);
      return strides.bob.up;
    };
    expect(after(1 / 30)).toBeCloseTo(after(1 / 120), 2);
  });
});
