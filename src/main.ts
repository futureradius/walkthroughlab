import {
  Color,
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { addAbout } from "./about";
import { collisionMesh } from "./collision";
import { loadEnvironment } from "./environment";
import { Gestures } from "./gestures";
import { AmbientOcclusion } from "./occlusion";
import { Joystick } from "./joystick";
import { Keyboard } from "./keyboard";
import { applySettings } from "./settings";
import { Steering } from "./steering";
import {
  addCoastingTuning,
  addOcclusionTuning,
  addRunningTuning,
  addTuning,
  addWalkingTuning,
  addZoomTuning,
} from "./tuning";

/** Old phones report pixel ratios of 3 or more; rendering that many pixels is the main cost. */
const MAX_PIXEL_RATIO = 2;
/** Longest step simulated in one frame, so a stalled tab doesn't teleport the viewer. */
const MAX_STEP_SECONDS = 0.1;
/** Farthest distance drawn, in metres. */
const VIEW_DISTANCE = 300;
/** Shown behind the loading bar until the sky arrives. */
const LOADING_BACKDROP = 0xdde8f0;

/** The environment the link opens, and where the viewer starts in it. */
const TEST_ENVIRONMENT = {
  files: {
    model: `${import.meta.env.BASE_URL}models/test-environment.glb`,
    skyPicture: `${import.meta.env.BASE_URL}skies/golden_gate_hills_8k.jpg`,
    skyLight: `${import.meta.env.BASE_URL}skies/golden_gate_hills_8k.hdr`,
    bakedLight: `${import.meta.env.BASE_URL}models/test-environment-light.jpg`,
    settings: `${import.meta.env.BASE_URL}models/test-environment.md`,
  },
  // At the foot of the stairs, looking up them.
  start: { x: -13.4, z: 13, heading: 0 },
};

const params = new URLSearchParams(location.search);
const canvas = document.querySelector<HTMLCanvasElement>("#walkthrough")!;
const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});

const scene = new Scene();
const screenSize = () => ({ width: window.innerWidth, height: window.innerHeight });
// Steering sets the field of view from the first frame on.
const camera = new PerspectiveCamera(60, 1, 0.1, VIEW_DISTANCE);
camera.rotation.order = "YXZ";

function resize() {
  const { width, height } = screenSize();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

/** Load the test environment and steer through it from its starting spot. */
async function enterTestEnvironment(): Promise<Steering> {
  scene.background = new Color(LOADING_BACKDROP);
  // Must match the tone mapping baked into sky pictures by `npm run optimize`.
  renderer.toneMapping = NeutralToneMapping;
  const loading = document.body.appendChild(
    Object.assign(document.createElement("div"), { className: "loading" }),
  );
  const bar = loading.appendChild(
    Object.assign(document.createElement("div"), { className: "loading__bar" }),
  );
  try {
    // Started now, so what ambient occlusion usually needs arrives alongside
    // the environment rather than after it.
    void occlusion?.ready(scene, camera);
    const environment = await loadEnvironment(
      TEST_ENVIRONMENT.files,
      renderer,
      (fraction) => {
        loading.classList.toggle("loading--unknown", fraction === undefined);
        if (fraction !== undefined) bar.style.width = `${fraction * 100}%`;
      },
    );
    scene.add(environment.visible);
    scene.background = environment.skyPicture;
    scene.environment = environment.skyLight;
    if (occlusion) {
      occlusion.bakedLight = environment.bakedLight ?? null;
      const refused = applySettings(
        occlusion.settings,
        environment.settings["ambient occlusion"],
      );
      if (refused.length > 0) {
        console.warn(`The settings file's ${refused.join(", ")} could not be used.`);
      }
      // The loading bar stays until ambient occlusion can be in the first frame.
      await occlusion.ready(scene, camera);
    }
    const { terrain, floorAt } = collisionMesh(environment.collision);
    const { x, z, heading } = TEST_ENVIRONMENT.start;
    const floor = floorAt(x, z, 0);
    if (floor === undefined) {
      throw new Error("The starting spot is not on the collision mesh.");
    }
    const steering = new Steering({ terrain, start: { x, z, floor, heading, pitch: 0 } });
    const zoomRefused = applySettings(steering.settings.zoom, environment.settings.zoom);
    if (zoomRefused.length > 0) {
      console.warn(`The settings file's ${zoomRefused.join(", ")} under Zoom could not be used.`);
    }
    loading.remove();
    return steering;
  } catch (error) {
    loading.className = "loading loading--failed";
    loading.textContent = "This walkthrough could not be loaded.";
    throw error;
  }
}

// Add ?fps to the address to show the frame rate while testing on a phone.
const fps = params.has("fps")
  ? document.body.appendChild(
      Object.assign(document.createElement("div"), { className: "fps" }),
    )
  : null;

// Ambient occlusion is on wherever the device can work it out.
const occlusion = AmbientOcclusion.supported(renderer)
  ? new AmbientOcclusion(renderer)
  : null;

addAbout(document.body);

const steering = await enterTestEnvironment();

// Add ?config to the address for a panel that changes settings while walking.
// Ambient occlusion's and zoom's start from those the environment's settings
// file gave. With reduced motion a thrown view is braked much harder.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const { walking, running, coasting, zoom } = steering.settings;
coasting.reduced = reducedMotion.matches;
if (params.has("config")) {
  const tuning = addTuning(document.body);
  if (occlusion) addOcclusionTuning(tuning, occlusion.settings);
  addWalkingTuning(tuning, walking);
  addCoastingTuning(tuning, coasting);
  addRunningTuning(tuning, running);
  addZoomTuning(tuning, zoom);
} else {
  // The panel has a switch for this instead, to try both brakes on one device.
  reducedMotion.addEventListener("change", () => {
    coasting.reduced = reducedMotion.matches;
  });
}

const joystick = new Joystick(document.body);
const keyboard = new Keyboard();
new Gestures(canvas, steering);
let frames = 0;
let lowest = Infinity;
let windowStart = performance.now();

let previous = performance.now();
renderer.setAnimationLoop((now) => {
  const seconds = Math.min((now - previous) / 1000, MAX_STEP_SECONDS);
  previous = now;

  const readings = { knob: joystick.knob, keys: keyboard.keys };
  const view = steering.step(readings, seconds, screenSize());
  camera.position.set(view.x, view.y, view.z);
  camera.rotation.y = -view.heading;
  camera.rotation.x = view.pitch;
  camera.fov = view.fov;
  camera.updateProjectionMatrix();
  if (occlusion) occlusion.render(scene, camera);
  else renderer.render(scene, camera);

  if (fps) {
    frames++;
    if (now - windowStart >= 1000) {
      const rate = Math.round((frames * 1000) / (now - windowStart));
      lowest = Math.min(lowest, rate);
      fps.textContent = `${rate} fps (lowest ${lowest})`;
      frames = 0;
      windowStart = now;
    }
  }
});
