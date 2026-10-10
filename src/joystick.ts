import type { Stick } from "./controls";

/** Deflection below this fraction of full travel counts as centred. */
const DEAD_ZONE = 0.12;

/**
 * The on-screen joystick. It follows only the pointer that grabbed it, so
 * other fingers on the screen stay free for other gestures.
 */
export class Joystick {
  readonly stick: Stick = { x: 0, y: 0 };

  private readonly base = document.createElement("div");
  private readonly knob = document.createElement("div");
  private pointerId: number | null = null;

  constructor(parent: HTMLElement) {
    this.base.className = "joystick";
    this.knob.className = "joystick__knob";
    this.base.append(this.knob);
    parent.append(this.base);

    this.base.addEventListener("pointerdown", (event) => {
      if (this.pointerId !== null) return;
      this.pointerId = event.pointerId;
      this.base.setPointerCapture(event.pointerId);
      this.follow(event);
    });
    this.base.addEventListener("pointermove", (event) => {
      if (event.pointerId === this.pointerId) this.follow(event);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      this.base.addEventListener(type, (event) => {
        if ((event as PointerEvent).pointerId === this.pointerId) this.release();
      });
    }
    this.base.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  private follow(event: PointerEvent) {
    event.preventDefault();
    const rect = this.base.getBoundingClientRect();
    const travel = (rect.width - this.knob.offsetWidth) / 2;
    let x = (event.clientX - (rect.left + rect.width / 2)) / travel;
    let y = (event.clientY - (rect.top + rect.height / 2)) / travel;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    this.knob.style.transform = `translate(${x * travel}px, ${y * travel}px)`;

    // Rescale so speed ramps up smoothly from the edge of the dead zone.
    const reach = Math.min(length, 1);
    const scale =
      reach < DEAD_ZONE ? 0 : (reach - DEAD_ZONE) / (1 - DEAD_ZONE) / reach;
    this.stick.x = x * scale;
    this.stick.y = -y * scale;
  }

  private release() {
    this.pointerId = null;
    this.stick.x = 0;
    this.stick.y = 0;
    this.knob.style.transform = "";
  }
}
