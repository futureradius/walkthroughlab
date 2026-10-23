import { describe, expect, it } from "vitest";
import { NET, SafetyNet } from "./safetynet";

/** Feed the net these frame rates, one second apart from `start`; returns when it is now. */
function feed(net: SafetyNet, rates: number[], start = 0) {
  rates.forEach((rate, i) => net.second(rate, start + i));
  return start + rates.length;
}

const slow = (seconds: number) => Array(seconds).fill(20);
const steady = (seconds: number) => Array(seconds).fill(60);

describe("the safety net", () => {
  it("steps down only after two slow seconds in a row: ambient occlusion first, then resolution, stopping at 1", () => {
    const net = new SafetyNet(2, true);
    feed(net, [20, 40, 20]);
    expect(net.current).toEqual({ occlusion: true, pixelRatio: 2 });
    feed(net, slow(1), 3);
    expect(net.current).toEqual({ occlusion: false, pixelRatio: 2 });
    feed(net, slow(2), 4);
    expect(net.current).toEqual({ occlusion: false, pixelRatio: 1.5 });
    feed(net, slow(10), 6);
    expect(net.current).toEqual({ occlusion: false, pixelRatio: 1 });
    expect(net.describe()).toBe(" · no AO · 1×");
  });

  it("leaves a phone held at 30 by battery saver alone", () => {
    const net = new SafetyNet(2, true);
    feed(net, [29, 30, 29, 31, 29, 30]);
    expect(net.describe()).toBe("");
  });

  it("steps back up, resolution first, after five steady seconds each", () => {
    const net = new SafetyNet(2, true);
    let now = feed(net, slow(4));
    expect(net.current.pixelRatio).toBe(1.5);
    now = feed(net, steady(4), now);
    expect(net.current.pixelRatio).toBe(1.5);
    now = feed(net, steady(1), now);
    expect(net.current).toEqual({ occlusion: false, pixelRatio: 2 });
    feed(net, steady(5), now + NET.relapseSeconds);
    expect(net.current).toEqual({ occlusion: true, pixelRatio: 2 });
  });

  it("undoes a step back up that does not hold, and does not try it again", () => {
    const net = new SafetyNet(2, true);
    let now = feed(net, slow(2));
    now = feed(net, steady(5), now);
    expect(net.current.occlusion).toBe(true);
    now = feed(net, slow(1), now + 3);
    expect(net.current.occlusion).toBe(false);
    feed(net, steady(30), now);
    expect(net.current.occlusion).toBe(false);
  });

  it("counts a slow second long after a step back up as an ordinary one", () => {
    const net = new SafetyNet(2, true);
    let now = feed(net, slow(2));
    now = feed(net, steady(5), now);
    now = feed(net, slow(1), now + NET.relapseSeconds + 1);
    expect(net.current.occlusion).toBe(true);
    feed(net, slow(1), now);
    expect(net.current.occlusion).toBe(false);
  });

  it("only lowers resolution where the device draws above it, and skips ambient occlusion it does not have", () => {
    expect(new SafetyNet(1, true).levels).toEqual([
      { occlusion: true, pixelRatio: 1 },
      { occlusion: false, pixelRatio: 1 },
    ]);
    expect(new SafetyNet(1.75, false).levels.map(({ pixelRatio }) => pixelRatio)).toEqual([1.75, 1.5, 1]);
  });

  it("gives everything back at once when switched off, and does nothing until switched on", () => {
    const net = new SafetyNet(2, true);
    feed(net, slow(4));
    net.settings.on = false;
    expect(net.current).toEqual({ occlusion: true, pixelRatio: 2 });
    feed(net, slow(10), 4);
    net.settings.on = true;
    expect(net.current).toEqual({ occlusion: true, pixelRatio: 2 });
  });
});
