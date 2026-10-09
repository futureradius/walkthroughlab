import { describe, expect, it } from "vitest";
import { advance, TURN_SPEED, WALK_SPEED, type Viewpoint } from "./motion";

const limits = { halfWidth: 5, halfDepth: 4 };
const start: Viewpoint = { x: 0, z: 0, heading: 0 };

describe("advance", () => {
  it("walks north when pushed forward from the start", () => {
    const next = advance(start, { x: 0, y: 1 }, 1, limits);
    expect(next.x).toBeCloseTo(0);
    expect(next.z).toBeCloseTo(-WALK_SPEED);
    expect(next.heading).toBe(0);
  });

  it("walks backward without turning when pulled back", () => {
    const next = advance(start, { x: 0, y: -1 }, 1, limits);
    expect(next.z).toBeCloseTo(WALK_SPEED);
    expect(next.heading).toBe(0);
  });

  it("turns on the spot when pushed sideways, never sidestepping", () => {
    const next = advance(start, { x: 1, y: 0 }, 1, limits);
    expect(next.heading).toBeCloseTo(TURN_SPEED);
    expect(next.x).toBe(0);
    expect(next.z).toBe(0);
  });

  it("walks east after a quarter turn to the right", () => {
    const facingEast = advance(start, { x: 1, y: 0 }, 1, limits);
    const next = advance(facingEast, { x: 0, y: 1 }, 1, limits);
    expect(next.x).toBeCloseTo(WALK_SPEED);
    expect(next.z).toBeCloseTo(0);
  });

  it("curves when pushed diagonally", () => {
    const next = advance(start, { x: 0.5, y: 0.5 }, 1, limits);
    expect(next.heading).toBeGreaterThan(0);
    expect(next.x).toBeGreaterThan(0);
    expect(next.z).toBeLessThan(0);
  });

  it("scales speed with how far the stick is pushed", () => {
    const next = advance(start, { x: 0, y: 0.5 }, 1, limits);
    expect(next.z).toBeCloseTo(-WALK_SPEED / 2);
  });

  it("stops at the limits", () => {
    const next = advance(start, { x: 0, y: 1 }, 60, limits);
    expect(next.z).toBe(-limits.halfDepth);
  });
});
