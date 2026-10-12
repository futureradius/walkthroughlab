import { Coasting, releaseSpeed, THROW_WINDOW, type Sample } from "./coasting";
import type { Look } from "./controls";

/**
 * Free look: a drag anywhere on the walkthrough outside the joystick. The
 * scene moves with the finger, as in a street-level panorama, so dragging
 * left turns the view right and dragging down tilts it up. Let go of while
 * moving, the view coasts on until it rests or the next touch catches it.
 */
export class FreeLook {
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private draggedX = 0;
  private draggedY = 0;
  /** Where the drag has been lately, to tell how fast it was let go. */
  private trail: Sample[] = [];
  /** Pixels per second the drag was let go at, until the next `take`. */
  private thrown: { x: number; y: number } | null = null;

  constructor(
    surface: HTMLElement,
    private readonly coasting: Coasting,
  ) {
    surface.addEventListener("pointerdown", (event) => {
      // Only the first finger looks; a mouse looks with its main button.
      if (this.pointerId !== null || event.button !== 0) return;
      this.pointerId = event.pointerId;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.trail = [{ at: event.timeStamp, x: event.clientX, y: event.clientY }];
      this.thrown = null;
      this.coasting.catch();
      surface.setPointerCapture(event.pointerId);
    });
    surface.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this.pointerId) return;
      this.draggedX += event.clientX - this.lastX;
      this.draggedY += event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.trail = this.trail.filter(
        (sample) => event.timeStamp - sample.at <= THROW_WINDOW,
      );
      this.trail.push({ at: event.timeStamp, x: event.clientX, y: event.clientY });
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      surface.addEventListener(type, (event) => {
        if ((event as PointerEvent).pointerId !== this.pointerId) return;
        this.pointerId = null;
        // Only a drag the viewer let go of throws the view.
        if (type === "pointerup") this.thrown = releaseSpeed(this.trail, event.timeStamp);
      });
    }
    surface.addEventListener("contextmenu", (event) => event.preventDefault());
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
      held: this.pointerId !== null,
      right: -this.draggedX * radiansPerPixel + coasted.right,
      up: this.draggedY * radiansPerPixel + coasted.up,
    };
    this.draggedX = 0;
    this.draggedY = 0;
    return look;
  }
}
