import { Color, type Scene, type WebGLRenderer } from "three";
import { collisionMesh } from "./collision";
import { loadConfig, loadEnvironment, type EnvironmentFiles } from "./environment";
import { Faces, FACES_DESCRIBED } from "./faces";
import { OCCLUSION_DESCRIBED, type AmbientOcclusion } from "./occlusion";
import { applyConfig, section, type Config, type Section } from "./settings";
import { Steering, STEERING_DESCRIBED } from "./steering";

/** Shown behind the loading bar until the sky arrives. */
const LOADING_BACKDROP = 0xdde8f0;

/** An environment's files and its config file. */
export interface EnvironmentAddress {
  files: EnvironmentFiles;
  config: string;
}

/** The environment the link opens. */
export const TEST_ENVIRONMENT: EnvironmentAddress = {
  files: {
    model: `${import.meta.env.BASE_URL}models/test-environment.glb`,
    skyPicture: `${import.meta.env.BASE_URL}skies/golden_gate_hills_8k.jpg`,
    skyLight: `${import.meta.env.BASE_URL}skies/golden_gate_hills_8k.hdr`,
    bakedLight: `${import.meta.env.BASE_URL}models/test-environment-light.jpg`,
  },
  config: `${import.meta.env.BASE_URL}models/test-environment-config.md`,
};

/** What the environment is opened into. */
export interface Walkthrough {
  renderer: WebGLRenderer;
  scene: Scene;
  /** Null where the device cannot work out ambient occlusion. */
  occlusion: AmbientOcclusion | null;
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

/**
 * Download an environment into the scene and steer from its start spot, with
 * its config file's settings. Resolves once ambient occlusion can be in the
 * first frame; rejects if the environment cannot be had or its start spot is
 * not on its collision mesh. `onProgress` gets the fraction downloaded, or
 * undefined while the server hasn't said how big the files are.
 */
export async function openEnvironment(
  environment: EnvironmentAddress,
  { renderer, scene, occlusion }: Walkthrough,
  onProgress: (fraction: number | undefined) => void,
): Promise<Opened> {
  scene.background = new Color(LOADING_BACKDROP);
  const occlusionSections = occlusion
    ? [section("Ambient occlusion", occlusion.settings, OCCLUSION_DESCRIBED, true)]
    : [];
  const config = loadConfig(environment.config);
  // The config file arrives first and says which way ambient occlusion is
  // worked out, so only that is fetched, alongside the environment.
  const occlusionReady = config.then((read) => {
    configure(occlusionSections, read);
    return occlusion?.ready();
  });
  const loaded = await loadEnvironment(environment.files, renderer, onProgress);
  scene.add(loaded.visible);
  const faces = new Faces(loaded.visible);
  scene.background = loaded.skyPicture;
  scene.environment = loaded.skyLight;
  for (const warning of loaded.warnings) console.warn(warning);
  const { terrain, floorAt } = collisionMesh(loaded.collision);
  if (!loaded.start) {
    throw new Error("The environment has no start spot; run `npm run optimize` again.");
  }
  // The start line is drawn near the floor the viewer stands on.
  const { x, y, z, heading } = loaded.start;
  const floor = floorAt(x, z, y);
  if (floor === undefined) {
    throw new Error("The start spot is not over the collision mesh.");
  }
  const steering = new Steering({ terrain, start: { x, z, floor, heading, pitch: 0 } });
  // Steering's sections exist only once it does.
  const sections = steeringSections(steering);
  configure(sections, await config);
  if (occlusion) occlusion.bakedLight = loaded.bakedLight ?? null;
  await occlusionReady;
  return {
    steering,
    faces,
    sections: [...occlusionSections, section("Faces", faces.settings, FACES_DESCRIBED), ...sections],
    warnings: loaded.warnings,
  };
}
