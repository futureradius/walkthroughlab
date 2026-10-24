// Writes placeholder props into models-source/props/, to build and measure
// props with before the author's own from Blender exist (#28):
//   chair.glb, table.glb  still props: boxes, baked like the environment
//   potted-plant.glb      a still pot and a swaying plant, `sway-plant`
//   tree.glb              a trunk and branches, baked, and a crown of
//                         see-through leaf cards, `sway-leaves`, painted
//                         with sway as an author would in Blender
//   bush.glb              a crown alone, unpainted, so it sways by height
// Each has a `collision mesh` of upright walls round it. In each, the origin
// is where it stands and its front faces +z, what Blender's Front view looks
// at. Run with `node scripts/placeholder-props.mjs`, then `npm run optimize`.
import { mkdir } from "node:fs/promises";
import { Document, NodeIO } from "@gltf-transform/core";
import sharp from "sharp";

const OUT = "models-source/props";
/** Always the same props, run after run. */
let seed = 11;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (low, high) => low + random() * (high - low);

/** Triangles as they are built: positions, normals, and picture coordinates or sway paint if any. */
const part = () => ({ positions: [], normals: [], uvs: [], colours: [], indices: [] });

/** A flat-shaded quad from four corners in order round it, facing the way they turn. */
function quad(into, corners, uvs) {
  const [a, b, c] = corners;
  const u = b.map((v, k) => v - a[k]);
  const w = c.map((v, k) => v - a[k]);
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const length = Math.hypot(...n) || 1;
  const first = into.positions.length / 3;
  corners.forEach((corner, i) => {
    into.positions.push(...corner);
    into.normals.push(...n.map((v) => v / length));
    if (uvs) into.uvs.push(...uvs[i]);
  });
  into.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
}

/** A box from its lowest to its highest corner, every face facing out. */
function box(into, [x0, y0, z0], [x1, y1, z1]) {
  quad(into, [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]);
  quad(into, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]);
  quad(into, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
  quad(into, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]);
  quad(into, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]);
  quad(into, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
}

/** A tapering tube along a path of points, `radii` wide at each, with `sides` sides. */
function tube(into, path, radii, sides = 8) {
  for (let i = 0; i + 1 < path.length; i++) {
    const [from, to] = [path[i], path[i + 1]];
    const along = to.map((v, k) => v - from[k]);
    const length = Math.hypot(...along);
    const d = along.map((v) => v / length);
    // Two directions across the tube.
    const helper = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    const s = cross(d, helper).map((v, _, all) => v / Math.hypot(...all));
    const t = cross(d, s);
    const ring = (centre, radius, k) => {
      const angle = (k / sides) * Math.PI * 2;
      return centre.map((v, j) => v + radius * (Math.cos(angle) * s[j] + Math.sin(angle) * t[j]));
    };
    for (let k = 0; k < sides; k++) {
      quad(into, [ring(from, radii[i], k), ring(from, radii[i], k + 1), ring(to, radii[i + 1], k + 1), ring(to, radii[i + 1], k)]);
    }
  }
}

/** Upright walls round a footprint of corners on the floor plan, which stop the viewpoint unseen. */
function walls(into, footprint, height = 1.2) {
  footprint.forEach(([x0, z0], i) => {
    const [x1, z1] = footprint[(i + 1) % footprint.length];
    quad(into, [[x0, 0, z0], [x1, 0, z1], [x1, height, z1], [x0, height, z0]]);
  });
}

const circle = (radius, sides = 8) =>
  Array.from({ length: sides }, (_, k) => [radius * Math.cos((k / sides) * Math.PI * 2), radius * Math.sin((k / sides) * Math.PI * 2)]);
const rectangle = (width, depth) => [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]];

/**
 * Leaf cards spread through a crown, an upright ellipsoid round `centre`,
 * more of them towards its skin, each `size` across and turned at random.
 */
function leafCards(into, count, centre, radii, size) {
  for (let card = 0; card < count; card++) {
    // A spot in the ellipsoid, towards its skin.
    let spot;
    do spot = [between(-1, 1), between(-1, 1), between(-1, 1)];
    while (Math.hypot(...spot) > 1);
    const out = Math.hypot(...spot) || 1;
    const reach = 0.3 + 0.7 * Math.sqrt(out);
    const at = spot.map((v, k) => centre[k] + (v / out) * reach * radii[k]);
    const yaw = between(0, Math.PI * 2);
    const tilt = between(-0.6, 0.6);
    const across = [Math.cos(yaw), 0, Math.sin(yaw)];
    const up = [-Math.sin(yaw) * Math.sin(tilt), Math.cos(tilt), Math.cos(yaw) * Math.sin(tilt)];
    const h = size / 2;
    const corner = (a, b) => at.map((v, k) => v + a * h * across[k] + b * h * up[k]);
    quad(into, [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], [[0, 1], [1, 1], [1, 0], [0, 0]]);
  }
}

