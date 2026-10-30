import type { Raycaster, Scene, Texture, WebGLRenderer } from "three";
import { BODY, collisionMesh } from "./collision";
import { Door, DOOR_DESCRIBED, HINGED_DOOR, SLIDING_DOOR } from "./doors";
import { buttonUnder, Elevator, ELEVATOR, ELEVATOR_DESCRIBED } from "./elevators";
import type { Downloads } from "./download";
import { LAYERS, loadConfig, loadEnvironment, loadModel, loadSharpSky, type EnvironmentFiles } from "./environment";
import { MATERIALS_DESCRIBED, Surfaces } from "./materials";
import { Crowns, leavesOf, PROP, PROP_DESCRIBED, propSway, STILL_PROP_DESCRIBED } from "./props";
import { groundsOf, Scatter, SCATTER_DESCRIBED, tuftOf } from "./scatter";
import { CLOTH_DESCRIBED, clothSettings } from "./cloth";
import { birdOf, FLOCK_DESCRIBED, Flocks } from "./flock";
import { Water, WATER_DESCRIBED } from "./water";
import { WIND, WIND_DESCRIBED, type WindSettings } from "./wind";
import { Faces, FACES_DESCRIBED } from "./faces";
import { OCCLUSION_DESCRIBED, type AmbientOcclusion } from "./occlusion";
import { applyConfig, section, type Config, type Section } from "./settings";
import { Steering, STEERING_DESCRIBED } from "./steering";
import { quietMoment, sharpenTextures, type Pace } from "./textures";
import { AMBIENT_DESCRIBED, FOOTSTEPS_DESCRIBED, HEARD_DESCRIBED, PLACED_DESCRIBED, SOUND_DESCRIBED, Sounds } from "./sound";

/** An environment's files and its config file. */
export interface EnvironmentAddress {
  files: EnvironmentFiles;
  config: string;
  /** Where the sharp picture of a texture lies, by the name `npm run optimize` gave it. */
  texture: (name: string) => string;
  /** Where the file a scatter mark copies lies, by the mark's name, such as "grass". */
  scatter: (name: string) => string;
  /** Where the swaying parts of a prop lie, by its mark's name, such as "tree". */
  prop: (name: string) => string;
  /** Where the file a traffic mark flies lies, by the mark's name, such as "birds". */
  traffic: (name: string) => string;
  /** For testing, a spot to open at instead of the start spot: x and z on the floor plan, heading, and near which floor height. */
  at?: { x: number; z: number; heading: number; y?: number };
  /** From the link, a named view to open at instead of the start spot, by the name after `view-` on its layer. */
  view?: string;
  /** From the link, whatever the config file says: all sound on or off, or everything but the ambient sound. */
  sound?: "on" | "off" | "no-ambient";
}

/** The environment the link opens. */
export const TEST_ENVIRONMENT = "test-environment";

/** Where the files of the environment of this name lie, beside the page. */
export function addressOf(name: string): EnvironmentAddress {
  return {
    files: {
      model: `${import.meta.env.BASE_URL}models/${name}.glb`,
      smallSkyPicture: `${import.meta.env.BASE_URL}skies/golden_gate_hills_8k-small.jpg`,
      smallSkyLight: `${import.meta.env.BASE_URL}skies/golden_gate_hills_8k-small.hdr`,
      skyPicture: `${import.meta.env.BASE_URL}skies/golden_gate_hills_8k.jpg`,
      skyLight: `${import.meta.env.BASE_URL}skies/golden_gate_hills_8k.hdr`,
      bakedLight: `${import.meta.env.BASE_URL}models/${name}-light-`,
    },
    config: `${import.meta.env.BASE_URL}models/${name}-config.md`,
    texture: (texture) => `${import.meta.env.BASE_URL}models/${name}-textures/${texture}.webp`,
    scatter: (name) => `${import.meta.env.BASE_URL}models/scatter/${name}.glb`,
    prop: (name) => `${import.meta.env.BASE_URL}models/props/${name}.glb`,
    traffic: (name) => `${import.meta.env.BASE_URL}models/traffic/${name}.glb`,
  };
}

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
  /** Props' swaying parts, such as trees' crowns; move them on every frame. */
  props: { update(seconds: number): void };
  /** Flocks of traffic, such as birds; move them on every frame, `still` for viewers who ask for reduced motion. */
  traffic: { update(seconds: number, still: boolean): void };
  /** Surfaces that may show relief or shine; `apply` them every frame. */
  surfaces: Surfaces;
  /** The environment's water, if any; move its waves on every frame, after the wind. */
  water: Water;
  /** Doors that open by themselves; move them on every frame, after steering. */
  doors: { update(seconds: number): void };
  /** Elevators: move them on every frame, after steering, and tell them of taps. */
  elevators: { update(seconds: number): void; tap(raycaster: Raycaster): void };
  /** Everything the viewer hears; `update` it every frame, after steering. */
  sounds: Sounds;
}

