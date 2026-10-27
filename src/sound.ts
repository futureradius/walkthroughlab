import { Vector3 } from "three";
import type { Downloads } from "./download";
import type { Point } from "./marks";
import { fixed, number, toggle, type Described } from "./settings";

// Everything the viewer hears (#13, #33): one ambient sound, footsteps,
// placed sounds, and the sounds of doors and elevators. Sound begins on the
// viewer's first touch and pauses while the page is off screen, fading both
// ways. Each sound is heard once its file has arrived, last in the trailing
// download.

/** A sound file `npm run optimize` lists in the environment, by its address under the page; a loop says how long it is. */
export interface SoundFile {
  file: string;
  /** Seconds the loop lasts, from OVERLAP into the file; see scripts/sound-files.mjs. */
  loop?: number;
}

/** Every sound the environment plays, by name: `ambient`, `footstep-1`, `door-hinged-open`, `hum`… */
export type SoundList = Record<string, SoundFile>;

/** A placed sound mark, such as `sound-hum`: what it plays and the middle of each object on its layer. */
export interface PlacedSound {
  name: string;
  spots: Point[];
}

/** Seconds of copied sound at each end of a loop's file: OVERLAP in scripts/sound-files.mjs. */
const OVERLAP = 0.1;
/** Seconds sound takes to fade in, as it starts or comes back, and to fade out (#35). */
const FADE_IN = 0.5;
const FADE_OUT = 0.2;
/** Within this many metres a sound is heard at full strength. */
const NEAR = 1;
/** The quietest loudness, in decibels, which is silence. */
const SILENT = -60;
/** How quickly a sound's loudness follows a change, in seconds, so nothing clicks. */
const FOLLOW = 0.05;

/**
 * Whether there is sound at all, and the ambient sound. Off, it is neither
 * played nor downloaded: for walks where sound would distract, such as
 * surveys in public places, and for testing.
 */
export interface SoundSettings {
  on: boolean;
  ambient: boolean;
}

export const SOUND: SoundSettings = { on: true, ambient: true };

export const SOUND_DESCRIBED: Described<SoundSettings> = {
  on: toggle({
    label: "On",
    about: "Whether there is any sound. Off, no sound is downloaded or played.",
  }),
  ambient: toggle({
    label: "Ambient sound",
    about: "Whether the ambient sound plays. Off, it is not downloaded; everything else still sounds.",
  }),
};

/**
 * The share of a sound's own level that a loudness in decibels plays it at:
 * 0 dB as it was levelled, -6 dB half the level, -20 dB a tenth. Ears hear
 * level in ratios, so steps of a decibel sound alike all the way down, where
 * steps of a share crowd together at the quiet end; -10 dB sounds about half
 * as loud. The quietest setting is silence.
 */
export function gainOf(decibels: number): number {
  return decibels <= SILENT ? 0 : 10 ** (decibels / 20);
}

/** A loudness setting: in decibels, from silent to a little above the sound's own level. */
const loudness = (about: string) =>
  number({
    label: "Loudness",
    min: SILENT,
    max: 6,
    step: 1,
    show: (value) => (value <= SILENT ? "silent" : `${value > 0 ? "+" : ""}${value} dB`),
    about: `${about} In decibels: 0 is the sound as it was levelled, -10 sounds about half as loud.`,
  });

/** How loud a sound heard from somewhere is, and how far it carries (#33). */
export interface HeardSettings {
  /** Decibels; see gainOf. */
  loudness: number;
  /** Metres up to which it fades as sound really does, halving with each doubling of distance. */
  realistic: number;
  /** Metres at which it has faded in a straight line from there to silence. */
  silent: number;
}

export const HEARD: HeardSettings = { loudness: 0, realistic: 20, silent: 25 };

const metres = fixed(0, " m");

export const HEARD_DESCRIBED: Described<HeardSettings> = {
  loudness: loudness("How loud it is from up to a metre away."),
  realistic: number({
    label: "Fades as real sound up to",
    min: 1,
    max: 100,
    step: 1,
    show: metres,
    about: "Up to here it fades as sound really does, halving with each doubling of distance.",
  }),
  silent: number({
    label: "Silent at",
    min: 1,
    max: 120,
    step: 1,
    show: metres,
    about: "From the distance above it fades in a straight line to silence here, and beyond it is not played.",
  }),
};

