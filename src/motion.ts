/** Where the viewer's eyes are on the floor plan, and which way they face. */
export interface Viewpoint {
  /** Metres east of the room's centre. */
  x: number;
  /** Metres south of the room's centre. */
  z: number;
  /** Radians clockwise from north, seen from above. */
  heading: number;
}

/** Joystick deflection, each axis in [-1, 1]. */
export interface Stick {
  /** Positive is pushed right. */
  x: number;
  /** Positive is pushed forward. */
  y: number;
}

/** The floor area the viewpoint may occupy, centred on the origin. */
export interface Limits {
  halfWidth: number;
  halfDepth: number;
}

/** Metres per second at full stick. */
export const WALK_SPEED = 1.4;
/** Radians per second at full stick: a quarter turn. */
export const TURN_SPEED = Math.PI / 2;

const clamp = (value: number, limit: number) =>
  Math.max(-limit, Math.min(limit, value));

/**
 * Move the viewpoint for one frame. Sideways stick turns on the spot and
 * never sidesteps; forward and back walk along the current heading.
 */
export function advance(
  from: Viewpoint,
  stick: Stick,
  seconds: number,
  limits: Limits,
): Viewpoint {
  const heading = from.heading + stick.x * TURN_SPEED * seconds;
  const distance = stick.y * WALK_SPEED * seconds;
  return {
    heading,
    x: clamp(from.x + Math.sin(heading) * distance, limits.halfWidth),
    z: clamp(from.z - Math.cos(heading) * distance, limits.halfDepth),
  };
}
