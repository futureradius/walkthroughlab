import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { Joystick } from "./joystick";
import { advance, type Viewpoint } from "./motion";
import { buildRoom, ROOM } from "./room";

const EYE_HEIGHT = 1.6;
/** How close the viewpoint may get to a wall, in metres. */
const WALL_MARGIN = 0.4;
/** Vertical field of view in degrees: wide in portrait to offset the narrow screen. */
const PORTRAIT_FOV = 90;
const LANDSCAPE_FOV = 60;
/** Old phones report pixel ratios of 3 or more; rendering that many pixels is the main cost. */
const MAX_PIXEL_RATIO = 2;
/** Longest step simulated in one frame, so a stalled tab doesn't teleport the viewer. */
const MAX_STEP_SECONDS = 0.1;

const canvas = document.querySelector<HTMLCanvasElement>("#walkthrough")!;
const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setClearColor(0xffffff);

const scene = new Scene();
scene.add(buildRoom(Math.min(4, renderer.capabilities.getMaxAnisotropy())));

const camera = new PerspectiveCamera(PORTRAIT_FOV, 1, 0.1, 50);
camera.rotation.order = "YXZ";

const joystick = new Joystick(document.body);
const limits = {
  halfWidth: ROOM.width / 2 - WALL_MARGIN,
  halfDepth: ROOM.depth / 2 - WALL_MARGIN,
};
let viewpoint: Viewpoint = { x: 0, z: 0, heading: 0 };

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = camera.aspect < 1 ? PORTRAIT_FOV : LANDSCAPE_FOV;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// Add ?fps to the address to show the frame rate while testing on a phone.
const fps = new URLSearchParams(location.search).has("fps")
  ? document.body.appendChild(
      Object.assign(document.createElement("div"), { className: "fps" }),
    )
  : null;
let frames = 0;
let lowest = Infinity;
let windowStart = performance.now();

let previous = performance.now();
renderer.setAnimationLoop((now) => {
  const seconds = Math.min((now - previous) / 1000, MAX_STEP_SECONDS);
  previous = now;

  viewpoint = advance(viewpoint, joystick.stick, seconds, limits);
  camera.position.set(viewpoint.x, EYE_HEIGHT, viewpoint.z);
  camera.rotation.y = -viewpoint.heading;
  renderer.render(scene, camera);

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
