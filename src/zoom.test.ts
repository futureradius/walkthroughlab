import { describe, expect, it } from "vitest";
import { MAX_PITCH, type Viewpoint } from "./motion";
import {
  anchored,
  sceneDirection,
  Zoom,
  ZOOM,
  zoomedIn,
  type Screen,
  type Spot,
} from "./zoom";

const UPRIGHT: Screen = { width: 400, height: 800 };
const SIDEWAYS: Screen = { width: 800, height: 400 };
const MIDDLE: Spot = { x: 200, y: 400 };
/** Off to the upper right of an upright screen. */
const OFF_CENTRE: Spot = { x: 330, y: 150 };
const FRAME = 1 / 60;
const start: Viewpoint = { x: 0, z: 0, floor: 0, heading: 0.4, pitch: 0.2 };

/** Expect two directions to be the same. */
function same(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.z).toBeCloseTo(b.z, 6);
}

describe("zoomed in", () => {
  it("is the standard field of view at 1×", () => {
    expect(zoomedIn(90, 1)).toBeCloseTo(90);
  });

  it("makes things in the middle twice as big at 2×", () => {
    const fov = zoomedIn(90, 2);
    expect(Math.tan(((fov / 2) * Math.PI) / 180)).toBeCloseTo(0.5);
  });
});

describe("scene direction", () => {
  it("is straight ahead through the middle of the screen", () => {
    const facing = { heading: Math.PI / 2, pitch: 0 };
    same(sceneDirection(facing, MIDDLE, UPRIGHT, 90), { x: 1, y: 0, z: 0 });
  });

  it("is up and to the right through the top right corner", () => {
    const corner = sceneDirection({ heading: 0, pitch: 0 }, { x: 400, y: 0 }, UPRIGHT, 90);
    expect(corner.x).toBeGreaterThan(0);
    expect(corner.y).toBeGreaterThan(0);
    // At 90° the top edge is as far up as the screen is from the eyes.
    expect(corner.y / -corner.z).toBeCloseTo(1);
  });
});

describe("anchored", () => {
  it("keeps the scene under a spot while the field of view narrows", () => {
    const before = { spot: OFF_CENTRE, fov: 90 };
    const after = { spot: OFF_CENTRE, fov: zoomedIn(90, 3) };
    const facing = anchored(start, UPRIGHT, before, after);
    same(
      sceneDirection(facing, OFF_CENTRE, UPRIGHT, after.fov),
      sceneDirection(start, OFF_CENTRE, UPRIGHT, before.fov),
    );
    // Zooming in turns the view towards the spot: right and up.
    expect(facing.heading).toBeGreaterThan(start.heading);
    expect(facing.pitch).toBeGreaterThan(start.pitch);
  });

  it("moves the scene from one spot to another", () => {
    const before = { spot: OFF_CENTRE, fov: 60 };
    const after = { spot: { x: 100, y: 500 }, fov: 50 };
    const facing = anchored(start, UPRIGHT, before, after);
    same(
      sceneDirection(facing, after.spot, UPRIGHT, after.fov),
      sceneDirection(start, before.spot, UPRIGHT, before.fov),
    );
  });

  it("doesn't turn the view for the middle of the screen", () => {
    const facing = anchored(start, UPRIGHT, { spot: MIDDLE, fov: 90 }, { spot: MIDDLE, fov: 30 });
    expect(facing.heading).toBeCloseTo(start.heading);
    expect(facing.pitch).toBeCloseTo(start.pitch);
  });

  it("never tilts past the usual limit", () => {
    const steep = { heading: 0, pitch: MAX_PITCH - 0.01 };
    const top = { x: 200, y: 0 };
    const facing = anchored(steep, UPRIGHT, { spot: top, fov: 90 }, { spot: top, fov: 20 });
    expect(facing.pitch).toBe(MAX_PITCH);
  });

  it("turns the short way round from any heading", () => {
    const turned = { ...start, heading: 4 * Math.PI + 0.4 };
    const before = { spot: OFF_CENTRE, fov: 90 };
    const after = { spot: OFF_CENTRE, fov: 45 };
    const facing = anchored(turned, UPRIGHT, before, after);
    expect(facing.heading - turned.heading).toBeCloseTo(
      anchored(start, UPRIGHT, before, after).heading - start.heading,
    );
  });
});