/** How loud a sound heard from `distance` metres is, as a share of its loudness (#33). */
export function heard(distance: number, { realistic, silent }: Pick<HeardSettings, "realistic" | "silent">): number {
  const away = Math.max(distance, NEAR);
  const bend = Math.max(realistic, NEAR);
  if (away >= silent) return 0;
  if (away <= bend) return NEAR / away;
  return ((NEAR / bend) * (silent - away)) / (silent - bend);
}

/** The ambient sound, heard everywhere at once. */
export interface AmbientSettings {
  loudness: number;
}

export const AMBIENT: AmbientSettings = { loudness: -24 };

export const AMBIENT_DESCRIBED: Described<AmbientSettings> = {
  loudness: loudness("How loud the ambient sound is, everywhere."),
};

/** Footsteps: one per stride, walking or running. */
export interface FootstepSettings {
  loudness: number;
  /** Metres from one footstep to the next while walking. */
  walking: number;
  /** Metres from one footstep to the next at a full run. */
  running: number;
}

export const FOOTSTEPS: FootstepSettings = { loudness: -20, walking: 0.75, running: 1.2 };

const stride = fixed(2, " m");

export const FOOTSTEPS_DESCRIBED: Described<FootstepSettings> = {
  loudness: loudness("How loud each footstep is."),
  walking: number({
    label: "Stride, walking",
    min: 0.3,
    max: 2,
    step: 0.05,
    show: stride,
    about: "How far the viewer walks from one footstep to the next.",
  }),
  running: number({
    label: "Stride, running",
    min: 0.3,
    max: 3,
    step: 0.05,
    show: stride,
    about: "How far the viewer runs from one footstep to the next at full speed; between walking and running it is in between.",
  }),
};

/** All placed sounds together. */
export interface PlacedSettings {
  /** How many of the nearest placed sounds play at once. */
  atOnce: number;
}

export const PLACED: PlacedSettings = { atOnce: 4 };

export const PLACED_DESCRIBED: Described<PlacedSettings> = {
  atOnce: number({
    label: "Playing at once",
    min: 1,
    max: 16,
    step: 1,
    show: (value) => `${value}`,
    about: "How many placed sounds play at once: the nearest, within their silent distance.",
  }),
};

/** The nearest `count` spots within their silent distance of `from`, by their place in `spots`. */
export function nearest(spots: { at: Vector3; silent: number }[], from: Vector3, count: number): Set<number> {
  return new Set(
    spots
      .map(({ at, silent }, index) => ({ index, away: at.distanceTo(from), silent }))
      .filter(({ away, silent }) => away < silent)
      .sort((a, b) => a.away - b.away)
      .slice(0, count)
      .map(({ index }) => index),
  );
}

/**
 * When footsteps fall: one per stride walked across the floor, a stride
 * between the walking and the running one by how fast the viewer goes, and
 * one on landing from a fall. A viewer setting off steps within half a
 * stride. Standing, turning, falling and riding make no steps.
 */
export class Strides {
  /** Metres walked since the last footstep. */
  private since: number;

  constructor(private readonly settings: FootstepSettings) {
    this.since = settings.walking / 2;
  }

  /**
   * One frame: metres walked across the floor in `seconds`, the speeds of a
   * walk and of a full run, and whether a fall ended. Whether a footstep falls.
   */
  step(walked: number, seconds: number, speeds: { walking: number; running: number }, landed: boolean): boolean {
    if (landed) {
      this.since = 0;
      return true;
    }
    const { walking, running } = this.settings;
    const speed = seconds > 0 ? walked / seconds : 0;
    const share = Math.max(0, Math.min(1, (speed - speeds.walking) / Math.max(speeds.running - speeds.walking, 0.01)));
    const length = walking + (running - walking) * share;
    if (walked === 0) {
      this.since = Math.max(this.since, length / 2);
      return false;
    }
    this.since += walked;
    if (this.since < length) return false;
    this.since = Math.min(this.since - length, length);
    return true;
  }
}

/** A sound being played: its source, its fade and its loudness, and where it is heard from. */
interface Playing {
  source: AudioBufferSourceNode;
  fade: GainNode;
  level: GainNode;
  panner: PannerNode | null;
}

