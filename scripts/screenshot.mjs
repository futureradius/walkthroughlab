// Screenshot the walkthrough as a real graphics card draws it, for checking a
// change by eye: headless Edge, driven over its debugging port, waits until
// the loading cover is gone and a few seconds more, so the frame is settled.
//
//   npm run screenshot -- <address> <picture.png> [seconds to settle] [--look-up=<pixels>] [--reduced-motion]
//
// --look-up drags the view up by that many pixels once loaded, as a finger
// would, for things above eye level such as a flag; --reduced-motion opens it
// as for a device that asks for reduced motion.
//
// For example, with `npm run preview` running:
//   npm run screenshot -- "http://localhost:4173/?fps&at=27,-4,60" stairs.png
//
// No --use-angle=swiftshader: software drawing runs at a few frames a second,
// so the safety net turns ambient occlusion off and its drawing goes unchecked.
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9336;
const options = process.argv.slice(2).filter((part) => part.startsWith("--"));
const [address, picture, settle = "6"] = process.argv.slice(2).filter((part) => !part.startsWith("--"));
const lookUp = Number(options.find((part) => part.startsWith("--look-up="))?.slice("--look-up=".length) ?? 0);
const reducedMotion = options.includes("--reduced-motion");
if (!address || !picture) {
  console.error("npm run screenshot -- <address> <picture.png> [seconds to settle]");
  process.exit(1);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A profile of its own, so a running Edge and an earlier cache don't interfere.
const profile = await mkdtemp(join(tmpdir(), "walkthrough-screenshot-"));
const edge = spawn(EDGE, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--window-size=1280,800",
  "about:blank",
]);

try {
  let targets;
  for (let tries = 0; !targets && tries < 50; tries++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    } catch {
      await wait(200);
    }
  }
  if (!targets) throw new Error("Edge didn't open its debugging port.");

  const socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve));
  let lastId = 0;
  const answers = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    answers.get(message.id)?.(message.result);
    answers.delete(message.id);
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++lastId;
      answers.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  if (reducedMotion) {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  }
  await send("Page.navigate", { url: address });
  let loaded = false;
  for (let tries = 0; !loaded && tries < 120; tries++) {
    await wait(500);
    const answer = await send("Runtime.evaluate", {
      expression: "document.readyState === 'complete' && !document.querySelector('.loading')",
      returnByValue: true,
    });
    loaded = answer.result.value;
  }
  if (!loaded) console.warn("The loading cover was still up after a minute; saving what shows.");
  if (lookUp) {
    const mouse = (type, y) => send("Input.dispatchMouseEvent", { type, x: 640, y, button: "left", buttons: 1, clickCount: 1 });
    await mouse("mousePressed", 300);
    for (let step = 1; step <= 10; step++) {
      await mouse("mouseMoved", 300 + (lookUp * step) / 10);
      await wait(30);
    }
    // Held still before letting go, so the view doesn't coast on.
    await wait(400);
    await mouse("mouseReleased", 300 + lookUp);
  }
  await wait(Number(settle) * 1000);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(picture, Buffer.from(shot.data, "base64"));
  console.log(`saved ${picture}`);
  socket.close();
} finally {
  edge.kill();
  await wait(500);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
