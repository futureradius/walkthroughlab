// Writes placeholder grass tufts into models-source/scatter/, to build and
// measure grass with before the author's own tuft from Blender exists (#25):
//   grass.glb        blades: thin solid tapered ribbons, nothing see-through,
//                    the kind that ran faster on phones and laptops
//   grass-cards.glb  cards: a few flat see-through pictures of several blades
// Run with `node scripts/placeholder-grass.mjs`, then `npm run optimize`. To
// try the cards, rename them to grass.glb and optimize again.
import { mkdir } from "node:fs/promises";
import { Document, NodeIO } from "@gltf-transform/core";
import sharp from "sharp";

const OUT = "models-source/scatter";
/** Always the same tufts, run after run. */
let seed = 7;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (low, high) => low + random() * (high - low);

/** A tuft as one mesh of triangles, with positions, a colour or picture coordinates, and indices. */
function writeTuft(path, { positions, uvs, colours, indices }, picture) {
  const document = new Document();
  const buffer = document.createBuffer();
  const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const primitive = document
    .createPrimitive()
    .setAttribute("POSITION", accessor("VEC3", new Float32Array(positions)))
    .setIndices(accessor("SCALAR", new Uint16Array(indices)));
  const material = document.createMaterial("grass").setRoughnessFactor(1).setMetallicFactor(0).setDoubleSided(true);
  if (uvs) primitive.setAttribute("TEXCOORD_0", accessor("VEC2", new Float32Array(uvs)));
  if (colours) primitive.setAttribute("COLOR_0", accessor("VEC3", new Float32Array(colours)));
  if (picture) {
    material
      .setBaseColorTexture(document.createTexture("blades").setImage(picture).setMimeType("image/png"))
      .setAlphaMode("MASK")
      .setAlphaCutoff(0.5);
  }
  primitive.setMaterial(material);
  const mesh = document.createMesh("tuft").addPrimitive(primitive);
  document.createScene().addChild(document.createNode("tuft").setMesh(mesh));
  return new NodeIO().write(path, document);
}

/** Linear green from a dark root to a light tip. */
const green = (height) => [0.05 + 0.1 * height, 0.12 + 0.2 * height, 0.02 + 0.03 * height];

/** A picture of several blades side by side, opaque on the blades and clear between them. */
async function bladesPicture(size = 256) {
  const pixels = Buffer.alloc(size * size * 4);
  const blades = Array.from({ length: 7 }, (_, i) => ({
    x: (i + 0.5) / 7 + between(-0.03, 0.03),
    width: between(0.035, 0.06),
    height: between(0.7, 1),
    lean: between(-0.08, 0.08),
  }));
  for (let y = 0; y < size; y++) {
    const up = 1 - y / size;
    for (let x = 0; x < size; x++) {
      const across = x / size;
      const blade = blades.find(({ x: root, width, height, lean }) => {
        const half = (width / 2) * (1 - up / height);
        return up <= height && Math.abs(across - (root + lean * up)) <= half;
      });
      if (!blade) continue;
      // Kept in sRGB, as pictures are.
      const [r, g, b] = green(up).map((linear) => Math.round(255 * linear ** (1 / 2.2)));
      pixels.set([r, g, b, 255], (y * size + x) * 4);
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

/** Flat cards standing round the root, each a picture of several blades, in three rows so they can bend. */
function cards(count = 6, rows = 3) {
  const tuft = { positions: [], uvs: [], indices: [] };
  for (let card = 0; card < count; card++) {
    const yaw = (card / count) * Math.PI + between(-0.2, 0.2);
    const [dx, dz] = [Math.cos(yaw), Math.sin(yaw)];
    const [cx, cz] = [between(-0.06, 0.06), between(-0.06, 0.06)];
    const width = between(0.28, 0.36);
    const height = between(0.32, 0.42);
    const first = tuft.positions.length / 3;
    for (let row = 0; row <= rows; row++) {
      const up = row / rows;
      for (const side of [-0.5, 0.5]) {
        tuft.positions.push(cx + dx * side * width, up * height, cz + dz * side * width);
        tuft.uvs.push(side + 0.5, 1 - up);
      }
    }
    for (let row = 0; row < rows; row++) {
      const a = first + row * 2;
      tuft.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  return tuft;
}

/** Thin solid blades, each a ribbon narrowing to a point, in four rows so it can bend. */
function blades(count = 24, rows = 4) {
  const tuft = { positions: [], colours: [], indices: [] };
  for (let blade = 0; blade < count; blade++) {
    const angle = between(0, Math.PI * 2);
    const out = Math.sqrt(random()) * 0.12;
    const [rx, rz] = [Math.cos(angle) * out, Math.sin(angle) * out];
    const facing = between(0, Math.PI);
    const [wx, wz] = [Math.cos(facing), Math.sin(facing)];
    const lean = [Math.cos(angle) * between(0, 0.12), Math.sin(angle) * between(0, 0.12)];
    const height = between(0.25, 0.45);
    const width = between(0.012, 0.02);
    const first = tuft.positions.length / 3;
    for (let row = 0; row < rows; row++) {
      const up = row / rows;
      const half = (width / 2) * (1 - up);
      const [x, z] = [rx + lean[0] * up * up, rz + lean[1] * up * up];
      for (const side of [-1, 1]) {
        tuft.positions.push(x + wx * side * half, up * height, z + wz * side * half);
        tuft.colours.push(...green(up));
      }
    }
    tuft.positions.push(rx + lean[0], height, rz + lean[1]);
    tuft.colours.push(...green(1));
    for (let row = 0; row < rows - 1; row++) {
      const a = first + row * 2;
      tuft.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const last = first + (rows - 1) * 2;
    tuft.indices.push(last, last + 1, last + 2);
  }
  return tuft;
}

await mkdir(OUT, { recursive: true });
await writeTuft(`${OUT}/grass.glb`, blades());
await writeTuft(`${OUT}/grass-cards.glb`, cards(), await bladesPicture());
console.log(`Wrote ${OUT}/grass.glb (blades) and ${OUT}/grass-cards.glb (cards).`);
