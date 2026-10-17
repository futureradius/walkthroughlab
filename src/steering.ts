import { COASTING, Coasting, glideOf, type CoastingSettings } from "./coasting";
import {
  advance,
  levelling,
  WALKING,
  type Intent,
  type Terrain,
  type Viewpoint,
  type WalkingSettings,
} from "./motion";
import { RUNNING, Running, type RunningSettings } from "./running";
import { Zoom, ZOOM, type Screen, type Spot, type ZoomSettings } from "./zoom";

/** Where the joystick's knob sits, each axis as a share of its reach in [-1, 1]. */
export interface Stick {
  /** Positive is pushed right. */
  x: number;
  /** Positive is pushed forward. */
  y: number;
}

/** Which movement keys are held, each axis as -1, 0 or 1. */
export interface Keys {
  /** W and S, or the up and down arrows: positive is forward. */
  walk: number;
  /** A and D: positive is to the right. */
  sidestep: number;
  /** The left and right arrows: positive is to the right. */
  turn: number;
  /** Either Shift. */
  run: boolean;
}

/** What the joystick and the keyboard are doing this frame. */
export interface Readings {
  knob: Stick;
  keys: Keys;
}

/** Somewhere to walk: where steps may end, and where to begin. */
export interface Place {
  terrain: Terrain;
  start: Viewpoint;
}

/** What can be changed about steering while walking; see tuning.ts. */
export interface SteeringSettings {
  walking: WalkingSettings;
  running: RunningSettings;
  coasting: CoastingSettings;
  zoom: ZoomSettings;
}

/** Where the eyes are, which way they look, and how wide they see. */
export interface View {
  /** Metres east of the origin. */
  x: number;
  /** Metres the eyes are above the origin. */
  y: number;
  /** Metres south of the origin. */
  z: number;
  /** Radians clockwise from north, seen from above. */
  heading: number;
  /** Radians the view is tilted up from level. */
  pitch: number;
  /** Vertical field of view in degrees. */
  fov: number;
}

/** Deflection below this share of the joystick's reach counts as centred. */
const DEAD_ZONE = 0.12;
/** Share of a sideways push below which the joystick has eased back to turning. */
const TURNING = 0.01;

const unit = (value: number) => Math.max(-1, Math.min(1, value));

/** How hard the knob pushes, rising smoothly from the edge of the dead zone. */
function pushOf(knob: Stick): Stick {
  const reach = Math.min(Math.hypot(knob.x, knob.y), 1);
  const scale = reach < DEAD_ZONE ? 0 : (reach - DEAD_ZONE) / (1 - DEAD_ZONE) / reach;
  return { x: knob.x * scale, y: knob.y * scale };
}

/**
 * Steering: how the viewer's joystick, keys, free look and zoom move the
 * viewpoint, frame by frame. Gestures on the view arrive as they happen; the
 * joystick and the keys are read once a frame.
 *
 * On its own a sideways joystick turns; during free look and while the view
 * coasts after it, it sidesteps instead, as with two thumbs in a phone game.
 * Zoomed in, the joystick and the keys turn the view more slowly, by as much
 * as it is zoomed in, so the scene crosses the screen no faster than without
 * zoom.
 */
export class Steering {
  readonly settings: SteeringSettings = {
    walking: { ...WALKING },
    running: { ...RUNNING },
    coasting: { ...COASTING },
    zoom: { ...ZOOM },
  };
  private readonly coasting = new Coasting(this.settings.coasting);
  private readonly running = new Running(this.settings.running, this.settings.walking);
  private readonly zoom = new Zoom(this.settings.zoom);
  private viewpoint: Viewpoint;
  /** Metres the eyes are above the origin, catching up with the floor. */
  private eyes: number;
  /** Whether a free look drag is being held. */
  private held = false;
  /** Pixels free look dragged since the last step. */
  private dragged = { x: 0, y: 0 };
  /** Pixels per second the drag was let go at, until the next step. */
  private thrown: { x: number; y: number } | null = null;
  /** The share of a sideways push that sidesteps; the rest turns. */
  private sidestepping = 0;

