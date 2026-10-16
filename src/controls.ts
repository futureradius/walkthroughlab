import { COASTING, glideOf, type CoastingSettings } from "./coasting";
import { IDLE, type Intent } from "./motion";

/** Joystick deflection, each axis in [-1, 1]. */
export interface Stick {
  /** Positive is pushed right. */
  x: number;
  /** Positive is pushed forward. */
  y: number;
}

/** Which movement keys are held, each axis as -1, 0 or 1. */
export interface Keys {
  /** W and S, or the up and down arrows: positive is forward. */
  walk: number;
  /** A and D: positive is to the right. */
  sidestep: number;
  /** The left and right arrows: positive is to the right. */
  turn: number;
}

/** How far free look turned the view since it was last read. */
export interface Look {
  /** Whether a drag is being held. */
  held: boolean;
  /** Radians per second the view coasts at after a drag; zero once it rests. */
  coasting: number;
  /** Radians the view turned to the right. */
  right: number;
  /** Radians the view tilted up. */
  up: number;
}

const unit = (value: number) => Math.max(-1, Math.min(1, value));

/** Share of a sideways push below which the joystick has eased back to turning. */
const TURNING = 0.01;

/**
 * Combines the joystick, the keyboard and free look into what the viewer is
 * asking for. On its own a sideways joystick turns; during free look and
 * while the view coasts after it, it sidesteps instead, as with two thumbs in
 * a phone game. Zoomed in, the joystick and the keys turn the view more
 * slowly, by as much as it is zoomed in, so the scene crosses the screen no
 * faster than without zoom.
 */
export class Controls {
  /** The share of a sideways push that sidesteps; the rest turns. */
  private sidestepping = 0;

  constructor(private readonly coasting: CoastingSettings = { ...COASTING }) {}

  /** What the viewer asks for this frame, `seconds` after the last. */
  read(stick: Stick, keys: Keys, look: Look, seconds: number, zoom = 1): Intent {
    // As the view slows to rest, a joystick still pushed sideways eases from
    // sidestepping to turning, so a viewer who keeps hold of it is never
    // stuck sidestepping, nor flung into a spin. Below the handover speed the
    // share follows the coast down, and it fades no faster than coasting
    // glides, also after the view rests or when no throw came at all. Let go,
    // the joystick turns at once, or follows a coast still under way.
    const coast = Math.min(1, (look.coasting * zoom) / this.coasting.handover);
    if (look.held) this.sidestepping = 1;
    else if (stick.x === 0 && stick.y === 0) this.sidestepping = coast;
    else {
      const faded = this.sidestepping * Math.exp(-glideOf(this.coasting) * seconds);
      this.sidestepping = Math.max(coast, faded);
    }
    if (this.sidestepping < TURNING) this.sidestepping = 0;

    return {
      ...IDLE,
      walk: unit(stick.y + keys.walk),
      sidestep: unit(stick.x * this.sidestepping + keys.sidestep),
      turn: unit(stick.x * (1 - this.sidestepping) + keys.turn) / zoom,
      lookRight: look.right,
      lookUp: look.up,
      looking: look.held,
    };
  }
}
