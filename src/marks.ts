// Reads the marks an author puts in the Rhino model: layer names inside one
// top layer `Walkthrough`, as ADR 0004 and issue #12 settle them. It runs in
// `npm run optimize`, which writes what it finds into the environment's file,
// so it must not import anything: Node runs it as it is.

/** A spot in the walkthrough's space: x and z across the floor plan, y up. */
export type Point = readonly [number, number, number];

/**
 * A layer of the Rhino model as the export carries it. `node` is whatever
 * the caller reads the model with, handed back where a mark needs it.
 */
export interface Layer<T> {
  name: string;
  node: T;
  layers: Layer<T>[];
  /** The lines and polylines drawn on it, each as its points in order. */
  lines: Point[][];
  /** How many of its objects have surfaces, as opposed to lines. */
  surfaces: number;
}

/** Where the viewpoint begins and which way it looks; see GLOSSARY.md. */
export interface Start {
  x: number;
  /** Height of the line, near the floor the viewer stands on. */
  y: number;
  z: number;
  /** Radians, turning right from looking towards -z, as steering counts it. */
  heading: number;
}

/** A recognised mark, such as `door-hinged-2`. */
export interface Part<T> {
  kind: Kind;
  name: string;
  /** How messages name it, such as `elevator-1 › door-sliding-2`. */
  path: string;
  layer: Layer<T>;
  /** For a prop, each copy its lines place. */
  copies?: Copy[];
}

/** Where one copy of a prop stands, which way it faces, and how large it is, from its line (#28). */
export interface Copy {
  /** Where the prop's origin goes: the start of the line. */
  at: Point;
  /** Radians the prop is turned about the upright, from facing +z, its front in Blender, towards +x. */
  turn: number;
  /** Its size as a share of its own: the line's length in metres. */
  size: number;
}

/** Everything the marks of one model say. */
export interface Marks<T> {
  start?: Start;
  /** Every collision mesh layer: the still one and each moving part's piece. */
  collision: T[];
  parts: Part<T>[];
  /** Mistakes that leave things still or unused, for the author to fix. */
  warnings: string[];
  /** Mistakes that stop the environment from opening. */
  errors: string[];
}

export const WALKTHROUGH = "walkthrough";
export const COLLISION_MESH = "collision mesh";
const START = "start";
const MODEL = "model";
const LEAVES = ["leaf-left", "leaf-right"];

/** Every kind of mark a layer name can begin with. */
export const KINDS = [
  "door-hinged",
  "door-sliding",
  "elevator",
  "sway",
  "prop",
  "scatter",
  "traffic",
  "sound",
] as const;
export type Kind = (typeof KINDS)[number];

/** Kinds that move, have a `model` and a `collision mesh`, and are drawn by a line. */
const MOVING: readonly Kind[] = ["door-hinged", "door-sliding", "elevator"];

/** Lines may lie this far off level, in metres, and still count as flat. */
const FLAT = 0.01;

/** Capitals and spaces around a dash don't matter in a name. */
export const normalise = (name: string) =>
  name.trim().toLowerCase().replace(/\s*-\s*/g, "-").replace(/\s+/g, " ");

/** The kind a layer name begins with and the name after it, if any. */
function kindOf(name: string): { kind: Kind; name: string } | { kind: Kind; name: "" } | undefined {
  const plain = normalise(name);
  for (const kind of KINDS) {
    if (plain === kind) return { kind, name: "" };
    if (plain.startsWith(`${kind}-`)) return { kind, name: plain.slice(kind.length + 1) };
  }
  return undefined;
}

const isFlat = (line: Point[]) => line.every(([, y]) => Math.abs(y - line[0][1]) <= FLAT);

/** Which way the viewpoint looks along a line on the floor plan. */
export function headingOf(from: Point, to: Point): number {
  return Math.atan2(to[0] - from[0], -(to[2] - from[2]));
}

/** Read the marks of a model whose top layers are `layers`. */
export function readMarks<T>(layers: Layer<T>[]): Marks<T> {
  const marks: Marks<T> = { collision: [], parts: [], warnings: [], errors: [] };
  const top = layers.find((layer) => normalise(layer.name) === WALKTHROUGH);
  if (!top) {
    marks.errors.push('The model has no "Walkthrough" layer, so it has no collision mesh or start spot.');
    return marks;
  }
  const warn = (path: string, text: string) => marks.warnings.push(`${path}: ${text}`);

  // Every collision mesh is invisible and stops the viewpoint, wherever it
  // sits and whatever is wrong around it, so it never shows by mistake.
  const gatherCollision = (layer: Layer<T>) => {
    if (normalise(layer.name) === COLLISION_MESH) marks.collision.push(layer.node);
    else layer.layers.forEach(gatherCollision);
  };
  gatherCollision(top);

  if (top.surfaces > 0 || top.lines.length > 0) {
    warn("Walkthrough", "things directly on this layer are not read as marks; put each on a layer inside it.");
  }

  let starts = 0;
  let stillCollision = false;
  for (const layer of top.layers) {
    const plain = normalise(layer.name);
    if (plain === COLLISION_MESH) {
      stillCollision ||= layer.surfaces > 0;
      continue;
    }
    if (plain === START) {
      starts++;
      readStart(layer, marks, starts > 1);
      continue;
    }
    readPart(layer, layer.name, marks, warn);
  }

  if (!stillCollision) {
    marks.errors.push('There is no "collision mesh" layer inside "Walkthrough" with surfaces on it.');
  }
  if (starts === 0) {
    marks.errors.push('There is no "start" layer inside "Walkthrough" with a line on it.');
  }
  return marks;
}