/** What the feet did in a frame, from steering. */
export interface Feet {
  walked: number;
  landed: boolean;
}

/** Where the eyes are and which way they look, from steering. */
interface Ears {
  x: number;
  y: number;
  z: number;
  /** Radians clockwise from north, seen from above. */
  heading: number;
}

type Context = AudioContext;

/** The browser's AudioContext, or none where it has no sound. */
function newContext(): Context | null {
  if (typeof window === "undefined") return null;
  const Made = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Made) return null;
  try {
    return new Made();
  } catch (error) {
    console.warn("Sound could not be set up, so the walkthrough is silent.", error);
    return null;
  }
}

/** Set a position the way every browser takes it, old Safari included. */
function place(at: { positionX?: AudioParam; setPosition?: (x: number, y: number, z: number) => void }, x: number, y: number, z: number) {
  if (at.positionX) {
    at.positionX.value = x;
    (at as PannerNode).positionY.value = y;
    (at as PannerNode).positionZ.value = z;
  } else at.setPosition?.(x, y, z);
}

/**
 * Everything the viewer hears. Sounds are heard from their direction with
 * the plain, cheap kind of placement, and fade with distance by `heard`;
 * walls do not muffle and rooms do not echo (#13).
 */
export class Sounds {
  readonly sound: SoundSettings = { ...SOUND };
  readonly ambient: AmbientSettings = { ...AMBIENT };
  readonly footsteps: FootstepSettings = { ...FOOTSTEPS };
  readonly placed: PlacedSettings = { ...PLACED };
  /** Each placed sound's settings, by its name, such as "hum". */
  readonly placedSettings = new Map<string, HeardSettings>();

  private readonly context = newContext();
  private readonly master: GainNode | null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly spots: { name: string; at: Vector3; playing: Playing | null }[];
  private readonly strides = new Strides(this.footsteps);
  private readonly hums = new Map<object, Playing>();
  private ambientPlaying: Playing | null = null;
  private lastStep = -1;
  /** Where the ears were in the last frame. */
  private readonly ears = new Vector3();
  /** Whether sound has begun, on the viewer's first touch. */
  private begun = false;
  /** Whether the phone kept sound from coming back by itself, so the next touch tries again. */
  private needTouch = false;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  /** Where sounds are downloaded from, once the trailing download has come to them. */
  private source: { downloads: Downloads; base: string } | null = null;
  private fetching = false;
  /** Sounds that could not be downloaded or decoded, not tried again. */
  private readonly failed = new Set<string>();
  /** Whether sound was on in the last frame. */
  private wasOn = true;

  constructor(
    private readonly list: SoundList,
    placed: PlacedSound[],
  ) {
    this.master = this.context ? this.context.createGain() : null;
    if (this.context && this.master) {
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
    }
    for (const { name } of placed) this.placedSettings.set(name, { ...HEARD });
    this.spots = placed.flatMap(({ name, spots }) => spots.map(([x, y, z]) => ({ name, at: new Vector3(x, y, z), playing: null })));
    if (!this.context) return;
    // Sound unlocks when a touch ends, not when it begins (#19).
    for (const kind of ["touchend", "pointerup", "mousedown", "keydown"]) {
      window.addEventListener(kind, () => this.touched(), { capture: true });
    }
    document.addEventListener("visibilitychange", () => this.shown(!document.hidden));
  }

  /** The names of the sounds to download, in the order they are wanted: the ambient sound first. */
  get wanted(): string[] {
    const order = (name: string) =>
      name === "ambient" ? 0 : name.startsWith("footstep-") ? 1 : name.startsWith("door-") ? 2 : name.startsWith("elevator-") ? 3 : 4;
    return Object.keys(this.list).sort((a, b) => order(a) - order(b));
  }

  /**
   * Download every sound the settings ask for, one after another, each heard
   * as soon as it arrives. Those switched off are left, and fetched if they
   * are switched on later.
   */
  async download(downloads: Downloads, base: string) {
    this.source = { downloads, base };
    await this.fetch();
  }

  /** The sounds the settings ask for that have yet to arrive. */
  private get missing(): string[] {
    if (!this.sound.on) return [];
    return this.wanted.filter(
      (name) => !this.buffers.has(name) && !this.failed.has(name) && (this.sound.ambient || name !== "ambient"),
    );
  }

