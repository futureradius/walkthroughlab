// Turns the raw files in models-source/ into the small files viewers download.
// Rhino exports (.glb) go to public/models/, skies (.exr) to public/skies/.
// Run with `npm run optimize`, or `npm run optimize -- <environment>` when
// models-source/ holds more than one Rhino export.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { gzipSync } from "node:zlib";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import {
  dedup,
  join,
  meshopt,
  prune,
  unwrapPrimitives,
  weld,
} from "@gltf-transform/functions";
import sharp from "sharp";
import { FloatType } from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { MeshoptEncoder } from "meshoptimizer";
import * as watlas from "watlas";
import { COLLISION_MESH, normalise, readMarks, swingOf } from "../src/marks.ts";

const SOURCE = "models-source";
const MODELS = "public/models";
const SKIES = "public/skies";
/** Where `npm run bake` reads the environment from, before its geometry is compressed. */
const BAKE_COPY = "models-source/baked";
/** Tufts and the like that scatter marks copy, prepared in Blender, beside the environment. */
const SCATTER_SOURCE = joinPath(SOURCE, "scatter");
const SCATTER = joinPath(MODELS, "scatter");
/** Longest side of any texture, in pixels. */
const MAX_TEXTURE_SIZE = 1024;
const WEBP_QUALITY = 80;
/** Materials that let more light through than this are shown as glass. */
const GLASS_TRANSMISSION = 0.5;
/** How strongly a material reflects, which the walkthrough honours on glass. */
const KEPT_ON_GLASS = ["KHR_materials_ior", "KHR_materials_specular"];
/** Rhino exports these on every material; phones pay for them and gain nothing. */
const DROPPED_EXTENSIONS = [
  "KHR_materials_transmission",
  "KHR_materials_clearcoat",
  "KHR_materials_ior",
  "KHR_materials_specular",
  "KHR_materials_emissive_strength",
];
const LINEAR_MIPMAP_LINEAR = 9987;
const TRIANGLES = 4;
/** Width of the sky picture viewers see: the largest texture old phones accept. */
const SKY_PICTURE_WIDTH = 4096;
const SKY_PICTURE_QUALITY = 85;
/** Width of the sky as a light source, which needs brightness but little detail. */
const SKY_LIGHT_WIDTH = 1024;
/**
 * Widths of the small sky picture and sky light that arrive before the viewer
 * can move; the ones above follow and sharpen them (#14, #23).
 */
const SMALL_SKY_PICTURE_WIDTH = 1024;
const SMALL_SKY_LIGHT_WIDTH = 256;
/** How long a viewer may wait before they can move: about 10 s on Slow 4G (#14). */
const OPENING_BUDGET = 2;
/** The whole walkthrough, and all its sound (#14). */
const WHOLE_BUDGET = 10;
/** The page's own code, which optimize cannot measure: about this much on the wire. */
const CODE_ESTIMATE = 0.2;
/** Brightens or darkens a sky, both as seen and as a light source. */
const SKY_EXPOSURE = 1;

/**
 * Glass keeps its colour, which the walkthrough and the bake take as the share
 * of light each of its surfaces lets through; everything else becomes solid.
 */
function simplifyMaterials(document) {
  let anyGlass = false;
  for (const material of document.getRoot().listMaterials()) {
    const transmission = material.getExtension("KHR_materials_transmission");
    const isGlass =
      transmission !== null &&
      transmission.getTransmissionFactor() > GLASS_TRANSMISSION;
    anyGlass ||= isGlass;
    for (const name of DROPPED_EXTENSIONS) {
      if (!(isGlass && KEPT_ON_GLASS.includes(name))) material.setExtension(name, null);
    }

    const [red, green, blue] = material.getBaseColorFactor();
    // BLEND is what marks a material as glass from here on.
    material.setAlphaMode(isGlass ? "BLEND" : "OPAQUE");
    material.setBaseColorFactor([red, green, blue, 1]);
    // Rhino asks for no mipmaps, which makes distant textures shimmer.
    material.getBaseColorTextureInfo()?.setMinFilter(LINEAR_MIPMAP_LINEAR);
    material.getNormalTextureInfo()?.setMinFilter(LINEAR_MIPMAP_LINEAR);
    material.getMetallicRoughnessTextureInfo()?.setMinFilter(LINEAR_MIPMAP_LINEAR);
  }
  for (const extension of document.getRoot().listExtensionsUsed()) {
    const name = extension.extensionName;
    if (!DROPPED_EXTENSIONS.includes(name)) continue;
    if (!(anyGlass && KEPT_ON_GLASS.includes(name))) extension.dispose();
  }
}

