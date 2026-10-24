import type { Raycaster, Scene, WebGLRenderer } from "three";
import { BODY, collisionMesh } from "./collision";
import { Door, DOOR_DESCRIBED, HINGED_DOOR, SLIDING_DOOR } from "./doors";
import { buttonUnder, Elevator, ELEVATOR, ELEVATOR_DESCRIBED } from "./elevators";
import type { Downloads } from "./download";
import { LAYERS, loadConfig, loadEnvironment, loadModel, loadSharpSky, type EnvironmentFiles } from "./environment";
import { MATERIALS_DESCRIBED, Surfaces } from "./materials";
import { groundsOf, Scatter, SCATTER_DESCRIBED, tuftOf } from "./scatter";
import { WIND, WIND_DESCRIBED, type WindSettings } from "./wind";
import { Faces, FACES_DESCRIBED } from "./faces";
import { OCCLUSION_DESCRIBED, type AmbientOcclusion } from "./occlusion";
import { applyConfig, section, type Config, type Section } from "./settings";
import { Steering, STEERING_DESCRIBED } from "./steering";

/** An environment's files and its config file. */
export interface EnvironmentAddress {
  files: EnvironmentFiles;
  config: string;
  /** Where the file a scatter mark copies lies, by the mark's name, such as "grass". */
  scatter: (name: string) => string;
  /** For testing, a spot to open at instead of the start spot: x and z on the floor plan, and heading. */
  at?: { x: number; z: number; heading: number };
}

/** The environment the link opens. */
export const TEST_ENVIRONMENT: EnvironmentAddress = {
  files: {
    model: `${import.meta.env.BASE_URL}models/test-environment.glb`,
    smallSkyPicture: `${import.meta.env.BASE_URL}skies/golden_gate_hills_8k-small.jpg`,
    smallSkyLight: `${import.meta.env.BASE_URL}skies/golden_gate_hills_8k-small.hdr`,
    skyPicture: `${import.meta.env.BASE_URL}skies/golden_gate_hills_8k.jpg`,
    skyLight: `${import.meta.env.BASE_URL}skies/golden_gate_hills_8k.hdr`,
    bakedLight: `${import.meta.env.BASE_URL}models/test-environment-light.webp`,
  },
  config: `${import.meta.env.BASE_URL}models/test-environment-config.md`,
  scatter: (name) => `${import.meta.env.BASE_URL}models/scatter/${name}.glb`,
};

/** What the environment is opened into. */
export interface Walkthrough {
  renderer: WebGLRenderer;
  scene: Scene;
  /** Null where the device cannot work out ambient occlusion. */
  occlusion: AmbientOcclusion | null;
  /** Fetches every file, trying again until it arrives. */
  downloads: Downloads;
}

/** An opened environment, ready for its first frame. */
export interface Opened {
  steering: Steering;
  /** Which faces of the environment are drawn; `update` it each frame. */
  faces: Faces;
  /** The settings the ?config panel changes while walking, in its order. */
  sections: Section[];
  /** What is wrong with the environment's marks, for the ?config panel. */
  warnings: string[];
  /** The wind everything that sways moves in; `blow` it each frame. */
  wind: WindSettings;
  /** Copies grown over marked surfaces; `update` each every frame. */
  scatters: Scatter[];
  /** Surfaces that may show relief or shine; `apply` them every frame. */
  surfaces: Surfaces;
  /** Doors that open by themselves; move them on every frame, after steering. */
  doors: { update(seconds: number): void };
  /** Elevators: move them on every frame, after steering, and tell them of taps. */
  elevators: { update(seconds: number): void; tap(raycaster: Raycaster): void };
}

/**
 * The trailing download, in order, each part fading in or sharpening what is
 * there as it arrives. Ambient occlusion fades in by itself once its method
 * has arrived.
 */
async function trail(
  environment: EnvironmentAddress,
  scatters: { name: string; scatter: Scatter }[],
  { renderer, scene, occlusion, downloads }: Walkthrough,
) {
  await occlusion?.ready();
  for (const { name, scatter } of scatters) {
    try {
      scatter.grow(tuftOf(await loadModel(environment.scatter(name), downloads)));
    } catch (error) {
      console.warn(`The ${name} for scatter-${name} could not be grown.`, error);
    }
  }
  await loadSharpSky(
    environment.files,
    renderer,
    downloads,
    (light) => {
      scene.environment?.dispose();
      scene.environment = light;
    },
    (picture) => {
      (scene.background as { dispose?: () => void } | null)?.dispose?.();
      scene.background = picture;
    },
  );
}

/** Use what the config file sets in these sections, saying in the console what it could not. */
function configure(sections: Section[], config: Config) {
  for (const section of sections.filter(({ inFile }) => inFile)) {
    const refused = applyConfig(section, config[section.heading.toLowerCase()]);
    if (refused.length > 0) {
      console.warn(`The config file's ${section.heading} section could not use ${refused.join("; ")}.`);
    }
  }
}

