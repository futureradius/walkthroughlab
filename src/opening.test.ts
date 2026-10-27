import { Group, PerspectiveCamera, Scene, Texture, type WebGLRenderer } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Downloads } from "./download";
import { loadEnvironment, loadSharpSky, type Environment } from "./environment";
import { WALKING } from "./motion";
import { AmbientOcclusion, METHODS, OCCLUSION, type Method, type OcclusionWorkings } from "./occlusion";
import { openEnvironment, type EnvironmentAddress } from "./opening";
import { ZOOM } from "./zoom";

// Unpacking a real environment's sky needs WebGL, so the tests hand over one of their own.
vi.mock("./environment", async (original) => ({
  ...(await original<typeof import("./environment")>()),
  loadEnvironment: vi.fn(),
  loadSharpSky: vi.fn(async () => {}),
}));

const ADDRESS: EnvironmentAddress = {
  files: {
    model: "model.glb",
    smallSkyPicture: "sky-small.jpg",
    smallSkyLight: "sky-small.hdr",
    skyPicture: "sky.jpg",
    skyLight: "sky.hdr",
    bakedLight: "light.webp",
  },
  config: "config.md",
  scatter: (name) => `${name}.glb`,
  prop: (name) => `props/${name}.glb`,
  traffic: (name) => `traffic/${name}.glb`,
};

/** A square of floor 10 m across around the origin, 2 m up. */
const FLOOR = new Float32Array([
  -5, 2, -5, 5, 2, -5, 5, 2, 5,
  -5, 2, -5, 5, 2, 5, -5, 2, 5,
]);

const CONFIG = `
# Config file

## Environment

- name: Test Environment #1

## Ambient occlusion

- method: glamarye
- reach: 0.5

## Zoom

- max: 2
- upright: lots
`;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A gate the test opens when it chooses. */
function gate<T = void>() {
  let open!: (value: T) => void;
  const opened = new Promise<T>((resolve) => (open = resolve));
  return { opened, open };
}

/** Ambient occlusion with methods that only note what was fetched, and wait for `arrive`. */
function occlusionFor(scene: Scene, arrive: Promise<void> = Promise.resolve()) {
  const fetched: string[] = [];
  const methods: Method[] = METHODS.map(({ name, uses }) => ({
    name,
    uses,
    load: async () => {
      fetched.push(name);
      await arrive;
      return {} as OcclusionWorkings;
    },
  }));
  const occlusion = new AmbientOcclusion({} as WebGLRenderer, scene, new PerspectiveCamera(), methods);
  return { occlusion, fetched };
}

/** An environment as `npm run optimize` left it, its start line drawn on the floor. */
function environment(start = { x: 1, y: 2, z: -2, heading: 0.5 }): Environment {
  return {
    visible: new Group(),
    collision: FLOOR,
    skyPicture: new Texture(),
    skyLight: new Texture(),
    bakedLight: [new Texture()],
    start,
    warnings: [],
    scatter: [],
    cloths: [],
    props: [],
    traffic: [],
    doors: [],
    elevators: [],
    sounds: {},
    placedSounds: [],
    shiny: [],
    glass: [],
    water: [],
  };
}

/** Serve this config file, or none. */
function serve(config: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (address: string) =>
      address === ADDRESS.config && config !== null ? new Response(config) : new Response("", { status: 404 }),
    ),
  );
}

/** Open the environment into a fresh scene. */
function open(options: { occlusion?: boolean; arrive?: Promise<void>; address?: EnvironmentAddress } = {}) {
  const scene = new Scene();
  const { occlusion, fetched } = occlusionFor(scene, options.arrive);
  const names: string[] = [];
  const opening = openEnvironment(
    options.address ?? ADDRESS,
    {
      renderer: {} as WebGLRenderer,
      scene,
      occlusion: options.occlusion === false ? null : occlusion,
      downloads: new Downloads(),
    },
    () => {},
    (name) => names.push(name),
  );
  return { scene, occlusion, fetched, opening, names };
}

