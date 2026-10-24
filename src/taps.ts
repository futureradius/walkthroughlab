/** Most a tap may move, in pixels, before it counts as a drag instead. */
const STILL_PIXELS = 8;
/** Longest a tap may last, in milliseconds. */
const TAP_MS = 350;

/**
 * Hear taps on a surface: a single finger, or the mouse's main button, that
 * lets go quickly without dragging. Free look still hears the same touch, so
 * a tap also stops a coasting view, which is what a touch on the view does.
 */
export function onTap(surface: HTMLElement, tapped: (x: number, y: number) => void) {
  const down = new Map<number, { x: number; y: number; at: number }>();
  surface.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    down.set(event.pointerId, { x: event.clientX, y: event.clientY, at: event.timeStamp });
  });
  surface.addEventListener("pointerup", (event) => {
    const start = down.get(event.pointerId);
    const alone = down.size === 1;
    down.delete(event.pointerId);
    if (!start || !alone) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved <= STILL_PIXELS && event.timeStamp - start.at <= TAP_MS) tapped(event.clientX, event.clientY);
  });
  surface.addEventListener("pointercancel", (event) => down.delete(event.pointerId));
}
