import { describe, expect, it } from "vitest";
import {
  advance,
  IDLE,
  LEVELLING_RATE,
  MAX_PITCH,
  STANDING_TURN_SPEED,
  WALK_SPEED,
  WALKING_TURN_SPEED,
  withinLimits,
  type Viewpoint,
} from "./motion";

const limits = { halfWidth: 5, halfDepth: 4 };
const room = withinLimits(limits);
const start: Viewpoint = { x: 0, z: 0, floor: 0, heading: 0, pitch: 0 };
/** A joystick on its own: sideways turns, forward walks. */
const push = (turn: number, walk: number) => ({ ...IDLE, turn, walk });

describe("advance", () => {
  it("walks north when pushed forward from the start", () => {
    const next = advance(start, push(0, 1), 1, room);
    expect(next.x).toBeCloseTo(0);
    expect(next.z).toBeCloseTo(-WALK_SPEED);
    expect(next.heading).toBe(0);
  });

  it("walks backward without turning when pulled back", () => {
    const next = advance(start, push(0, -1), 1, room);
    expect(next.z).toBeCloseTo(WALK_SPEED);
    expect(next.heading).toBe(0);
  });

  it("turns on the spot when pushed sideways, never sidestepping", () => {
    const next = advance(start, push(1, 0), 1, room);
    expect(next.heading).toBeCloseTo(STANDING_TURN_SPEED);
    expect(next.x).toBe(0);
    expect(next.z).toBe(0);
  });

  it("walks east after a quarter turn to the right", () => {
    const facingEast = advance(start, push(1, 0), 0.75, room);
    const next = advance(facingEast, push(0, 1), 1, room);
    expect(next.x).toBeCloseTo(WALK_SPEED);
    expect(next.z).toBeCloseTo(0);
  });

  it("curves when pushed diagonally", () => {
    const next = advance(start, push(0.5, 0.5), 1, room);
    expect(next.heading).toBeGreaterThan(0);
    expect(next.x).toBeGreaterThan(0);
    expect(next.z).toBeLessThan(0);
  });

  it("scales speed with how far the stick is pushed", () => {
    const next = advance(start, push(0, 0.5), 1, room);
    expect(next.z).toBeCloseTo(-WALK_SPEED / 2);
  });

  it("turns fastest standing still and slowest at full walking speed", () => {
    const standing = advance(start, push(1, 0), 0.1, room);
    const strolling = advance(start, push(1, 0.5), 0.1, room);
    const walking = advance(start, push(1, 1), 0.1, room);
    expect(standing.heading).toBeCloseTo(STANDING_TURN_SPEED * 0.1);
    expect(walking.heading).toBeCloseTo(WALKING_TURN_SPEED * 0.1);
    expect(strolling.heading).toBeLessThan(standing.heading);
    expect(strolling.heading).toBeGreaterThan(walking.heading);
  });

  it("turns just as fast walking backward as forward", () => {
    const forward = advance(start, push(1, 1), 0.1, room);
    const backward = advance(start, push(1, -1), 0.1, room);
    expect(backward.heading).toBeCloseTo(forward.heading);
  });

  it("stops at the limits", () => {
    const next = advance(start, push(0, 1), 60, room);
    expect(next.z).toBe(-limits.halfDepth);
  });

  it("sidesteps to the right without turning", () => {
    const next = advance(start, { ...IDLE, sidestep: 1 }, 1, room);
    expect(next.x).toBeCloseTo(WALK_SPEED);
    expect(next.z).toBeCloseTo(0);
    expect(next.heading).toBe(0);
  });

  it("sidesteps relative to where the viewer faces", () => {
    const facingEast = { ...start, heading: Math.PI / 2 };
    const next = advance(facingEast, { ...IDLE, sidestep: 1 }, 1, room);
    expect(next.x).toBeCloseTo(0);
    expect(next.z).toBeCloseTo(WALK_SPEED);
  });

  it("is no faster walking diagonally than straight", () => {
    const next = advance(start, { ...IDLE, walk: 1, sidestep: 1 }, 1, room);
    expect(Math.hypot(next.x, next.z)).toBeCloseTo(WALK_SPEED);
  });

  it("turns and tilts the view by a free look drag", () => {
    const next = advance(start, { ...IDLE, looking: true, lookRight: 0.3, lookUp: 0.2 }, 0.016, room);
    expect(next.heading).toBeCloseTo(0.3);
    expect(next.pitch).toBeCloseTo(0.2);
  });

  it("walks where free look has turned the view", () => {
    const next = advance(start, { ...IDLE, walk: 1, looking: true, lookRight: Math.PI / 2 }, 1, room);
    expect(next.x).toBeCloseTo(WALK_SPEED);
    expect(next.z).toBeCloseTo(0);
  });

  it("stops tilting just short of straight up and straight down", () => {
    const up = advance(start, { ...IDLE, looking: true, lookUp: 3 }, 0.016, room);
    const down = advance(start, { ...IDLE, looking: true, lookUp: -3 }, 0.016, room);
    expect(up.pitch).toBe(MAX_PITCH);
    expect(down.pitch).toBe(-MAX_PITCH);
  });

  describe("levelling the view", () => {
    const tilted = { ...start, pitch: 0.8 };

    it("eases back to level while walking", () => {
      const next = advance(tilted, push(0, 1), 1, room);
      expect(next.pitch).toBeCloseTo(0.8 * Math.exp(-LEVELLING_RATE));
      expect(next.pitch).toBeLessThan(0.02);
    });

    it("eases back to level while sidestepping", () => {
      const next = advance(tilted, { ...IDLE, sidestep: 1 }, 0.1, room);
      expect(next.pitch).toBeLessThan(0.8);
    });

    it("keeps the tilt while standing still", () => {
      expect(advance(tilted, IDLE, 1, room).pitch).toBe(0.8);
    });

    it("keeps the tilt while turning on the spot", () => {
      expect(advance(tilted, push(1, 0), 1, room).pitch).toBe(0.8);
    });

    it("keeps the tilt while walking with a free look drag held", () => {
      const next = advance(tilted, { ...IDLE, walk: 1, looking: true }, 1, room);
      expect(next.pitch).toBe(0.8);
    });
  });
});
