import { WALKING, type WalkingSettings } from "./motion";
import type { Stick } from "./steering";

/** What can be changed about running while walking; see tuning.ts. */
export interface RunningSettings {
  /** Metres per second at full push forward while running. */
  speed: number;
  /** Share of the joystick's reach each push must go past. */
  push: number;
  /** Share of the joystick's reach the dip must come back inside. */
  dip: number;
  /** Seconds the first push has to come back, and the dip to push out again. */
  time: number;
  /** Seconds the pace takes to pick up from walking to running, or drop back. */
  ease: number;
}

/**
 * The usual settings: a brisk run at two and a half times walking pace,
 * started by a push and a dip quick enough that nobody does them by chance.
 */
export const RUNNING: RunningSettings = {
  speed: 3.5,
  push: 0.8,
  dip: 0.5,
  time: 0.4,
  ease: 0.3,
};

/** Where the joystick is this frame. */
export interface JoystickState {
  /** Where the knob sits, as a share of its reach. */
  knob: Stick;
  /** How hard it pushes, after its dead zone. */
  stick: Stick;
}

/**
 * Running: on the joystick, a push forward, a dip back towards the middle and
 * a second push forward, each quick, start it; it lasts until the push
 * forward slows to walking pace. On a keyboard it lasts while Shift is held.
 * A push counts when it goes more forward than sideways, and letting go of
 * the joystick counts as a dip.
 */
export class Running {
  private seconds = 0;
  private running = false;
  /** How far the pace has picked up from walking to running, from 0 to 1. */
  private level = 0;
  private outside = false;
  private leftAt = -Infinity;
  private pushed = false;
  private dippedAt = -Infinity;

  constructor(
    readonly settings: RunningSettings = { ...RUNNING },
    private readonly walking: WalkingSettings = WALKING,
  ) {}

  /**
   * Follow the joystick, and whether Shift is held while a key walks forward,
   * for one frame. Returns the metres per second a full push forward moves
   * the viewer.
   */
  step(joystick: JoystickState, shift: boolean, seconds: number): number {
    const { speed, push, dip, time, ease } = this.settings;
    this.seconds += seconds;
    const { knob, stick } = joystick;
    const reach = Math.hypot(knob.x, knob.y);

    if (reach >= dip) {
      if (!this.outside) {
        this.outside = true;
        this.leftAt = this.seconds;
        this.pushed = false;
      }
      if (!this.pushed && reach >= push && knob.y > Math.abs(knob.x)) {
        this.pushed = true;
        if (this.seconds - this.dippedAt <= time) {
          this.running = true;
          this.dippedAt = -Infinity;
        }
      }
    } else if (this.outside) {
      // Back inside: a dip, if the push before it was a quick one forward.
      this.outside = false;
      const quick = this.pushed && this.seconds - this.leftAt <= time;
      this.dippedAt = quick ? this.seconds : -Infinity;
    }

    const walkSpeed = this.walking.speed;
    if (this.running && stick.y * speed < walkSpeed) this.running = false;

    const target = this.running || shift ? 1 : 0;
    const change = ease > 0 ? seconds / ease : 1;
    this.level += Math.max(-change, Math.min(change, target - this.level));
    return walkSpeed + (speed - walkSpeed) * this.level;
  }
}
