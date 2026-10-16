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
  /** Radians the view is tilted up from level; negative looks down. */
  pitch: number;
}

/** What the viewer is asking for this frame, from every input combined. */
export interface Intent {
  /** Walking forward, in [-1, 1]; negative is backward. */
  walk: number;
  /** Sidestepping to the right, in [-1, 1]. */
  sidestep: number;
  /** Turning to the right, in [-1, 1]. */
  turn: number;
  /** Radians free look turned the view to the right since the last frame. */
  lookRight: number;
  /** Radians free look tilted the view up since the last frame. */
  lookUp: number;
  /** Whether a free look drag is being held. */
  looking: boolean;
  /** Metres per second at full push forward: walking pace, or more while running. */
  forwardSpeed: number;
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

/** Metres per second at full stick, unless running forward. */
export const WALK_SPEED = 1.4;
/** Radians per second at full stick while standing still: a third of a turn. */
export const STANDING_TURN_SPEED = (Math.PI * 2) / 3;
/**
 * Radians per second at full stick while walking at full speed: a quarter
 * turn. Running forward eases it off further by the same rule.
 */
export const WALKING_TURN_SPEED = Math.PI / 2;
/** Farthest the view tilts up or down: just short of straight up. */
export const MAX_PITCH = (85 * Math.PI) / 180;
/** How quickly the view returns to level once the viewer sets off, per second. */
export const LEVELLING_RATE = 4;

export const IDLE: Intent = {
  walk: 0,
  sidestep: 0,
  turn: 0,
  lookRight: 0,
  lookUp: 0,
  looking: false,
  forwardSpeed: WALK_SPEED,
};

const clamp = (value: number, limit: number) =>
  Math.max(-limit, Math.min(limit, value));

/**
 * The share of its tilt the view keeps this frame: all of it unless the
 * viewer moves without holding a free look drag. Zoom wears off by the same
 * share.
 */
export function levelling(intent: Intent, seconds: number): number {
  const moving = intent.walk !== 0 || intent.sidestep !== 0;
  return moving && !intent.looking ? Math.exp(-LEVELLING_RATE * seconds) : 1;
}

/** A flat floor at height zero, walled in by a rectangle. */
export function withinLimits(limits: Limits): Terrain {
  return (_from, x, z) => ({
    x: clamp(x, limits.halfWidth),
    z: clamp(z, limits.halfDepth),
    floor: 0,
  });
}

/**
 * Move the viewpoint for one frame. Turning is quickest standing still and
 * eases off the faster the viewer moves, so curves stay gentle. The view
 * returns to level while the viewer moves, unless they are holding a free
 * look drag.
 */
export function advance(
  from: Viewpoint,
  intent: Intent,
  seconds: number,
  terrain: Terrain,
): Viewpoint {
  // A diagonal push is no faster than a straight one.
  const push = Math.max(1, Math.hypot(intent.walk, intent.sidestep));
  const walk = intent.walk / push;
  const sidestep = intent.sidestep / push;
  // Only forward is any faster for running.
  const forwardSpeed = walk > 0 ? intent.forwardSpeed : WALK_SPEED;
  const pace = Math.hypot(walk * forwardSpeed, sidestep * WALK_SPEED) / WALK_SPEED;

  const turnSpeed = Math.max(
    0,
    STANDING_TURN_SPEED + (WALKING_TURN_SPEED - STANDING_TURN_SPEED) * pace,
  );
  const heading =
    from.heading + intent.turn * turnSpeed * seconds + intent.lookRight;
  const pitch = clamp(from.pitch + intent.lookUp, MAX_PITCH) * levelling(intent, seconds);

  const forward = walk * forwardSpeed * seconds;
  const right = sidestep * WALK_SPEED * seconds;
  const footing = terrain(
    from,
    from.x + Math.sin(heading) * forward + Math.cos(heading) * right,
    from.z - Math.cos(heading) * forward + Math.sin(heading) * right,
  );
  return { heading, pitch, x: footing.x, z: footing.z, floor: footing.floor };
}
