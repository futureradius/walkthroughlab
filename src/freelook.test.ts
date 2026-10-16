import { describe, expect, it } from "vitest";
import { Coasting } from "./coasting";
import { FreeLook } from "./freelook";
import type { Spot } from "./zoom";

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
  const send = (type: string, at: number, x: number, y = 0, pointerId = 1) =>
    listeners.get(type)!({ pointerId, button: 0, timeStamp: at, clientX: x, clientY: y });
  return { element, send };
}

/** Free look on a stand-in canvas, noting every pinch it hands to zoom. */
function freeLook() {
  const { element, send } = surface();
  const pinches: { spot: Spot; spread: number }[] = [];
  const zoom = { pinch: (spot: Spot, spread: number) => pinches.push({ spot, spread }) };
  const look = new FreeLook(element, new Coasting(), zoom);
  /** How far the fingers spread altogether. */
  const spread = () => pinches.reduce((total, pinch) => total * pinch.spread, 1);
  return { look, send, pinches, spread };
}

/** Drag steadily to the left for 80 ms, then let go at once or after a rest. */
function drag(send: ReturnType<typeof surface>["send"], rest = 0) {
  send("pointerdown", 0, 300);
  for (let at = 16; at <= 80; at += 16) send("pointermove", at, 300 - at * 2);
  send("pointerup", 80 + rest, 140);
}

describe("free look", () => {
  it("coasts on the way the drag was going once it is let go", () => {
    const { look, send } = freeLook();
    drag(send);
    const dragged = look.take(RADIANS_PER_PIXEL, FRAME);
    expect(dragged.held).toBe(false);
    const coasted = look.take(RADIANS_PER_PIXEL, FRAME);
    expect(coasted.held).toBe(false);
    expect(coasted.coasting).toBe(true);
    expect(coasted.right).toBeGreaterThan(0);
    expect(coasted.right).toBeLessThan(2000 * RADIANS_PER_PIXEL * FRAME);
  });

  it("stays put when the finger rested before lifting", () => {
    const { look, send } = freeLook();
    drag(send, 300);
    look.take(RADIANS_PER_PIXEL, FRAME);
    const rested = look.take(RADIANS_PER_PIXEL, FRAME);
    expect(rested.right).toBe(0);
    expect(rested.coasting).toBe(false);
  });

  it("is caught by the next touch", () => {
    const { look, send } = freeLook();
    drag(send);
    look.take(RADIANS_PER_PIXEL, FRAME);
    send("pointerdown", 200, 150);
    const caught = look.take(RADIANS_PER_PIXEL, FRAME);
    expect(caught.held).toBe(true);
    expect(caught.right).toBe(0);
  });

  it("does not coast when the drag is taken away rather than let go", () => {
    const { look, send } = freeLook();
    send("pointerdown", 0, 300);
    for (let at = 16; at <= 80; at += 16) send("pointermove", at, 300 - at * 2);
    send("pointercancel", 80, 140);
    look.take(RADIANS_PER_PIXEL, FRAME);
    expect(look.take(RADIANS_PER_PIXEL, FRAME).right).toBe(0);
  });

  describe("with two fingers", () => {
    it("doesn't jump when a second finger lands during a drag", () => {
      const { look, send, pinches } = freeLook();
      send("pointerdown", 0, 300, 100, 1);
      send("pointermove", 16, 280, 100, 1);
      send("pointerdown", 20, 500, 300, 2);
      const turned = look.take(RADIANS_PER_PIXEL, FRAME);
      expect(turned.held).toBe(true);
      expect(turned.right).toBeCloseTo(20 * RADIANS_PER_PIXEL);
      expect(turned.up).toBe(0);
      expect(pinches).toEqual([]);
    });

    it("drags by the spot between them when they move together", () => {
      const { look, send, spread } = freeLook();
      send("pointerdown", 0, 100, 100, 1);
      send("pointerdown", 0, 300, 100, 2);
      send("pointermove", 16, 80, 110, 1);
      send("pointermove", 16, 280, 110, 2);
      const turned = look.take(RADIANS_PER_PIXEL, FRAME);
      expect(turned.right).toBeCloseTo(20 * RADIANS_PER_PIXEL);
      expect(turned.up).toBeCloseTo(10 * RADIANS_PER_PIXEL);
      expect(spread()).toBeCloseTo(1);
    });

    it("pinches by how far they spread, at the spot between them", () => {
      const { look, send, pinches, spread } = freeLook();
      send("pointerdown", 0, 150, 200, 1);
      send("pointerdown", 0, 250, 200, 2);
      send("pointermove", 16, 100, 200, 1);
      send("pointermove", 16, 300, 200, 2);
      expect(spread()).toBeCloseTo(2);
      expect(pinches[pinches.length - 1].spot).toEqual({ x: 200, y: 200 });
      expect(look.take(RADIANS_PER_PIXEL, FRAME).right).toBeCloseTo(0);
    });

    it("carries on as a one-finger drag, without a jolt, when one lifts", () => {
      const { look, send } = freeLook();
      send("pointerdown", 0, 100, 100, 1);
      send("pointerdown", 0, 300, 100, 2);
      look.take(RADIANS_PER_PIXEL, FRAME);
      send("pointerup", 16, 100, 100, 1);
      const lifted = look.take(RADIANS_PER_PIXEL, FRAME);
      expect(lifted.held).toBe(true);
      expect(lifted.right).toBeCloseTo(0);
      expect(lifted.up).toBeCloseTo(0);
      send("pointermove", 32, 290, 100, 2);
      const turned = look.take(RADIANS_PER_PIXEL, FRAME);
      expect(turned.held).toBe(true);
      expect(turned.right).toBeCloseTo(10 * RADIANS_PER_PIXEL);
    });

    it("coasts when both are let go while turning", () => {
      const { look, send } = freeLook();
      send("pointerdown", 0, 300, 100, 1);
      send("pointerdown", 0, 500, 100, 2);
      for (let at = 16; at <= 80; at += 16) {
        send("pointermove", at, 300 - at * 2, 100, 1);
        send("pointermove", at, 500 - at * 2, 100, 2);
      }
      send("pointerup", 80, 140, 100, 1);
      send("pointerup", 84, 340, 100, 2);
      look.take(RADIANS_PER_PIXEL, FRAME);
      const coasted = look.take(RADIANS_PER_PIXEL, FRAME);
      expect(coasted.held).toBe(false);
      expect(coasted.right).toBeGreaterThan(0);
    });

    it("leaves a third finger out", () => {
      const { look, send, pinches } = freeLook();
      send("pointerdown", 0, 100, 100, 1);
      send("pointerdown", 0, 300, 100, 2);
      send("pointerdown", 0, 500, 100, 3);
      send("pointermove", 16, 600, 100, 3);
      expect(look.take(RADIANS_PER_PIXEL, FRAME).right).toBeCloseTo(0);
      expect(pinches).toEqual([]);
    });
  });
});
