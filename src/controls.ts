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
  /** Radians the view turned to the right. */
  right: number;
  /** Radians the view tilted up. */
  up: number;
}

const unit = (value: number) => Math.max(-1, Math.min(1, value));

/**
 * Combines the joystick, the keyboard and free look into what the viewer is
 * asking for. On its own a sideways joystick turns; during free look it
 * sidesteps instead, as with two thumbs in a phone game.
 */
export class Controls {
  private sidestepping = false;

  read(stick: Stick, keys: Keys, look: Look): Intent {
    // Sidestepping starts with a look drag but outlasts it until the joystick
    // is let go, so lifting the look thumb never turns a sidestep into a spin.
    if (look.held) this.sidestepping = true;
    else if (stick.x === 0 && stick.y === 0) this.sidestepping = false;

    return {
      ...IDLE,
      walk: unit(stick.y + keys.walk),
      sidestep: unit((this.sidestepping ? stick.x : 0) + keys.sidestep),
      turn: unit((this.sidestepping ? 0 : stick.x) + keys.turn),
      lookRight: look.right,
      lookUp: look.up,
      looking: look.held,
    };
  }
}
