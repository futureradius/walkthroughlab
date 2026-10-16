import { Coasting, releaseSpeed, THROW_WINDOW, type Sample } from "./coasting";
import type { Look } from "./controls";
import type { Spot } from "./zoom";

/** Somewhere to send a pinch: two fingers at `spot` moved apart by `spread`. */
export interface Pinching {
  pinch(spot: Spot, spread: number): void;
}

/**
 * Free look: a drag of one or two fingers anywhere on the walkthrough
 * outside the joystick. The scene moves with the finger, as in a
 * street-level panorama, so dragging left turns the view right and dragging
 * down tilts it up. Two fingers drag by the spot between them, and spreading
 * or pinching them zooms. Let go of while moving, the view coasts on until
 * it rests or the next touch catches it.
 */
export class FreeLook {
  /** Where each finger on the view is, at most two of them. */
  private readonly fingers = new Map<number, Spot>();
  /** The spot that drags: the one finger, or the spot between two. */
  private lastX = 0;
  private lastY = 0;
  /** How far apart two fingers are. */
  private spread = 0;
  private draggedX = 0;
  private draggedY = 0;
  /** Where the drag has been lately, to tell how fast it was let go. */
  private trail: Sample[] = [];
  /** Pixels per second the drag was let go at, until the next `take`. */
  private thrown: { x: number; y: number } | null = null;

  constructor(
    surface: HTMLElement,
    private readonly coasting: Coasting,
    private readonly zoom: Pinching,
  ) {
    surface.addEventListener("pointerdown", (event) => {
      // Two fingers look; a mouse looks with its main button.
      if (this.fingers.size >= 2 || event.button !== 0) return;
      if (this.fingers.size === 0) {
        this.trail = [];
        this.thrown = null;
        this.coasting.catch();
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
      this.draggedX += x - this.lastX;
      this.draggedY += y - this.lastY;
      this.lastX = x;
      this.lastY = y;
      if (this.fingers.size === 2) {
        const spread = this.apart();
        if (this.spread > 0 && spread > 0) this.zoom.pinch({ x, y }, spread / this.spread);
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
        if (type === "pointerup") this.thrown = releaseSpeed(this.trail, timeStamp);
      });
    }
    surface.addEventListener("contextmenu", (event) => event.preventDefault());
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

  /**
   * How far the view turned since the last call, `seconds` ago, by dragging
   * and by coasting. `radiansPerPixel` is the angle one screen pixel covers,
   * so the spot under the finger stays there.
   */
  take(radiansPerPixel: number, seconds: number): Look {
    if (this.thrown) {
      this.coasting.throw(
        -this.thrown.x * radiansPerPixel,
        this.thrown.y * radiansPerPixel,
      );
      this.thrown = null;
    }
    const coasted = this.coasting.step(seconds);
    const look = {
      held: this.fingers.size > 0,
      coasting: this.coasting.turning,
      right: -this.draggedX * radiansPerPixel + coasted.right,
      up: this.draggedY * radiansPerPixel + coasted.up,
    };
    this.draggedX = 0;
    this.draggedY = 0;
    return look;
  }
}