describe("zoom", () => {
  it("counts from the field of view for the screen's shape", () => {
    const zoom = new Zoom();
    expect(zoom.fov(UPRIGHT)).toBeCloseTo(ZOOM.upright);
    expect(zoom.fov(SIDEWAYS)).toBeCloseTo(ZOOM.sideways);
  });

  it("keeps its zoom when the screen turns", () => {
    const zoom = new Zoom();
    zoom.pinch(MIDDLE, 2);
    zoom.step(start, FRAME, 1, UPRIGHT);
    expect(zoom.fov(SIDEWAYS)).toBeCloseTo(zoomedIn(ZOOM.sideways, 2));
  });

  it("doubles when the fingers spread twice as far apart", () => {
    const zoom = new Zoom();
    zoom.pinch(OFF_CENTRE, 1.25);
    zoom.pinch(OFF_CENTRE, 1.6);
    const facing = zoom.step(start, FRAME, 1, UPRIGHT);
    expect(zoom.level).toBeCloseTo(2);
    same(
      sceneDirection(facing, OFF_CENTRE, UPRIGHT, zoom.fov(UPRIGHT)),
      sceneDirection(start, OFF_CENTRE, UPRIGHT, ZOOM.upright),
    );
  });

  it("pinches harder or softer by the pinch strength", () => {
    const zoom = new Zoom({ ...ZOOM, pinch: 2 });
    zoom.pinch(MIDDLE, 1.5);
    zoom.step(start, FRAME, 1, UPRIGHT);
    expect(zoom.level).toBeCloseTo(2.25);
  });

  it("stops dead at max zoom, without turning", () => {
    const zoom = new Zoom();
    zoom.pinch(OFF_CENTRE, 3);
    const nearly = zoom.step(start, FRAME, 1, UPRIGHT);
    zoom.pinch(OFF_CENTRE, 3);
    const full = zoom.step(nearly, FRAME, 1, UPRIGHT);
    expect(zoom.level).toBe(ZOOM.max);
    zoom.pinch(OFF_CENTRE, 3);
    expect(zoom.step(full, FRAME, 1, UPRIGHT)).toEqual(full);
    expect(zoom.level).toBe(ZOOM.max);
  });

  it("never goes wider than the standard field of view, nor turns trying to", () => {
    const zoom = new Zoom();
    zoom.pinch(OFF_CENTRE, 0.5);
    expect(zoom.step(start, FRAME, 1, UPRIGHT)).toEqual(start);
    expect(zoom.level).toBe(1);
    zoom.scroll(OFF_CENTRE, -3);
    expect(zoom.step(start, FRAME, 1, UPRIGHT)).toEqual(start);
    expect(zoom.level).toBe(1);
  });

  it("eases a step of the wheel in, keeping the spot under the pointer", () => {
    const zoom = new Zoom();
    zoom.scroll(OFF_CENTRE, 1);
    const seen = sceneDirection(start, OFF_CENTRE, UPRIGHT, zoom.fov(UPRIGHT));
    let facing = zoom.step(start, FRAME, 1, UPRIGHT);
    expect(zoom.level).toBeGreaterThan(1);
    expect(zoom.level).toBeLessThan(ZOOM.scroll);
    for (let frames = 0; frames < 60; frames++) {
      facing = zoom.step(facing, FRAME, 1, UPRIGHT);
      same(sceneDirection(facing, OFF_CENTRE, UPRIGHT, zoom.fov(UPRIGHT)), seen);
    }
    expect(zoom.level).toBe(ZOOM.scroll);
  });

  it("stays while the view keeps its tilt", () => {
    const zoom = new Zoom();
    zoom.pinch(MIDDLE, 2);
    zoom.step(start, FRAME, 1, UPRIGHT);
    for (let frames = 0; frames < 600; frames++) zoom.step(start, FRAME, 1, UPRIGHT);
    expect(zoom.level).toBeCloseTo(2);
  });

  it("wears off by the share the view levels out by, without turning", () => {
    const zoom = new Zoom();
    zoom.pinch(MIDDLE, 2);
    zoom.step(start, FRAME, 1, UPRIGHT);
    expect(zoom.step(start, FRAME, 0.5, UPRIGHT)).toEqual(start);
    expect(zoom.level).toBeCloseTo(Math.sqrt(2));
    for (let frames = 0; frames < 30; frames++) zoom.step(start, FRAME, 0.5, UPRIGHT);
    expect(zoom.level).toBeCloseTo(1);
  });

  it("lets a pinch take over from a wheel still easing", () => {
    const zoom = new Zoom();
    zoom.scroll(MIDDLE, 4);
    zoom.step(start, FRAME, 1, UPRIGHT);
    const caught = zoom.level;
    zoom.pinch(MIDDLE, 1);
    zoom.step(start, FRAME, 1, UPRIGHT);
    zoom.step(start, FRAME, 1, UPRIGHT);
    expect(zoom.level).toBeCloseTo(caught);
  });

  it("comes back within a lowered limit", () => {
    const zoom = new Zoom();
    zoom.pinch(MIDDLE, 4);
    zoom.step(start, FRAME, 1, UPRIGHT);
    zoom.settings.max = 2;
    zoom.step(start, FRAME, 1, UPRIGHT);
    expect(zoom.level).toBe(2);
  });
});
