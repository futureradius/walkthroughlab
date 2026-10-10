/** A spot on the floor plan and the height of the floor there. */
export interface Footing {
  /** Metres east of the origin. */
  x: number;
  /** Metres south of the origin. */
  z: number;
  /** Metres the floor under the viewer lies above the origin. */
  floor: number;
}

/** Where the viewer stands, and which way they face. */
export interface Viewpoint extends Footing {
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

/**
 * Decides where a step from one footing towards a spot on the floor plan
 * actually ends: short of walls, and on whatever floor is there.
 */
export type Terrain = (from: Footing, x: number, z: number) => Footing;

/** The floor area the viewpoint may occupy, centred on the origin. */
export interface Limits {
  halfWidth: number;
  halfDepth: number;
}

/** Metres per second at full stick. */
export const WALK_SPEED = 1.4;
/** Radians per second at full stick while standing still: a third of a turn. */
export const STANDING_TURN_SPEED = (Math.PI * 2) / 3;
/** Radians per second at full stick while walking at full speed: a quarter turn. */
export const WALKING_TURN_SPEED = Math.PI / 2;

const clamp = (value: number, limit: number) =>
  Math.max(-limit, Math.min(limit, value));

/** A flat floor at height zero, walled in by a rectangle. */
export function withinLimits(limits: Limits): Terrain {
  return (_from, x, z) => ({
    x: clamp(x, limits.halfWidth),
    z: clamp(z, limits.halfDepth),
    floor: 0,
  });
}

/**
 * Move the viewpoint for one frame. Sideways stick turns on the spot and
 * never sidesteps; forward and back walk along the current heading. Turning
 * is quickest standing still and eases off the faster the viewer walks, so
 * curves stay gentle.
 */
export function advance(
  from: Viewpoint,
  stick: Stick,
  seconds: number,
  terrain: Terrain,
): Viewpoint {
  const turnSpeed =
    STANDING_TURN_SPEED +
    (WALKING_TURN_SPEED - STANDING_TURN_SPEED) * Math.abs(stick.y);
  const heading = from.heading + stick.x * turnSpeed * seconds;
  const distance = stick.y * WALK_SPEED * seconds;
  const footing = terrain(
    from,
    from.x + Math.sin(heading) * distance,
    from.z - Math.cos(heading) * distance,
  );
  return { heading, x: footing.x, z: footing.z, floor: footing.floor };
}