/** Seconds a part of the trailing download may take before the console hears it is still awaited. */
const SLOW_SECONDS = 20;

/** Wait for a part of the trailing download, saying so if it takes long. */
async function awaited<T>(what: string, part: Promise<T>): Promise<T> {
  const timer = setTimeout(
    () => console.warn(`The trailing download has waited ${SLOW_SECONDS} s for ${what}, and holds everything after it.`),
    SLOW_SECONDS * 1000,
  );
  try {
    return await part;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The trailing download, in order, each part fading in or sharpening what is
 * there as it arrives. Textures come first, since a blurred surface shows the
 * most, and finer pictures of the biggest of them last of all, so the walkthrough
 * goes on improving even on a weak connection. Ambient occlusion fades in by
 * itself once its method has arrived, and water's waves rise once their pictures
 * are made.
 */
async function trail(
  environment: EnvironmentAddress,
  textures: Map<string, Texture[]>,
  finerTextures: string[],
  steering: Steering,
  scatters: { name: string; scatter: Scatter }[],
  swaying: { name: string; crowns: Crowns }[],
  traffic: { name: string; flocks: Flocks }[],
  water: Water,
  sounds: Sounds,
  { renderer, scene, occlusion, downloads }: Walkthrough,
) {
  const pace: Pace = { moment: () => quietMoment(() => steering.still), upload: (texture) => renderer.initTexture(texture) };
  // Handed over at a walking viewer's pace, which nothing after them should have to wait for.
  const sharp = sharpenTextures(textures, environment.texture, downloads, { pace });
  await awaited("ambient occlusion", occlusion?.ready() ?? Promise.resolve());
  // Made here rather than downloaded; flat until then.
  water.grow();
  for (const { name, scatter } of scatters) {
    try {
      scatter.grow(tuftOf(await awaited(`the ${name}`, loadModel(environment.scatter(name), downloads))));
    } catch (error) {
      console.warn(`The ${name} for scatter-${name} could not be grown.`, error);
    }
  }
  for (const { name, crowns } of swaying) {
    try {
      crowns.grow(leavesOf(await awaited(`prop-${name}'s swaying parts`, loadModel(environment.prop(name), downloads))));
    } catch (error) {
      console.warn(`The swaying parts of prop-${name} could not be drawn.`, error);
    }
  }
  await awaited(
    "the sharp sky",
    loadSharpSky(
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
        water.sky = picture;
      },
    ),
  );
  for (const { name, flocks } of traffic) {
    try {
      flocks.grow(birdOf(await awaited(`traffic-${name}'s file`, loadModel(environment.traffic(name), downloads))));
    } catch (error) {
      console.warn(`The flocks of traffic-${name} could not be drawn.`, error);
    }
  }
  // Sound comes after everything seen (#14).
  await sounds.download(downloads, import.meta.env.BASE_URL);
  await sharp;
  const finer = new Map(finerTextures.flatMap((name) => (textures.has(name) ? [[name, textures.get(name)!]] : [])));
  await awaited("the finer textures", sharpenTextures(finer, (name) => environment.texture(`${name}-finer`), downloads, { pace }));
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
  const view = environment.view === undefined ? undefined : loaded.views[environment.view];
  if (environment.view !== undefined && !view) {
    loaded.warnings.push(`?view=${environment.view}: there is no view-${environment.view} layer, so the walkthrough opened at the start spot.`);
  }
  for (const warning of loaded.warnings) console.warn(warning);
  // Doors' walls move, so collision asks them where they stand each time.
  const hinged = { ...HINGED_DOOR };
  const sliding = { ...SLIDING_DOOR };
  const doors = loaded.doors.map(
    ({ motion, leaves }) => new Door(motion, leaves, motion.kind === "hinged" ? hinged : sliding),
  );
  const lifting = { ...ELEVATOR };
  const elevators = loaded.elevators.map((parts) => new Elevator(parts, lifting, sliding));
  // Doors and elevators are heard as they move (#33).
  const sounds = new Sounds(loaded.sounds, loaded.placedSounds);
  doors.forEach((door, i) => {
    const kind = loaded.doors[i].motion.kind;
    door.onMove = (opening) => sounds.once(`door-${kind}-${opening ? "open" : "close"}`, door.middle, kind === "hinged" ? hinged : sliding);
  });
  for (const elevator of elevators) {
    const from = () => (elevator.carries(steering.footing) ? null : elevator.middle);
    elevator.onDepart = () => sounds.once("elevator-start", from(), lifting);
    elevator.onArrive = () => sounds.once("elevator-arrive", from(), lifting);
    elevator.onDoors = (opening, at) => sounds.once(`door-sliding-${opening ? "open" : "close"}`, at, sliding);
  }
  const collision = collisionMesh(loaded.collision, BODY, () => [
    ...doors.flatMap((door) => door.walls()),
    ...elevators.flatMap((elevator) => elevator.triangles()),
  ]);
  const { terrain, floorAt } = collision;
  if (!loaded.start) {
    throw new Error("The environment has no start spot; run `npm run optimize` again.");
  }
  // The start line is drawn near the floor the viewer stands on.
  const { x, y, z, heading } = environment.at
    ? { ...environment.at, y: environment.at.y ?? loaded.start.y }
    : view ?? loaded.start;
  const floor = floorAt(x, z, y);
  if (floor === undefined) {
    throw new Error("The start spot is not over the collision mesh.");
  }
  const steering = new Steering({ terrain, start: { x, z, floor, heading, pitch: 0 } });
  // Steering's sections exist only once it does.
  const sections = steeringSections(steering);
  const surfaces = new Surfaces(loaded.shiny, loaded.glass);
  const water = new Water(loaded.water);
  water.sky = loaded.skyPicture;
  // Copies grow once their file arrives; their settings are there from the start.
  const wind = { ...WIND };
  const scatters = loaded.scatter.map(({ name, layer }) => {
    const scatter = new Scatter(groundsOf(layer), LAYERS.sway);
    scene.add(scatter.group);
    return { name, scatter };
  });
  // A prop's settings are there from the start, its swaying parts once they arrive.
  const props = loaded.props.map(({ name, copies, sways }) => {
    const settings = { ...PROP };
    const crowns = sways ? new Crowns(copies, loaded.bakedLight, propSway(name), LAYERS.sway) : undefined;
    if (crowns) scene.add(crowns.group);
    return { name, settings, crowns };
  });
  // Traffic's settings are there from the start, its flocks once their file arrives.
  const traffic = loaded.traffic.map(({ name, loops }) => {
    const flocks = new Flocks(loops, LAYERS.sway);
    scene.add(flocks.group);
    return { name, flocks };
  });
  const kinds = new Set(loaded.doors.map(({ motion }) => motion.kind));
  if (kinds.has("hinged")) sections.push(section("door-hinged", hinged, DOOR_DESCRIBED, true));
  if (kinds.has("sliding") || elevators.length > 0) sections.push(section("door-sliding", sliding, DOOR_DESCRIBED, true));
  if (elevators.length > 0) sections.push(section("elevator", lifting, ELEVATOR_DESCRIBED, true));
  sections.push(
    section("Materials", surfaces.settings, MATERIALS_DESCRIBED, true),
    section("Wind", wind, WIND_DESCRIBED, true),
    ...(water.any ? [section("Water", water.settings, WATER_DESCRIBED, true)] : []),
    ...loaded.cloths.map((name) => section(`sway-${name}`, clothSettings(name), CLOTH_DESCRIBED, true)),
    ...scatters.map(({ name, scatter }) => section(`scatter-${name}`, scatter.settings, SCATTER_DESCRIBED, true)),
    ...props.map(({ name, settings, crowns }) =>
      crowns
        ? section(`prop-${name}`, settings, PROP_DESCRIBED, true)
        : section(`prop-${name}`, settings, STILL_PROP_DESCRIBED, true),
    ),
    ...traffic.map(({ name, flocks }) => section(`traffic-${name}`, flocks.settings, FLOCK_DESCRIBED, true)),
    ...(Object.keys(loaded.sounds).length > 0 ? [section("Sound", sounds.sound, SOUND_DESCRIBED, true)] : []),
    ...(loaded.sounds.ambient ? [section("Ambient sound", sounds.ambient, AMBIENT_DESCRIBED, true)] : []),
    ...(Object.keys(loaded.sounds).some((name) => name.startsWith("footstep-"))
      ? [section("Footsteps", sounds.footsteps, FOOTSTEPS_DESCRIBED, true)]
      : []),
    ...(loaded.placedSounds.length > 0 ? [section("Placed sounds", sounds.placed, PLACED_DESCRIBED, true)] : []),
    ...[...sounds.placedSettings].map(([name, settings]) => section(`sound-${name}`, settings, HEARD_DESCRIBED, true)),
  );
  configure(sections, await config);
  // The link has the last word, so one walkthrough serves walks with and without sound.
  if (environment.sound) Object.assign(sounds.sound, { on: environment.sound !== "off", ambient: environment.sound === "on" });
  surfaces.apply(true);
  const swaying = props.flatMap(({ name, crowns }) => (crowns ? [{ name, crowns }] : []));
  trail(environment, loaded.textures, loaded.finerTextures, steering, scatters, swaying, traffic, water, sounds, { renderer, scene, occlusion, downloads }).catch((error) =>
    console.error("The trailing download stopped, so what comes after the failure never arrives.", error),
  );
  return {
    steering,
    faces,
    sections: [...occlusionSections, section("Faces", faces.settings, FACES_DESCRIBED), ...sections],
    warnings: loaded.warnings,
    wind,
    scatters: scatters.map(({ scatter }) => scatter),
    props: {
      update: (seconds) => {
        for (const { name, settings, crowns } of props) {
          propSway(name).value = settings.sway;
          crowns?.update(seconds);
        }
      },
    },
    traffic: {
      update: (seconds, still) => {
        for (const { flocks } of traffic) flocks.update(seconds, still);
      },
    },
    surfaces,
    water,
    doors: {
      update: (seconds) => {
        for (const door of doors) door.update(seconds, collision, steering);
      },
    },
    elevators: {
      update: (seconds) => {
        for (const elevator of elevators) {
          elevator.update(seconds, collision, steering);
          sounds.hum(elevator, elevator.travelling, elevator.middle, elevator.carries(steering.footing), lifting);
        }
      },
      tap: (raycaster) => {
        for (const elevator of elevators) {
          const button = buttonUnder(raycaster, scene, elevator.pressable);
          if (button) elevator.press(button);
        }
      },
    },
    sounds,
  };
}
