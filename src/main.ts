import { NeutralToneMapping, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { addAbout } from "./about";
import { Gestures } from "./gestures";
import { AmbientOcclusion } from "./occlusion";
import { Joystick } from "./joystick";
import { Keyboard } from "./keyboard";
import { whileLoading } from "./loading";
import { openEnvironment, TEST_ENVIRONMENT } from "./opening";
import { addTuning } from "./tuning";

/** Old phones report pixel ratios of 3 or more; rendering that many pixels is the main cost. */
const MAX_PIXEL_RATIO = 2;
/** Longest step simulated in one frame, so a stalled tab doesn't teleport the viewer. */
const MAX_STEP_SECONDS = 0.1;
/** Farthest distance drawn, in metres. */
const VIEW_DISTANCE = 300;

const params = new URLSearchParams(location.search);
const canvas = document.querySelector<HTMLCanvasElement>("#walkthrough")!;
const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
// Must match the tone mapping baked into sky pictures by `npm run optimize`.
renderer.toneMapping = NeutralToneMapping;

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

// Ambient occlusion is on wherever the device can work it out.
const occlusion = AmbientOcclusion.supported(renderer)
  ? new AmbientOcclusion(renderer, scene, camera)
  : null;

// Add ?fps to the address to show the frame rate while testing on a phone.
const fps = params.has("fps")
  ? document.body.appendChild(
      Object.assign(document.createElement("div"), { className: "fps" }),
    )
  : null;

addAbout(document.body);

const { steering, sections } = await whileLoading(document.body, (onProgress) =>
  openEnvironment(TEST_ENVIRONMENT, { renderer, scene, occlusion }, onProgress),
);

// Add ?config to the address for a panel that changes settings while walking.
// Ambient occlusion's and zoom's start from those the environment's config
// file gave. With reduced motion a thrown view is braked much harder.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const { coasting } = steering.settings;
coasting.reduced = reducedMotion.matches;
if (params.has("config")) {
  addTuning(document.body, sections);
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
  if (occlusion) occlusion.render();
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
