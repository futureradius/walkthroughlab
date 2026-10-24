import { NeutralToneMapping, PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer } from "three";
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
import { onTap } from "./taps";
import { addTuning } from "./tuning";
import { blow } from "./wind";

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

/** What the device draws at in full, before the safety net lowers it. */
const fullPixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
// Gives up some grass, then ambient occlusion, then resolution, while the
// frame rate is too low; made once the environment says whether it has grass.
let net: SafetyNet | undefined;

function resize() {
  const { width, height } = screenSize();
  renderer.setPixelRatio(net ? net.current.pixelRatio : fullPixelRatio);
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
// Add ?tuft=blades to grow the placeholder blades instead of the placeholder cards (#25).
const tuft = params.get("tuft");
// Add ?at=x,z,bearing to open at that spot on the floor plan, looking along
// the compass bearing (0 north, 90 east), instead of at the start spot; a
// fourth number picks the floor nearest that height, for upper storeys.
const [atX, atZ, bearing, atHeight] = (params.get("at") ?? "").split(",").map(Number);
const environment = {
  ...TEST_ENVIRONMENT,
  ...(tuft ? { scatter: (name: string) => TEST_ENVIRONMENT.scatter(`${name}-${tuft}`) } : {}),
  ...(Number.isFinite(atZ)
    ? { at: { x: atX, z: atZ, heading: ((bearing || 0) * Math.PI) / 180, y: Number.isFinite(atHeight) ? atHeight : undefined } }
    : {}),
};
const { steering, faces, sections, warnings, wind, scatters, surfaces, doors, elevators } = await whileLoading(document.body, downloads, (onProgress, onName) =>
  openEnvironment(environment, { renderer, scene, occlusion, downloads }, onProgress, onName),
);

// Add ?config to the address for a panel that changes settings while walking.
// Ambient occlusion's and zoom's start from those the environment's config
// file gave. With reduced motion a thrown view is braked much harder.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const { coasting } = steering.settings;
coasting.reduced = reducedMotion.matches;
net = new SafetyNet(fullPixelRatio, occlusion !== null, scatters.length > 0, surfaces.any);

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
// A tap or click exactly on an elevator's button presses it.
const raycaster = new Raycaster();
onTap(canvas, (x, y) => {
  const { width, height } = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1), camera);
  elevators.tap(raycaster);
});
let frames = 0;
let lowest = Infinity;
let applied = net.current;
let windowStart = performance.now();

let previous = performance.now();
renderer.setAnimationLoop((now) => {
  const seconds = Math.min((now - previous) / 1000, MAX_STEP_SECONDS);
  previous = now;

  const readings = { knob: joystick.knob, keys: keyboard.keys };
  // Doors and elevators move first, carrying or pushing the viewer, so the
  // view is worked out from where the car already is this frame: a frame
  // behind, the car jitters against the eyes as it rides.
  doors.update(seconds);
  elevators.update(seconds);
  const view = steering.step(readings, seconds, screenSize());
  camera.position.set(view.x, view.y, view.z);
  camera.rotation.y = -view.heading;
  camera.rotation.x = view.pitch;
  camera.fov = view.fov;
  camera.updateProjectionMatrix();
  faces.update();
  blow(wind, seconds, reducedMotion.matches);
  for (const scatter of scatters) scatter.update(seconds, camera.position);
  surfaces.apply(net!.current.shine);
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
      for (const scatter of scatters) scatter.reduce(level.scatter);
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
