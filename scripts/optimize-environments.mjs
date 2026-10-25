// Turns the raw files in models-source/ into the small files viewers download.
// Rhino exports (.glb) go to public/models/, skies (.exr) to public/skies/.
// Run with `npm run optimize`, or `npm run optimize -- <environment>` when
// models-source/ holds more than one Rhino export.
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { gzipSync } from "node:zlib";
import { NodeIO, PropertyType } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import {
  cloneDocument,
  dedup,
  getBounds,
  join,
  mergeDocuments,
  meshopt,
  prune,
  weld,
} from "@gltf-transform/functions";
import sharp from "sharp";
import { FloatType } from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { MeshoptEncoder } from "meshoptimizer";
import * as watlas from "watlas";
import { describeLamps, facingOf, fromRhino as fromRhinoGlow, lumenOf } from "../src/lamps.ts";
import { buttonOf, COLLISION_MESH, normalise, readMarks, swingOf } from "../src/marks.ts";
import { readConfig } from "../src/settings.ts";

const SOURCE = "models-source";
const MODELS = "public/models";
const SKIES = "public/skies";
/** Where `npm run bake` reads the environment from, before its geometry is compressed. */
const BAKE_COPY = "models-source/baked";
/** Tufts and the like that scatter marks copy, prepared in Blender, beside the environment. */
const SCATTER_SOURCE = joinPath(SOURCE, "scatter");
const SCATTER = joinPath(MODELS, "scatter");
/** Things prop marks place, prepared in Blender, beside the environment (#28). */
const PROPS_SOURCE = joinPath(SOURCE, "props");
/** The parts of each prop that sway, which arrive after the viewer can move. */
const PROPS = joinPath(MODELS, "props");
/** A prop's parts whose material's name begins with this sway and are lit live (#28). */
const SWAY = "sway-";
/** How far a prop's most swaying part moves in a full gust of a strong wind, as a share of the prop's height. */
const BEND = 0.06;
/** Side of the light probe above each crown, in metres at the prop's own size. */
const PROBE_SIZE = 0.4;
/** How far above the top of its crown a light probe lies, likewise. */
const PROBE_ABOVE = 0.2;
/** Longest side of any texture, in pixels. */
const MAX_TEXTURE_SIZE = 1024;
const WEBP_QUALITY = 80;
/** Materials that let more light through than this are shown as glass. */
const GLASS_TRANSMISSION = 0.5;
/** How strongly a material reflects, which the walkthrough honours on glass. */
const KEPT_ON_GLASS = ["KHR_materials_ior", "KHR_materials_specular"];
/** How bright a lamp glows, beyond a colour's 1, which the bake and the walkthrough honour (#29). */
const KEPT_ON_LAMPS = ["KHR_materials_emissive_strength"];
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
 * A material that glows with a plain colour is a lamp, solid and never metal,
 * noted as `lamp` for the bake and the walkthrough; from Rhino, its colour is
 * raised to the power Raytraced raises it to (#29). Returns what the author
 * should know.
 */
function simplifyMaterials(document, { fromRhino = true } = {}) {
  let anyGlass = false;
  let anyLamp = false;
  const said = [];
  for (const material of document.getRoot().listMaterials()) {
    const name = material.getName() || "(unnamed)";
    if (material.getEmissiveTexture()) {
      said.push(`${name}: glows from a picture, which Rhino exports black; give its glow a plain colour.`);
      material.setEmissiveTexture(null);
    }
    const glow = material.getEmissiveFactor();
    const isLamp = Math.max(...glow) > 0;
    anyLamp ||= isLamp;
    if (isLamp) {
      if (fromRhino) material.setEmissiveFactor(fromRhinoGlow(glow));
      material.setMetallicFactor(0);
      material.setExtras({ ...material.getExtras(), lamp: true });
    }
    const transmission = material.getExtension("KHR_materials_transmission");
    const isGlass =
      !isLamp &&
      transmission !== null &&
      transmission.getTransmissionFactor() > GLASS_TRANSMISSION;
    anyGlass ||= isGlass;
    for (const name of DROPPED_EXTENSIONS) {
      const kept = (isGlass && KEPT_ON_GLASS.includes(name)) || (isLamp && KEPT_ON_LAMPS.includes(name));
      if (!kept) material.setExtension(name, null);
    }

    const [red, green, blue] = material.getBaseColorFactor();
    // A prop's leaves keep their picture's clear parts cut away.
    const cutOut = isSwaying(material) && material.getBaseColorTexture() !== null;
    if (cutOut && material.getAlphaMode() === "OPAQUE") material.setAlphaCutoff(0.5);
    // BLEND is what marks a material as glass from here on.
    material.setAlphaMode(isGlass ? "BLEND" : cutOut ? "MASK" : "OPAQUE");
    material.setBaseColorFactor([red, green, blue, 1]);
    // Rhino asks for no mipmaps, which makes distant textures shimmer.
    material.getBaseColorTextureInfo()?.setMinFilter(LINEAR_MIPMAP_LINEAR);
    material.getNormalTextureInfo()?.setMinFilter(LINEAR_MIPMAP_LINEAR);
    material.getMetallicRoughnessTextureInfo()?.setMinFilter(LINEAR_MIPMAP_LINEAR);
  }
  for (const extension of document.getRoot().listExtensionsUsed()) {
    const name = extension.extensionName;
    if (!DROPPED_EXTENSIONS.includes(name)) continue;
    const kept = (anyGlass && KEPT_ON_GLASS.includes(name)) || (anyLamp && KEPT_ON_LAMPS.includes(name));
    if (!kept) extension.dispose();
  }
  return said;
}

/**
 * Every lamp's material in a document, and for each the objects glowing with
 * it, each with its area and the sum of its triangles' fronts, each as long as
 * its area, in world space: what the list of lamps needs (#29).
 */
function lampsIn(document) {
  const found = new Map();
  for (const node of document.getRoot().listNodes()) {
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const material = primitive.getMaterial();
      if (primitive.getMode() !== TRIANGLES || !material?.getExtras().lamp) continue;
      const { corners, area } = worldCorners(primitive, node);
      const index = primitive.getIndices();
      const count = index ? index.getCount() : corners.length / 3;
      const at = (i) => (index ? index.getScalar(i) : i) * 3;
      const fronts = [0, 0, 0];
      for (let t = 0; t + 2 < count; t += 3) {
        const [a, b, c] = [at(t), at(t + 1), at(t + 2)];
        const u = [0, 1, 2].map((k) => corners[b + k] - corners[a + k]);
        const v = [0, 1, 2].map((k) => corners[c + k] - corners[a + k]);
        fronts[0] += (u[1] * v[2] - u[2] * v[1]) / 2;
        fronts[1] += (u[2] * v[0] - u[0] * v[2]) / 2;
        fronts[2] += (u[0] * v[1] - u[1] * v[0]) / 2;
      }
      if (!found.has(material)) found.set(material, new Map());
      const objects = found.get(material);
      const object = objects.get(node) ?? { area: 0, fronts: [0, 0, 0] };
      object.area += area;
      for (let k = 0; k < 3; k++) object.fronts[k] += fronts[k];
      objects.set(node, object);
    }
  }
  return found;
}