function readStart<T>(layer: Layer<T>, marks: Marks<T>, again: boolean) {
  if (again) {
    marks.warnings.push("start: there is more than one start layer; only the first is used.");
    return;
  }
  const [line, ...others] = layer.lines;
  if (!line || line.length < 2) {
    marks.errors.push("start: draw one flat line, from where the viewer stands towards where they look.");
    return;
  }
  if (others.length > 0) marks.warnings.push("start: holds more than one line; only one is used.");
  if (line.length > 2) marks.warnings.push("start: is a polyline; only its first stretch is used.");
  if (!isFlat(line.slice(0, 2))) marks.warnings.push("start: its line is not flat; only its direction across the floor counts.");
  const [from, to] = line;
  marks.start = { x: from[0], y: from[1], z: from[2], heading: headingOf(from, to) };
}

/** A layer inside `Walkthrough` that should be a mark of some kind. */
function readPart<T>(
  layer: Layer<T>,
  path: string,
  marks: Marks<T>,
  warn: (path: string, text: string) => void,
) {
  const kind = kindOf(layer.name);
  if (!kind) {
    const plain = normalise(layer.name);
    const hint = plain.startsWith("door")
      ? " A door is door-hinged-… or door-sliding-…."
      : plain.startsWith("button")
        ? " Buttons belong inside an elevator: button-call-… beside its floor doors, button-… in its car's model."
        : ` Marks begin with ${KINDS.join(", ")}, "collision mesh" or "start".`;
    warn(path, `is not a kind of mark, so its things stay still.${hint}`);
    return;
  }
  if (kind.name === "") {
    warn(path, `has no name after its kind; call it ${kind.kind}-1. Its things stay still until then.`);
    return;
  }
  if (kind.kind === "prop") {
    marks.parts.push({ kind: kind.kind, name: kind.name, path, layer, copies: copiesOf(layer, path, warn) });
    return;
  }
  marks.parts.push({ kind: kind.kind, name: kind.name, path, layer });
  if (MOVING.includes(kind.kind)) checkMoving(layer, kind.kind, path, marks, warn);
}

/** A door or an elevator: a line, a `model`, a `collision mesh`, and for some, more inside. */
function checkMoving<T>(
  layer: Layer<T>,
  kind: Kind,
  path: string,
  marks: Marks<T>,
  warn: (path: string, text: string) => void,
) {
  const named = (name: string) => layer.layers.filter((inner) => normalise(inner.name) === name);
  const leaves = layer.layers.filter((inner) => LEAVES.includes(normalise(inner.name)));

  if (kind === "door-sliding" && leaves.length > 0) {
    // A door that parts in two: each leaf is a sliding door of its own.
    if (layer.lines.length > 0 || named(MODEL).length > 0) {
      warn(path, "has leaves, so its lines and model belong inside leaf-left and leaf-right.");
    }
    for (const leaf of leaves) checkMoving(leaf, kind, `${path} › ${leaf.name}`, marks, warn);
    const missing = LEAVES.filter((name) => !leaves.some((leaf) => normalise(leaf.name) === name));
    if (missing.length > 0) warn(path, `has only one leaf; a door that parts in two needs ${missing[0]} as well.`);
  } else {
    checkLine(layer, kind, path, warn);
    if (named(MODEL).length === 0) warn(path, 'has no "model" layer, so nothing of it is seen.');
    if (named(COLLISION_MESH).length === 0) {
      warn(path, `has no "collision mesh" layer, so it won't stop the viewpoint.`);
    }
  }

  for (const inner of layer.layers) {
    const plain = normalise(inner.name);
    if (plain === COLLISION_MESH) continue;
    if (plain === MODEL) {
      if (kind === "elevator") {
        // Car doors and buttons sit in the car's model and travel with it.
        for (const inside of inner.layers) {
          const where = `${path} › ${MODEL} › ${inside.name}`;
          const button = buttonOf(inside.name);
          if (button && !button.call) checkButton(inside, where, layer.lines[0]?.length ?? 0, warn);
          else readCarDoor(inside, where, marks, warn);
        }
      }
      continue;
    }
    if (LEAVES.includes(plain)) {
      if (kind !== "door-sliding") warn(`${path} › ${inner.name}`, "leaves belong only inside a door-sliding-… layer.");
      continue;
    }
    if (kind === "elevator" && kindOf(inner.name)?.kind === "door-sliding") {
      // A floor door, opened when the car stands at the stop nearest it.
      readPart(inner, `${path} › ${inner.name}`, marks, warn);
      continue;
    }
    if (kind === "elevator" && buttonOf(inner.name)?.call) {
      checkButton(inner, `${path} › ${inner.name}`, layer.lines[0]?.length ?? 0, warn);
      continue;
    }
    warn(`${path} › ${inner.name}`, "is not read here, so its things stay still.");
  }
}

