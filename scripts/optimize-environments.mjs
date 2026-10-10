// Turns raw Rhino exports in models-source/ into the small files viewers
// download from public/models/. Run with `npm run optimize`.
import { mkdir, readdir, stat } from "node:fs/promises";
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

const SOURCE = "models-source";
const TARGET = "public/models";
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

const megabytes = async (path) =>
  `${((await stat(path)).size / 1024 / 1024).toFixed(2)} MB`;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await mkdir(TARGET, { recursive: true });
const files = (await readdir(SOURCE)).filter((file) => file.endsWith(".glb"));
if (files.length === 0) console.log(`No .glb files in ${SOURCE}/`);

for (const file of files) {
  const from = joinPath(SOURCE, file);
  const to = joinPath(TARGET, file);
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