/** A picture of a cluster of leaves, opaque on the leaves and clear between them. */
async function leavesPicture(size = 512) {
  const pixels = Buffer.alloc(size * size * 4);
  const leaves = Array.from({ length: 26 }, () => {
    const angle = between(0, Math.PI * 2);
    const out = Math.sqrt(random()) * 0.36;
    return {
      x: 0.5 + Math.cos(angle) * out,
      y: 0.5 + Math.sin(angle) * out,
      length: between(0.09, 0.14),
      width: between(0.04, 0.06),
      turn: between(0, Math.PI),
      shade: between(0.7, 1.15),
    };
  });
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const [x, y] = [px / size, py / size];
      // The last leaf drawn over a pixel lies on top.
      for (let i = leaves.length - 1; i >= 0; i--) {
        const leaf = leaves[i];
        const [dx, dy] = [x - leaf.x, y - leaf.y];
        const along = (dx * Math.cos(leaf.turn) + dy * Math.sin(leaf.turn)) / leaf.length;
        const side = (-dx * Math.sin(leaf.turn) + dy * Math.cos(leaf.turn)) / leaf.width;
        if (along * along + side * side > 1) continue;
        // Lighter along the middle vein, in sRGB as pictures are.
        const vein = Math.abs(side) < 0.08 ? 1.25 : 1;
        const linear = [0.09, 0.2, 0.04].map((c) => c * leaf.shade * vein * (0.85 + 0.15 * (1 - Math.abs(side))));
        pixels.set([...linear.map((c) => Math.round(255 * Math.min(1, c) ** (1 / 2.2))), 255], (py * size + px) * 4);
        break;
      }
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

/** Write a prop of named parts, each `{ name, part, material }`; a material of null is a collision mesh. */
async function writeProp(path, parts) {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene();
  const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  for (const { name, part, material } of parts) {
    const primitive = document
      .createPrimitive()
      .setAttribute("POSITION", accessor("VEC3", new Float32Array(part.positions)))
      .setAttribute("NORMAL", accessor("VEC3", new Float32Array(part.normals)))
      .setIndices(accessor("SCALAR", new Uint32Array(part.indices)));
    if (part.uvs.length > 0) primitive.setAttribute("TEXCOORD_0", accessor("VEC2", new Float32Array(part.uvs)));
    if (part.colours.length > 0) primitive.setAttribute("COLOR_0", accessor("VEC3", new Float32Array(part.colours)));
    if (material) primitive.setMaterial(await material(document));
    scene.addChild(document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive)));
  }
  await new NodeIO().write(path, document);
}

/** A plain material of a linear colour. */
const plain = (name, colour, roughness = 0.85) => (document) =>
  document.createMaterial(name).setBaseColorFactor([...colour, 1]).setRoughnessFactor(roughness).setMetallicFactor(0);

/** A see-through leaf material, its clear parts cut away. */
const leafy = (name, picture) => (document) =>
  document
    .createMaterial(name)
    .setBaseColorTexture(document.createTexture(name).setImage(picture).setMimeType("image/png"))
    .setAlphaMode("MASK")
    .setAlphaCutoff(0.5)
    .setRoughnessFactor(1)
    .setMetallicFactor(0)
    .setDoubleSided(true);

/** A grey of sway paint on every corner of a part added since `from`, by where each is. */
function paint(into, from, grey) {
  for (let i = from; i < into.positions.length / 3; i++) {
    const value = grey(into.positions.slice(i * 3, i * 3 + 3));
    into.colours.push(value, value, value);
  }
}

const wood = plain("wood", [0.36, 0.22, 0.12], 0.7);

async function chair() {
  const seat = part();
  box(seat, [-0.22, 0.42, -0.22], [0.22, 0.46, 0.22]);
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]]) box(seat, [x - 0.02, 0, z - 0.02], [x + 0.02, 0.42, z + 0.02]);
  // The back is behind whoever sits: away from the front, at -z.
  box(seat, [-0.22, 0.46, -0.22], [0.22, 0.9, -0.19]);
  const stop = part();
  walls(stop, rectangle(0.48, 0.48));
  await writeProp(`${OUT}/chair.glb`, [
    { name: "chair", part: seat, material: wood },
    { name: "collision mesh", part: stop, material: null },
  ]);
}

