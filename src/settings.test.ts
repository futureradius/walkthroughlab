import { describe, expect, it } from "vitest";
import { applySettings, readSettings, writeSettings } from "./settings";

const file = `# Settings for an environment

Notes like this one are ignored, even with a colon: like so.

## Ambient occlusion

How far a surface looks for neighbours, in metres.

- reach: 0.2
- smooth: yes
- on: no
- method: n8ao

## Something later

- reach: 5
`;

describe("settings", () => {
  it("reads the values listed under each heading", () => {
    expect(readSettings(file)["ambient occlusion"]).toEqual({
      reach: 0.2,
      smooth: true,
      on: false,
      method: "n8ao",
    });
    expect(readSettings(file)["something later"]).toEqual({ reach: 5 });
  });

  it("reads nothing from a file without headings", () => {
    expect(readSettings("- reach: 0.2")).toEqual({});
  });

  it("reads back what it writes", () => {
    const values = { on: true, reach: 0.35, method: "gtao" };
    const written = writeSettings("Ambient occlusion", values);
    expect(readSettings(written)).toEqual({ "ambient occlusion": values });
  });

  it("changes only the settings it is given", () => {
    const settings = { reach: 0.2, smooth: true, samples: 8 };
    expect(applySettings(settings, { reach: 0.5, smooth: false })).toEqual([]);
    expect(settings).toEqual({ reach: 0.5, smooth: false, samples: 8 });
  });

  it("leaves out names it does not know and values of the wrong kind", () => {
    const settings = { reach: 0.2, smooth: true };
    expect(applySettings(settings, { reech: 0.5, smooth: 1 })).toEqual(["reech", "smooth"]);
    expect(settings).toEqual({ reach: 0.2, smooth: true });
  });
});
