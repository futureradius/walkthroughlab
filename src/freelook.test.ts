import { describe, expect, it } from "vitest";
import { Coasting } from "./coasting";
import { FreeLook } from "./freelook";

const RADIANS_PER_PIXEL = 0.002;
const FRAME = 1 / 60;

/** A stand-in for the canvas that hands pointer events to free look. */
function surface() {
  const listeners = new Map<string, (event: unknown) => void>();
  const element = {
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    setPointerCapture: () => {},
  } as unknown as HTMLElement;
  const send = (type: string, at: number, x: number, y = 0) =>
    listeners.get(type)!({ pointerId: 1, button: 0, timeStamp: at, clientX: x, clientY: y });
  return { element, send };
}

/** Drag steadily to the left for 80 ms, then let go at once or after a rest. */
function drag(send: ReturnType<typeof surface>["send"], rest = 0) {
  send("pointerdown", 0, 300);
  for (let at = 16; at <= 80; at += 16) send("pointermove", at, 300 - at * 2);
  send("pointerup", 80 + rest, 140);
}

describe("free look", () => {
  it("coasts on the way the drag was going once it is let go", () => {
    const { element, send } = surface();
    const freeLook = new FreeLook(element, new Coasting());
    drag(send);
    const dragged = freeLook.take(RADIANS_PER_PIXEL, FRAME);
    expect(dragged.held).toBe(false);
    const coasted = freeLook.take(RADIANS_PER_PIXEL, FRAME);
    expect(coasted.held).toBe(false);
    expect(coasted.right).toBeGreaterThan(0);
    expect(coasted.right).toBeLessThan(2000 * RADIANS_PER_PIXEL * FRAME);
  });

  it("stays put when the finger rested before lifting", () => {
    const { element, send } = surface();
    const freeLook = new FreeLook(element, new Coasting());
    drag(send, 300);
    freeLook.take(RADIANS_PER_PIXEL, FRAME);
    expect(freeLook.take(RADIANS_PER_PIXEL, FRAME).right).toBe(0);
  });

  it("is caught by the next touch", () => {
    const { element, send } = surface();
    const freeLook = new FreeLook(element, new Coasting());
    drag(send);
    freeLook.take(RADIANS_PER_PIXEL, FRAME);
    send("pointerdown", 200, 150);
    const caught = freeLook.take(RADIANS_PER_PIXEL, FRAME);
    expect(caught.held).toBe(true);
    expect(caught.right).toBe(0);
  });

  it("does not coast when the drag is taken away rather than let go", () => {
    const { element, send } = surface();
    const freeLook = new FreeLook(element, new Coasting());
    send("pointerdown", 0, 300);
    for (let at = 16; at <= 80; at += 16) send("pointermove", at, 300 - at * 2);
    send("pointercancel", 80, 140);
    freeLook.take(RADIANS_PER_PIXEL, FRAME);
    expect(freeLook.take(RADIANS_PER_PIXEL, FRAME).right).toBe(0);
  });
});
