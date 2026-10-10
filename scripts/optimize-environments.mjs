// Turns the raw files in models-source/ into the small files viewers download.
// Rhino exports (.glb) go to public/models/, skies (.exr) to public/skies/.
// Run with `npm run optimize`.
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  join,
  prune,
  textureCompress,
  weld,
} from "@gltf-transform/functions";
import sharp from "sharp";
import { FloatType } from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";

const SOURCE = "models-source";
const MODELS = "public/models";
const SKIES = "public/skies";
/** Longest side of any texture, in pixels. */
const MAX_TEXTURE_SIZE = 1024;
const JPEG_QUALITY = 80;
/** Materials that let more light through than this are shown as glass. */
const GLASS_TRANSMISSION = 0.5;
const GLASS_OPACITY = 0.25;
/** Rhino exports these on every material; phones pay for them and gain nothing. */
const DROPPED_EXTENSIONS = [
  "KHR_materials_transmission",
  "KHR_materials_clearcoat",
  "KHR_materials_ior",
  "KHR_materials_specular",
  "KHR_materials_emissive_strength",
];
const LINEAR_MIPMAP_LINEAR = 9987;
/** Width of the sky picture viewers see: the largest texture old phones accept. */
const SKY_PICTURE_WIDTH = 4096;
const SKY_PICTURE_QUALITY = 85;
/** Width of the sky as a light source, which needs brightness but little detail. */
const SKY_LIGHT_WIDTH = 1024;
/** Brightens or darkens a sky, both as seen and as a light source. */
const SKY_EXPOSURE = 1;

/** Glass becomes a see-through tint; everything else becomes solid. */
function simplifyMaterials(document) {
  for (const material of document.getRoot().listMaterials()) {
    const transmission = material.getExtension("KHR_materials_transmission");
    const isGlass =
      transmission !== null &&
      transmission.getTransmissionFactor() > GLASS_TRANSMISSION;
    for (const name of DROPPED_EXTENSIONS) material.setExtension(name, null);

    const [red, green, blue] = material.getBaseColorFactor();
    material.setAlphaMode(isGlass ? "BLEND" : "OPAQUE");
    material.setBaseColorFactor([red, green, blue, isGlass ? GLASS_OPACITY : 1]);
    // Rhino asks for no mipmaps, which makes distant textures shimmer.
    material.getBaseColorTextureInfo()?.setMinFilter(LINEAR_MIPMAP_LINEAR);
  }
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (DROPPED_EXTENSIONS.includes(extension.extensionName)) extension.dispose();
  }
}

/** Shrink a panorama of linear colour rows by averaging blocks of pixels. */
function shrink(pixels, width, height, channels, targetWidth) {
  const block = width / targetWidth;
  const targetHeight = height / block;
  const shrunk = new Float32Array(targetWidth * targetHeight * 3);
  const scale = SKY_EXPOSURE / (block * block);
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      let red = 0, green = 0, blue = 0;
      for (let dy = 0; dy < block; dy++) {
        let from = ((y * block + dy) * width + x * block) * channels;
        for (let dx = 0; dx < block; dx++, from += channels) {
          red += pixels[from];
          green += pixels[from + 1];
          blue += pixels[from + 2];
        }
      }
      const to = (y * targetWidth + x) * 3;
      shrunk[to] = red * scale;
      shrunk[to + 1] = green * scale;
      shrunk[to + 2] = blue * scale;
    }
  }
  return { pixels: shrunk, width: targetWidth, height: targetHeight };
}

/**
 * The tone mapping the walkthrough renders with (Khronos PBR Neutral), so the
 * sky picture matches the surfaces the sky lights.
 */
function toneMap(colour) {
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;
  const low = Math.min(colour[0], colour[1], colour[2]);
  const offset = low < 0.08 ? low - 6.25 * low * low : 0.04;
  for (let c = 0; c < 3; c++) colour[c] -= offset;
  const peak = Math.max(colour[0], colour[1], colour[2]);
  if (peak < startCompression) return;
  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  for (let c = 0; c < 3; c++) {
    colour[c] = colour[c] * (newPeak / peak) * (1 - g) + newPeak * g;
  }
}

const toScreen = (linear) =>
  linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;