/** The list's entry for one lamp material and its objects, each at a size: 1 but for a prop's copies. */
function lampsOf(name, material, objects) {
  const colour = material.getEmissiveFactor();
  const strength = material.getExtension("KHR_materials_emissive_strength")?.getEmissiveStrength() ?? 1;
  return {
    name,
    lumens: objects.map(({ area, size = 1 }) => lumenOf(strength, colour, area * size * size)),
    colour,
    facings: objects.map(({ area, fronts }) => facingOf(fronts, area)),
    sways: isSwaying(material),
  };
}

/** Print how bright and how warm every lamp of an environment is, its props' included, to check against the real fixtures (#29). */
function listLamps(file, lamps) {
  if (lamps.length === 0) return;
  console.log(`${file}: lamps, by material:`);
  for (const entry of lamps) console.log(`  ${describeLamps(entry)}`);
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
    if (colour && material.getAlphaMode() === "OPAQUE") {
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
    if (kind === "prop" && !existsSync(joinPath(PROPS_SOURCE, `${name}.glb`))) {
      const warning = `${path}: there is no ${PROPS_SOURCE}/${name}.glb to place.`;
      marks.warnings.push(warning);
      console.warn(`${file}: ${warning}`);
    }
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
  for (const { kind, path, layer } of marks.parts) {
    if (kind === "elevator") markElevator(layer, (text) => {
      marks.warnings.push(`${path}: ${text}`);
      console.warn(`${file}: ${path}: ${text}`);
    });
  }
  scene.setExtras({ ...scene.getExtras(), walkthrough: { start: marks.start, warnings: marks.warnings } });
  const kinds = new Map();
  for (const { kind } of marks.parts) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  const found = [...kinds].map(([kind, count]) => `${count} ${kind}`).join(", ");
  console.log(`${file}: marks found: ${found || "none"}; ${marks.warnings.length} warnings`);
  return marks;
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
 * Note on an elevator what the walkthrough needs to run it (#26): its route,
 * whose corners and far end are its stops; each floor door's stop, the one
 * nearest the door's foot; its car doors; and each button's stop.
 */
function markElevator(layer, warn) {
  const [route] = layer.lines;
  if (!route) return;
  const extras = (node, more) => node.setExtras({ ...node.getExtras(), ...more });
  extras(layer.node, { walkthrough: "elevator", elevator: { route } });
  const model = layer.layers.find((inner) => normalise(inner.name) === "model");
  // The car, whose lamps the bake lets light only the car (#29).
  if (model) extras(model.node, { walkthrough: "car" });
  for (const inner of [...layer.layers, ...(model?.layers ?? [])]) {
    const plain = normalise(inner.name);
    const button = buttonOf(plain);
    if (button) {
      extras(inner.node, { walkthrough: "button", button });
      continue;
    }
    if (!plain.startsWith("door-sliding-")) continue;
    const door = doorMotion("door-sliding", inner, warn);
    if (!door) continue;
    if (model?.layers.includes(inner)) {
      extras(inner.node, { walkthrough: "elevator-door", door, car: true });
    } else {
      let stop = 0;
      route.forEach(([, y], i) => {
        if (Math.abs(y - door.bottom) < Math.abs(route[stop][1] - door.bottom)) stop = i;
      });
      extras(inner.node, { walkthrough: "elevator-door", door, stop: stop + 1 });
    }
  }
}

/** Whether a material is one of a prop's parts that sway, `sway-…`, which are lit live (#28). */
const isSwaying = (material) => normalise(material?.getName() ?? "").startsWith(SWAY);
/** Whether a node of a prop is its collision mesh, which stops the viewpoint unseen. */
const isCollision = (node) => normalise(node.getName()).startsWith(COLLISION_MESH);

/** Every triangle primitive of a prop, with the node it hangs from and whether it is in a collision mesh. */
function primitivesOfProp(document) {
  const found = [];
  const visit = (node, collision) => {
    const inCollision = collision || isCollision(node);
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      if (primitive.getMode() === TRIANGLES) found.push({ primitive, node, collision: inCollision });
    }
    node.listChildren().forEach((child) => visit(child, inCollision));
  };
  for (const scene of document.getRoot().listScenes()) scene.listChildren().forEach((node) => visit(node, false));
  return found;
}

/**
 * Read a prop prepared in Blender and make it ready to place: its materials
 * and textures treated as the environment's, and on every part that sways,
 * how far each corner moves in a full gust of a strong wind, in metres at the
 * prop's own size, as `_SWAY`. That comes from the sway painted on it, black
 * still and white the most, or for an unpainted `sway-` part from how high
 * it is and how far from the upright through the origin; an unpainted part
 * that is not `sway-` stands still (#28).
 */
async function readProp(io, file) {
  const name = normalise(file.replace(/\.glb$/, ""));
  const document = await io.read(joinPath(PROPS_SOURCE, file));
  // Blender writes a glow's colour as it lights, unlike Rhino.
  const said = simplifyMaterials(document, { fromRhino: false }).map((text) => `props/${file}: ${text}`);
  await flattenTextures(document, `props/${file}`);
  await document.transform(dedup(), weld(), prune());
  await compressTextures(document);
  // Each lamp material over the whole prop, at its own size.
  const lamps = [...lampsIn(document)].map(([material, objects]) => {
    const all = { area: 0, fronts: [0, 0, 0] };
    for (const { area, fronts } of objects.values()) {
      all.area += area;
      for (let k = 0; k < 3; k++) all.fronts[k] += fronts[k];
    }
    return { material, ...all };
  });
  const parts = primitivesOfProp(document).filter(({ collision }) => !collision);
  const cornersOf = new Map(parts.map(({ primitive, node }) => [primitive, worldCorners(primitive, node).corners]));
  let height = 0.01;
  let reach = 0.01;
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const { primitive } of parts) {
    const corners = cornersOf.get(primitive);
    const swaying = isSwaying(primitive.getMaterial());
    for (let i = 0; i < corners.length; i += 3) {
      height = Math.max(height, corners[i + 1]);
      if (!swaying) continue;
      reach = Math.max(reach, Math.hypot(corners[i], corners[i + 2]));
      for (let k = 0; k < 3; k++) {
        low[k] = Math.min(low[k], corners[i + k]);
        high[k] = Math.max(high[k], corners[i + k]);
      }
    }
  }
  let unpainted = false;
  const buffer = document.getRoot().listBuffers()[0];
  for (const { primitive } of parts) {
    const paint = primitive.getAttribute("COLOR_0");
    const swaying = isSwaying(primitive.getMaterial());
    if (!paint && !swaying) continue;
    unpainted ||= !paint;
    const corners = cornersOf.get(primitive);
    const moves = new Float32Array(corners.length / 3);
    for (let i = 0, colour = []; i < moves.length; i++) {
      let share;
      if (paint) {
        paint.getElement(i, colour);
        share = (colour[0] + colour[1] + colour[2]) / 3;
      } else {
        const up = Math.max(0, Math.min(1, corners[i * 3 + 1] / height));
        const out = Math.min(1, Math.hypot(corners[i * 3], corners[i * 3 + 2]) / reach);
        share = up * (0.5 + 0.5 * out);
      }
      moves[i] = share * BEND * height;
    }
    // Paint says how a part moves, never what colour it is.
    primitive.setAttribute("COLOR_0", null);
    primitive.setAttribute("_SWAY", document.createAccessor().setType("SCALAR").setArray(moves).setBuffer(buffer));
  }
  await document.transform(prune({ keepAttributes: true }));
  // The walkthrough sways a prop's baked parts by its own settings.
  for (const material of document.getRoot().listMaterials()) material.setExtras({ ...material.getExtras(), prop: name });
  const sways = low[0] <= high[0];
  const warnings = said;
  if (sways && unpainted) {
    warnings.push(`props/${file}: its ${SWAY}… parts have no sway paint, so they sway by how high they are; see docs/props.md to paint them.`);
  }
  // Its origin should be where it stands, so that is where its line puts it.
  const { min, max } = getBounds(document.getRoot().listScenes()[0]);
  const away = Math.hypot((min[0] + max[0]) / 2, (min[2] + max[2]) / 2);
  if (away > Math.max(1, (max[0] - min[0]) / 2, (max[2] - min[2]) / 2)) {
    warnings.push(`props/${file}: it stands ${away.toFixed(1)} m from its origin, so each copy lands that far from its line; move it so the origin is where it stands.`);
  }
  for (const warning of warnings) console.warn(warning);
  return { name, file, document, crown: sways ? { low, high } : undefined, lamps, warnings };
}

/** Every prop in models-source/props/, by the name its marks use. */
async function readProps(io) {
  const props = new Map();
  if (!existsSync(PROPS_SOURCE)) return props;
  for (const file of (await readdir(PROPS_SOURCE)).filter((name) => name.endsWith(".glb"))) {
    const prop = await readProp(io, file);
    props.set(prop.name, prop);
  }
  return props;
}

/**
 * A copy of a prop's node and everything under it, holding only the
 * primitives `keep` picks, given whether they are in a collision mesh; a
 * collision mesh is noted as one. Null if nothing is left.
 */
function copyOf(document, node, keep, collision = false) {
  const inCollision = collision || isCollision(node);
  const copy = document
    .createNode(node.getName())
    .setTranslation(node.getTranslation())
    .setRotation(node.getRotation())
    .setScale(node.getScale());
  if (inCollision && !collision) copy.setExtras({ walkthrough: COLLISION_MESH });
  const kept = (node.getMesh()?.listPrimitives() ?? []).filter(
    (primitive) => primitive.getMode() === TRIANGLES && keep(primitive, inCollision),
  );
  if (kept.length > 0) {
    // Each copy's own primitives, as each gets its own patch of baked light.
    const mesh = document.createMesh(node.getMesh().getName());
    for (const primitive of kept) mesh.addPrimitive(primitive.clone());
    copy.setMesh(mesh);
  }
  for (const child of node.listChildren()) {
    const inner = copyOf(document, child, keep, inCollision);
    if (inner) copy.addChild(inner);
  }
  if (copy.getMesh() || copy.listChildren().length > 0) return copy;
  copy.dispose();
  return null;
}

/** What of a prop the environment holds: everything but its swaying parts. */
const stillPart = (primitive, collision) => collision || !isSwaying(primitive.getMaterial());
/** Its crown: the swaying parts, which the bake needs only for their shadow. */
const crownPart = (primitive, collision) => !collision && isSwaying(primitive.getMaterial());

function disposeTree(node) {
  for (const child of node.listChildren()) disposeTree(child);
  node.dispose();
}

/** A small square facing up at a spot, which the bake lights like any surface and viewers never see. */
function probeAt(document, material, [x, y, z]) {
  const h = PROBE_SIZE / 2;
  const buffer = document.getRoot().listBuffers()[0];
  const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const primitive = document
    .createPrimitive()
    .setAttribute("POSITION", accessor("VEC3", new Float32Array([x - h, y, z - h, x - h, y, z + h, x + h, y, z - h, x + h, y, z + h])))
    .setAttribute("NORMAL", accessor("VEC3", new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])))
    .setIndices(accessor("SCALAR", new Uint32Array([0, 1, 2, 2, 1, 3])))
    .setMaterial(material);
  return document
    .createNode("light probe")
    .setMesh(document.createMesh("light probe").addPrimitive(primitive))
    .setExtras({ walkthrough: "probe" });
}

