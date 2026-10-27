import { COASTING, COASTING_DESCRIBED, Coasting, glideOf, type CoastingSettings } from "./coasting";
import { BODY } from "./collision";
import {
  advance,
  levelling,
  WALKING,
  WALKING_DESCRIBED,
  type Footing,
  type Intent,
  type Terrain,
  type Viewpoint,
  type WalkingSettings,
} from "./motion";
import { RUNNING, RUNNING_DESCRIBED, Running, type RunningSettings } from "./running";
import { fixed, number, percent, type Described } from "./settings";
import { Zoom, ZOOM, ZOOM_DESCRIBED, type Screen, type Spot, type ZoomSettings } from "./zoom";

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

/** What can be changed about how the joystick reads, in the ?config panel. */
export interface JoystickSettings {
  /** Share of the joystick's reach a push must go past to count at all. */
  deadZone: number;
  /**
   * Radians per second, as seen on screen, below which a coasting view starts
   * handing a sideways joystick back from sidestepping to turning.
   */
  handover: number;
}

/**
 * The usual settings. The handover starts where the slowest throw does, so
 * it is well under way by the time the view looks still.
 */
export const JOYSTICK: JoystickSettings = {
  deadZone: 0.12,
  handover: 0.3,
};

export const JOYSTICK_DESCRIBED: Described<JoystickSettings> = {
  deadZone: number({
    label: "Dead zone",
    min: 0,
    max: 0.4,
    step: 0.01,
    show: percent,
    about: "How far from the middle a push must go to count, so a resting thumb stays still.",
  }),
  handover: number({
    label: "Handover",
    min: 0.05,
    max: 2,
    step: 0.05,
    show: fixed(2, " rad/s"),
    about: "How slow a coasting view must turn before a sideways push eases from sidestepping back to turning.",
  }),
};

/** What can be changed about steering while walking, in the ?config panel. */
export interface SteeringSettings {
  walking: WalkingSettings;
  running: RunningSettings;
  coasting: CoastingSettings;
  joystick: JoystickSettings;
  zoom: ZoomSettings;
}

/** What each of steering's settings is and what it may be. */
export const STEERING_DESCRIBED: { [K in keyof SteeringSettings]: Described<SteeringSettings[K]> } = {
  walking: WALKING_DESCRIBED,
  running: RUNNING_DESCRIBED,
  coasting: COASTING_DESCRIBED,
  joystick: JOYSTICK_DESCRIBED,
  zoom: ZOOM_DESCRIBED,
};

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

/** Share of a sideways push below which the joystick has eased back to turning. */
const TURNING = 0.01;

/** A fall off a ledge taller than a step, until the viewer lands. */
interface Fall {
  /** Metres the feet are above the origin. */
  feet: number;
  /** Metres per second the feet drop at. */
  speed: number;
  /** Metres per second east and south the viewer stepped off at, and keeps. */
  east: number;
  south: number;
}

/** A terrain that keeps the viewer where they are, while they are in the air. */
const stay: Terrain = (from) => from;

const unit = (value: number) => Math.max(-1, Math.min(1, value));