/** The sky as viewers see it: an ordinary picture, top row first. */
async function writeSkyPicture(sky, path) {
  const bytes = new Uint8Array(sky.width * sky.height * 3);
  const colour = [0, 0, 0];
  for (let y = 0; y < sky.height; y++) {
    for (let x = 0; x < sky.width; x++) {
      // Rows arrive bottom first.
      const from = ((sky.height - 1 - y) * sky.width + x) * 3;
      for (let c = 0; c < 3; c++) colour[c] = sky.pixels[from + c];
      toneMap(colour);
      const to = (y * sky.width + x) * 3;
      for (let c = 0; c < 3; c++) {
        bytes[to + c] = Math.round(255 * Math.max(0, Math.min(1, toScreen(colour[c]))));
      }
    }
  }
  await sharp(bytes, { raw: { width: sky.width, height: sky.height, channels: 3 } })
    .jpeg({ quality: SKY_PICTURE_QUALITY, mozjpeg: true })
    .toFile(path);
}

/** Run-length encode one colour channel of one row, as Radiance files do. */
function packRow(channel, packed) {
  let i = 0;
  while (i < channel.length) {
    let run = 1;
    while (i + run < channel.length && run < 127 && channel[i + run] === channel[i]) run++;
    if (run >= 3) {
      packed.push(128 + run, channel[i]);
      i += run;
      continue;
    }
    const start = i;
    while (i < channel.length && i - start < 128) {
      if (i + 2 < channel.length && channel[i + 1] === channel[i] && channel[i + 2] === channel[i]) break;
      i++;
    }
    packed.push(i - start, ...channel.subarray(start, i));
  }
}

/** The sky as a light source: a Radiance .hdr file, which keeps its full brightness. */
async function writeSkyLight(sky, path) {
  const packed = [];
  const row = [0, 1, 2, 3].map(() => new Uint8Array(sky.width));
  for (let y = sky.height - 1; y >= 0; y--) {
    for (let x = 0; x < sky.width; x++) {
      const from = (y * sky.width + x) * 3;
      const red = sky.pixels[from], green = sky.pixels[from + 1], blue = sky.pixels[from + 2];
      const peak = Math.max(red, green, blue);
      // Each pixel shares one power-of-two exponent between its three colours.
      const exponent = peak < 1e-32 ? -128 : Math.floor(Math.log2(peak)) + 1;
      const scale = peak < 1e-32 ? 0 : 256 / 2 ** exponent;
      row[0][x] = Math.min(255, red * scale);
      row[1][x] = Math.min(255, green * scale);
      row[2][x] = Math.min(255, blue * scale);
      row[3][x] = exponent + 128;
    }
    packed.push(2, 2, sky.width >> 8, sky.width & 255);
    for (const channel of row) packRow(channel, packed);
  }
  const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${sky.height} +X ${sky.width}\n`;
  await writeFile(path, Buffer.concat([Buffer.from(header, "ascii"), Buffer.from(packed)]));
}

const megabytes = async (path) =>
  `${((await stat(path)).size / 1024 / 1024).toFixed(2)} MB`;
const renamed = (file, extension) => file.replace(/\.[^.]+$/, extension);

async function optimizeEnvironment(io, file) {
  const from = joinPath(SOURCE, file);
  const to = joinPath(MODELS, file);
  const document = await io.read(from);
  simplifyMaterials(document);
  await document.transform(
    dedup(),
    weld(),
    // Rhino writes one mesh per face; merge them so each layer draws at once.
    join(),
    textureCompress({
      encoder: sharp,
      targetFormat: "jpeg",
      quality: JPEG_QUALITY,
      resize: [MAX_TEXTURE_SIZE, MAX_TEXTURE_SIZE],
    }),
    prune(),
  );
  await io.write(to, document);
  console.log(`${file}: ${await megabytes(from)} -> ${await megabytes(to)}`);
}

async function optimizeSky(file) {
  const from = joinPath(SOURCE, file);
  const picture = joinPath(SKIES, renamed(file, ".jpg"));
  const light = joinPath(SKIES, renamed(file, ".hdr"));
  const raw = await readFile(from);
  const { data, width, height } = new EXRLoader()
    .setDataType(FloatType)
    .parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const channels = data.length / (width * height);
  await writeSkyPicture(shrink(data, width, height, channels, SKY_PICTURE_WIDTH), picture);
  await writeSkyLight(shrink(data, width, height, channels, SKY_LIGHT_WIDTH), light);
  console.log(
    `${file}: ${await megabytes(from)} -> ${await megabytes(picture)} picture, ${await megabytes(light)} light`,
  );
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await mkdir(MODELS, { recursive: true });
await mkdir(SKIES, { recursive: true });
const files = await readdir(SOURCE);
const environments = files.filter((file) => file.endsWith(".glb"));
const skies = files.filter((file) => file.endsWith(".exr"));
if (environments.length + skies.length === 0) {
  console.log(`No .glb or .exr files in ${SOURCE}/`);
}
for (const file of environments) await optimizeEnvironment(io, file);
for (const file of skies) await optimizeSky(file);