beforeEach(() => {
  serve(CONFIG);
  vi.mocked(loadEnvironment).mockResolvedValue(environment());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("opening an environment", () => {
  it("fetches the ambient occlusion method the config file names only after the opening download", async () => {
    const download = gate<Environment>();
    vi.mocked(loadEnvironment).mockReturnValue(download.opened);
    const { fetched, opening } = open();
    await tick();
    expect(fetched).toEqual([]);
    download.open(environment());
    await opening;
    await tick();
    expect(fetched).toEqual(["glamarye"]);
  });

  it("lets the viewer move before ambient occlusion has arrived, and sharpens the sky after it", async () => {
    const arrival = gate();
    const { opening } = open({ arrive: arrival.opened });
    await opening;
    await tick();
    expect(loadSharpSky).not.toHaveBeenCalled();
    arrival.open();
    await tick();
    await tick();
    expect(loadSharpSky).toHaveBeenCalledOnce();
  });

  it("tells the loading screen the environment's name from the config file", async () => {
    const { opening, names } = open();
    await opening;
    expect(names).toEqual(["Test Environment #1"]);
  });

  it("uses the config file's settings and reports those it cannot use", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { occlusion, opening } = open();
    const { steering } = await opening;
    expect(occlusion.settings.reach).toBe(0.5);
    expect(steering.settings.zoom.max).toBe(2);
    expect(steering.settings.zoom.upright).toBe(ZOOM.upright);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/Zoom section could not use upright/);
  });

  it("keeps the usual settings without a config file", async () => {
    serve(null);
    const { occlusion, fetched, opening, names } = open();
    const { steering } = await opening;
    await tick();
    expect(occlusion.settings).toEqual(OCCLUSION);
    expect(steering.settings.zoom).toEqual(ZOOM);
    expect(fetched).toEqual([OCCLUSION.method]);
    expect(names).toEqual([]);
  });

  it("starts at the start spot, on the floor there", async () => {
    const { opening } = open();
    const { steering } = await opening;
    const view = steering.step(
      { knob: { x: 0, y: 0 }, keys: { walk: 0, sidestep: 0, turn: 0, run: false } },
      0,
      { width: 400, height: 800 },
    );
    expect(view).toMatchObject({ x: 1, z: -2, heading: 0.5, pitch: 0 });
    expect(view.y).toBeCloseTo(2 + WALKING.eyeHeight);
  });

  it("fails when the start spot is not over the collision mesh", async () => {
    vi.mocked(loadEnvironment).mockResolvedValue(environment({ x: 50, y: 0, z: 50, heading: 0 }));
    const { opening } = open();
    await expect(opening).rejects.toThrow(/start spot is not over the collision mesh/);
  });

  it("stands on the floor nearest the start line's height, on a spot with floors above each other", async () => {
    const upstairs = FLOOR.map((value, i) => (i % 3 === 1 ? 5.5 : value));
    vi.mocked(loadEnvironment).mockResolvedValue({
      ...environment({ x: 1, y: 5.5, z: -2, heading: 0 }),
      collision: Float32Array.from([...FLOOR, ...upstairs]),
    });
    const { opening } = open();
    const { steering } = await opening;
    const view = steering.step(
      { knob: { x: 0, y: 0 }, keys: { walk: 0, sidestep: 0, turn: 0, run: false } },
      0,
      { width: 400, height: 800 },
    );
    expect(view.y).toBeCloseTo(5.5 + WALKING.eyeHeight);
  });

  it("passes on the warnings about the marks, and says them in the console", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(loadEnvironment).mockResolvedValue({ ...environment(), warnings: ["door-hinged-2: no collision mesh"] });
    const { opening } = open();
    const { warnings } = await opening;
    expect(warnings).toEqual(["door-hinged-2: no collision mesh"]);
    expect(warn).toHaveBeenCalledWith("door-hinged-2: no collision mesh");
  });

  it("puts the environment and its sky in place", async () => {
    const loaded = environment();
    vi.mocked(loadEnvironment).mockResolvedValue(loaded);
    const { scene, opening } = open();
    await opening;
    expect(scene.children).toContain(loaded.visible);
    expect(scene.background).toBe(loaded.skyPicture);
    expect(scene.environment).toBe(loaded.skyLight);
  });

  it("gives the sections in the panel's order", async () => {
    const { opening } = open();
    const { sections } = await opening;
    expect(sections.map(({ heading }) => heading)).toEqual([
      "Ambient occlusion",
      "Faces",
      "Walking",
      "Running",
      "Coasting",
      "Joystick",
      "Zoom",
      "Materials",
      "Wind",
    ]);
  });

  it("opens without ambient occlusion where the device cannot work it out", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetched, opening } = open({ occlusion: false });
    const { steering, sections } = await opening;
    expect(fetched).toEqual([]);
    expect(sections.map(({ heading }) => heading)).not.toContain("Ambient occlusion");
    expect(steering.settings.zoom.max).toBe(2);
  });

  it("lets the link turn sound on or off, whatever the config file says", async () => {
    vi.mocked(loadEnvironment).mockResolvedValue({ ...environment(), sounds: { ambient: { file: "ambient.webm", loop: 120 } } });
    serve(`${CONFIG}
## Sound

- on: no
`);
    expect((await open().opening).sounds.sound).toEqual({ on: false, ambient: true });
    serve(`${CONFIG}
## Sound

- on: no
`);
    expect((await open({ address: { ...ADDRESS, sound: "on" } }).opening).sounds.sound).toEqual({ on: true, ambient: true });
    expect((await open({ address: { ...ADDRESS, sound: "no-ambient" } }).opening).sounds.sound).toEqual({ on: true, ambient: false });
  });
});
