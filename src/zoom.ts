import { MAX_PITCH, type Viewpoint } from "./motion";
import { fixed, number, type Described } from "./settings";

/** What can be changed about zoom, in the ?config panel and an environment's config file. */
export interface ZoomSettings {
  /** Max zoom: how far the view zooms in, as a multiple of how big things look at 1×. */
  max: number;
  /**
   * Vertical field of view in degrees with the screen upright: wide, to
   * offset the narrow screen. Zoom counts from it.
   */
  upright: number;
  /** Vertical field of view in degrees with the screen sideways. */
  sideways: number;
  /** How hard a pinch zooms: 1 follows the fingers exactly. */
  pinch: number;
  /** How far one step of a mouse wheel zooms in, as a multiple. */
  scroll: number;
}

export const ZOOM: ZoomSettings = {
  max: 2.5,
  upright: 90,
  sideways: 60,
  pinch: 1,
  scroll: 1.25,
};

const degrees = (value: number) => `${value}°`;

export const ZOOM_DESCRIBED: Described<ZoomSettings> = {
  max: number({
    label: "Max zoom",
    min: 1,
    max: 10,
    step: 0.5,
    show: (value) => `${value}×`,
    about: "How far the view zooms in, as a multiple of how big things look unzoomed.",
  }),
  upright: number({
    label: "Field of view, upright",
    min: 30,
    max: 120,
    step: 1,
    show: degrees,
    about: "How tall a slice of the scene shows with the screen upright, wide to make up for its narrowness.",
  }),
  sideways: number({
    label: "Field of view, sideways",
    min: 30,
    max: 120,
    step: 1,
    show: degrees,
    about: "How tall a slice of the scene shows with the screen sideways.",
  }),
  pinch: number({
    label: "Pinch strength",
    min: 0.25,
    max: 3,
    step: 0.05,
    show: fixed(2),
    about: "How hard a pinch zooms: 1 follows the fingers exactly.",
  }),
  scroll: number({
    label: "Scroll strength",
    min: 1.05,
    max: 2,
    step: 0.05,
    show: fixed(2, "×"),
    about: "How far one step of a mouse wheel zooms in.",
  }),
};

/** How quickly a scrolled zoom catches up with the wheel, per second. */
export const SCROLL_EASING = 18;
/** A scrolled zoom this close to where it is going, as a logarithm, is there. */
const SETTLED = 0.001;

/** A spot on the screen, in pixels from its top left corner. */
export interface Spot {
  x: number;
  y: number;
}

/** The size of the screen in pixels. */
export interface Screen {
  width: number;
  height: number;
}

/** A direction from the viewpoint, as a vector of length one. */
interface Direction {
  x: number;
  y: number;
  z: number;
}

/** Which way the viewpoint faces. */
type Facing = Pick<Viewpoint, "heading" | "pitch">;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/** The vertical field of view in degrees for the standard one zoomed in this far. */
export function zoomedIn(standard: number, level: number): number {
  return toDegrees(2 * Math.atan(Math.tan(toRadians(standard) / 2) / level));
}

/**
 * The direction the eyes look through a spot on the screen, seen from the
 * eyes themselves before they turn: x to the right, y up, z backward.
 */
function throughSpot(spot: Spot, screen: Screen, fov: number): Direction {
  // How far the screen lies from the eyes, in pixels.
  const distance = screen.height / 2 / Math.tan(toRadians(fov) / 2);
  const x = spot.x - screen.width / 2;
  const y = screen.height / 2 - spot.y;
  const length = Math.hypot(x, y, distance);
  return { x: x / length, y: y / length, z: -distance / length };
}

/** Tilt a direction up by `pitch`, as the eyes do. */
function tilt(direction: Direction, pitch: number): Direction {
  const { x, y, z } = direction;
  return {
    x,
    y: y * Math.cos(pitch) - z * Math.sin(pitch),
    z: y * Math.sin(pitch) + z * Math.cos(pitch),
  };
}

/** Radians clockwise from north, seen from above, the way headings count. */
const bearing = (direction: Direction) => Math.atan2(direction.x, -direction.z);

/** The direction in the scene the eyes look through a spot on the screen. */
export function sceneDirection(
  facing: Facing,
  spot: Spot,
  screen: Screen,
  fov: number,
): Direction {
  const tilted = tilt(throughSpot(spot, screen, fov), facing.pitch);
  const turn = bearing(tilted) + facing.heading;
  const across = Math.hypot(tilted.x, tilted.z);
  return { x: Math.sin(turn) * across, y: tilted.y, z: -Math.cos(turn) * across };
}