/** Keep everything in one buffer, as a .glb holds only one; merging brings the prop's along. */
function oneBuffer(document) {
  const [first, ...rest] = document.getRoot().listBuffers();
  for (const accessor of document.getRoot().listAccessors()) accessor.setBuffer(first);
  for (const buffer of rest) buffer.dispose();
}

/** Throw away meshes, materials and textures nothing uses any more, keeping every layer and attribute. */
const tidy = () =>
  prune({
    propertyTypes: [PropertyType.MESH, PropertyType.PRIMITIVE, PropertyType.ACCESSOR, PropertyType.MATERIAL, PropertyType.TEXTURE],
    keepAttributes: true,
  });

/**
 * Place a copy of its prop at every line of each prop mark (#28), under the
 * mark's layer: its still parts, to be baked like the environment, and its
 * collision mesh. A prop with parts that sway gets a light probe above its
 * crown, which the bake lights and its leaves take their light from. A prop
 * whose config file section says `shadow: no` is noted for the bake to cast
 * no shadow.
 */
function placeProps(document, marks, props, config) {
  const placed = [];
  let probeMaterial;
  for (const { kind, name, layer, copies } of marks.parts) {
    const prop = props.get(name);
    if (kind !== "prop" || !prop || copies.length === 0) continue;
    marks.warnings.push(...prop.warnings);
    const shadow = config[`prop-${name}`]?.shadow !== false;
    const merged = mergeDocuments(document, prop.document);
    oneBuffer(document);
    // The prop's scene came along; its nodes are what each copy is made from.
    const scene = merged.get(prop.document.getRoot().listScenes()[0]);
    const templates = scene.listChildren();
    for (const template of templates) scene.removeChild(template);
    scene.dispose();
    probeMaterial ??= document.createMaterial("light probe").setRoughnessFactor(1).setMetallicFactor(0);
    const placing = copies.map(({ at, turn, size }, i) => {
      const node = document
        .createNode(`${name} ${i + 1}`)
        .setTranslation([...at])
        .setRotation([0, Math.sin(turn / 2), 0, Math.cos(turn / 2)])
        .setScale([size, size, size]);
      if (!shadow) node.setExtras({ castsNoShadow: true });
      for (const template of templates) {
        const part = copyOf(document, template, stillPart);
        if (part) node.addChild(part);
      }
      let probe;
      if (prop.crown) {
        const { low, high } = prop.crown;
        probe = probeAt(document, probeMaterial, [(low[0] + high[0]) / 2, high[1] + PROBE_ABOVE, (low[2] + high[2]) / 2]);
        node.addChild(probe);
      }
      layer.node.addChild(node);
      return { node, probe, note: { at, turn, size } };
    });
    placed.push({ prop, layer, shadow, templates, placing });
  }
  noteProps(placed);
  return placed;
}