function steeringSections(steering: Steering): Section[] {
  const { walking, running, coasting, joystick, zoom } = steering.settings;
  const described = STEERING_DESCRIBED;
  return [
    section("Walking", walking, described.walking),
    section("Running", running, described.running),
    section("Coasting", coasting, described.coasting),
    section("Joystick", joystick, described.joystick),
    section("Zoom", zoom, described.zoom, true),
  ];
}

/** The name the config file gives the environment, for the loading screen. */
function nameOf(config: Config): string | undefined {
  const name = config.environment?.name;
  return name === undefined || name === "" ? undefined : String(name);
}

/**
 * Download an environment's opening download into the scene and steer from
 * its start spot, with its config file's settings. Resolves once the viewer
 * can move; the trailing download then follows on its own: ambient occlusion,
 * then the sharp sky light and the sharp sky picture (#14). Rejects if the
 * start spot is not over the collision mesh. `onProgress` gets the fraction
 * downloaded, or undefined while the sizes are unknown, and `onName` the
 * environment's name once the config file has said it.
 */
export async function openEnvironment(
  environment: EnvironmentAddress,
  { renderer, scene, occlusion, downloads }: Walkthrough,
  onProgress: (fraction: number | undefined) => void,
  onName: (name: string) => void = () => {},
): Promise<Opened> {
  const occlusionSections = occlusion
    ? [section("Ambient occlusion", occlusion.settings, OCCLUSION_DESCRIBED, true)]
    : [];
  const config = loadConfig(environment.config).then((read) => {
    const name = nameOf(read);
    if (name) onName(name);
    configure(occlusionSections, read);
    return read;
  });
  const loaded = await loadEnvironment(environment.files, renderer, downloads, onProgress);
  scene.add(loaded.visible);
  const faces = new Faces(loaded.visible);
  scene.background = loaded.skyPicture;
  scene.environment = loaded.skyLight;
  for (const warning of loaded.warnings) console.warn(warning);
  // Doors' walls move, so collision asks them where they stand each time.
  const hinged = { ...HINGED_DOOR };
  const sliding = { ...SLIDING_DOOR };
  const doors = loaded.doors.map(
    ({ motion, leaves }) => new Door(motion, leaves, motion.kind === "hinged" ? hinged : sliding),
  );
  const lifting = { ...ELEVATOR };
  const elevators = loaded.elevators.map((parts) => new Elevator(parts, lifting, sliding));
  const collision = collisionMesh(loaded.collision, BODY, () => [
    ...doors.flatMap((door) => door.walls()),
    ...elevators.flatMap((elevator) => elevator.triangles()),
  ]);
  const { terrain, floorAt } = collision;
  if (!loaded.start) {
    throw new Error("The environment has no start spot; run `npm run optimize` again.");
  }
  // The start line is drawn near the floor the viewer stands on.
  const { x, y, z, heading } = environment.at ? { ...environment.at, y: loaded.start.y } : loaded.start;
  const floor = floorAt(x, z, y);
  if (floor === undefined) {
    throw new Error("The start spot is not over the collision mesh.");
  }
  const steering = new Steering({ terrain, start: { x, z, floor, heading, pitch: 0 } });
  // Steering's sections exist only once it does.
  const sections = steeringSections(steering);
  const surfaces = new Surfaces(loaded.shiny, loaded.glass);
  // Copies grow once their file arrives; their settings are there from the start.
  const wind = { ...WIND };
  const scatters = loaded.scatter.map(({ name, layer }) => {
    const scatter = new Scatter(groundsOf(layer), loaded.bakedLight, LAYERS.sway);
    scene.add(scatter.group);
    return { name, scatter };
  });
  const kinds = new Set(loaded.doors.map(({ motion }) => motion.kind));
  if (kinds.has("hinged")) sections.push(section("door-hinged", hinged, DOOR_DESCRIBED, true));
  if (kinds.has("sliding") || elevators.length > 0) sections.push(section("door-sliding", sliding, DOOR_DESCRIBED, true));
  if (elevators.length > 0) sections.push(section("elevator", lifting, ELEVATOR_DESCRIBED, true));
  sections.push(
    section("Materials", surfaces.settings, MATERIALS_DESCRIBED, true),
    section("Wind", wind, WIND_DESCRIBED, true),
    ...scatters.map(({ name, scatter }) => section(`scatter-${name}`, scatter.settings, SCATTER_DESCRIBED, true)),
  );
  configure(sections, await config);
  surfaces.apply(true);
  if (occlusion) occlusion.bakedLight = loaded.bakedLight ?? null;
  void trail(environment, scatters, { renderer, scene, occlusion, downloads });
  return {
    steering,
    faces,
    sections: [...occlusionSections, section("Faces", faces.settings, FACES_DESCRIBED), ...sections],
    warnings: loaded.warnings,
    wind,
    scatters: scatters.map(({ scatter }) => scatter),
    surfaces,
    doors: {
      update: (seconds) => {
        for (const door of doors) door.update(seconds, collision, steering);
      },
    },
    elevators: {
      update: (seconds) => {
        for (const elevator of elevators) elevator.update(seconds, collision, steering);
      },
      tap: (raycaster) => {
        for (const elevator of elevators) {
          const button = buttonUnder(raycaster, scene, elevator.pressable);
          if (button) elevator.press(button);
        }
      },
    },
  };
}