/** How hard the knob pushes, rising smoothly from the edge of the dead zone. */
function pushOf(knob: Stick, deadZone: number): Stick {
  const reach = Math.min(Math.hypot(knob.x, knob.y), 1);
  const scale = reach <= deadZone ? 0 : (reach - deadZone) / (1 - deadZone) / reach;
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
    joystick: { ...JOYSTICK },
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
  private fall: Fall | null = null;
  /** What the feet did in the last step, for footsteps: metres walked across the floor, and whether a fall ended. */
  readonly feet = { walked: 0, landed: false };

  constructor(private readonly place: Place) {
    this.viewpoint = place.start;
    this.eyes = place.start.floor + this.settings.walking.eyeHeight;
  }

  /** Where the viewer stands. */
  get footing(): Footing {
    const { x, z, floor } = this.viewpoint;
    return { x, z, floor };
  }

  /** Something that moves, such as a door, pushes the viewer to here. */
  shove(to: Footing) {
    // Carried up or down, as by an elevator's car, the eyes go along at once.
    this.eyes += to.floor - this.viewpoint.floor;
    this.viewpoint = { ...this.viewpoint, ...to };
  }

  /** Whether to brake a thrown view as for reduced motion; see Accessibility. */
  set reducedMotion(reduced: boolean) {
    this.coasting.reduced = reduced;
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
    const { walking, joystick } = this.settings;
    const { knob, keys } = readings;
    this.feet.walked = 0;
    this.feet.landed = false;
    const stick = pushOf(knob, joystick.deadZone);

    // One pixel covers this angle at the present zoom, so a dragged spot
    // stays under the finger.
    const radiansPerPixel = (this.zoom.fov(screen) * Math.PI) / 180 / screen.height;
    if (this.thrown) {
      this.coasting.throw(-this.thrown.x * radiansPerPixel, this.thrown.y * radiansPerPixel);
      this.thrown = null;
    }
    const coasted = this.coasting.step(seconds);
    const lookRight = -this.dragged.x * radiansPerPixel + coasted.right;
    const lookUp = this.dragged.y * radiansPerPixel + coasted.up;
    this.dragged = { x: 0, y: 0 };

    this.handOver(stick, seconds);
    const steered: Intent = {
      walk: unit(stick.y + keys.walk),
      sidestep: unit(stick.x * this.sidestepping + keys.sidestep),
      turn: unit(stick.x * (1 - this.sidestepping) + keys.turn) / this.zoom.level,
      lookRight,
      lookUp,
      looking: this.held,
      forwardSpeed: this.running.step({ knob, stick }, keys.run && keys.walk > 0, seconds),
    };
    // In the air the viewer can look around but not steer.
    const intent = this.fall ? { ...steered, walk: 0, sidestep: 0, turn: 0 } : steered;

    const moved = this.fall
      ? this.drift(this.fall, advance(this.viewpoint, intent, seconds, stay, walking), seconds)
      : this.walk(intent, seconds);
    // Zoom wears off by the same share as the view levels out.
    this.viewpoint = this.zoom.step(moved, seconds, levelling(intent, seconds, walking), screen);
    const { x, z, floor, heading, pitch } = this.viewpoint;
    if (this.fall) this.drop(this.fall, floor, seconds);
    else {
      this.eyes +=
        (floor + walking.eyeHeight - this.eyes) * Math.min(1, seconds * walking.eyeCatchUp);
    }
    return { x, y: this.eyes, z, heading, pitch, fov: this.zoom.fov(screen) };
  }

  /** Walk for a frame, and begin a fall where that steps off a ledge taller than a step. */
  private walk(intent: Intent, seconds: number): Viewpoint {
    const from = this.viewpoint;
    const moved = advance(from, intent, seconds, this.place.terrain, this.settings.walking);
    this.feet.walked = Math.hypot(moved.x - from.x, moved.z - from.z);
    if (moved.floor < from.floor - BODY.maxStep && seconds > 0) {
      this.fall = {
        feet: from.floor,
        speed: 0,
        east: (moved.x - from.x) / seconds,
        south: (moved.z - from.z) / seconds,
      };
    }
    return moved;
  }

  /** Carry a falling viewer on at the speed they stepped off with, short of walls. */
  private drift(fall: Fall, looked: Viewpoint, seconds: number): Viewpoint {
    const footing = this.place.terrain(
      { x: looked.x, z: looked.z, floor: fall.feet },
      looked.x + fall.east * seconds,
      looked.z + fall.south * seconds,
    );
    // Held where they are, they fall on towards the floor already beneath
    // them rather than stand on the air.
    return footing.x === looked.x && footing.z === looked.z ? looked : { ...looked, ...footing };
  }

  /** Drop the feet faster and faster, and land on the floor beneath. */
  private drop(fall: Fall, floor: number, seconds: number) {
    fall.speed += this.settings.walking.gravity * seconds;
    fall.feet -= fall.speed * seconds;
    if (fall.feet <= floor) {
      fall.feet = floor;
      this.fall = null;
      this.feet.landed = true;
    }
    this.eyes = fall.feet + this.settings.walking.eyeHeight;
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
    const { coasting, joystick } = this.settings;
    const coast = Math.min(1, (this.coasting.turning * this.zoom.level) / joystick.handover);
    if (this.held) this.sidestepping = 1;
    else if (stick.x === 0 && stick.y === 0) this.sidestepping = coast;
    else {
      const faded = this.sidestepping * Math.exp(-glideOf(coasting, this.coasting.reduced) * seconds);
      this.sidestepping = Math.max(coast, faded);
    }
    if (this.sidestepping < TURNING) this.sidestepping = 0;
  }
}