async function table() {
  const top = part();
  box(top, [-0.8, 0.71, -0.4], [0.8, 0.75, 0.4]);
  for (const [x, z] of [[-0.74, -0.34], [0.74, -0.34], [0.74, 0.34], [-0.74, 0.34]]) box(top, [x - 0.03, 0, z - 0.03], [x + 0.03, 0.71, z + 0.03]);
  const stop = part();
  walls(stop, rectangle(1.6, 0.8));
  await writeProp(`${OUT}/table.glb`, [
    { name: "table", part: top, material: wood },
    { name: "collision mesh", part: stop, material: null },
  ]);
}

async function pottedPlant(picture) {
  const pot = part();
  tube(pot, [[0, 0, 0], [0, 0.4, 0]], [0.15, 0.2], 10);
  const soil = part();
  const rim = circle(0.19, 10);
  rim.forEach(([x0, z0], k) => {
    const [x1, z1] = rim[(k + 1) % rim.length];
    soil.positions.push(0, 0.37, 0, x1, 0.37, z1, x0, 0.37, z0);
    soil.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    soil.indices.push(k * 3, k * 3 + 1, k * 3 + 2);
  });
  const plant = part();
  leafCards(plant, 40, [0, 0.78, 0], [0.34, 0.38, 0.34], 0.36);
  const stop = part();
  walls(stop, circle(0.24));
  await writeProp(`${OUT}/potted-plant.glb`, [
    { name: "pot", part: pot, material: plain("terracotta", [0.5, 0.2, 0.1]) },
    { name: "soil", part: soil, material: plain("soil", [0.08, 0.05, 0.03]) },
    { name: "plant", part: plant, material: leafy("sway-plant", picture) },
    { name: "collision mesh", part: stop, material: null },
  ]);
}

async function tree(picture) {
  const height = 8;
  const crown = { centre: [0, 5.3, 0], radii: [3, 2.7, 3] };
  const wooden = part();
  tube(wooden, [[0, 0, 0], [0, 1.8, 0], [0.05, 3.6, -0.05]], [0.2, 0.15, 0.1], 10);
  // Painted nearly black at the foot, so the trunk barely moves.
  paint(wooden, 0, ([, y]) => 0.15 * (y / 3.6) ** 2);
  for (let b = 0; b < 5; b++) {
    const from = wooden.positions.length / 3;
    const yaw = (b / 5) * Math.PI * 2 + between(-0.3, 0.3);
    const rise = between(2.2, 3.3);
    const reach = between(1.6, 2.4);
    const end = [Math.cos(yaw) * reach, rise + between(1.4, 2.4), Math.sin(yaw) * reach];
    const middle = [end[0] * 0.45, rise + (end[1] - rise) * 0.55, end[2] * 0.45];
    tube(wooden, [[0, rise, 0], middle, end], [0.08, 0.055, 0.025], 6);
    // Lighter towards the tips, where the leaves begin.
    paint(wooden, from, ([x, y, z]) => 0.15 + 0.3 * Math.min(1, Math.hypot(x, z) / reach) * Math.min(1, y / height + 0.3));
  }
  const leaves = part();
  leafCards(leaves, 600, crown.centre, crown.radii, 1.1);
  // Most at the top and the crown's skin, as a painted tree would be.
  paint(leaves, 0, ([x, y, z]) => {
    const up = Math.min(1, Math.max(0, (y - 2.6) / (height - 2.6)));
    const out = Math.min(1, Math.hypot(x, z) / crown.radii[0]);
    return Math.min(1, 0.35 + 0.35 * up + 0.3 * out);
  });
  const stop = part();
  walls(stop, circle(0.25));
  await writeProp(`${OUT}/tree.glb`, [
    { name: "trunk", part: wooden, material: plain("bark", [0.16, 0.11, 0.07]) },
    { name: "crown", part: leaves, material: leafy("sway-leaves", picture) },
    { name: "collision mesh", part: stop, material: null },
  ]);
}

async function bush(picture) {
  const leaves = part();
  leafCards(leaves, 160, [0, 0.72, 0], [1.05, 0.68, 1.05], 0.6);
  const stop = part();
  walls(stop, circle(0.8));
  await writeProp(`${OUT}/bush.glb`, [
    { name: "bush", part: leaves, material: leafy("sway-leaves", picture) },
    { name: "collision mesh", part: stop, material: null },
  ]);
}

await mkdir(OUT, { recursive: true });
const picture = await leavesPicture();
await chair();
await table();
await pottedPlant(picture);
await tree(picture);
await bush(picture);
console.log(`Wrote chair, table, potted-plant, tree and bush into ${OUT}/.`);
