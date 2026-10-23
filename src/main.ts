import { NeutralToneMapping, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { addAbout } from "./about";
import { Downloads } from "./download";
import { Gestures } from "./gestures";
import { AmbientOcclusion } from "./occlusion";
import { Joystick } from "./joystick";
import { Keyboard } from "./keyboard";
import { whileLoading } from "./loading";
import { openEnvironment, TEST_ENVIRONMENT } from "./opening";
import { NET_DESCRIBED, SafetyNet } from "./safetynet";
import { section } from "./settings";
import { addTuning } from "./tuning";

/** Old phones report pixel ratios of 3 or more; rendering that many pixels is the main cost. */
const MAX_PIXEL_RATIO = 2;
/** Longest step simulated in one frame, so a stalled tab doesn't teleport the viewer. */
const MAX_STEP_SECONDS = 0.1;
/** Farthest distance drawn, in metres. */
const VIEW_DISTANCE = 300;
/** Seconds after the first frame in which the device is still preparing what it draws. */
const SETTLING_SECONDS = 3;

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

// Ambient occlusion is on wherever the device can work it out.
const occlusion = AmbientOcclusion.supported(renderer)
  ? new AmbientOcclusion(renderer, scene, camera)
  : null;

// Gives up ambient occlusion, then resolution, while the frame rate is too low.
const net = new SafetyNet(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO), occlusion !== null);

function resize() {
  const { width, height } = screenSize();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, net.current.pixelRatio));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// Add ?fps to the address to show the frame rate while testing on a phone.
const fps = params.has("fps")
  ? document.body.appendChild(
      Object.assign(document.createElement("div"), { className: "fps" }),
    )
  : null;

addAbout(document.body);

const downloads = new Downloads();
const { steering, faces, sections, warnings } = await whileLoading(document.body, downloads, (onProgress, onName) =>
  openEnvironment(TEST_ENVIRONMENT, { renderer, scene, occlusion, downloads }, onProgress, onName),
);

// Add ?config to the address for a panel that changes settings while walking.
// Ambient occlusion's and zoom's start from those the environment's config
// file gave. With reduced motion a thrown view is braked much harder.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const { coasting } = steering.settings;
coasting.reduced = reducedMotion.matches;
// Something arriving, the page going off screen or a setting changed stalls
// frames for reasons the net can do nothing about, so those seconds don't count.
let hitch = performance.now() + SETTLING_SECONDS * 1000;
const noteHitch = () => (hitch = Math.max(hitch, performance.now()));
downloads.onArrival = noteHitch;
if (occlusion) occlusion.onArrival = noteHitch;
document.addEventListener("visibilitychange", noteHitch);
if (params.has("config")) {
  const netSection = section("Safety net", net.settings, NET_DESCRIBED);
  addTuning(document.body, [...sections, netSection], warnings, noteHitch);
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
let applied = net.current;
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
  faces.update();
  if (occlusion) occlusion.render();
  else renderer.render(scene, camera);

  frames++;
  if (now - windowStart >= 1000) {
    const rate = Math.round((frames * 1000) / (now - windowStart));
    // A second stretched by a paused page, or touched by a hitch, doesn't count.
    const counts = now - windowStart < 1500 && windowStart > hitch;
    if (counts) net.second(rate, now / 1000);
    // Also gives everything back at once when the net is switched off.
    const level = net.current;
    if (level !== applied) {
      if (occlusion) occlusion.heldOff = !level.occlusion;
      applied = level;
      resize();
    }
    if (fps) {
      lowest = Math.min(lowest, rate);
      fps.textContent = `${rate} fps (lowest ${lowest})${net.describe()}`;
    }
    frames = 0;
    windowStart = now;
  }
});
