import { describe, expect, it } from "vitest";
import { fromHex, hexOf, hotBodyColour, toRhino } from "./hot-bodies";
import { fromRhino, kelvinOf } from "./lamps";

describe("hot bodies", () => {
  it("gives the README's hex codes for its four temperatures", () => {
    expect(hexOf(toRhino(hotBodyColour(2700)))).toBe("#FFAD55");
    expect(hexOf(toRhino(hotBodyColour(3000)))).toBe("#FFB869");
    expect(hexOf(toRhino(hotBodyColour(3500)))).toBe("#FFC786");
    expect(hexOf(toRhino(hotBodyColour(4000)))).toBe("#FFD4A0");
  });

  it("gives colours optimize names by the same temperature", () => {
    for (let kelvin = 2000; kelvin <= 12000; kelvin += 250) {
      const pasted = fromHex(hexOf(toRhino(hotBodyColour(kelvin))))!;
      expect(Math.abs(kelvinOf(fromRhino(pasted))! - kelvin)).toBeLessThanOrEqual(0.035 * kelvin);
    }
  });

  it("goes between temperatures in the table", () => {
    const [, green] = hotBodyColour(2750);
    expect(green).toBeGreaterThan(hotBodyColour(2700)[1]);
    expect(green).toBeLessThan(hotBodyColour(2800)[1]);
  });

  it("reads a hex code with or without its hash, and nothing else", () => {
    expect(fromHex("#FF0000")).toEqual([1, 0, 0]);
    expect(fromHex(" ffad55 ")).toEqual(fromHex("#FFAD55"));
    expect(fromHex("#FFF")).toBeUndefined();
    expect(fromHex("warm")).toBeUndefined();
  });
});
