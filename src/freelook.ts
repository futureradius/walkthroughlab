import type { Look } from "./controls";

/**
 * Free look: a drag anywhere on the walkthrough outside the joystick. The
 * scene moves with the finger, as in a street-level panorama, so dragging
 * left turns the view right and dragging down tilts it up.
 */
export class FreeLook {
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private draggedX = 0;
  private draggedY = 0;

  constructor(surface: HTMLElement) {
    surface.addEventListener("pointerdown", (event) => {
      // Only the first finger looks; a mouse looks with its main button.
      if (this.pointerId !== null || event.button !== 0) return;
      this.pointerId = event.pointerId;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      surface.setPointerCapture(event.pointerId);
    });
    surface.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this.pointerId) return;
      this.draggedX += event.clientX - this.lastX;
      this.draggedY += event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      surface.addEventListener(type, (event) => {
        if ((event as PointerEvent).pointerId === this.pointerId) this.pointerId = null;
      });
    }
    surface.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  /**
   * How far the view turned since the last call. `radiansPerPixel` is the
   * angle one screen pixel covers, so the spot under the finger stays there.
   */
  take(radiansPerPixel: number): Look {
    const look = {
      held: this.pointerId !== null,
      right: -this.draggedX * radiansPerPixel,
      up: this.draggedY * radiansPerPixel,
    };
    this.draggedX = 0;
    this.draggedY = 0;
    return look;
  }
}
