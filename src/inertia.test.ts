import { describe, expect, it } from "vitest";
import { chase, Inertia } from "./inertia";
import { WALKING } from "./motion";
import { RUNNING } from "./running";

const BRAKE = 5.6;
const PICK_UP = 9.3;
const still = { east: 0, south: 0 };
const east = (speed: number) => ({ east: speed, south: 0 });

/** Chase a wanted velocity for this long in frames of this length. */
function chased(from: { east: number; south: number }, wanted: { east: number; south: number }, seconds: number, frame = 1 / 60) {
  let velocity = from;
  const travelled = { east: 0, south: 0 };
  for (let left = seconds; left > 1e-9; left -= frame) {
    const step = chase(velocity, wanted, Math.min(frame, left), BRAKE, PICK_UP);
    velocity = step.velocity;
    travelled.east += step.metres.east;
    travelled.south += step.metres.south;
  }
  return { velocity, travelled };
}

describe("chasing a velocity", () => {
  it("stays on the velocity wanted", () => {
    const { velocity, metres } = chase(east(1.4), east(1.4), 0.5, BRAKE, PICK_UP);
    expect(velocity).toEqual(east(1.4));
    expect(metres.east).toBeCloseTo(0.7);
  });

  it("sheds speed at the brake and comes to rest exactly", () => {
    const halfway = chased(east(1.4), still, 0.125);
    expect(halfway.velocity.east).toBeCloseTo(0.7);
    const { velocity, travelled } = chased(east(1.4), still, 1);
    expect(velocity).toEqual(still);
    expect(travelled.east).toBeCloseTo(1.4 ** 2 / (2 * BRAKE));
  });

  it("builds speed at the pick-up", () => {
    expect(chased(still, east(1.4), 0.1).velocity.east).toBeCloseTo(0.93);
    expect(chased(still, east(1.4), 0.2).velocity).toEqual(east(1.4));
  });

  it("slows to a stop before picking up the other way", () => {
    const stopped = 1.4 / BRAKE;
    expect(chased(east(1.4), east(-1.4), stopped - 0.05).velocity.east).toBeGreaterThan(0);
    const backing = chased(east(1.4), east(-1.4), stopped + 0.05).velocity.east;
    expect(backing).toBeCloseTo(-0.05 * PICK_UP);
    expect(chased(east(1.4), east(-1.4), stopped + 1.4 / PICK_UP + 0.01).velocity).toEqual(east(-1.4));
  });

  it("slows through a hard turn, never faster than it began", () => {
    const wanted = { east: 0, south: 3.5 };
    let velocity = east(3.5);
    let slowest = 3.5;
    for (let t = 0; t < 1; t += 1 / 60) {
      velocity = chase(velocity, wanted, 1 / 60, BRAKE, PICK_UP).velocity;
      const speed = Math.hypot(velocity.east, velocity.south);
      expect(speed).toBeLessThanOrEqual(3.5 + 1e-9);
      slowest = Math.min(slowest, speed);
    }
    expect(velocity).toEqual(wanted);
    expect(slowest).toBeCloseTo(3.5 / Math.SQRT2, 1);
  });

  it("gives the same result at any frame rate, also through a change of phase", () => {
    const slow = chased(east(3.5), east(-1.4), 0.7, 1 / 24);
    const fast = chased(east(3.5), east(-1.4), 0.7, 1 / 240);
    expect(slow.velocity.east).toBeCloseTo(fast.velocity.east);
    expect(slow.travelled.east).toBeCloseTo(fast.travelled.east);
  });

  it("is there at once with no time set for either", () => {
    const { velocity, metres } = chase(east(1.4), east(-1.4), 0.1, Infinity, Infinity);
    expect(velocity).toEqual(east(-1.4));
    expect(metres.east).toBeCloseTo(-0.14);
  });
});

describe("inertia", () => {
  const body = () => {
    const inertia = new Inertia(WALKING, RUNNING);
    inertia.carryOn({ east: 1, south: 1 });
    return inertia;
  };

  it("keeps its speed when the step went as asked", () => {
    const inertia = body();
    inertia.met({ east: 0.1, south: 0.1 }, { east: 0.1, south: 0.1 });
    expect(inertia.speed).toBeCloseTo(Math.SQRT2);
  });

  it("loses the speed going into a wall, and keeps the speed along it", () => {
    const inertia = body();
    inertia.met({ east: 0.1, south: 0.1 }, { east: 0.1, south: 0 });
    expect(inertia.speed).toBeCloseTo(1);
  });

  it("loses all its speed when stopped dead", () => {
    const inertia = body();
    inertia.met({ east: 0.1, south: 0.1 }, still);
    expect(inertia.speed).toBe(0);
  });

  it("takes its brake and pick-up from walking pace and the seconds set", () => {
    const inertia = new Inertia(WALKING, RUNNING);
    inertia.carry(east(WALKING.speed), WALKING.settingOff / 2);
    expect(inertia.speed).toBeCloseTo(WALKING.speed / 2);
    inertia.carry(still, WALKING.stopping / 4);
    expect(inertia.speed).toBeCloseTo(WALKING.speed / 4);
  });
});