  private async fetch() {
    if (!this.context || !this.source || this.fetching) return;
    this.fetching = true;
    try {
      for (let name = this.missing[0]; name; name = this.missing[0]) {
        try {
          const bytes = await this.source.downloads.get(this.source.base + this.list[name].file);
          this.buffers.set(name, await this.context.decodeAudioData(bytes));
        } catch (error) {
          this.failed.add(name);
          console.warn(`The sound ${name} could not be played.`, error);
        }
      }
    } finally {
      this.fetching = false;
    }
  }

  /** A sound that plays once, from `at`, or at the ears if none, as loud as `settings` say from there. */
  once(name: string, at: Vector3 | null, settings: { loudness: number } & Partial<HeardSettings>) {
    const buffer = this.buffers.get(name);
    if (!buffer || !this.sound.on || !this.context || this.context.state !== "running") return;
    const share = at && settings.realistic !== undefined ? heard(at.distanceTo(this.ears), settings as HeardSettings) : 1;
    if (share === 0) return;
    this.play(buffer, undefined, at, gainOf(settings.loudness) * share);
  }

  /** Footsteps, placed sounds and the ambient sound, for one frame. */
  update(seconds: number, eyes: Ears, feet: Feet, speeds: { walking: number; running: number }) {
    if (!this.context || !this.master) return;
    const ears = this.ears.set(eyes.x, eyes.y, eyes.z);
    const listener = this.context.listener;
    // Heading 0 looks north, towards -z.
    const ahead = [Math.sin(eyes.heading), 0, -Math.cos(eyes.heading)];
    if (listener.forwardX) {
      place(listener, eyes.x, eyes.y, eyes.z);
      listener.forwardX.value = ahead[0];
      listener.forwardY.value = ahead[1];
      listener.forwardZ.value = ahead[2];
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    } else {
      listener.setPosition(eyes.x, eyes.y, eyes.z);
      listener.setOrientation(ahead[0], ahead[1], ahead[2], 0, 1, 0);
    }

    // Switched on or off, as from the ?config panel.
    const on = this.sound.on;
    if (on !== this.wasOn && this.begun && !document.hidden) this.rampMaster(on ? 1 : 0, on ? FADE_IN : FADE_OUT);
    this.wasOn = on;
    if (this.missing.length > 0) void this.fetch();
    if (this.ambientPlaying && !this.sound.ambient) {
      this.fadeOut(this.ambientPlaying);
      this.ambientPlaying = null;
    }
    const ambient = this.sound.ambient ? this.buffers.get("ambient") : undefined;
    if (ambient && !this.ambientPlaying) this.ambientPlaying = this.fadeIn(this.play(ambient, this.list.ambient.loop, null, gainOf(this.ambient.loudness)));
    if (this.ambientPlaying) this.follow(this.ambientPlaying, gainOf(this.ambient.loudness));

    if (this.strides.step(feet.walked, seconds, speeds, feet.landed)) this.footstep();

    const chosen = nearest(
      this.spots.map(({ name, at }) => ({ at, silent: this.placedSettings.get(name)!.silent })),
      ears,
      this.placed.atOnce,
    );
    this.spots.forEach((spot, index) => {
      const settings = this.placedSettings.get(spot.name)!;
      const buffer = this.buffers.get(spot.name);
      if (chosen.has(index) && buffer && !spot.playing) {
        spot.playing = this.fadeIn(this.play(buffer, this.list[spot.name].loop, spot.at, 0));
      } else if (!chosen.has(index) && spot.playing) {
        this.fadeOut(spot.playing);
        spot.playing = null;
      }
      if (spot.playing) this.follow(spot.playing, gainOf(settings.loudness) * heard(spot.at.distanceTo(ears), settings));
    });
  }

  /**
   * An elevator's hum, for one frame: heard while the car travels, from the
   * car, or at full strength while riding it.
   */
  hum(elevator: object, travelling: boolean, at: Vector3, riding: boolean, settings: HeardSettings) {
    const ears = this.ears;
    const buffer = this.buffers.get("elevator-hum");
    let playing = this.hums.get(elevator);
    if (travelling && buffer && !playing) {
      playing = this.fadeIn(this.play(buffer, this.list["elevator-hum"].loop, at, 0));
      this.hums.set(elevator, playing);
    } else if (!travelling && playing) {
      this.fadeOut(playing);
      this.hums.delete(elevator);
      return;
    }
    if (!playing) return;
    if (playing.panner) place(playing.panner, ...(riding ? ears : at).toArray());
    this.follow(playing, gainOf(settings.loudness) * (riding ? 1 : heard(at.distanceTo(ears), settings)));
  }

