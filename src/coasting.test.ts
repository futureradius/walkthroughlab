import { describe, expect, it } from "vitest";
import { COASTING, Coasting, releaseSpeed, SLOWEST_THROW } from "./coasting";

/** Throw the view to the right and add up how far it carries, and for how long. */
function carry(coasting: Coasting, speed: number, frame = 1 / 60) {
  coasting.throw(speed, 0);
  let turned = 0;
  let seconds = 0;
  for (let frames = 0; frames < 100000; frames++) {
    const step = coasting.step(frame);
    if (step.right === 0) break;
    turned += step.right;
    seconds += frame;
  }
  return { turned, seconds };
}

describe("coasting", () => {
  it("carries on the way the view was thrown", () => {
    const coasting = new Coasting();
    coasting.throw(-3, 4);
    const step = coasting.step(0.016);
    expect(step.right).toBeLessThan(0);
    expect(step.up).toBeGreaterThan(0);
    expect(step.up / step.right).toBeCloseTo(4 / -3);
  });

  it("slows from the speed of the throw and comes to rest", () => {
    const coasting = new Coasting();
    coasting.throw(5, 0);
    const first = coasting.step(0.016).right;
    const second = coasting.step(0.016).right;
    expect(first).toBeLessThan(5 * 0.016);
    expect(second).toBeLessThan(first);
    for (let frames = 0; frames < 1000; frames++) coasting.step(0.016);
    expect(coasting.step(0.016)).toEqual({ right: 0, up: 0 });
  });

  it("ends up in the same place whatever the frame rate", () => {
    const smooth = carry(new Coasting(), 6, 1 / 120).turned;
    const choppy = carry(new Coasting(), 6, 1 / 20).turned;
    expect(choppy).toBeCloseTo(smooth, 1);
  });

  it("carries a harder throw further, but less so the harder it gets", () => {
    const gentle = carry(new Coasting(), 4).turned;
    const hard = carry(new Coasting(), 8).turned;
    const fierce = carry(new Coasting(), 16).turned;
    expect(hard).toBeGreaterThan(gentle);
    expect(fierce).toBeGreaterThan(hard);
    expect(hard).toBeLessThan(gentle * 2);
    expect(fierce - hard).toBeLessThan((hard - gentle) * 2);
  });

  it("stays put after a release too slow to be a throw", () => {
    const coasting = new Coasting();
    coasting.throw(SLOWEST_THROW * 0.9, 0);
    expect(coasting.step(0.016)).toEqual({ right: 0, up: 0 });
  });

  it("stops dead when caught", () => {
    const coasting = new Coasting();
    coasting.throw(5, 0);
    coasting.step(0.016);
    coasting.catch();
    expect(coasting.step(0.016)).toEqual({ right: 0, up: 0 });
  });

  it("settles sooner and nearer with reduced motion, without stopping dead", () => {
    const usual = carry(new Coasting(), 5);
    const reduced = carry(new Coasting({ ...COASTING, reduced: true }), 5);
    expect(reduced.turned).toBeGreaterThan(0);
    expect(reduced.turned).toBeLessThan(usual.turned / 4);
    expect(reduced.seconds).toBeLessThan(0.5);
  });

  it("does not carry on when switched off", () => {
    const coasting = new Coasting({ ...COASTING, on: false });
    coasting.throw(5, 0);
    expect(coasting.step(0.016)).toEqual({ right: 0, up: 0 });
  });
});

describe("release speed", () => {
  it("is the speed of the drag over the last moment", () => {
    const samples = [
      { at: 0, x: 0, y: 0 },
      { at: 950, x: 100, y: 50 },
      { at: 1000, x: 200, y: 30 },
    ];
    const speed = releaseSpeed(samples, 1000);
    expect(speed.x).toBeCloseTo(2000);
    expect(speed.y).toBeCloseTo(-400);
  });

  it("is nothing once the finger has come to rest", () => {
    const samples = [
      { at: 0, x: 0, y: 0 },
      { at: 50, x: 300, y: 0 },
    ];
    expect(releaseSpeed(samples, 400)).toEqual({ x: 0, y: 0 });
  });

  it("drops the longer the finger lingers before lifting", () => {
    const samples = [
      { at: 0, x: 0, y: 0 },
      { at: 20, x: 100, y: 0 },
    ];
    expect(releaseSpeed(samples, 80).x).toBeLessThan(releaseSpeed(samples, 20).x);
  });

  it("is nothing for a tap", () => {
    expect(releaseSpeed([{ at: 10, x: 5, y: 5 }], 10)).toEqual({ x: 0, y: 0 });
    expect(releaseSpeed([], 10)).toEqual({ x: 0, y: 0 });
  });
});
