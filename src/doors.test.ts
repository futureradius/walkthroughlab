import { describe, expect, it } from "vitest";
import { BODY, collisionMesh } from "./collision";
import { Door, HINGED_DOOR, type DoorMotion } from "./doors";
import type { Footing } from "./motion";

/** A floor 20 m across at height 0, as two triangles. */
const FLOOR = [-10, 0, -10, 10, 0, -10, 10, 0, 10, -10, 0, -10, 10, 0, 10, -10, 0, 10];

/** An upright wall from one spot on the floor plan to another, 2 m high, as two triangles. */
const wall = (x1: number, z1: number, x2: number, z2: number) => [
  x1, 0, z1, x2, 0, z2, x2, 2, z2, x1, 0, z1, x2, 2, z2, x1, 2, z1,
];

/** A door 1 m wide, hinged at the origin, closed along +x, turning a quarter turn towards +z. */
const MOTION: DoorMotion = {
  kind: "hinged",
  parts: [{ leaf: null, pivot: [0, 0], angle: Math.PI / 2, reach: 1 }],
  centre: [0.5, 0],
  bottom: 0,
  top: 2,
};

/** A door, the collision it lives in, and a viewer it can push. */
function scene(stand: Footing, still: number[] = []) {
  const door = new Door(MOTION, [{ model: undefined, walls: Float32Array.from(wall(0, 0, 1, 0)) }], { ...HINGED_DOOR });
  const collision = collisionMesh(Float32Array.from([...FLOOR, ...still]), BODY, () => door.walls());
  const viewer = { footing: stand, shove(to: Footing) { this.footing = to; } };
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) door.update(0.05, collision, viewer);
  };
  return { door, viewer, run };
}

/** Where the leaf's free edge is now, on the floor plan. */
const freeEdge = (door: Door) => {
  const walls = door.walls();
  let far = [0, 0];
  for (const t of walls) for (let c = 0; c < 9; c += 3) if (Math.hypot(t[c], t[c + 2]) > Math.hypot(far[0], far[1])) far = [t[c], t[c + 2]];
  return far;
};

describe("a door", () => {
  it("opens as the viewer comes near, and closes once they have been away a while", () => {
    const { door, viewer, run } = scene({ x: 0.5, z: -1.2, floor: 0 });
    run(HINGED_DOOR.seconds + 0.1);
    const [x, z] = freeEdge(door);
    expect(x).toBeCloseTo(0, 1);
    expect(z).toBeCloseTo(1, 1);
    viewer.footing = { x: 6, z: -6, floor: 0 };
    run(HINGED_DOOR.wait + HINGED_DOOR.seconds + 0.2);
    expect(freeEdge(door)[0]).toBeCloseTo(1, 1);
  });

  it("opens from further away on the side it swings to, by its width and half a metre", () => {
    const swingSide = scene({ x: 0.5, z: 1.4, floor: 0 });
    swingSide.run(0.2);
    expect(freeEdge(swingSide.door)[1]).toBeGreaterThan(0.01);
    const otherSide = scene({ x: 0.5, z: -1.6, floor: 0 });
    otherSide.run(0.2);
    expect(freeEdge(otherSide.door)[1]).toBeCloseTo(0, 5);
  });

  it("pushes a viewer standing where it swings", () => {
    const { door, viewer, run } = scene({ x: 0.7, z: 0.5, floor: 0 });
    run(HINGED_DOOR.seconds + 0.1);
    expect(freeEdge(door)[1]).toBeCloseTo(1, 1);
    // The leaf now lies along +z at x = 0, from z = 0 to 1; the viewer was
    // pushed ahead of it, round its swing, and stands clear of it.
    const { x, z } = viewer.footing;
    const along = Math.min(1, Math.max(0, z));
    expect(Math.hypot(x, z - along)).toBeGreaterThanOrEqual(BODY.radius - 0.03);
  });

  it("stops where it would push the viewer into a wall, and never pushes them through it", () => {
    const { door, viewer, run } = scene({ x: 0.5, z: 0.55, floor: 0 }, wall(-2, 0.95, 3, 0.95));
    run(5);
    expect(freeEdge(door)[1]).toBeLessThan(0.9);
    expect(viewer.footing.z).toBeLessThanOrEqual(0.95 - BODY.radius + 0.03);
  });
});