  /** A footstep at the ears, never the same one twice running, each a little different. */
  private footstep() {
    const steps = [...this.buffers.keys()].filter((name) => name.startsWith("footstep-"));
    if (steps.length === 0) return;
    let pick = Math.floor(Math.random() * steps.length);
    if (steps.length > 1 && pick === this.lastStep) pick = (pick + 1) % steps.length;
    this.lastStep = pick;
    this.once(steps[pick], null, { loudness: this.footsteps.loudness - 1.5 + Math.random() * 3 });
  }

  /** Start a sound now, looping between its overlaps if `loop` says how long it is. */
  private play(buffer: AudioBuffer, loop: number | undefined, at: Vector3 | null, gain: number): Playing {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const fade = context.createGain();
    const level = context.createGain();
    level.gain.value = gain;
    let panner: PannerNode | null = null;
    source.connect(fade).connect(level);
    if (at) {
      panner = context.createPanner();
      panner.panningModel = "equalpower";
      // `heard` sets the loudness by distance; the panner only gives direction.
      panner.distanceModel = "linear";
      panner.rolloffFactor = 0;
      place(panner, at.x, at.y, at.z);
      level.connect(panner).connect(this.master!);
    } else level.connect(this.master!);
    if (loop) {
      source.loop = true;
      source.loopStart = OVERLAP;
      source.loopEnd = OVERLAP + loop;
      // As if it had been playing all along.
      source.start(0, OVERLAP + (context.currentTime % loop));
    } else {
      source.playbackRate.value = 0.96 + Math.random() * 0.08;
      source.start();
    }
    return { source, fade, level, panner };
  }

  private fadeIn(playing: Playing): Playing {
    const now = this.context!.currentTime;
    playing.fade.gain.setValueAtTime(0, now);
    playing.fade.gain.linearRampToValueAtTime(1, now + FADE_IN);
    return playing;
  }

  private fadeOut({ source, fade }: Playing) {
    const now = this.context!.currentTime;
    fade.gain.cancelScheduledValues(now);
    fade.gain.setValueAtTime(fade.gain.value, now);
    fade.gain.linearRampToValueAtTime(0, now + FADE_OUT);
    source.stop(now + FADE_OUT + 0.05);
  }

  /** Let a sound's level follow what it should be now, smoothly. */
  private follow({ level }: Playing, gain: number) {
    if (Math.abs(level.gain.value - gain) < 0.0001) return;
    level.gain.setTargetAtTime(gain, this.context!.currentTime, FOLLOW);
  }

  private rampMaster(to: number, seconds: number) {
    const gain = this.master!.gain;
    const now = this.context!.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(to, now + seconds);
  }

  /** A touch ended: begin sound, or bring it back if the phone would not by itself. */
  private touched() {
    const context = this.context!;
    if (document.hidden || (this.begun && !this.needTouch)) return;
    if (!this.begun) {
      // Old iPhones only let sound start from a sound begun during a touch.
      const silence = context.createBufferSource();
      silence.buffer = context.createBuffer(1, 1, context.sampleRate);
      silence.connect(context.destination);
      silence.start(0);
    }
    this.resume();
  }

  private resume() {
    const context = this.context!;
    Promise.resolve(context.resume())
      .then(() => {
        if (context.state !== "running") throw new Error(context.state);
        this.begun = true;
        this.needTouch = false;
        if (this.sound.on) this.rampMaster(1, FADE_IN);
      })
      .catch(() => {
        this.needTouch = true;
      });
  }

  /** The page came on screen or went off it: fade sound back in, or out and pause it. */
  private shown(visible: boolean) {
    if (!this.begun) return;
    clearTimeout(this.hideTimer);
    if (visible) {
      this.resume();
      return;
    }
    this.rampMaster(0, FADE_OUT);
    this.hideTimer = setTimeout(() => {
      if (document.hidden) this.context!.suspend().catch(() => {});
    }, FADE_OUT * 1000 + 50);
  }
}
