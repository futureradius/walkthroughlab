import {
  Color,
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { collisionMesh } from "./collision";
import { Controls } from "./controls";
import { loadEnvironment } from "./environment";
import { FreeLook } from "./freelook";
import { Joystick } from "./joystick";
import { Keyboard } from "./keyboard";
import { advance, withinLimits, type Terrain, type Viewpoint } from "./motion";
import { buildRoom, ROOM } from "./room";

const EYE_HEIGHT = 1.6;
/** How close the viewpoint may get to a wall of the white room, in metres. */
const WALL_MARGIN = 0.4;
/** Vertical field of view in degrees: wide in portrait to offset the narrow screen. */
const PORTRAIT_FOV = 90;
const LANDSCAPE_FOV = 60;
/** Old phones report pixel ratios of 3 or more; rendering that many pixels is the main cost. */
const MAX_PIXEL_RATIO = 2;
/** Longest step simulated in one frame, so a stalled tab doesn't teleport the viewer. */
const MAX_STEP_SECONDS = 0.1;
/** How quickly the eyes catch up with a sudden change in floor height, per second. */
const EYE_CATCH_UP = 12;
/** Farthest distance drawn, in metres. */
const VIEW_DISTANCE = 300;
const ROOM_BACKDROP = 0xffffff;
/** Shown behind the loading bar until the sky arrives. */
const LOADING_BACKDROP = 0xdde8f0;

/** The environment the link opens, and where the viewer starts in it. */
const TEST_ENVIRONMENT = {
  files: {
    model: `${import.meta.env.BASE_URL}models/test-environment.glb`,
    skyPicture: `${import.meta.env.BASE_URL}skies/golden_gate_hills_8k.jpg`,
    skyLight: `${import.meta.env.BASE_URL}skies/golden_gate_hills_8k.hdr`,
  },
  // At the foot of the stairs, looking up them.
  start: { x: -13.4, z: 13, heading: 0 },
};

/** Somewhere to walk: what to draw, where steps may end, and where to begin. */
interface Place {
  terrain: Terrain;
  start: Viewpoint;
}

const params = new URLSearchParams(location.search);
const canvas = document.querySelector<HTMLCanvasElement>("#walkthrough")!;
const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});

const scene = new Scene();
const camera = new PerspectiveCamera(PORTRAIT_FOV, 1, 0.1, VIEW_DISTANCE);
camera.rotation.order = "YXZ";

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

function enterWhiteRoom(): Place {
  scene.background = new Color(ROOM_BACKDROP);
  scene.add(buildRoom(Math.min(4, renderer.capabilities.getMaxAnisotropy())));
  return {
    terrain: withinLimits({
      halfWidth: ROOM.width / 2 - WALL_MARGIN,
      halfDepth: ROOM.depth / 2 - WALL_MARGIN,
    }),
    start: { x: 0, z: 0, floor: 0, heading: 0, pitch: 0 },
  };
}

async function enterTestEnvironment(): Promise<Place> {
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
    const { terrain, floorAt } = collisionMesh(environment.collision);
    const { x, z, heading } = TEST_ENVIRONMENT.start;
    const floor = floorAt(x, z, 0);
    if (floor === undefined) {
      throw new Error("The starting spot is not on the collision mesh.");
    }
    loading.remove();
    return { terrain, start: { x, z, floor, heading, pitch: 0 } };
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

// Add ?room to the address to walk the gridded white room instead.
const place = params.has("room") ? enterWhiteRoom() : await enterTestEnvironment();

const joystick = new Joystick(document.body);
const keyboard = new Keyboard();
const freeLook = new FreeLook(canvas);
const controls = new Controls();
let viewpoint = place.start;
let eyes = viewpoint.floor + EYE_HEIGHT;
let frames = 0;
let lowest = Infinity;
let windowStart = performance.now();

let previous = performance.now();
renderer.setAnimationLoop((now) => {
  const seconds = Math.min((now - previous) / 1000, MAX_STEP_SECONDS);
  previous = now;

  // One pixel covers this angle, so a dragged spot stays under the finger.
  const radiansPerPixel = (camera.fov * Math.PI) / 180 / window.innerHeight;
  const intent = controls.read(
    joystick.stick,
    keyboard.keys,
    freeLook.take(radiansPerPixel),
  );
  viewpoint = advance(viewpoint, intent, seconds, place.terrain);
  eyes +=
    (viewpoint.floor + EYE_HEIGHT - eyes) * Math.min(1, seconds * EYE_CATCH_UP);
  camera.position.set(viewpoint.x, eyes, viewpoint.z);
  camera.rotation.y = -viewpoint.heading;
  camera.rotation.x = viewpoint.pitch;
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
