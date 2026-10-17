import { describe, expect, it } from "vitest";
import { fromWheel, Gestures, releaseSpeed, type Steered } from "./gestures";
import type { Spot } from "./zoom";

/** A stand-in for the canvas or the page, handing on the events sent to it. */
function target() {
  const listeners = new Map<string, (event: unknown) => void>();
  const element = {
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    setPointerCapture: () => {},
  } as unknown as HTMLElement;
  const dispatch = (type: string, event: object) =>
    listeners.get(type)!({ preventDefault: () => {}, ...event });
  return { element, dispatch };
}

/** Gestures on a stand-in canvas, noting everything they hand to steering. */
function gestures() {
  const surface = target();
  const page = target();
  const sent = {
    touches: 0,
    dragged: { x: 0, y: 0 },
    letGo: [] as { x: number; y: number }[],
    pinches: [] as { spot: Spot; spread: number }[],
    scrolls: [] as { spot: Spot; steps: number }[],
  };
  const steering: Steered = {
    touch: () => sent.touches++,
    drag: (x, y) => {
      sent.dragged.x += x;
      sent.dragged.y += y;
    },
    letGo: (x = 0, y = 0) => sent.letGo.push({ x, y }),
    pinch: (spot, spread) => sent.pinches.push({ spot, spread }),
    scroll: (spot, steps) => sent.scrolls.push({ spot, steps }),
  };
  new Gestures(surface.element, steering, page.element);
  const send = (type: string, at: number, x: number, y = 0, pointerId = 1) =>
    surface.dispatch(type, { pointerId, button: 0, timeStamp: at, clientX: x, clientY: y });
  /** How far the fingers spread altogether. */
  const spread = () => sent.pinches.reduce((total, pinch) => total * pinch.spread, 1);
  return { sent, send, spread, wheel: surface.dispatch };
}

/** Drag steadily to the left at 2000 pixels a second for 80 ms, then let go at once or after a rest. */
function drag(send: ReturnType<typeof gestures>["send"], rest = 0) {
  send("pointerdown", 0, 300);
  for (let at = 16; at <= 80; at += 16) send("pointermove", at, 300 - at * 2);
  send("pointerup", 80 + rest, 140);
}

