import { toggle, type Described } from "./settings";

/** The frame rates and times the safety net works by (#15, #24). */
export const NET = {
  /** Below this many frames a second a second counts as slow: 30 less a margin for phones held at 30. */
  floor: 28,
  /** At this many or more a second counts as steady. */
  steady: 50,
  /** Slow seconds in a row before a step down. */
  slowSeconds: 2,
  /** Steady seconds in a row before a step back up. */
  steadySeconds: 5,
  /** A slow second this soon after a step back up undoes it, for good. */
  relapseSeconds: 10,
};

/** What the viewer's device is asked to draw at one step of the net. */
export interface Level {
  occlusion: boolean;
  pixelRatio: number;
}

/** Resolutions the net steps down through, in rendered pixels per screen pixel. */
const LOWER_RATIOS = [1.5, 1];

export interface NetSettings {
  on: boolean;
}

export const NET_DESCRIBED: Described<NetSettings> = {
  on: toggle({
    label: "On",
    about:
      "Turns ambient occlusion off, then lowers the resolution, while the frame rate stays under 28, and gives them back once it holds 50. Off to measure what something costs.",
  }),
};

/**
 * Keeps the frame rate of a struggling device above 30 by giving up ambient
 * occlusion first, then resolution, and giving them back when it can. It is
 * told each second's frame rate, and never tells the viewer anything.
 */
export class SafetyNet {
  readonly settings: NetSettings = { on: true };
  /** From the full picture, at 0, down to the cheapest. */
  readonly levels: Level[];

  private level = 0;
  private slow = 0;
  private steady = 0;
  /** When the last step back up was taken, and from which level. */
  private lastUp?: { at: number; from: number };
  /** Levels a step back up failed to hold, never tried again this visit. */
  private readonly given = new Set<number>();

  /** `pixelRatio` is what the device draws at in full; `occlusion` whether it has ambient occlusion. */
  constructor(pixelRatio: number, occlusion: boolean) {
    this.levels = [{ occlusion, pixelRatio }];
    if (occlusion) this.levels.push({ occlusion: false, pixelRatio });
    for (const ratio of LOWER_RATIOS) {
      if (ratio < pixelRatio) this.levels.push({ occlusion: false, pixelRatio: ratio });
    }
  }

  /** What to draw now. */
  get current(): Level {
    return this.levels[this.settings.on ? this.level : 0];
  }

  /** What the net has given up, for ?fps, such as ` · no AO · 1.5×`; nothing while it hasn't. */
  describe(): string {
    const full = this.levels[0];
    const now = this.current;
    let given = "";
    if (full.occlusion && !now.occlusion) given += " · no AO";
    if (now.pixelRatio < full.pixelRatio) given += ` · ${now.pixelRatio}×`;
    return given;
  }

  /**
   * Hear one second's frame rate, at `now` in seconds. A second that should
   * not count, such as one in which something arrived, is not passed in.
   * Returns whether the level changed.
   */
  second(rate: number, now: number): boolean {
    if (!this.settings.on) {
      this.level = 0;
      this.slow = this.steady = 0;
      return false;
    }
    if (rate < NET.floor) {
      this.steady = 0;
      // A step back up that does not hold is undone at once, and not tried again.
      if (this.lastUp && now - this.lastUp.at <= NET.relapseSeconds) {
        this.given.add(this.level);
        this.level = this.lastUp.from;
        this.lastUp = undefined;
        this.slow = 0;
        return true;
      }
      if (++this.slow >= NET.slowSeconds && this.level < this.levels.length - 1) {
        this.level++;
        this.slow = 0;
        return true;
      }
      return false;
    }
    this.slow = 0;
    if (rate >= NET.steady && this.level > 0 && !this.given.has(this.level - 1)) {
      if (++this.steady >= NET.steadySeconds) {
        this.lastUp = { at: now, from: this.level };
        this.level--;
        this.steady = 0;
        return true;
      }
    } else {
      this.steady = 0;
    }
    return false;
  }
}
