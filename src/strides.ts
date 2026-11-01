import { fixed, number, percent, type Described } from "./settings";

/** What can be changed about strides and head bob while walking, in the ?config panel. */
export interface StridesSettings {
  /** Metres from one footfall to the next at the very slowest. */
  slowest: number;
  /** Metres from one footfall to the next at walking pace. */
  walking: number;
  /** Metres from one footfall to the next at a full run. */
  running: number;
  /** Metres the eyes rise and fall either side of rest at walking pace. */
  bobWalking: number;
  /** Metres the eyes rise and fall either side of rest at a full run. */
  bobRunning: number;
  /** How far the eyes sway sideways, as a share of how far they rise and fall. */
  sway: number;
}

export const STRIDES: StridesSettings = {
  slowest: 0.25,
  walking: 0.75,
  running: 1.2,
  bobWalking: 0.01,
  bobRunning: 0.02,
  sway: 1,
};

const metres = fixed(2, " m");
const centimetres = (value: number) => `± ${(value * 100).toFixed(1)} cm`;

export const STRIDES_DESCRIBED: Described<StridesSettings> = {
  slowest: number({
    label: "Stride, slowest",
    min: 0.05,
    max: 1,
    step: 0.05,
    show: metres,
    about: "How far apart footfalls are at the slowest push; it grows to the walking stride at walking pace.",
  }),
  walking: number({
    label: "Stride, walking",
    min: 0.3,
    max: 2,
    step: 0.05,
    show: metres,
    about: "How far the viewer walks from one footfall to the next.",
  }),
  running: number({
    label: "Stride, running",
    min: 0.3,
    max: 3,
    step: 0.05,
    show: metres,
    about: "How far the viewer runs from one footfall to the next at full speed; between walking and running it is in between.",
  }),
  bobWalking: number({
    label: "Head bob, walking",
    min: 0,
    max: 0.06,
    step: 0.001,
    show: centimetres,
    about: "How far the eyes rise and fall with each stride at walking pace. Too much makes some people ill.",
  }),
  bobRunning: number({
    label: "Head bob, running",
    min: 0,
    max: 0.06,
    step: 0.001,
    show: centimetres,
    about: "How far the eyes rise and fall with each stride at a full run.",
  }),
  sway: number({
    label: "Head bob, sideways",
    min: 0,
    max: 2,
    step: 0.05,
    show: percent,
    about: "How far the eyes sway to each side, as a share of the rise and fall: towards one foot, then the other.",
  }),
};

/** Seconds of standing still after which the next stride starts afresh. */
const RESTING = 0.15;
/** How quickly the size of the bob follows the viewer's speed, per second. */
const SETTLING = 20;
/** Metres of bob below which the eyes are at rest. */
const AT_REST = 1e-4;

/**
 * Strides: where the viewer is between one footfall and the next, which both
 * the footsteps and the head bob go by, so a step is heard as the eyes reach
 * their lowest. One footfall per stride walked across the floor, a stride that
 * grows with how fast the viewer goes, and one on landing from a fall. A viewer
 * setting off steps within half a stride. Standing, turning, falling and riding
 * make no footfalls.
 */
export class Strides {
  /** The share of a stride walked since the last footfall. */
  private share = 0.5;
  /** Which foot is down, 0 or 1. */
  private foot = 0;
  /** Seconds since the viewer last walked. */
  private resting = 0;
  /** Metres the eyes bob either side of rest, following the viewer's speed. */
  private size = 0;

  constructor(private readonly settings: StridesSettings) {}

  /**
   * One frame: metres walked across the floor in `seconds`, the speeds of a
   * walk and of a full run, whether a fall ended, and whether the eyes are to
   * stay still. Whether a footfall falls.
   */
  step(walked: number, seconds: number, speeds: { walking: number; running: number }, landed: boolean, still = false): boolean {
    const speed = seconds > 0 ? walked / seconds : 0;
    const wanted = still ? 0 : this.bobAt(speed, speeds);
    this.size += (wanted - this.size) * (1 - Math.exp(-SETTLING * seconds));
    if (this.size < AT_REST && wanted === 0) this.size = 0;

    if (landed) {
      this.share = 0;
      this.foot = 1 - this.foot;
      this.resting = 0;
      return true;
    }
    if (walked === 0) {
      this.resting += seconds;
      return false;
    }
    if (this.resting >= RESTING) this.share = Math.max(this.share, 0.5);
    this.resting = 0;
    this.share += walked / this.lengthAt(speed, speeds);
    if (this.share < 1) return false;
    this.share = Math.min(this.share - 1, 1);
    this.foot = 1 - this.foot;
    return true;
  }

  /** Metres the eyes are off their rest for now: up, and to the viewer's right. */
  get bob(): { up: number; right: number } {
    return {
      // Lowest as a foot falls, highest halfway to the next.
      up: -this.size * Math.cos(Math.PI * 2 * this.share),
      // Over one foot, then the other: a whole sway takes two strides.
      right: this.size * this.settings.sway * Math.sin(Math.PI * (this.share + this.foot)),
    };
  }

  /** Whether the eyes have come to rest. */
  get settled(): boolean {
    return this.size === 0;
  }

  private lengthAt(speed: number, { walking, running }: { walking: number; running: number }) {
    const settings = this.settings;
    if (speed <= walking) return settings.slowest + (settings.walking - settings.slowest) * (speed / walking);
    return settings.walking + (settings.running - settings.walking) * towardsRun(speed, walking, running);
  }

  private bobAt(speed: number, { walking, running }: { walking: number; running: number }) {
    const { bobWalking, bobRunning } = this.settings;
    if (speed <= walking) return bobWalking * (speed / walking);
    return bobWalking + (bobRunning - bobWalking) * towardsRun(speed, walking, running);
  }
}

/** How far a speed lies from a walk to a full run, from 0 to 1. */
function towardsRun(speed: number, walking: number, running: number) {
  return Math.max(0, Math.min(1, (speed - walking) / Math.max(running - walking, 0.01)));
}
