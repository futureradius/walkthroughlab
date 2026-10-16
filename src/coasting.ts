/** What can be changed about coasting while it runs; see tuning.ts. */
export interface CoastingSettings {
  /** Whether a thrown view carries on at all. */
  on: boolean;
  /** The brake that is always on and gives the soft tail, per second. */
  glide: number;
  /** The brake that grows with speed and tames a fierce throw, per radian. */
  grip: number;
  /** Whether the device asks for reduced motion, which swaps in the two below. */
  reduced: boolean;
  reducedGlide: number;
  reducedGrip: number;
}

/**
 * The usual brakes, tuned by hand on a phone. An ordinary throw carries
 * about a fifth of a turn and the hardest over half of one, at rest in about
 * a second and a half. With reduced motion the view settles within a few
 * degrees and a third of a second.
 */
export const COASTING: CoastingSettings = {
  on: true,
  glide: 3.5,
  grip: 0.1,
  reduced: false,
  reducedGlide: 14,
  reducedGrip: 3.5,
};

/** The brake that is always on, per second, as reduced motion picks it. */
export function glideOf(settings: CoastingSettings): number {
  return settings.reduced ? settings.reducedGlide : settings.glide;
}

/** How long before letting go a drag still counts towards the throw, in milliseconds. */
export const THROW_WINDOW = 100;
/** Slowest release that throws the view, in radians per second. */
export const SLOWEST_THROW = 0.3;
/** Speed below which a coasting view is at rest, in radians per second. */
const REST = 0.03;

/** Where a drag was at a moment, in pixels and milliseconds. */
export interface Sample {
  at: number;
  x: number;
  y: number;
}

/**
 * How fast a drag was going when it was let go, in pixels per second, from
 * where it had been over the last moment. A finger that came to rest before
 * lifting was going nowhere.
 */
export function releaseSpeed(samples: Sample[], releasedAt: number) {
  const recent = samples.filter((sample) => releasedAt - sample.at <= THROW_WINDOW);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (!first || releasedAt <= first.at) return { x: 0, y: 0 };
  const seconds = (releasedAt - first.at) / 1000;
  return { x: (last.x - first.x) / seconds, y: (last.y - first.y) / seconds };
}

/**
 * Coasting: the view carrying on the way it was thrown, braked harder the
 * faster it turns, until it rests or is caught.
 */
export class Coasting {
  private speed = 0;
  private right = 0;
  private up = 0;

  constructor(readonly settings: CoastingSettings = { ...COASTING }) {}

  /** Whether the view is still carrying on. */
  get moving(): boolean {
    return this.speed > 0 && this.settings.on;
  }

  /** Let go of the view while it turns at these radians per second. */
  throw(right: number, up: number) {
    const speed = Math.hypot(right, up);
    if (!this.settings.on || speed < SLOWEST_THROW) return;
    this.speed = speed;
    this.right = right / speed;
    this.up = up / speed;
  }

  /** Stop the view where it is. */
  catch() {
    this.speed = 0;
  }

  /** How far the view carried on over this long, in radians. */
  step(seconds: number) {
    if (this.speed === 0 || !this.settings.on) {
      this.speed = 0;
      return { right: 0, up: 0 };
    }
    const glide = glideOf(this.settings);
    const grip = this.settings.reduced ? this.settings.reducedGrip : this.settings.grip;

    // Slowing by glide × speed + grip × speed², worked out exactly so the
    // view ends up in the same place whatever the frame rate.
    const shed = 1 - Math.exp(-glide * seconds);
    const bite = 1 + (grip * this.speed * shed) / glide;
    const turned = grip > 0 ? Math.log(bite) / grip : (this.speed * shed) / glide;
    this.speed = (this.speed * (1 - shed)) / bite;
    if (this.speed < REST) this.speed = 0;
    return { right: this.right * turned, up: this.up * turned };
  }
}