/**
 * Every texture as WebP, at most MAX_TEXTURE_SIZE across: a third smaller
 * than JPEG for the same look, and every phone that matters reads it (#23).
 * Colour is kept at full resolution rather than WebP's usual half, which
 * smudged faint green and red blotches into near-grey textures such as a
 * light tile, and bent the slopes of normal maps, for about 5 % more (#6).
 */
async function compressTextures(document) {
  const textures = document.getRoot().listTextures();
  for (const texture of textures) {
    const image = await sharp(texture.getImage(), { limitInputPixels: false })
      .resize(MAX_TEXTURE_SIZE, MAX_TEXTURE_SIZE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY, smartSubsample: true })
      .toBuffer();
    texture.setImage(image).setMimeType("image/webp").setURI(texture.getURI().replace(/.[^.]+$/, ".webp"));
  }
  if (textures.length > 0) document.createExtension(EXTTextureWebP).setRequired(true);
}

/**
 * A texture is taken as one value when every channel varies less than FLAT
 * on average, out of 255, and its darkest and lightest pixels lie within
 * FLAT_RANGE: thin details such as grout lines barely move the average but
 * stretch the range (#6, #11).
 */
const FLAT = 4;
const FLAT_RANGE = 24;
/** A material rough everywhere beyond this never shines, so its roughness map is not needed. */
const ALWAYS_ROUGH = 0.9;

/** Each channel's average and spread in a texture, from 0 to 1. */
async function channelsOf(texture) {
  const { channels } = await sharp(texture.getImage()).stats();
  return channels.map(({ mean, stdev, min, max }) => ({
    mean: mean / 255,
    flat: stdev < FLAT && max - min <= FLAT_RANGE,
    min: min / 255,
  }));
}

/**
 * Turn textures that are nearly one value into that value, and drop maps a
 * material's setup won't use, saying what was done so the author knows: a
 * colour map of one colour, a roughness map of a material rough all over, a
 * flat normal map, and every ambient occlusion map, since baked light covers
 * that (#6).
 */
async function flattenTextures(document, file) {
  const said = [];
  for (const material of document.getRoot().listMaterials()) {
    const name = material.getName() || "(unnamed)";
    const colour = material.getBaseColorTexture();
    if (colour && !material.getAlphaMode().startsWith("BLEND")) {
      const [r, g, b] = await channelsOf(colour);
      if (r.flat && g.flat && b.flat) {
        const [fr, fg, fb, fa] = material.getBaseColorFactor();
        material.setBaseColorFactor([fr * r.mean, fg * g.mean, fb * b.mean, fa]);
        material.setBaseColorTexture(null);
        said.push(`${name}: colour map is one colour, used as its colour`);
      }
    }
    const rough = material.getMetallicRoughnessTexture();
    if (rough) {
      // glTF keeps roughness in green and metalness in blue.
      const [, g, b] = await channelsOf(rough);
      const roughness = material.getRoughnessFactor();
      const metalness = material.getMetallicFactor();
      const neverShines = roughness * g.min >= ALWAYS_ROUGH && metalness * b.mean < 0.02;
      if ((g.flat && b.flat) || neverShines) {
        material.setRoughnessFactor(roughness * g.mean);
        material.setMetallicFactor(metalness * b.mean);
        material.setMetallicRoughnessTexture(null);
        said.push(`${name}: roughness map dropped, ${neverShines ? "rough all over" : "one value"}: roughness ${(roughness * g.mean).toFixed(2)}, metal ${(metalness * b.mean).toFixed(2)}`);
      } else if (b.flat && metalness * b.mean < 0.02) {
        // Kept for its roughness; a metal channel of nothing but black means not metal.
        material.setMetallicFactor(0);
        said.push(`${name}: metal map is black all over, so not metal`);
      }
    }
    const normal = material.getNormalTexture();
    if (normal) {
      const [r, g] = await channelsOf(normal);
      if (r.flat && g.flat && Math.abs(r.mean - 0.5) < 0.03 && Math.abs(g.mean - 0.5) < 0.03) {
        material.setNormalTexture(null);
        said.push(`${name}: normal map is flat, dropped`);
      }
    }
    if (material.getOcclusionTexture()) {
      material.setOcclusionTexture(null);
      said.push(`${name}: ambient occlusion map dropped; baked light covers it`);
    }
  }
  for (const line of said) console.log(`${file}: ${line}`);
}

