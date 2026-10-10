import { describe, expect, it } from "vitest";
import { BODY, collisionMesh } from "./collision";
import { advance, WALK_SPEED, type Viewpoint } from "./motion";

type Corner = [x: number, y: number, z: number];
const quad = (a: Corner, b: Corner, c: Corner, d: Corner) => [
  ...a, ...b, ...c,
  ...a, ...c, ...d,
];
/** A level rectangle of floor at one height. */
const floor = (x0: number, z0: number, x1: number, z1: number, y: number) =>
  quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]);
/** A vertical wall along a line on the floor plan. */
const wall = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number) =>
  quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]);

const start: Viewpoint = { x: 0, z: 0, floor: 0, heading: 0 };
const forward = { x: 0, y: 1 };
const FRAME = 0.05;
/** Walk forward for a while in small frames, as the render loop does. */
function walk(from: Viewpoint, terrain: ReturnType<typeof collisionMesh>["terrain"], seconds: number) {
  let viewpoint = from;
  for (let frame = 0; frame < Math.round(seconds / FRAME); frame++) {
    viewpoint = advance(viewpoint, forward, FRAME, terrain);
  }
  return viewpoint;
}

describe("collision mesh", () => {
  it("lets the viewer walk across level floor", () => {
    const { terrain } = collisionMesh(floor(-5, -5, 5, 5, 0));
    const next = walk(start, terrain, 1);
    expect(next.z).toBeCloseTo(-WALK_SPEED);
    expect(next.floor).toBeCloseTo(0);
  });

  it("carries the viewer up a slope", () => {
    // Level until z = -1, then rising 1 m over the next 4 m.
    const { terrain } = collisionMesh([
      ...floor(-5, -1, 5, 5, 0),
      ...quad([-5, 1, -5], [5, 1, -5], [5, 0, -1], [-5, 0, -1]),
    ]);
    const next = walk(start, terrain, 2);
    expect(next.z).toBeCloseTo(-2 * WALK_SPEED);
    expect(next.floor).toBeCloseTo((2 * WALK_SPEED - 1) / 4);
  });

  it("refuses to walk off the edge of the floor", () => {
    const { terrain } = collisionMesh(floor(-5, -2, 5, 5, 0));
    const next = walk(start, terrain, 5);
    expect(next.z).toBeGreaterThanOrEqual(-2);
    expect(next.z).toBeLessThan(-1.9);
  });

  it("refuses a drop taller than a step", () => {
    const { terrain } = collisionMesh([
      ...floor(-5, -2, 5, 5, 0),
      ...floor(-5, -9, 5, -2, -1),
    ]);
    const next = walk(start, terrain, 5);
    expect(next.z).toBeGreaterThanOrEqual(-2);
    expect(next.floor).toBe(0);
  });

  it("walks over a change in height no taller than a step", () => {
    const { terrain } = collisionMesh([
      ...floor(-5, -2, 5, 5, 0),
      ...floor(-5, -9, 5, -2, 0.15),
    ]);
    const next = walk(start, terrain, 3);
    expect(next.z).toBeCloseTo(-3 * WALK_SPEED);
    expect(next.floor).toBeCloseTo(0.15);
  });

  it("keeps the viewer a body's radius away from a wall", () => {
    const { terrain } = collisionMesh([
      ...floor(-5, -5, 5, 5, 0),
      ...wall(-5, -2, 5, -2, 0, 3),
    ]);
    const next = walk(start, terrain, 5);
    expect(next.z).toBeCloseTo(-2 + BODY.radius);
  });

  it("slides along a wall met at an angle", () => {
    const { terrain } = collisionMesh([
      ...floor(-9, -5, 9, 5, 0),
      ...wall(-9, -2, 9, -2, 0, 3),
    ]);
    const next = walk({ ...start, heading: Math.PI / 4 }, terrain, 4);
    expect(next.z).toBeCloseTo(-2 + BODY.radius);
    expect(next.x).toBeGreaterThan(3);
  });

  it("treats a surface steeper than 45 degrees as a wall", () => {
    // Rising 2 m over 1 m: too steep to be floor.
    const { terrain } = collisionMesh([
      ...floor(-5, -2, 5, 5, 0),
      ...quad([-5, 2, -3], [5, 2, -3], [5, 0, -2], [-5, 0, -2]),
    ]);
    const next = walk(start, terrain, 5);
    expect(next.floor).toBe(0);
    expect(next.z).toBeGreaterThan(-2);
  });

  it("ignores a kerb lower than a step, and a beam above head height", () => {
    const { terrain } = collisionMesh([
      ...floor(-5, -9, 5, 5, 0),
      ...wall(-5, -2, 5, -2, 0, 0.2),
      ...wall(-5, -3, 5, -3, 2.2, 3),
    ]);
    const next = walk(start, terrain, 3);
    expect(next.z).toBeCloseTo(-3 * WALK_SPEED);
  });

  it("picks the floor level closest to the viewer where levels overlap", () => {
    const { floorAt } = collisionMesh([
      ...floor(-5, -5, 5, 5, 0),
      ...floor(-5, -5, 5, 5, 3),
    ]);
    expect(floorAt(0, 0, 0.2)).toBe(0);
    expect(floorAt(0, 0, 2.5)).toBe(3);
    expect(floorAt(20, 0, 0)).toBeUndefined();
  });
});
