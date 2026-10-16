import { describe, expect, it } from "vitest";
import { COASTING } from "./coasting";
import { Controls, type Keys, type Look } from "./controls";

const noKeys: Keys = { walk: 0, sidestep: 0, turn: 0 };
const notLooking: Look = { held: false, coasting: false, right: 0, up: 0 };
const looking: Look = { held: true, coasting: false, right: 0, up: 0 };
const coasting: Look = { held: false, coasting: true, right: 0, up: 0 };
const centred = { x: 0, y: 0 };
const pushedRight = { x: 1, y: 0 };
const frame = 1 / 60;

/** Hold the joystick to the right with the view at rest for this long. */
function holdRight(controls: Controls, seconds: number) {
  let intent = controls.read(pushedRight, noKeys, notLooking, frame);
  for (let held = frame; held < seconds; held += frame) {
    intent = controls.read(pushedRight, noKeys, notLooking, frame);
  }
  return intent;
}

describe("controls", () => {
  it("turns when the joystick is pushed sideways on its own", () => {
    const intent = new Controls().read(pushedRight, noKeys, notLooking, frame);
    expect(intent.turn).toBe(1);
    expect(intent.sidestep).toBe(0);
  });

  it("sidesteps when the joystick is pushed sideways during free look", () => {
    const intent = new Controls().read(pushedRight, noKeys, looking, frame);
    expect(intent.sidestep).toBe(1);
    expect(intent.turn).toBe(0);
  });

  it("sidesteps while the view coasts, even pushed afresh", () => {
    const controls = new Controls();
    controls.read(pushedRight, noKeys, looking, frame);
    controls.read(centred, noKeys, coasting, frame);
    const intent = controls.read(pushedRight, noKeys, coasting, frame);
    expect(intent.sidestep).toBe(1);
    expect(intent.turn).toBe(0);
  });

  it("eases from sidestepping to turning once the view rests", () => {
    const controls = new Controls();
    controls.read(pushedRight, noKeys, looking, frame);
    const soon = holdRight(controls, 0.1);
    expect(soon.sidestep).toBeLessThan(1);
    expect(soon.sidestep).toBeGreaterThan(0.5);
    expect(soon.sidestep + soon.turn).toBeCloseTo(1);
    const later = holdRight(controls, 2);
    expect(later.sidestep).toBe(0);
    expect(later.turn).toBe(1);
  });

  it("eases as softly as coasting glides, following its settings", () => {
    const share = (glide: number, reduced = false) => {
      const settings = { ...COASTING, glide, reduced };
      const controls = new Controls(settings);
      controls.read(pushedRight, noKeys, looking, frame);
      return holdRight(controls, 0.2).sidestep;
    };
    expect(share(3.5)).toBeCloseTo(Math.exp(-3.5 * 0.2), 1);
    expect(share(1)).toBeGreaterThan(share(3.5));
    expect(share(3.5, true)).toBeLessThan(share(3.5));
  });

  it("follows coasting settings changed while walking", () => {
    const settings = { ...COASTING };
    const controls = new Controls(settings);
    controls.read(pushedRight, noKeys, looking, frame);
    settings.glide = 1000;
    expect(holdRight(controls, 0.1).turn).toBe(1);
  });

  it("is back to turning at once when the joystick is let go during the ease", () => {
    const controls = new Controls();
    controls.read(pushedRight, noKeys, looking, frame);
    controls.read(pushedRight, noKeys, notLooking, frame);
    controls.read(centred, noKeys, notLooking, frame);
    expect(controls.read(pushedRight, noKeys, notLooking, frame).turn).toBe(1);
  });

  it("walks the same way with or without free look", () => {
    const controls = new Controls();
    expect(controls.read({ x: 0, y: 1 }, noKeys, notLooking, frame).walk).toBe(1);
    expect(controls.read({ x: 0, y: 1 }, noKeys, looking, frame).walk).toBe(1);
  });

  it("sidesteps with A and D and turns with the arrows, free look or not", () => {
    const keys: Keys = { walk: 1, sidestep: -1, turn: 1 };
    for (const look of [notLooking, looking, coasting]) {
      const intent = new Controls().read(centred, keys, look, frame);
      expect(intent.walk).toBe(1);
      expect(intent.sidestep).toBe(-1);
      expect(intent.turn).toBe(1);
    }
  });

  it("is no faster with the joystick and a key pushing the same way", () => {
    const intent = new Controls().read(
      { x: 0, y: 1 },
      { walk: 1, sidestep: 0, turn: 0 },
      notLooking,
      frame,
    );
    expect(intent.walk).toBe(1);
  });

  it("turns more slowly, by as much as the view is zoomed, but walks as fast", () => {
    const pushed = { x: 1, y: 1 };
    const keys: Keys = { walk: 0, sidestep: 0, turn: -1 };
    expect(new Controls().read(pushed, noKeys, notLooking, frame, 4).turn).toBe(0.25);
    expect(new Controls().read(pushed, noKeys, notLooking, frame, 4).walk).toBe(1);
    expect(new Controls().read(centred, keys, notLooking, frame, 2).turn).toBe(-0.5);
  });

  it("passes on how far free look turned the view", () => {
    const intent = new Controls().read(
      centred,
      noKeys,
      { held: true, coasting: false, right: 0.2, up: -0.1 },
      frame,
    );
    expect(intent.lookRight).toBe(0.2);
    expect(intent.lookUp).toBe(-0.1);
    expect(intent.looking).toBe(true);
  });
});