/**
 * The model's layers as the marks reader takes them: a node without a mesh
 * of its own is a layer, and the nodes with meshes under it are its objects.
 */
function layersOf(nodes) {
  return nodes
    .filter((node) => !node.getMesh() && node.getName())
    .map((node) => {
      const layer = { name: node.getName(), node, layers: layersOf(node.listChildren()), lines: [], surfaces: 0 };
      for (const object of node.listChildren()) {
        const matrix = object.getWorldMatrix();
        for (const primitive of object.getMesh()?.listPrimitives() ?? []) {
          if (primitive.getMode() === TRIANGLES) {
            layer.surfaces++;
            continue;
          }
          const position = primitive.getAttribute("POSITION");
          const line = [];
          for (let i = 0, p = [0, 0, 0]; i < position.getCount(); i++) {
            position.getElement(i, p);
            line.push([0, 1, 2].map((r) => matrix[r] * p[0] + matrix[4 + r] * p[1] + matrix[8 + r] * p[2] + matrix[12 + r]));
          }
          layer.lines.push(line);
        }
      }
      return layer;
    });
}

/**
 * Read the marks in the model, report what is wrong with them, and note in
 * the file what the walkthrough and the bake need: which layers are
 * collision meshes, where the viewer starts, and the warnings, which the
 * ?config panel lists.
 */
function markEnvironment(document, file) {
  const scene = document.getRoot().listScenes()[0];
  const marks = readMarks(layersOf(scene.listChildren()));
  for (const warning of marks.warnings) console.warn(`${file}: ${warning}`);
  for (const error of marks.errors) console.error(`${file}: ${error}`);
  if (marks.errors.length > 0) {
    throw new Error(`${file} would not open in the walkthrough; nothing was written.`);
  }
  for (const node of marks.collision) node.setExtras({ ...node.getExtras(), walkthrough: COLLISION_MESH });
  // Scatter grows copies of scatter/<name>.glb over the surfaces on its layer.
  for (const { kind, name, path, layer } of marks.parts) {
    if (kind !== "scatter") continue;
    layer.node.setExtras({ ...layer.node.getExtras(), walkthrough: "scatter", scatter: name });
    if (!existsSync(joinPath(SCATTER_SOURCE, `${name}.glb`))) {
      const warning = `${path}: there is no ${SCATTER_SOURCE}/${name}.glb to copy over its surfaces.`;
      marks.warnings.push(warning);
      console.warn(`${file}: ${warning}`);
    }
  }
  // Doors move by themselves; an elevator's are moved by it, which comes with #26.
  for (const { kind, path, layer } of marks.parts) {
    if (!kind.startsWith("door-") || path.includes("›")) continue;
    const door = doorMotion(kind, layer, (text) => {
      marks.warnings.push(`${path}: ${text}`);
      console.warn(`${file}: ${path}: ${text}`);
    });
    if (door) layer.node.setExtras({ ...layer.node.getExtras(), walkthrough: "door", door });
  }
  scene.setExtras({ ...scene.getExtras(), walkthrough: { start: marks.start, warnings: marks.warnings } });
  const kinds = new Map();
  for (const { kind } of marks.parts) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  const found = [...kinds].map(([kind, count]) => `${count} ${kind}`).join(", ");
  console.log(`${file}: marks found: ${found || "none"}; ${marks.warnings.length} warnings`);
}

/** Every corner of every surface under a node, in world space. */
function cornersUnder(node) {
  const corners = [];
  const visit = (each) => {
    const matrix = each.getWorldMatrix();
    for (const primitive of each.getMesh()?.listPrimitives() ?? []) {
      if (primitive.getMode() !== TRIANGLES) continue;
      const position = primitive.getAttribute("POSITION");
      for (let i = 0, p = [0, 0, 0]; i < position.getCount(); i++) {
        position.getElement(i, p);
        corners.push([0, 1, 2].map((r) => matrix[r] * p[0] + matrix[4 + r] * p[1] + matrix[8 + r] * p[2] + matrix[12 + r]));
      }
    }
    each.listChildren().forEach(visit);
  };
  visit(node);
  return corners;
}