  constructor(private readonly place: Place) {
    this.viewpoint = place.start;
    this.eyes = place.start.floor + this.settings.walking.eyeHeight;
  }

  /** A free look drag began, which catches a coasting view. */
  touch() {
    this.held = true;
    this.thrown = null;
    this.coasting.catch();
  }

  /** The free look drag moved this many pixels across the screen. */
  drag(x: number, y: number) {
    this.dragged.x += x;
    this.dragged.y += y;
  }

  /** The free look drag was let go while moving this many pixels per second. */
  letGo(x = 0, y = 0) {
    this.held = false;
    this.thrown = { x, y };
  }

  /** Two fingers at `spot` moved apart by this share of their distance. */
  pinch(spot: Spot, spread: number) {
    this.zoom.pinch(spot, spread);
  }

  /** A wheel at `spot` turned this many steps; positive zooms in. */
  scroll(spot: Spot, steps: number) {
    this.zoom.scroll(spot, steps);
  }

  /** Move the viewpoint for one frame, `seconds` after the last, on a screen this size. */
  step(readings: Readings, seconds: number, screen: Screen): View {
    const { walking } = this.settings;
    const { knob, keys } = readings;
    const stick = pushOf(knob);

    // One pixel in the middle of the screen covers this angle at the present
    // zoom, so a spot dragged there stays under the finger. Zoomed in twice
    // as far it covers exactly half, as the joystick's turning and handover
    // count it.
    const fovRadians = (this.zoom.fov(screen) * Math.PI) / 180;
    const radiansPerPixel = (2 * Math.tan(fovRadians / 2)) / screen.height;
    if (this.thrown) {
      this.coasting.throw(-this.thrown.x * radiansPerPixel, this.thrown.y * radiansPerPixel);
      this.thrown = null;
    }
    const coasted = this.coasting.step(seconds);
    const lookRight = -this.dragged.x * radiansPerPixel + coasted.right;
    const lookUp = this.dragged.y * radiansPerPixel + coasted.up;
    this.dragged = { x: 0, y: 0 };

    this.handOver(stick, seconds);
    const intent: Intent = {
      walk: unit(stick.y + keys.walk),
      sidestep: unit(stick.x * this.sidestepping + keys.sidestep),
      turn: unit(stick.x * (1 - this.sidestepping) + keys.turn) / this.zoom.level,
      lookRight,
      lookUp,
      looking: this.held,
      forwardSpeed: this.running.step({ knob, stick }, keys.run && keys.walk > 0, seconds),
    };

    const moved = advance(this.viewpoint, intent, seconds, this.place.terrain, walking);
    // Zoom wears off by the same share as the view levels out.
    this.viewpoint = this.zoom.step(moved, seconds, levelling(intent, seconds, walking), screen);
    const { x, z, floor, heading, pitch } = this.viewpoint;
    this.eyes +=
      (floor + walking.eyeHeight - this.eyes) * Math.min(1, seconds * walking.eyeCatchUp);
    return { x, y: this.eyes, z, heading, pitch, fov: this.zoom.fov(screen) };
  }

  /**
   * As the view slows to rest, a joystick still pushed sideways eases from
   * sidestepping to turning, so a viewer who keeps hold of it is never stuck
   * sidestepping, nor flung into a spin. Below the handover speed the share
   * follows the coast down, and it fades no faster than coasting glides,
   * also after the view rests or when no throw came at all. Let go, the
   * joystick turns at once, or follows a coast still under way.
   */
  private handOver(stick: Stick, seconds: number) {
    const { coasting } = this.settings;
    const coast = Math.min(1, (this.coasting.turning * this.zoom.level) / coasting.handover);
    if (this.held) this.sidestepping = 1;
    else if (stick.x === 0 && stick.y === 0) this.sidestepping = coast;
    else {
      const faded = this.sidestepping * Math.exp(-glideOf(coasting) * seconds);
      this.sidestepping = Math.max(coast, faded);
    }
    if (this.sidestepping < TURNING) this.sidestepping = 0;
  }
}