/**
 * An elevator's button layer: `button-call-N` beside its floor doors calls
 * the car to stop N, `button-N` in its car sends the car there, counting
 * stops along the route from where it starts (#26).
 */
export function buttonOf(name: string): { call: boolean; stop: number } | undefined {
  const found = /^button-(call-)?(\d+)$/.exec(normalise(name));
  return found ? { call: found[1] !== undefined, stop: Number(found[2]) } : undefined;
}

function checkButton<T>(layer: Layer<T>, path: string, stops: number, warn: (path: string, text: string) => void) {
  const { stop } = buttonOf(layer.name)!;
  if (layer.surfaces === 0) warn(path, "has nothing on it to press.");
  if (stop < 1 || stop > stops) warn(path, `the elevator has ${stops} stops, so there is no stop ${stop}.`);
}

function readCarDoor<T>(
  layer: Layer<T>,
  path: string,
  marks: Marks<T>,
  warn: (path: string, text: string) => void,
) {
  if (kindOf(layer.name)?.kind !== "door-sliding") {
    warn(path, "inside an elevator's model, only car doors (door-sliding-…) and buttons (button-…) are read.");
    return;
  }
  readPart(layer, path, marks, warn);
}

/**
 * One copy of a prop for each line on its layer: from where it stands, the
 * way its front faces, as long in metres as its size, 1 m for its own (#28).
 */
export function copiesOf<T>(layer: Layer<T>, path: string, warn: (path: string, text: string) => void): Copy[] {
  const what = "one horizontal line per copy, from where it stands the way its front faces, 1 m long for its own size";
  if (layer.lines.length === 0) warn(path, `has no line; draw ${what}. Nothing is placed until then.`);
  if (layer.surfaces > 0) warn(path, "only its lines are read; the things drawn on it are shown as they are, not as the prop.");
  const copies: Copy[] = [];
  let sloped = 0, polylines = 0, empty = 0;
  for (const line of layer.lines) {
    if (line.length > 2) polylines++;
    const [from, to] = line;
    if (!to) {
      empty++;
      continue;
    }
    if (!isFlat([from, to])) sloped++;
    const [dx, dz] = [to[0] - from[0], to[2] - from[2]];
    const size = Math.hypot(dx, dz);
    if (size < FLAT) {
      empty++;
      continue;
    }
    copies.push({ at: from, turn: Math.atan2(dx, dz), size });
  }
  if (sloped > 0) warn(path, `${sloped} of its lines are not horizontal; only their length and direction across the floor count.`);
  if (polylines > 0) warn(path, `${polylines} of its lines are polylines; only their first stretch is used.`);
  if (empty > 0) warn(path, `${empty} of its lines have no length across the floor, so they place nothing.`);
  return copies;
}

/** The line that says how a door or elevator moves. */
function checkLine<T>(layer: Layer<T>, kind: Kind, path: string, warn: (path: string, text: string) => void) {
  const what =
    kind === "elevator"
      ? "a polyline from the car's floor through each stop"
      : kind === "door-hinged"
        ? "a flat line from the hinge to where the free edge is when fully open"
        : "a line from where the leaf is closed to where it is open";
  if (layer.lines.length === 0) {
    warn(path, `has no line; draw ${what}. It stays still until then.`);
    return;
  }
  if (layer.lines.length > 1) warn(path, `holds ${layer.lines.length} lines; it needs one, ${what}.`);
  const [line] = layer.lines;
  if (kind === "door-hinged" && !isFlat(line)) warn(path, "its line is not flat; the hinge runs upright through its start.");
  if (kind === "door-sliding" && line.length > 2) warn(path, "its line is a polyline; a sliding door moves along a straight line.");
}

/** A spot on the floor plan: x and z. */
export type Spot = readonly [number, number];

/**
 * How far a hinged door turns, in radians, positive turning from +x towards
 * +z: from where its free edge is when closed, through each corner of its
 * line in turn, each step the shorter way (#12). `halfTurn` says a straight
 * line ends at or near 180°, where the shorter way is unclear.
 */
export function swingOf(pivot: Spot, closedEdge: Spot, corners: Spot[]): { angle: number; halfTurn: boolean } {
  const bearing = (spot: Spot) => Math.atan2(spot[1] - pivot[1], spot[0] - pivot[0]);
  let from = bearing(closedEdge);
  let angle = 0;
  for (const corner of corners) {
    const to = bearing(corner);
    let turn = to - from;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn <= -Math.PI) turn += 2 * Math.PI;
    angle += turn;
    from = to;
  }
  const halfTurn = corners.length === 1 && Math.abs(Math.abs(angle) - Math.PI) < (10 * Math.PI) / 180;
  return { angle, halfTurn };
}
