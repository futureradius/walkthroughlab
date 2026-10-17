import { describe, expect, it } from "vitest";
import testEnvironmentConfig from "../public/models/test-environment-config.md?raw";
import { COASTING } from "./coasting";
import { WALKING } from "./motion";
import { OCCLUSION, OCCLUSION_DESCRIBED } from "./occlusion";
import { RUNNING } from "./running";
import {
  applyConfig,
  choice,
  fixed,
  number,
  readConfig,
  section,
  shown,
  toggle,
  writeConfig,
  type Described,
  type Section,
} from "./settings";
import { JOYSTICK, STEERING_DESCRIBED } from "./steering";
import { ZOOM } from "./zoom";

const file = `# Config file for an environment

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

interface Example {
  on: boolean;
  alone: boolean;
  method: string;
  reach: number;
  samples: number;
  falloff: number;
}

const EXAMPLE: Example = { on: true, alone: false, method: "n8ao", reach: 0.2, samples: 12, falloff: 3 };

const EXAMPLE_DESCRIBED: Described<Example> = {
  on: toggle({ label: "On", about: "On or off." }),
  alone: toggle({ label: "Alone", about: "Only while tuning.", panelOnly: true }),
  method: choice({ label: "Method", words: ["gtao", "n8ao"], about: "How." }),
  reach: number({ label: "Reach", min: 0.05, max: 2, step: 0.05, show: fixed(2), about: "How far." }),
  samples: number({ label: "Samples", min: 1, max: 32, step: 1, show: String, about: "How many." }),
  falloff: number({
    label: "Falloff",
    min: 0.1,
    max: 5,
    step: 0.1,
    show: fixed(1),
    about: "N8AO's own.",
    when: { method: ["n8ao"] },
  }),
};

const example = () => section("Example", { ...EXAMPLE }, EXAMPLE_DESCRIBED, true);

describe("reading a config file", () => {
  it("reads the values listed under each heading", () => {
    expect(readConfig(file)["ambient occlusion"]).toEqual({
      reach: 0.2,
      smooth: true,
      on: false,
      method: "n8ao",
    });
    expect(readConfig(file)["something later"]).toEqual({ reach: 5 });
  });

  it("reads nothing from a file without headings", () => {
    expect(readConfig("- reach: 0.2")).toEqual({});
  });
});

describe("applying a config file", () => {
  it("changes only the settings it is given", () => {
    const settings = example();
    expect(applyConfig(settings, { reach: 0.5, on: false, method: "gtao" })).toEqual([]);
    expect(settings.settings).toEqual({ ...EXAMPLE, reach: 0.5, on: false, method: "gtao" });
  });

  it("leaves out what it cannot use, saying why, and keeps the usual values", () => {
    const settings = example();
    const refused = applyConfig(settings, {
      reech: 0.5,
      on: 1,
      reach: 40,
      samples: 6.5,
      method: "n8a0",
      alone: true,
      falloff: "far",
    });
    expect(refused).toEqual([
      "reech: is not a setting",
      "on: 1 is not yes or no",
      "reach: 40 is not from 0.05 to 2",
      "samples: 6.5 is not a whole number",
      "method: n8a0 is not one of gtao, n8ao",
      "alone: is only for the ?config panel",
      "falloff: far is not a number",
    ]);
    expect(settings.settings).toEqual(EXAMPLE);
  });

  it("does not take names that only objects have for settings", () => {
    expect(applyConfig(example(), { toString: 1 })).toEqual(["toString: is not a setting"]);
  });

  it("reads back what the panel copies, leaving out what is only for the panel", () => {
    const tuned = example();
    Object.assign(tuned.settings, { on: false, alone: true, method: "gtao", reach: 0.35 });
    const written = writeConfig(tuned);
    expect(written).not.toContain("alone");
    const fresh = example();
    expect(applyConfig(fresh, readConfig(written).example)).toEqual([]);
    expect(fresh.settings).toEqual({ ...tuned.settings, alone: false });
  });
});

describe("showing settings in the panel", () => {
  it("shows a method's own settings only while it is chosen", () => {
    const settings = example();
    expect(shown(settings)).toContain("falloff");
    settings.settings.method = "gtao";
    expect(shown(settings)).not.toContain("falloff");
    expect(shown(settings)).toContain("reach");
  });

  it("shows each ambient occlusion method its own settings", () => {
    const occlusion = section("Ambient occlusion", { ...OCCLUSION }, OCCLUSION_DESCRIBED);
    const rows = (method: string) => {
      occlusion.settings.method = method;
      return shown(occlusion);
    };
    expect(rows("glamarye")).toEqual(expect.arrayContaining(["points", "shade", "blur"]));
    expect(rows("glamarye")).not.toContain("samples");
    expect(rows("n8ao")).toEqual(expect.arrayContaining(["samples", "falloff", "edges"]));
    expect(rows("n8ao")).not.toContain("points");
    expect(rows("gtao")).not.toContain("falloff");
  });
});

describe("every section", () => {
  const sections: Section[] = [
    section("Ambient occlusion", { ...OCCLUSION }, OCCLUSION_DESCRIBED, true),
    section("Walking", { ...WALKING }, STEERING_DESCRIBED.walking),
    section("Running", { ...RUNNING }, STEERING_DESCRIBED.running),
    section("Coasting", { ...COASTING }, STEERING_DESCRIBED.coasting),
    section("Joystick", { ...JOYSTICK }, STEERING_DESCRIBED.joystick),
    section("Zoom", { ...ZOOM }, STEERING_DESCRIBED.zoom, true),
  ];

  it.each(sections.map((s) => [s.heading, s] as const))(
    "%s starts from usual values its descriptions allow",
    (_heading, { settings, described }) => {
      expect(Object.keys(described).sort()).toEqual(Object.keys(settings).sort());
      const panelOnly = Object.keys(described).filter((name) => described[name].panelOnly);
      const usual = Object.fromEntries(
        Object.entries(settings).filter(([name]) => !panelOnly.includes(name)),
      );
      const copy: Section = { heading: "Copy", settings: { ...settings }, described, inFile: true };
      expect(applyConfig(copy, usual)).toEqual([]);
    },
  );

  it("can use everything the test environment's config file sets", () => {
    const config = readConfig(testEnvironmentConfig);
    for (const inFile of sections.filter((s) => s.inFile)) {
      expect(applyConfig(inFile, config[inFile.heading.toLowerCase()])).toEqual([]);
    }
  });
});
