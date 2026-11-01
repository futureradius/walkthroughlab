import type { Carrier, Ground, WalkingSettings } from "./motion";

/**
 * Change a velocity towards the one wanted, in a straight line and exactly,
 * so the result is the same at any frame rate. Speed being shed goes at
 * `brake`, in metres per second per second, and speed being built at
 * `pickUp`: a viewer reversing slows to a stop, then picks up the other way,
 * and one turning hard slows through the turn and picks up out of it. Neither
 * ever goes faster than the faster of where they began and what they want.
 */
export function chase(
  from: Ground,
  wanted: Ground,
  seconds: number,
  brake: number,
  pickUp: number,
): { velocity: Ground; metres: Ground } {
  const gapEast = wanted.east - from.east;
  const gapSouth = wanted.south - from.south;
  const gap = Math.hypot(gapEast, gapSouth);
  if (gap === 0) {
    return { velocity: wanted, metres: { east: wanted.east * seconds, south: wanted.south * seconds } };
  }
  const east = gapEast / gap;
  const south = gapSouth / gap;
  // Speed falls along the line until its nearest point to standing still, and rises after.
  const slowest = Math.max(0, Math.min(gap, -(from.east * east + from.south * south)));
  const needed = slowest / brake + (gap - slowest) / pickUp;

  let velocity = from;
  let left = seconds;
  const metres = { east: 0, south: 0 };
  const change = (distance: number, rate: number) => {
    const whole = distance / rate;
    const time = Math.min(left, whole);
    const by = time === whole ? distance : rate * time;
    const next = { east: velocity.east + east * by, south: velocity.south + south * by };
    metres.east += ((velocity.east + next.east) / 2) * time;
    metres.south += ((velocity.south + next.south) / 2) * time;
    velocity = next;
    left -= time;
  };
  change(slowest, brake);
  change(gap - slowest, pickUp);
  if (needed > seconds) return { velocity, metres };
  metres.east += wanted.east * left;
  metres.south += wanted.south * left;
  return { velocity: wanted, metres };
}

/** A difference this many metres from a step as asked is only rounding. */
const ROUNDING = 1e-9;

/**
 * Inertia: the viewer's body taking a moment to change how fast and which way
 * it goes. The joystick and the keys ask, and the body gets there.
 */
export class Inertia implements Carrier {
  /** Metres per second east and south the body is going at. */
  private velocity: Ground = { east: 0, south: 0 };

  constructor(private readonly walking: WalkingSettings) {}

  get speed() {
    return Math.hypot(this.velocity.east, this.velocity.south);
  }

  carry(wanted: Ground, seconds: number): Ground {
    const { speed, stopping, settingOff } = this.walking;
    const { velocity, metres } = chase(this.velocity, wanted, seconds, speed / stopping, speed / settingOff);
    this.velocity = velocity;
    return metres;
  }

  /**
   * A wall had its say in a step: speed into it goes, speed along it stays.
   * Only walking counts here, so what a door or an elevator's car does to the
   * viewer never builds up speed.
   */
  met(asked: Ground, got: Ground) {
    if (Math.hypot(got.east - asked.east, got.south - asked.south) <= ROUNDING) return;
    const length = Math.hypot(got.east, got.south);
    if (length <= ROUNDING) {
      this.velocity = { east: 0, south: 0 };
      return;
    }
    const east = got.east / length;
    const south = got.south / length;
    const along = Math.max(0, this.velocity.east * east + this.velocity.south * south);
    this.velocity = { east: east * along, south: south * along };
  }

  /** Go on at this speed, as a viewer does landing from a fall. */
  carryOn(velocity: Ground) {
    this.velocity = velocity;
  }
}