/**
 * Which way to face so that the scene seen through a spot on the screen at
 * one field of view is still seen through another spot at another. This is
 * what keeps a pinched or scrolled spot under the fingers or the pointer.
 * The view never tilts past the usual limit, so near it the spot may slip.
 */
export function anchored(
  facing: Facing,
  screen: Screen,
  before: { spot: Spot; fov: number },
  after: { spot: Spot; fov: number },
): Facing {
  const target = sceneDirection(facing, before.spot, screen, before.fov);
  const eyes = throughSpot(after.spot, screen, after.fov);
  // Tilting by `pitch` raises the spot's direction to the target's height:
  // eyes.y·cos(pitch) − eyes.z·sin(pitch) = target.y. Of the two tilts that
  // do, the one nearer the present tilt is meant; the other looks over the top.
  const reach = Math.hypot(eyes.y, eyes.z);
  const offset = Math.atan2(eyes.y, -eyes.z);
  const rise = Math.asin(clamp(target.y / reach, -1, 1));
  const tilts = [rise - offset, Math.sign(rise) * Math.PI - rise - offset];
  const nearest = tilts.reduce((a, b) =>
    Math.abs(a - facing.pitch) <= Math.abs(b - facing.pitch) ? a : b,
  );
  const pitch = clamp(nearest, -MAX_PITCH, MAX_PITCH);
  const turn = bearing(target) - bearing(tilt(eyes, pitch)) - facing.heading;
  // The shortest way round, so the heading never jumps by a whole turn.
  const heading = facing.heading + Math.atan2(Math.sin(turn), Math.cos(turn));
  return { heading, pitch };
}


/**
 * Zoom: narrowing the view to bring distant detail closer, without the
 * viewpoint moving. A pinch follows the fingers; a wheel zooms a step at a
 * time and eases there. Either way the spot pinched or scrolled towards
 * stays under the fingers or the pointer. It wears off by the same share as
 * the view levels out.
 */
export class Zoom {
  /** How far the view is zoomed in now, from 1× to max zoom. */
  level = 1;
  /** Where a scroll is easing the level to. */
  private target = 1;
  /** Where the pointer was at the last scroll. */
  private scrolledAt: Spot = { x: 0, y: 0 };
  /** Pinching since the last step: where the fingers are and how far they spread. */
  private pinched: { spot: Spot; spread: number } | null = null;

  constructor(readonly settings: ZoomSettings = { ...ZOOM }) {}

  /** The field of view with no zoom, for a screen of this shape. */
  standard(screen: Screen): number {
    return screen.width < screen.height ? this.settings.upright : this.settings.sideways;
  }

  /** The field of view at the present zoom. */
  fov(screen: Screen): number {
    return zoomedIn(this.standard(screen), this.level);
  }

  /** Two fingers on the screen at `spot` moved apart by this share of their distance. */
  pinch(spot: Spot, spread: number) {
    this.pinched = { spot, spread: (this.pinched?.spread ?? 1) * spread };
  }

  /** A wheel at `spot` turned this many steps; positive zooms in. */
  scroll(spot: Spot, steps: number) {
    this.target = this.limit(this.target * this.settings.scroll ** steps);
    this.scrolledAt = spot;
  }

  /**
   * Zoom for one frame, turning the view so the spot zoomed towards stays
   * put. `kept` is the share of the zoom left after it wears off this frame,
   * the same share of tilt the view keeps as it levels out.
   */
  step(facing: Viewpoint, seconds: number, kept: number, screen: Screen): Viewpoint {
    let view = facing;
    // A lowered limit narrows towards the middle of the screen.
    this.level = this.limit(this.level);
    this.target = this.limit(this.target);
    const zoomTo = (level: number, spot: Spot) => {
      const before = { spot, fov: this.fov(screen) };
      this.level = this.limit(level);
      const after = { spot, fov: this.fov(screen) };
      if (after.fov !== before.fov) view = { ...view, ...anchored(view, screen, before, after) };
    };

    if (this.pinched) {
      const { spot, spread } = this.pinched;
      this.pinched = null;
      zoomTo(this.level * spread ** this.settings.pinch, spot);
      // A pinch takes over from a scroll still easing.
      this.target = this.level;
    } else {
      // Close enough is there, so the view stops turning towards the pointer.
      const near = Math.abs(Math.log(this.target / this.level)) < SETTLED;
      const eased = near ? 1 : 1 - Math.exp(-SCROLL_EASING * seconds);
      zoomTo(this.level * (this.target / this.level) ** eased, this.scrolledAt);
    }

    // Wearing off narrows towards the middle of the screen, so it never turns the view.
    this.level = this.limit(this.level ** kept);
    this.target = this.limit(this.target ** kept);
    return view;
  }

  private limit(level: number): number {
    return clamp(level, 1, Math.max(1, this.settings.max));
  }
}