/**
 * How a door moves, worked out from its lines and its closed leaves, for the
 * walkthrough: each leaf's hinge and how far it turns, or how far it slides;
 * and where the door is, to know when the viewer comes near (#7).
 */
function doorMotion(kind, layer, warn) {
  const named = (from, name) => from.layers.find((inner) => normalise(inner.name) === name);
  const leaves = kind === "door-sliding" && layer.layers.some((inner) => normalise(inner.name).startsWith("leaf-"))
    ? layer.layers.filter((inner) => normalise(inner.name).startsWith("leaf-"))
    : [layer];
  const parts = [];
  const all = [];
  for (const leaf of leaves) {
    const [line] = leaf.lines;
    const model = named(leaf, "model");
    if (!line || !model) return undefined;
    const corners = cornersUnder(model.node);
    all.push(...corners);
    const part = { leaf: leaf === layer ? null : leaf.name };
    if (kind === "door-hinged") {
      const pivot = [line[0][0], line[0][2]];
      // The free edge is the leaf's point furthest from the hinge.
      let edge = pivot, reach = 0;
      for (const [x, , z] of corners) {
        const far = Math.hypot(x - pivot[0], z - pivot[1]);
        if (far > reach) [edge, reach] = [[x, z], far];
      }
      const { angle, halfTurn } = swingOf(pivot, edge, line.slice(1).map(([x, , z]) => [x, z]));
      if (halfTurn) warn("its line turns it 180°, so which way is unclear; add a corner to say which way.");
      Object.assign(part, { pivot, angle, reach });
    } else {
      const end = line[line.length - 1];
      part.offset = [end[0] - line[0][0], end[2] - line[0][2]];
    }
    parts.push(part);
  }
  if (all.length === 0) return undefined;
  const low = [0, 1, 2].map((k) => Math.min(...all.map((c) => c[k])));
  const high = [0, 1, 2].map((k) => Math.max(...all.map((c) => c[k])));
  return {
    kind: kind === "door-hinged" ? "hinged" : "sliding",
    parts,
    centre: [(low[0] + high[0]) / 2, (low[2] + high[2]) / 2],
    bottom: low[1],
    top: high[1],
  };
}

/**
 * Every surface that takes baked light: seen and solid. Metal too, for its
 * light only, so its reflections can be dimmed where little light reaches (#6).
 */
function bakedPrimitives(document) {
  const primitives = [];
  const visit = (node) => {
    if (node.getExtras().walkthrough === COLLISION_MESH) return;
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      // Lines are marks, never seen.
      if (primitive.getMode() !== TRIANGLES) continue;
      const material = primitive.getMaterial();
      // Glass shows the sky live, in reflections, instead.
      if (material?.getAlphaMode() === "BLEND") continue;
      primitives.push(primitive);
    }
    node.listChildren().forEach(visit);
  };
  for (const scene of document.getRoot().listScenes()) scene.listChildren().forEach(visit);
  return primitives;
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
  await flattenTextures(document, file);
  await document.transform(
    dedup(),
    weld(),
    // Rhino writes one mesh per face; merge them so each layer draws at once.
    // Lines are marks, each saying something of its own, so never merge them:
    // two lines on one layer would become one polyline.
    join({ filter: (node) => !node.getMesh()?.listPrimitives().some((primitive) => primitive.getMode() !== TRIANGLES) }),
    prune(),
  );
  await compressTextures(document);
  markEnvironment(document, file);
  // A second set of texture coordinates in which no two surfaces overlap, so
  // `npm run bake` can paint each one's light into a single shared picture.
  unwrapPrimitives(bakedPrimitives(document), { watlas, texcoord: 1, overwrite: true });
  // Blender can't read compressed geometry, so the bake gets its own copy.
  await mkdir(BAKE_COPY, { recursive: true });
  await io.write(joinPath(BAKE_COPY, file), document);
  // Geometry stored compressed, a few times smaller (#23).
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  await io.write(to, document);
  console.log(`${file}: ${await megabytes(from)} -> ${await megabytes(to)}`);
}

/** Bytes a file takes on the wire: GitHub Pages compresses all but pictures. */
async function onTheWire(path) {
  const bytes = await readFile(path);
  return /.(jpe?g|png|webp)$/.test(path) ? bytes.length : gzipSync(bytes).length;
}

/**
 * Say how the environment's downloads compare with the download budget,
 * warning, never failing, when one is over (#14).
 */
