import { describe, expect, it } from "vitest";
import { describeLamps, facingOf, fromRhino, kelvinOf, lumenOf } from "./lamps";

/** A hex code as pasted into Rhino, as its glTF export carries it. */
const exported = (hex: string) =>
  [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];

describe("lamps", () => {
  it("names the README's colours by the temperature they were made for", () => {
    expect(kelvinOf(fromRhino(exported("#FFAD55")))).toBe(2700);
    expect(kelvinOf(fromRhino(exported("#FFB869")))).toBe(3000);
    expect(kelvinOf(fromRhino(exported("#FFC786")))).toBe(3500);
    expect(kelvinOf(fromRhino(exported("#FFD4A0")))).toBe(4000);
  });

  it("finds Rhino's own 2000K swatch much cooler than it says", () => {
    const kelvin = kelvinOf(fromRhino(exported("#E8AB53")))!;
    expect(kelvin).toBeGreaterThan(2700);
    expect(kelvin).toBeLessThan(3300);
  });

  it("names no temperature for a colour no lamp gives", () => {
    expect(kelvinOf([0, 1, 0])).toBeUndefined();
    expect(kelvinOf([0.2, 0.4, 1])).toBeUndefined();
    expect(kelvinOf([0, 0, 0])).toBeUndefined();
  });

  it("works out lumen from strength, colour and area", () => {
    // The README's starting strength for a 60 × 60 cm panel of 3,600 lm at 4000 K.
    const panel = lumenOf(6.5, fromRhino(exported("#FFD4A0")), 0.36);
    expect(panel).toBeGreaterThan(3500);
    expect(panel).toBeLessThan(3700);
  });

  it("says which way a flat lamp faces, and nothing of a rounded one", () => {
    expect(facingOf([0, -0.36, 0], 0.36)).toBe("down");
    expect(facingOf([0, 1, 0], 1)).toBe("up");
    expect(facingOf([0.2, 0, 0], 0.2)).toBe("sideways");
    expect(facingOf([0, 0, 0], 0.126)).toBeUndefined();
  });

  it("lists one material's lamps on one line", () => {
    const warm = fromRhino(exported("#FFAD55"));
    expect(describeLamps({ name: "downlight", lumens: [800, 801, 799], colour: warm, facings: ["down", "down", "down"] })).toBe(
      "downlight: 3 lamps, 800 lm each, ~2700 K, faces down",
    );
    // A panel modelled facing up lights the ceiling, not the room.
    expect(describeLamps({ name: "panel", lumens: [3600, 3600, 3600, 800], colour: warm, facings: ["up", "up", "down", undefined] })).toBe(
      "panel: 4 lamps, 800–3,600 lm, ~2700 K, 2 face up, 1 faces down",
    );
    expect(describeLamps({ name: "Emission", lumens: [106_712, 209_934], colour: warm })).toBe(
      "Emission: 2 lamps, 106,710–209,930 lm, ~2700 K",
    );
    expect(describeLamps({ name: "sign", lumens: [12], colour: [0, 1, 0] })).toBe("sign: 1 lamp, 12 lm, not a lamp colour");
    expect(describeLamps({ name: "prop-lantern sway-paper", lumens: [40], colour: warm, sways: true })).toBe(
      "prop-lantern sway-paper: 1 lamp, 40 lm, ~2700 K, sways, lights nothing",
    );
  });
});