/**
 * Note on each prop mark's layer where its copies are, for the walkthrough,
 * which draws the swaying parts there; once the baked light is laid out, also
 * where each copy's light probe lies in it.
 */
function noteProps(placed) {
  for (const { prop, layer, placing } of placed) {
    for (const { probe, note } of placing) {
      const [primitive] = probe?.getMesh().listPrimitives() ?? [];
      const light = primitive?.getAttribute("TEXCOORD_1");
      if (!light) continue;
      const spot = [0, 0];
      for (let i = 0, uv = []; i < light.getCount(); i++) {
        light.getElement(i, uv);
        spot[0] += uv[0] / light.getCount();
        spot[1] += uv[1] / light.getCount();
      }
      note.probe = { picture: primitive.getMaterial().getExtras().lightPicture ?? 0, spot };
    }
    layer.node.setExtras({
      ...layer.node.getExtras(),
      walkthrough: "prop",
      prop: prop.name,
      sways: prop.crown !== undefined,
      copies: placing.map(({ note }) => note),
    });
  }
}

/** Give the bake each copy's crown, which casts its still shadow, unless its prop casts none. */
function addCrowns(document, placed) {
  const crowns = [];
  for (const { shadow, templates, placing } of placed) {
    if (!shadow) continue;
    for (const { node } of placing) {
      for (const template of templates) {
        const crown = copyOf(document, template, crownPart);
        if (!crown) continue;
        node.addChild(crown);
        crowns.push(crown);
      }
    }
  }
  return crowns;
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
      primitives.push({ primitive, node });
    }
    node.listChildren().forEach(visit);
  };
  for (const scene of document.getRoot().listScenes()) scene.listChildren().forEach(visit);
  return primitives;
}