describe("gestures", () => {
  it("drags with the finger and lets go at the speed it was going", () => {
    const { sent, send } = gestures();
    drag(send);
    expect(sent.touches).toBe(1);
    expect(sent.dragged.x).toBe(-160);
    expect(sent.letGo).toHaveLength(1);
    expect(sent.letGo[0].x).toBeCloseTo(-2000);
    expect(sent.letGo[0].y).toBeCloseTo(0);
  });

  it("lets go without speed when the finger rested before lifting", () => {
    const { sent, send } = gestures();
    drag(send, 300);
    expect(sent.letGo).toEqual([{ x: 0, y: 0 }]);
  });

  it("lets go without speed when the drag is taken away rather than let go", () => {
    const { sent, send } = gestures();
    send("pointerdown", 0, 300);
    for (let at = 16; at <= 80; at += 16) send("pointermove", at, 300 - at * 2);
    send("pointercancel", 80, 140);
    expect(sent.letGo).toEqual([{ x: 0, y: 0 }]);
  });

  it("touches afresh on the next drag", () => {
    const { sent, send } = gestures();
    drag(send);
    send("pointerdown", 200, 150);
    expect(sent.touches).toBe(2);
  });

  describe("with two fingers", () => {
    it("doesn't jump when a second finger lands during a drag", () => {
      const { sent, send } = gestures();
      send("pointerdown", 0, 300, 100, 1);
      send("pointermove", 16, 280, 100, 1);
      send("pointerdown", 20, 500, 300, 2);
      expect(sent.touches).toBe(1);
      expect(sent.dragged).toEqual({ x: -20, y: 0 });
      expect(sent.pinches).toEqual([]);
    });

    it("drags by the spot between them when they move together", () => {
      const { sent, send, spread } = gestures();
      send("pointerdown", 0, 100, 100, 1);
      send("pointerdown", 0, 300, 100, 2);
      send("pointermove", 16, 80, 110, 1);
      send("pointermove", 16, 280, 110, 2);
      expect(sent.dragged.x).toBeCloseTo(-20);
      expect(sent.dragged.y).toBeCloseTo(10);
      expect(spread()).toBeCloseTo(1);
    });

    it("pinches by how far they spread, at the spot between them", () => {
      const { sent, send, spread } = gestures();
      send("pointerdown", 0, 150, 200, 1);
      send("pointerdown", 0, 250, 200, 2);
      send("pointermove", 16, 100, 200, 1);
      send("pointermove", 16, 300, 200, 2);
      expect(spread()).toBeCloseTo(2);
      expect(sent.pinches[sent.pinches.length - 1].spot).toEqual({ x: 200, y: 200 });
      expect(sent.dragged.x).toBeCloseTo(0);
    });

    it("carries on as a one-finger drag, without a jolt, when one lifts", () => {
      const { sent, send } = gestures();
      send("pointerdown", 0, 100, 100, 1);
      send("pointerdown", 0, 300, 100, 2);
      send("pointerup", 16, 100, 100, 1);
      expect(sent.letGo).toEqual([]);
      expect(sent.dragged).toEqual({ x: 0, y: 0 });
      send("pointermove", 32, 290, 100, 2);
      expect(sent.dragged.x).toBeCloseTo(-10);
    });

    it("lets go at speed when both are let go while turning", () => {
      const { sent, send } = gestures();
      send("pointerdown", 0, 300, 100, 1);
      send("pointerdown", 0, 500, 100, 2);
      for (let at = 16; at <= 80; at += 16) {
        send("pointermove", at, 300 - at * 2, 100, 1);
        send("pointermove", at, 500 - at * 2, 100, 2);
      }
      send("pointerup", 80, 140, 100, 1);
      send("pointerup", 84, 340, 100, 2);
      expect(sent.letGo).toHaveLength(1);
      expect(sent.letGo[0].x).toBeLessThan(-1000);
    });

    it("leaves a third finger out", () => {
      const { sent, send } = gestures();
      send("pointerdown", 0, 100, 100, 1);
      send("pointerdown", 0, 300, 100, 2);
      send("pointerdown", 0, 500, 100, 3);
      send("pointermove", 16, 600, 100, 3);
      expect(sent.dragged.x).toBeCloseTo(0);
      expect(sent.pinches).toEqual([]);
    });
  });

  describe("with a wheel", () => {
    it("scrolls towards the pointer", () => {
      const { sent, wheel } = gestures();
      wheel("wheel", { deltaY: -200, deltaMode: 0, ctrlKey: false, clientX: 30, clientY: 40 });
      expect(sent.scrolls).toEqual([{ spot: { x: 30, y: 40 }, steps: 2 }]);
    });

    it("pinches with a trackpad", () => {
      const { sent, wheel } = gestures();
      const deltaY = -100 * Math.log(1.5);
      wheel("wheel", { deltaY, deltaMode: 0, ctrlKey: true, clientX: 30, clientY: 40 });
      expect(sent.pinches[0].spread).toBeCloseTo(1.5);
      expect(sent.scrolls).toEqual([]);
    });
  });
});

describe("release speed", () => {
  it("is the speed of the drag over the last moment", () => {
    const samples = [
      { at: 0, x: 0, y: 0 },
      { at: 950, x: 100, y: 50 },
      { at: 1000, x: 200, y: 30 },
    ];
    const speed = releaseSpeed(samples, 1000);
    expect(speed.x).toBeCloseTo(2000);
    expect(speed.y).toBeCloseTo(-400);
  });

  it("is nothing once the finger has come to rest", () => {
    const samples = [
      { at: 0, x: 0, y: 0 },
      { at: 50, x: 300, y: 0 },
    ];
    expect(releaseSpeed(samples, 400)).toEqual({ x: 0, y: 0 });
  });

  it("drops the longer the finger lingers before lifting", () => {
    const samples = [
      { at: 0, x: 0, y: 0 },
      { at: 20, x: 100, y: 0 },
    ];
    expect(releaseSpeed(samples, 80).x).toBeLessThan(releaseSpeed(samples, 20).x);
  });

  it("is nothing for a tap", () => {
    expect(releaseSpeed([{ at: 10, x: 5, y: 5 }], 10)).toEqual({ x: 0, y: 0 });
    expect(releaseSpeed([], 10)).toEqual({ x: 0, y: 0 });
  });
});

describe("from a wheel", () => {
  it("counts a notch of a mouse wheel as a step, in pixels or lines", () => {
    expect(fromWheel({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toEqual({ steps: 1 });
    expect(fromWheel({ deltaY: 3, deltaMode: 1, ctrlKey: false })).toEqual({ steps: -1 });
  });

  it("follows a trackpad pinch as a pinch", () => {
    const pinch = fromWheel({ deltaY: -100 * Math.log(1.5), deltaMode: 0, ctrlKey: true });
    expect("spread" in pinch && pinch.spread).toBeCloseTo(1.5);
  });
});
