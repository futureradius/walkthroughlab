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
}

export const IDLE: Intent = {
  walk: 0,
  sidestep: 0,
  turn: 0,
  lookRight: 0,
  lookUp: 0,
  looking: false,
};

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
/** Farthest the view tilts up or down: just short of straight up. */
export const MAX_PITCH = (85 * Math.PI) / 180;
/** How quickly the view returns to level once the viewer sets off, per second. */
export const LEVELLING_RATE = 4;

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
  const pace = Math.hypot(walk, sidestep);

  const turnSpeed =
    STANDING_TURN_SPEED + (WALKING_TURN_SPEED - STANDING_TURN_SPEED) * pace;
  const heading =
    from.heading + intent.turn * turnSpeed * seconds + intent.lookRight;
  let pitch = clamp(from.pitch + intent.lookUp, MAX_PITCH);
  if (pace > 0 && !intent.looking) {
    pitch *= Math.exp(-LEVELLING_RATE * seconds);
  }

  const forward = walk * WALK_SPEED * seconds;
  const right = sidestep * WALK_SPEED * seconds;
  const footing = terrain(
    from,
    from.x + Math.sin(heading) * forward + Math.cos(heading) * right,
    from.z - Math.cos(heading) * forward + Math.sin(heading) * right,
  );
  return { heading, pitch, x: footing.x, z: footing.z, floor: footing.floor };
}
