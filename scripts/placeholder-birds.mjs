// Writes a placeholder bird into models-source/traffic/, to build and tune
// birds with before the author's own from Blender exists (#32): a dark grey
// bird the size of a crow, 0.7 m across its wings, painted with how much
// each part flaps as an author would in Blender. Its origin is its middle and
// its front faces +z, what Blender's Front view looks at. Run with
// `node scripts/placeholder-birds.mjs`, then `npm run optimize`.
import { mkdir } from "node:fs/promises";
import { Document, NodeIO } from "@gltf-transform/core";

const OUT = "models-source/traffic";

/** Triangles as they are built: positions, normals and flap paint. */
const part = () => ({ positions: [], normals: [], colours: [], indices: [] });

/** A flat-shaded triangle or quad from corners in order round it, each painted by `grey`. */
function face(into, corners, grey) {
  const [a, b, c] = corners;
  const u = b.map((v, k) => v - a[k]);
  const w = c.map((v, k) => v - a[k]);
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const length = Math.hypot(...n) || 1;
  const first = into.positions.length / 3;
  for (const corner of corners) {
    into.positions.push(...corner);
    into.normals.push(...n.map((v) => v / length));
    const value = grey(corner);
    into.colours.push(value, value, value);
  }
  into.indices.push(first, first + 1, first + 2);
  if (corners.length === 4) into.indices.push(first, first + 2, first + 3);
}

/** Both sides of a thin surface, so it shows from above and below. */
function twoSided(into, corners, grey) {
  face(into, corners, grey);
  face(into, [...corners].reverse(), grey);
}

/** A body along z, from tail to beak, as rings of `sides` corners, each ring [z, y, width, height]. */
function body(into, rings, sides = 6) {
  const ring = ([z, y, width, height]) =>
    Array.from({ length: sides }, (_, k) => {
      const angle = (k / sides) * Math.PI * 2;
      return [width * Math.cos(angle), y + height * Math.sin(angle), z];
    });
  const still = () => 0;
  for (let i = 0; i + 1 < rings.length; i++) {
    const [from, to] = [ring(rings[i]), ring(rings[i + 1])];
    for (let k = 0; k < sides; k++) {
      const next = (k + 1) % sides;
      const corners = [from[k], from[next], to[next], to[k]];
      // A ring of no size closes the body to a point.
      if (rings[i + 1][2] === 0) face(into, [from[k], from[next], to[k]], still);
      else if (rings[i][2] === 0) face(into, [from[k], to[next], to[k]], still);
      else face(into, corners, still);
    }
  }
}

/** Half span, metres. */
const SPAN = 0.35;
/** Where the wing meets the body, metres out from the centre line. */
const SHOULDER = 0.04;

/** One wing, out along +x or -x, in a few stretches so it can bend as it flaps. */
function wing(into, side) {
  // Out from the body: how far out, where the leading and trailing edges lie along z.
  const stations = [
    [SHOULDER, 0.06, -0.08],
    [0.14, 0.06, -0.09],
    [0.24, 0.035, -0.08],
    [SPAN, -0.02, -0.05],
  ];
  // Still at the shoulder, flapping the most at the tip.
  const grey = ([x]) => Math.min(1, Math.max(0, (Math.abs(x) - SHOULDER) / (SPAN - SHOULDER)));
  for (let i = 0; i + 1 < stations.length; i++) {
    const [[x0, front0, back0], [x1, front1, back1]] = [stations[i], stations[i + 1]];
    const corners = [
      [side * x0, 0.01, front0],
      [side * x1, 0.01, front1],
      [side * x1, 0.01, back1],
      [side * x0, 0.01, back0],
    ];
    twoSided(into, side > 0 ? corners : [...corners].reverse(), grey);
  }
}

const bird = part();
// Tail to beak along z, its middle at the origin: [z, y, half width, half height].
body(bird, [
  [-0.17, 0.0, 0, 0],
  [-0.12, 0.0, 0.035, 0.03],
  [0.0, 0.0, 0.05, 0.045],
  [0.09, 0.015, 0.04, 0.04],
  [0.13, 0.025, 0.03, 0.03],
  [0.19, 0.02, 0, 0],
]);
// A fanned tail.
twoSided(bird, [[0, 0, -0.12], [-0.06, 0, -0.26], [0.06, 0, -0.26]].reverse(), () => 0);
wing(bird, 1);
wing(bird, -1);

const document = new Document();
const buffer = document.createBuffer();
const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const primitive = document
  .createPrimitive()
  .setAttribute("POSITION", accessor("VEC3", new Float32Array(bird.positions)))
  .setAttribute("NORMAL", accessor("VEC3", new Float32Array(bird.normals)))
  .setAttribute("COLOR_0", accessor("VEC3", new Float32Array(bird.colours)))
  .setIndices(accessor("SCALAR", new Uint16Array(bird.indices)))
  .setMaterial(document.createMaterial("feathers").setBaseColorFactor([0.045, 0.045, 0.05, 1]).setRoughnessFactor(0.8).setMetallicFactor(0));
document.createScene().addChild(document.createNode("bird").setMesh(document.createMesh("bird").addPrimitive(primitive)));
await mkdir(OUT, { recursive: true });
await new NodeIO().write(`${OUT}/birds.glb`, document);
console.log(`${OUT}/birds.glb: ${bird.indices.length / 3} triangles`);
