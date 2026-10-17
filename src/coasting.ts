import { fixed, number, toggle, type Described } from "./settings";

/** What can be changed about coasting while it runs, in the ?config panel. */
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

const perSecond = fixed(1, " /s");
const perRadian = fixed(2);

export const COASTING_DESCRIBED: Described<CoastingSettings> = {
  on: toggle({ label: "On", about: "Whether a thrown view carries on turning at all." }),
  glide: number({
    label: "Glide",
    min: 0.5,
    max: 10,
    step: 0.1,
    show: perSecond,
    about: "The brake that is always on and gives the soft tail; more stops sooner.",
  }),
  grip: number({
    label: "Grip",
    min: 0,
    max: 2,
    step: 0.01,
    show: perRadian,
    about: "The brake that grows with speed and tames a fierce throw.",
  }),
  reduced: toggle({
    label: "As with reduced motion",
    about: "Brake as for a device that asks for reduced motion, with the two below.",
  }),
  reducedGlide: number({
    label: "Glide (reduced)",
    min: 2,
    max: 40,
    step: 0.5,
    show: perSecond,
    about: "Glide with reduced motion.",
  }),
  reducedGrip: number({
    label: "Grip (reduced)",
    min: 0,
    max: 10,
    step: 0.1,
    show: perRadian,
    about: "Grip with reduced motion.",
  }),
};

/** The brake that is always on, per second, as reduced motion picks it. */
export function glideOf(settings: CoastingSettings): number {
  return settings.reduced ? settings.reducedGlide : settings.glide;
}

/** Slowest release that throws the view, in radians per second. */
export const SLOWEST_THROW = 0.3;
/** Speed below which a coasting view is at rest, in radians per second. */
const REST = 0.03;

/**
 * Coasting: the view carrying on the way it was thrown, braked harder the
 * faster it turns, until it rests or is caught.
 */
export class Coasting {
  private speed = 0;
  private right = 0;
  private up = 0;

  constructor(readonly settings: CoastingSettings = { ...COASTING }) {}

  /** Radians per second the view carries on at; zero once it rests. */
  get turning(): number {
    return this.settings.on ? this.speed : 0;
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
