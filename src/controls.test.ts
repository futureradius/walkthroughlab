import { describe, expect, it } from "vitest";
import { Controls, type Keys, type Look } from "./controls";

const noKeys: Keys = { walk: 0, sidestep: 0, turn: 0 };
const notLooking: Look = { held: false, right: 0, up: 0 };
const looking: Look = { held: true, right: 0, up: 0 };
const centred = { x: 0, y: 0 };
const pushedRight = { x: 1, y: 0 };

describe("controls", () => {
  it("turns when the joystick is pushed sideways on its own", () => {
    const intent = new Controls().read(pushedRight, noKeys, notLooking);
    expect(intent.turn).toBe(1);
    expect(intent.sidestep).toBe(0);
  });

  it("sidesteps when the joystick is pushed sideways during free look", () => {
    const intent = new Controls().read(pushedRight, noKeys, looking);
    expect(intent.sidestep).toBe(1);
    expect(intent.turn).toBe(0);
  });

  it("keeps sidestepping after free look ends until the joystick is let go", () => {
    const controls = new Controls();
    controls.read(pushedRight, noKeys, looking);
    expect(controls.read(pushedRight, noKeys, notLooking).sidestep).toBe(1);
    controls.read(centred, noKeys, notLooking);
    expect(controls.read(pushedRight, noKeys, notLooking).turn).toBe(1);
  });

  it("walks the same way with or without free look", () => {
    const controls = new Controls();
    expect(controls.read({ x: 0, y: 1 }, noKeys, notLooking).walk).toBe(1);
    expect(controls.read({ x: 0, y: 1 }, noKeys, looking).walk).toBe(1);
  });

  it("sidesteps with A and D and turns with the arrows, free look or not", () => {
    const keys: Keys = { walk: 1, sidestep: -1, turn: 1 };
    for (const look of [notLooking, looking]) {
      const intent = new Controls().read(centred, keys, look);
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
    );
    expect(intent.walk).toBe(1);
  });

  it("passes on how far free look turned the view", () => {
    const intent = new Controls().read(centred, noKeys, { held: true, right: 0.2, up: -0.1 });
    expect(intent.lookRight).toBe(0.2);
    expect(intent.lookUp).toBe(-0.1);
    expect(intent.looking).toBe(true);
  });
});
