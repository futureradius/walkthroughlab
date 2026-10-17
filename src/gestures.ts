import type { Steering } from "./steering";
import type { Spot } from "./zoom";

/** How long before letting go a drag still counts towards the throw, in milliseconds. */
const THROW_WINDOW = 100;
/** How far a wheel scrolls in one step, in pixels, lines or pages. */
const STEP = [100, 3, 1];

/** Where a drag was at a moment, in pixels and milliseconds. */
export interface Sample {
  at: number;
  x: number;
  y: number;
}

/** Somewhere to send what the viewer does on the view. */
export type Steered = Pick<Steering, "touch" | "drag" | "letGo" | "pinch" | "scroll">;

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
 * How many steps of zoom a mouse wheel asks for, and which way: positive
 * zooms in. A trackpad pinch arrives as a wheel with the control key held;
 * it asks for a share to zoom in by instead, as a pinch does.
 */
export function fromWheel(wheel: {
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
}): { steps: number } | { spread: number } {
  // Browsers turn a pinch's spread into −100 × its logarithm, in pixels.
  if (wheel.ctrlKey) return { spread: Math.exp(-wheel.deltaY / 100) };
  return { steps: -wheel.deltaY / (STEP[wheel.deltaMode] ?? STEP[0]) };
}

/**
 * Everything the viewer does on the view outside the joystick: free look
 * with one or two fingers, pinching two fingers, and zooming with a mouse
 * wheel or a trackpad pinch, instead of scrolling or zooming the page. The
 * scene moves with the finger, as in a street-level panorama, so dragging
 * left turns the view right and dragging down tilts it up. Two fingers drag
 * by the spot between them. A drag let go of while moving is thrown, to
 * coast on.
 */
export class Gestures {
  /** Where each finger on the view is, at most two of them. */
  private readonly fingers = new Map<number, Spot>();
  /** The spot that drags: the one finger, or the spot between two. */
  private lastX = 0;
  private lastY = 0;
  /** How far apart two fingers are. */
  private spread = 0;
  /** Where the drag has been lately, to tell how fast it was let go. */
  private trail: Sample[] = [];

  /** `page` hears Safari's own pinch gestures, which never reach `surface`. */
  constructor(
    surface: HTMLElement,
    private readonly steering: Steered,
    page: EventTarget = document,
  ) {
    surface.addEventListener("pointerdown", (event) => {
      // Two fingers look; a mouse looks with its main button.
      if (this.fingers.size >= 2 || event.button !== 0) return;
      if (this.fingers.size === 0) {
        this.trail = [];
        this.steering.touch();
      }
      this.fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.regrip(event.timeStamp);
      surface.setPointerCapture(event.pointerId);
    });
    surface.addEventListener("pointermove", (event) => {
      const finger = this.fingers.get(event.pointerId);
      if (!finger) return;
      finger.x = event.clientX;
      finger.y = event.clientY;
      const { x, y } = this.grip();
      this.steering.drag(x - this.lastX, y - this.lastY);
      this.lastX = x;
      this.lastY = y;
      if (this.fingers.size === 2) {
        const spread = this.apart();
        if (this.spread > 0 && spread > 0) this.steering.pinch({ x, y }, spread / this.spread);
        this.spread = spread;
      }
      this.trail = this.trail.filter(
        (sample) => event.timeStamp - sample.at <= THROW_WINDOW,
      );
      this.trail.push({ at: event.timeStamp, x, y });
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      surface.addEventListener(type, (event) => {
        const { pointerId, timeStamp } = event as PointerEvent;
        if (!this.fingers.delete(pointerId)) return;
        if (this.fingers.size > 0) {
          this.regrip(timeStamp);
          return;
        }
        // Only a drag the viewer let go of throws the view.
        if (type !== "pointerup") this.steering.letGo();
        else {
          const { x, y } = releaseSpeed(this.trail, timeStamp);
          this.steering.letGo(x, y);
        }
      });
    }
    surface.addEventListener("contextmenu", (event) => event.preventDefault());

    // A wheel over a panel still scrolls it.
    surface.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const spot = { x: event.clientX, y: event.clientY };
        const asked = fromWheel(event);
        if ("spread" in asked) this.steering.pinch(spot, asked.spread);
        else this.steering.scroll(spot, asked.steps);
      },
      { passive: false },
    );
    // Safari reports pinches as gestures of its own, which would otherwise
    // zoom the page. On a touch screen the fingers already pinch through the
    // pointer events above; on a Mac's trackpad the gesture is the only sign
    // of one.
    let scale = 1;
    const pinching = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale?: number; clientX?: number; clientY?: number };
      if (event.type === "gesturestart") scale = 1;
      if (event.target !== surface || navigator.maxTouchPoints > 0 || !gesture.scale) return;
      const spot = { x: gesture.clientX ?? 0, y: gesture.clientY ?? 0 };
      this.steering.pinch(spot, gesture.scale / scale);
      scale = gesture.scale;
    };
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
      page.addEventListener(type, pinching, { passive: false });
    }
  }

  /** The spot that drags: the one finger, or the spot between two. */
  private grip(): Spot {
    let x = 0;
    let y = 0;
    for (const finger of this.fingers.values()) {
      x += finger.x / this.fingers.size;
      y += finger.y / this.fingers.size;
    }
    return { x, y };
  }

  /** How far apart two fingers are, in pixels. */
  private apart(): number {
    const [a, b] = this.fingers.values();
    return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  /**
   * A finger landed or lifted, so the spot that drags jumped. The drag and
   * its trail carry on from the new spot, so the view doesn't jolt and a
   * throw keeps its speed.
   */
  private regrip(at: number) {
    const { x, y } = this.grip();
    for (const sample of this.trail) {
      sample.x += x - this.lastX;
      sample.y += y - this.lastY;
    }
    this.trail.push({ at, x, y });
    this.lastX = x;
    this.lastY = y;
    this.spread = this.apart();
  }
}
