import { describe, expect, it } from "vitest";
import {
  advance,
  STANDING_TURN_SPEED,
  WALK_SPEED,
  WALKING_TURN_SPEED,
  withinLimits,
  type Viewpoint,
} from "./motion";

const limits = { halfWidth: 5, halfDepth: 4 };
const room = withinLimits(limits);
const start: Viewpoint = { x: 0, z: 0, floor: 0, heading: 0 };

describe("advance", () => {
  it("walks north when pushed forward from the start", () => {
    const next = advance(start, { x: 0, y: 1 }, 1, room);
    expect(next.x).toBeCloseTo(0);
    expect(next.z).toBeCloseTo(-WALK_SPEED);
    expect(next.heading).toBe(0);
  });

  it("walks backward without turning when pulled back", () => {
    const next = advance(start, { x: 0, y: -1 }, 1, room);
    expect(next.z).toBeCloseTo(WALK_SPEED);
    expect(next.heading).toBe(0);
  });

  it("turns on the spot when pushed sideways, never sidestepping", () => {
    const next = advance(start, { x: 1, y: 0 }, 1, room);
    expect(next.heading).toBeCloseTo(STANDING_TURN_SPEED);
    expect(next.x).toBe(0);
    expect(next.z).toBe(0);
  });

  it("walks east after a quarter turn to the right", () => {
    const facingEast = advance(start, { x: 1, y: 0 }, 0.75, room);
    const next = advance(facingEast, { x: 0, y: 1 }, 1, room);
    expect(next.x).toBeCloseTo(WALK_SPEED);
    expect(next.z).toBeCloseTo(0);
  });

  it("curves when pushed diagonally", () => {
    const next = advance(start, { x: 0.5, y: 0.5 }, 1, room);
    expect(next.heading).toBeGreaterThan(0);
    expect(next.x).toBeGreaterThan(0);
    expect(next.z).toBeLessThan(0);
  });

  it("scales speed with how far the stick is pushed", () => {
    const next = advance(start, { x: 0, y: 0.5 }, 1, room);
    expect(next.z).toBeCloseTo(-WALK_SPEED / 2);
  });

  it("turns fastest standing still and slowest at full walking speed", () => {
    const standing = advance(start, { x: 1, y: 0 }, 0.1, room);
    const strolling = advance(start, { x: 1, y: 0.5 }, 0.1, room);
    const walking = advance(start, { x: 1, y: 1 }, 0.1, room);
    expect(standing.heading).toBeCloseTo(STANDING_TURN_SPEED * 0.1);
    expect(walking.heading).toBeCloseTo(WALKING_TURN_SPEED * 0.1);
    expect(strolling.heading).toBeLessThan(standing.heading);
    expect(strolling.heading).toBeGreaterThan(walking.heading);
  });

  it("turns just as fast walking backward as forward", () => {
    const forward = advance(start, { x: 1, y: 1 }, 0.1, room);
    const backward = advance(start, { x: 1, y: -1 }, 0.1, room);
    expect(backward.heading).toBeCloseTo(forward.heading);
  });

  it("stops at the limits", () => {
    const next = advance(start, { x: 0, y: 1 }, 60, room);
    expect(next.z).toBe(-limits.halfDepth);
  });
});