async function reportBudget(environment, sky) {
  const megabytes = async (paths) => {
    let bytes = 0;
    for (const path of paths) bytes += await onTheWire(path).catch(() => 0);
    return bytes / 1024 / 1024;
  };
  const baked = joinPath(MODELS, renamed(environment, "-light.webp"));
  const opening =
    CODE_ESTIMATE +
    (await megabytes([
      joinPath(MODELS, environment),
      baked,
      joinPath(SKIES, renamed(sky, "-small.jpg")),
      joinPath(SKIES, renamed(sky, "-small.hdr")),
    ]));
  const scattered = existsSync(SCATTER) ? (await readdir(SCATTER)).map((file) => joinPath(SCATTER, file)) : [];
  const whole =
    opening +
    (await megabytes([joinPath(SKIES, renamed(sky, ".jpg")), joinPath(SKIES, renamed(sky, ".hdr")), ...scattered]));
  const line = (what, size, budget) =>
    `${what}: about ${size.toFixed(2)} MB on the wire, of ${budget} MB${size > budget ? " - OVER BUDGET" : ""}`;
  console.log(line("Opening download, with about 0.2 MB of page code", opening, OPENING_BUDGET));
  console.log(line("Whole walkthrough", whole, WHOLE_BUDGET));
  console.log(line("Sound", 0, 3));
}

/**
 * The small files scatter marks copy, such as a grass tuft: textures as WebP
 * and geometry compressed, like the environment's.
 */
async function optimizeScatter(io) {
  if (!existsSync(SCATTER_SOURCE)) return;
  await mkdir(SCATTER, { recursive: true });
  for (const file of (await readdir(SCATTER_SOURCE)).filter((name) => name.endsWith(".glb"))) {
    const document = await io.read(joinPath(SCATTER_SOURCE, file));
    await document.transform(dedup(), weld(), prune());
    await compressTextures(document);
    await document.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    await io.write(joinPath(SCATTER, file), document);
    console.log(`scatter/${file}: ${await megabytes(joinPath(SCATTER_SOURCE, file))} -> ${await megabytes(joinPath(SCATTER, file))}`);
  }
}

async function optimizeSky(file) {
  const from = joinPath(SOURCE, file);
  const picture = joinPath(SKIES, renamed(file, ".jpg"));
  const light = joinPath(SKIES, renamed(file, ".hdr"));
  const smallPicture = joinPath(SKIES, renamed(file, "-small.jpg"));
  const smallLight = joinPath(SKIES, renamed(file, "-small.hdr"));
  const raw = await readFile(from);
  const { data, width, height } = new EXRLoader()
    .setDataType(FloatType)
    .parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const channels = data.length / (width * height);
  await writeSkyPicture(shrink(data, width, height, channels, SKY_PICTURE_WIDTH), picture);
  await writeSkyLight(shrink(data, width, height, channels, SKY_LIGHT_WIDTH), light);
  await writeSkyPicture(shrink(data, width, height, channels, SMALL_SKY_PICTURE_WIDTH), smallPicture);
  await writeSkyLight(shrink(data, width, height, channels, SMALL_SKY_LIGHT_WIDTH), smallLight);
  console.log(
    `${file}: ${await megabytes(from)} -> ${await megabytes(picture)} picture, ${await megabytes(light)} light, ` +
      `${await megabytes(smallPicture)} and ${await megabytes(smallLight)} small`,
  );
}

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
await watlas.Initialize();
await mkdir(MODELS, { recursive: true });
await mkdir(SKIES, { recursive: true });
const files = await readdir(SOURCE);
const exports = files.filter((file) => file.endsWith(".glb"));
const skies = files.filter((file) => file.endsWith(".exr"));
const [named] = process.argv.slice(2);
const environments = named ? [`${named.replace(/.glb$/, "")}.glb`] : exports;
if (environments.length > 1) {
  throw new Error(`${SOURCE}/ holds ${environments.length} Rhino exports; name one: npm run optimize -- <environment>`);
}
if (environments.length + skies.length === 0) {
  console.log(`No .glb or .exr files in ${SOURCE}/`);
}
for (const file of environments) await optimizeEnvironment(io, file);
for (const file of skies) await optimizeSky(file);
await optimizeScatter(io);
if (environments.length === 1 && skies.length === 1) await reportBudget(environments[0], skies[0]);