/** Width and height of each baked light picture, in pixels: SIZE in scripts/bake.mjs. */
const PICTURE_SIZE = 2048;
/** Metres each pixel of baked light covers (#27). */
const PIXEL = 0.03;
/** A single surface larger than this, in square metres, such as open ground, gets pixels twice as large (#27). */
const BIG_SURFACE = 200;
/** Pixels left between neighbouring patches, which the bake's margin fills, so light never bleeds across. */
const PADDING = 4;

/**
 * Give every node its own mesh. Optimize merges identical objects to save
 * download, so two blocks alike share one mesh, placed twice; but each copy
 * gets light of its own, so each needs its own patch of the baked light
 * pictures, or the two would paint over each other (#27).
 */
function unshareMeshes(document) {
  const seen = new Set();
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if (!seen.has(mesh)) {
      seen.add(mesh);
      continue;
    }
    const own = document.createMesh(mesh.getName());
    for (const primitive of mesh.listPrimitives()) own.addPrimitive(primitive.clone());
    node.setMesh(own);
  }
}

/** A primitive's corners in world space, and its area in square metres. */
function worldCorners(primitive, node) {
  const matrix = node.getWorldMatrix();
  const position = primitive.getAttribute("POSITION");
  const corners = new Float32Array(position.getCount() * 3);
  for (let i = 0, p = [0, 0, 0]; i < position.getCount(); i++) {
    position.getElement(i, p);
    for (let r = 0; r < 3; r++) corners[i * 3 + r] = matrix[r] * p[0] + matrix[4 + r] * p[1] + matrix[8 + r] * p[2] + matrix[12 + r];
  }
  const index = primitive.getIndices();
  const count = index ? index.getCount() : position.getCount();
  const at = (i) => (index ? index.getScalar(i) : i) * 3;
  let area = 0;
  for (let t = 0; t + 2 < count; t += 3) {
    const [a, b, c] = [at(t), at(t + 1), at(t + 2)];
    const u = [0, 1, 2].map((k) => corners[b + k] - corners[a + k]);
    const v = [0, 1, 2].map((k) => corners[c + k] - corners[a + k]);
    area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return { corners, area };
}

/**
 * Lay out every baked surface in as many baked light pictures as it takes,
 * each PICTURE_SIZE across, at PIXEL metres a pixel, or twice that on big
 * surfaces, with PADDING between patches so light never bleeds from one into
 * the next (#27). A surface's patches may land in different pictures, so it
 * is split into one primitive per picture, and each material used in more
 * than one picture is copied, so that a material always says which picture
 * holds its light: `lightPicture` in its extras, for the bake and the
 * walkthrough. Returns how many pictures there are.
 */
function packBakedLight(document) {
  unshareMeshes(document);
  const baked = bakedPrimitives(document);
  if (baked.length === 0) return 0;
  const atlas = new watlas.Atlas();
  for (const { primitive, node } of baked) {
    const { corners, area } = worldCorners(primitive, node);
    // Smaller in the layout means fewer pixels.
    if (area > BIG_SURFACE) for (let i = 0; i < corners.length; i++) corners[i] *= 0.5;
    const index = primitive.getIndices();
    const declaration = {
      vertexCount: corners.length / 3,
      vertexPositionData: corners,
      vertexPositionStride: 12,
    };
    if (index) {
      declaration.indexCount = index.getCount();
      declaration.indexData = Uint32Array.from(index.getArray());
    }
    atlas.addMesh(declaration);
  }
  atlas.generate({}, { resolution: PICTURE_SIZE, texelsPerUnit: 1 / PIXEL, padding: PADDING, bilinear: true });
  const pictures = atlas.atlasCount;
  const copies = new Map();
  /** Each part laid out, and the picture its patches are in, to check once all are done. */
  const laidOut = [];
  let dropped = 0;
  /** The material to use for this one in this picture: itself the first time, a copy after. */
  const materialFor = (material, picture) => {
    let byPicture = copies.get(material);
    if (!byPicture) copies.set(material, (byPicture = new Map()));
    if (!byPicture.has(picture)) {
      const made = byPicture.size === 0 ? material : material.clone().setName(`${material.getName()} ${picture + 1}`);
      made.setExtras({ ...made.getExtras(), lightPicture: picture });
      byPicture.set(picture, made);
    }
    return byPicture.get(picture);
  };
  baked.forEach(({ primitive, node }, m) => {
    const laid = atlas.getMesh(m);
    const vertices = Array.from({ length: laid.vertexCount }, (_, j) => laid.getVertex(j));
    const indices = new Uint32Array(laid.indexCount);
    laid.getIndexArray(indices);
    // Triangles by the picture their patch landed in.
    const byPicture = new Map();
    for (let t = 0; t < indices.length; t += 3) {
      const picture = vertices[indices[t]].atlasIndex;
      if (!byPicture.has(picture)) byPicture.set(picture, []);
      byPicture.get(picture).push(indices[t], indices[t + 1], indices[t + 2]);
    }
    // The layout leaves out triangles too small to hold any light, which
    // are too small to see as well, so they go.
    dropped += (byPicture.get(-1)?.length ?? 0) / 3;
    byPicture.delete(-1);
    if (byPicture.size === 0) node.getMesh().removePrimitive(primitive);
    const source = primitive;
    // Taken before the first half is given its picture's material, which may be a copy.
    const material = source.getMaterial();
    const attributes = source.listSemantics().map((semantic) => [semantic, source.getAttribute(semantic)]);
    const ownCoordinates = attributes.some(([semantic]) => semantic === "TEXCOORD_0");
    let first = true;
    for (const [picture, triangles] of byPicture) {
      // Only the corners this picture's triangles use, renumbered.
      const used = [...new Set(triangles)];
      const renumber = new Map(used.map((old, i) => [old, i]));
      const target = first ? source : source.clone();
      for (const [semantic, accessor] of attributes) {
        if (semantic === "TEXCOORD_1") continue;
        const size = accessor.getElementSize();
        const array = new (accessor.getArray().constructor)(used.length * size);
        const element = [];
        used.forEach((old, i) => array.set(accessor.getElement(vertices[old].xref, element), i * size));
        target.setAttribute(semantic, document.createAccessor().setType(accessor.getType()).setArray(array).setNormalized(accessor.getNormalized()).setBuffer(accessor.getBuffer()));
      }
      const light = new Float32Array(used.length * 2);
      used.forEach((old, i) => light.set([vertices[old].uv[0] / PICTURE_SIZE, vertices[old].uv[1] / PICTURE_SIZE], i * 2));
      const lightCoordinates = document.createAccessor().setType("VEC2").setArray(light).setBuffer(attributes[0][1].getBuffer());
      target.setAttribute("TEXCOORD_1", lightCoordinates);
      // Coordinates are numbered without gaps: a surface without its own
      // texture coordinates takes the light's as its first set too, or
      // Blender reads it as having no light coordinates and skips it.
      if (!ownCoordinates) target.setAttribute("TEXCOORD_0", lightCoordinates);
      target.setIndices(document.createAccessor().setType("SCALAR").setArray(Uint32Array.from(triangles, (old) => renumber.get(old))).setBuffer(attributes[0][1].getBuffer()));
      target.setMaterial(materialFor(material, picture));
      if (!first) node.getMesh().addPrimitive(target);
      laidOut.push([target, picture]);
      first = false;
    }
  });
  atlas.delete();
  if (dropped > 0) console.log(`${dropped} triangles too small to hold baked light were dropped`);
  // A material that named the wrong picture would show another surface's light.
  for (const [part, picture] of laidOut) {
    if (part.getMaterial().getExtras().lightPicture !== picture) {
      throw new Error(`${part.getMaterial().getName()}: names baked light picture ${part.getMaterial().getExtras().lightPicture}, but its patches are in ${picture}.`);
    }
  }
  return pictures;
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

async function optimizeEnvironment(io, file, props) {
  const from = joinPath(SOURCE, file);
  const to = joinPath(MODELS, file);
  const document = await io.read(from);
  const said = simplifyMaterials(document);
  for (const text of said) console.warn(`${file}: ${text}`);
  // Each lamp object as Rhino wrote it, before objects alike are merged.
  const lamps = [...lampsIn(document)].map(([material, objects]) =>
    lampsOf(material.getName() || "(unnamed)", material, [...objects.values()]),
  );
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
  const marks = markEnvironment(document, file);
  marks.warnings.push(...said);
  const configFile = joinPath(MODELS, renamed(file, "-config.md"));
  const config = existsSync(configFile) ? readConfig(await readFile(configFile, "utf8")) : {};
  const placed = placeProps(document, marks, props, config);
  for (const { prop, placing } of placed) {
    for (const { material, area, fronts } of prop.lamps) {
      const copies = placing.map(({ note }) => ({ area, fronts, size: note.size }));
      lamps.push(lampsOf(`prop-${prop.name} ${material.getName() || "(unnamed)"}`, material, copies));
    }
  }
  listLamps(file, lamps);
  await document.transform(tidy());
  // A second set of texture coordinates in which no two surfaces overlap, so
  // `npm run bake` can paint each one's light into the baked light pictures.
  const pictures = packBakedLight(document);
  noteProps(placed);
  console.log(
    `${file}: baked light in ${pictures} picture${pictures === 1 ? "" : "s"} of ${PICTURE_SIZE} px, ` +
      `${PIXEL * 100} cm a pixel, ${PIXEL * 200} cm on surfaces over ${BIG_SURFACE} m²`,
  );
  // Blender can't read compressed geometry, so the bake gets its own copy.
  await mkdir(BAKE_COPY, { recursive: true });
  const crowns = addCrowns(document, placed);
  await io.write(joinPath(BAKE_COPY, file), document);
  // Crowns arrive after the viewer can move, from props/, and probes are never seen.
  for (const node of crowns) disposeTree(node);
  for (const { templates, placing } of placed) {
    for (const template of templates) disposeTree(template);
    for (const { probe } of placing) if (probe) disposeTree(probe);
  }
  await document.transform(tidy());
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
  // Every baked light picture the last bake wrote.
  const stem = renamed(environment, "-light-");
  const baked = (await readdir(MODELS)).filter((file) => file.startsWith(stem)).map((file) => joinPath(MODELS, file));
  const opening =
    CODE_ESTIMATE +
    (await megabytes([
      joinPath(MODELS, environment),
      ...baked,
      joinPath(SKIES, renamed(sky, "-small.jpg")),
      joinPath(SKIES, renamed(sky, "-small.hdr")),
    ]));
  const scattered = [SCATTER, PROPS].flatMap((folder) =>
    existsSync(folder) ? readdirSync(folder).map((file) => joinPath(folder, file)) : [],
  );
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

/**
 * The parts of each prop that sway, which the walkthrough downloads after the
 * viewer can move and draws at every copy, compressed like the environment
 * (#28). A prop without them has no file here: all of it is in the environment.
 */
async function writeProps(io, props) {
  await mkdir(PROPS, { recursive: true });
  const written = new Set();
  for (const prop of props.values()) {
    if (!prop.crown) continue;
    const document = cloneDocument(prop.document);
    for (const { primitive, node, collision } of primitivesOfProp(document)) {
      if (collision || !isSwaying(primitive.getMaterial())) node.getMesh().removePrimitive(primitive);
    }
    await document.transform(prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    const to = joinPath(PROPS, `${prop.name}.glb`);
    await io.write(to, document);
    written.add(`${prop.name}.glb`);
    console.log(`props/${prop.file}: swaying parts ${await megabytes(to)}`);
  }
  // Left from props that are gone or no longer sway, they would be downloaded for nothing.
  for (const old of await readdir(PROPS)) if (!written.has(old)) await rm(joinPath(PROPS, old));
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
const props = await readProps(io);
for (const file of environments) await optimizeEnvironment(io, file, props);
for (const file of skies) await optimizeSky(file);
await optimizeScatter(io);
await writeProps(io, props);
if (environments.length === 1 && skies.length === 1) await reportBudget(environments[0], skies[0]);
