// Bakes the light a sky casts on an environment into one picture, by driving
// Blender in the background. Run `npm run optimize` first, then
// `npm run bake`, or `npm run bake -- <environment> <sky>` when
// public/models/ or public/skies/ hold more than one.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join as joinPath, resolve } from "node:path";
import sharp from "sharp";
import { FloatType } from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";

const MODELS = "public/models";
const SKIES = "public/skies";
/** Blender's raw output, kept out of git with the other source files. */
const WORK = "models-source/baked";
/** Width and height of the baked light picture, in pixels. */
const SIZE = 2048;
/** Light paths traced per pixel: more is smoother and slower. */
const SAMPLES = 256;
/** Must match SKY_EXPOSURE in optimize-environments.mjs. */
const SKY_EXPOSURE = 1;
/**
 * Brightest light the picture can hold; anything brighter is clipped. The
 * walkthrough multiplies by the same number, BAKED_LIGHT_RANGE in
 * environment.ts.
 */
const LIGHT_RANGE = 4;
const PICTURE_QUALITY = 90;

function findBlender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  const home = "C:/Program Files/Blender Foundation";
  if (existsSync(home)) {
    const versions = spawnSync("cmd", ["/c", "dir", "/b", home.replaceAll("/", "\\")], {
      encoding: "utf8",
    }).stdout.split(/\r?\n/).filter(Boolean).sort();
    const newest = versions.at(-1);
    if (newest) return joinPath(home, newest, "blender.exe");
  }
  return "blender";
}

/** The one file with this extension in a folder, or the one that was named. */
async function pick(folder, extension, name) {
  const files = (await readdir(folder)).filter((file) => file.endsWith(extension));
  if (name) return `${name.replace(extension, "")}${extension}`;
  if (files.length === 1) return files[0];
  throw new Error(
    `${folder}/ holds ${files.length} ${extension} files; name one: npm run bake -- <environment> <sky>`,
  );
}

const toScreen = (linear) =>
  linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;

/** Blender's raw light becomes an ordinary picture viewers download. */
async function writeLightPicture(from, to) {
  const raw = await readFile(from);
  const { data, width, height } = new EXRLoader()
    .setDataType(FloatType)
    .parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const channels = data.length / (width * height);
  const bytes = new Uint8Array(width * height * 3);
  let clipped = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Rows arrive bottom first.
      const source = ((height - 1 - y) * width + x) * channels;
      const target = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) {
        const light = data[source + c] / LIGHT_RANGE;
        if (light > 1) clipped++;
        bytes[target + c] = Math.round(255 * toScreen(Math.max(0, Math.min(1, light))));
      }
    }
  }
  await sharp(bytes, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: PICTURE_QUALITY, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toFile(to);
  return (100 * clipped) / (width * height * 3);
}

const [environmentName, skyName] = process.argv.slice(2);
const environment = await pick(MODELS, ".glb", environmentName);
const sky = await pick(SKIES, ".hdr", skyName);
const raw = joinPath(WORK, environment.replace(".glb", ".exr"));
const picture = joinPath(MODELS, environment.replace(".glb", "-light.jpg"));
await mkdir(WORK, { recursive: true });

const started = Date.now();
const blender = spawnSync(
  findBlender(),
  [
    "--background",
    "--factory-startup",
    "--python",
    "scripts/bake.py",
    "--",
    resolve(MODELS, environment),
    resolve(SKIES, sky),
    resolve(raw),
    String(SIZE),
    String(SAMPLES),
    String(SKY_EXPOSURE),
  ],
  { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
// Blender narrates every step; keep only what the bake script says.
for (const line of blender.stdout?.split(/\r?\n/) ?? []) {
  if (line.startsWith("bake:")) console.log(line);
}
if (blender.error) throw blender.error;
if (blender.status !== 0 || !existsSync(raw)) {
  console.error(blender.stdout?.split(/\r?\n/).slice(-30).join("\n"));
  throw new Error("Blender did not finish the bake.");
}

const clipped = await writeLightPicture(raw, picture);
const megabytes = ((await stat(picture)).size / 1024 / 1024).toFixed(2);
const minutes = ((Date.now() - started) / 60000).toFixed(1);
console.log(`${environment} under ${sky}: ${picture}, ${megabytes} MB, baked in ${minutes} min`);
if (clipped > 0.5) {
  console.log(`${clipped.toFixed(1)}% of the light was brighter than the picture can hold and was clipped.`);
}
