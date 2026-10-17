import type { Stick } from "./steering";

/**
 * The on-screen joystick. It follows only the pointer that grabbed it, so
 * other fingers on the screen stay free for other gestures.
 */
export class Joystick {
  /** Where the knob sits, as a share of its reach. */
  readonly knob: Stick = { x: 0, y: 0 };

  private readonly base = document.createElement("div");
  private readonly handle = document.createElement("div");
  private pointerId: number | null = null;

  constructor(parent: HTMLElement) {
    this.base.className = "joystick";
    this.handle.className = "joystick__knob";
    this.base.append(this.handle);
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
    const travel = (rect.width - this.handle.offsetWidth) / 2;
    let x = (event.clientX - (rect.left + rect.width / 2)) / travel;
    let y = (event.clientY - (rect.top + rect.height / 2)) / travel;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    this.handle.style.transform = `translate(${x * travel}px, ${y * travel}px)`;
    this.knob.x = x;
    this.knob.y = -y;
  }

  private release() {
    this.pointerId = null;
    this.knob.x = 0;
    this.knob.y = 0;
    this.handle.style.transform = "";
  }
}
