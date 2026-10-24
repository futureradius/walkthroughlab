import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type Material } from "three";
import { describe, expect, it } from "vitest";
import { BODY, collisionMesh } from "./collision";
import type { DoorSettings } from "./doors";
import { Elevator, ELEVATOR, type ElevatorParts } from "./elevators";
import type { Footing } from "./motion";

/** A flat square of floor, `size` across from (x, z), at height `y`, as two triangles. */
const square = (x: number, z: number, size: number, y: number) => [
  x, y, z, x + size, y, z, x + size, y, z + size, x, y, z, x + size, y, z + size, x, y, z + size,
];

/** Ground and two upper floors beside a shaft at x 0 to 2, z 0 to 2. */
const STILL = Float32Array.from([...square(-10, -10, 20, 0).map((v, i) => (i % 3 === 1 ? -0.01 : v)), ...square(-6, 0, 6, 3.5), ...square(-6, 0, 6, 6.5)]);

const DOORS: DoorSettings = { seconds: 0.5, near: 1.5, wait: 2 };

/** A button: a small box the tap would land on, and its material, to see it light. */
function button() {
  const mesh = new Mesh(new BoxGeometry(0.1, 0.1, 0.02), new MeshBasicMaterial({ color: 0x777777 }));
  return { object: new Group().add(mesh), mesh };
}

/** An elevator whose car is a 2 m square floor, with call buttons for stops 1 and 2 and a car door. */
function elevator() {
  const call = button();
  const back = button();
  const parts: ElevatorParts = {
    route: [[1, 0, 1], [1, 3.5, 1], [1, 6.5, 1]],
    car: { model: new Group(), walls: Float32Array.from(square(0, 0, 2, 0)) },
    carDoors: [
      {
        motion: { kind: "sliding", parts: [{ leaf: null, offset: [0.8, 0] }], centre: [0.5, 0], bottom: 0, top: 2 },
        leaves: [{ model: undefined, walls: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 2, 0, 0, 0, 0, 1, 2, 0, 0, 2, 0]) }],
      },
    ],
    floorDoors: [],
    buttons: [
      { object: call.object, stop: 2, call: true },
      { object: back.object, stop: 1, call: true },
    ],
  };
  const lift = new Elevator(parts, { ...ELEVATOR }, DOORS);
  const collision = collisionMesh(STILL, BODY, () => lift.triangles());
  const viewer = { footing: { x: 1, z: 1, floor: 0 } as Footing, shove(to: Footing) { this.footing = to; } };
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) lift.update(0.05, collision, viewer);
  };
  return { lift, call, back, viewer, run };
}

describe("an elevator", () => {
  it("carries the viewer to the stop a button asks for, lighting the button until it gets there", () => {
    const { lift, call, viewer, run } = elevator();
    const plain: Material = call.mesh.material as Material;
    lift.press(call.object);
    expect(call.mesh.material).not.toBe(plain);
    run(6);
    expect(viewer.footing.floor).toBeCloseTo(3.5, 2);
    expect(call.mesh.material).toBe(plain);
  });

  it("opens its doors on arrival, and leaves only once they have shut again", () => {
    const { lift, call, back, viewer, run } = elevator();
    lift.press(call.object);
    run(6);
    // Arrived at stop 2 and opened; a call for stop 1 waits for the doors.
    lift.press(back.object);
    run(0.5);
    expect(viewer.footing.floor).toBeCloseTo(3.5, 2);
    run(DOORS.wait + DOORS.seconds + 6);
    expect(viewer.footing.floor).toBeCloseTo(0, 2);
  });

  it("opens at once when called to the stop it stands at, and goes nowhere", () => {
    const { lift, back, viewer, run } = elevator();
    lift.press(back.object);
    run(1);
    expect(viewer.footing.floor).toBe(0);
    // The car door slid open, out of the way of the doorway.
    const walls = lift.triangles();
    expect(Math.min(...walls.slice(-2).flatMap((t) => [t[0], t[3], t[6]]))).toBeCloseTo(0.8, 1);
  });
});
