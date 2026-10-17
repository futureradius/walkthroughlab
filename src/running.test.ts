import { describe, expect, it } from "vitest";
import { WALKING } from "./motion";
import { RUNNING, Running } from "./running";

const FRAME = 1 / 60;

/** The knob held at a spot, pushing as hard as it reaches. */
const at = (x: number, y: number) => ({ knob: { x, y }, stick: { x, y } });
const middle = at(0, 0);
const forward = at(0, 1);

/** Hold the joystick for this long, and return the last frame's speed. */
function hold(running: Running, joystick = middle, seconds = FRAME, shift = false) {
  let speed = 0;
  for (let spent = 0; spent < seconds - 1e-9; spent += FRAME) {
    speed = running.step(joystick, shift, FRAME);
  }
  return speed;
}

/** Push forward, dip, and push forward again, each this quick. */
function doublePush(running: Running, push = 0.1, dip = 0.1, second = forward) {
  hold(running, forward, push);
  hold(running, middle, dip);
  hold(running, second);
}

/** Full speed forward, once the pace has had time to settle. */
const settled = (running: Running, joystick = forward) => hold(running, joystick, 1);

describe("running", () => {
  it("walks when pushed forward once", () => {
    const running = new Running();
    expect(settled(running)).toBe(WALKING.speed);
  });

  it("runs after a quick push forward, a dip and a second push", () => {
    const running = new Running();
    doublePush(running);
    expect(settled(running)).toBeCloseTo(RUNNING.speed);
  });

  it("counts a dip that keeps hold of the joystick, as well as letting go", () => {
    const running = new Running();
    hold(running, forward, 0.1);
    hold(running, at(0, RUNNING.dip - 0.1), 0.1);
    hold(running, forward);
    expect(settled(running)).toBeCloseTo(RUNNING.speed);
  });

  it("walks when the first push lasts too long", () => {
    const running = new Running();
    doublePush(running, RUNNING.time + 0.1);
    expect(settled(running)).toBe(WALKING.speed);
  });

  it("walks when the dip lasts too long", () => {
    const running = new Running();
    doublePush(running, 0.1, RUNNING.time + 0.1);
    expect(settled(running)).toBe(WALKING.speed);
  });

  it("walks when a push stops short of the push mark", () => {
    const running = new Running();
    const short = at(0, RUNNING.push - 0.05);
    hold(running, short, 0.1);
    hold(running, middle, 0.1);
    hold(running, forward);
    expect(settled(running)).toBe(WALKING.speed);
  });

  it("walks when the dip stays outside the dip mark", () => {
    const running = new Running();
    hold(running, forward, 0.1);
    hold(running, at(0, RUNNING.dip + 0.05), 0.1);
    hold(running, forward);
    expect(settled(running)).toBe(WALKING.speed);
  });

  it("counts a push more forward than sideways, but not one more sideways", () => {
    const leaning = new Running();
    doublePush(leaning, 0.1, 0.1, at(0.6, 0.8));
    expect(settled(leaning)).toBeCloseTo(RUNNING.speed);

    const sideways = new Running();
    doublePush(sideways, 0.1, 0.1, at(0.8, 0.6));
    expect(settled(sideways, at(0.8, 0.6))).toBe(WALKING.speed);
  });

  it("keeps running at a softer push while faster than walking", () => {
    const running = new Running();
    doublePush(running);
    expect(settled(running, at(0, 0.5))).toBeCloseTo(RUNNING.speed);
  });

  it("stops once the push slows to walking pace, until started again", () => {
    const running = new Running();
    doublePush(running);
    const slow = at(0, (WALKING.speed / RUNNING.speed) * 0.9);
    expect(settled(running, slow)).toBe(WALKING.speed);
    expect(settled(running)).toBe(WALKING.speed);
  });

  it("stops when the joystick is let go", () => {
    const running = new Running();
    doublePush(running);
    settled(running);
    hold(running, middle, 1);
    expect(settled(running)).toBe(WALKING.speed);
  });

  it("picks up and drops back over the ease time, not at once", () => {
    const running = new Running();
    doublePush(running);
    const halfway = hold(running, forward, RUNNING.ease / 2);
    expect(halfway).toBeGreaterThan(WALKING.speed);
    expect(halfway).toBeLessThan(RUNNING.speed);
    settled(running);

    const slow = at(0, 0.2);
    const easing = hold(running, slow, RUNNING.ease / 2);
    expect(easing).toBeGreaterThan(WALKING.speed);
    expect(easing).toBeLessThan(RUNNING.speed);
    expect(hold(running, slow, RUNNING.ease)).toBe(WALKING.speed);
  });

  it("runs while Shift is held, easing up and back", () => {
    const running = new Running();
    expect(hold(running, middle, 1, true)).toBeCloseTo(RUNNING.speed);
    expect(hold(running, middle, RUNNING.ease / 2)).toBeGreaterThan(WALKING.speed);
    expect(hold(running, middle, RUNNING.ease)).toBe(WALKING.speed);
  });
});
