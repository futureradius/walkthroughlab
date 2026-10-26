import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import type { Point } from "./marks";
import { fixed, number, type Described } from "./settings";

/**
 * How the flocks of one `traffic-<name>` mark fly, under `## traffic-<name>`
 * in the config file (#32). Climbing at `climb` or steeper, a bird flaps all
 * the time; level, it pauses for up to `pause` between bursts of flapping;
 * sinking at `dive` or steeper, it glides and never flaps; in between, its
 * longest pause slides from one to the next.
 */
export interface FlockSettings {
  /** Birds in each flock. */
  count: number;
  /** Metres a second along the loop. */
  speed: number;
  /** Metres from the flock's middle its birds keep to. */
  spread: number;
  /** Their size, as a share of the bird's own. */
  size: number;
  /** Wingbeats a second. */
  flap: number;
  /** Degrees the birds lean at most, in the tightest turns. */
  bank: number;
  /** Degrees climbing at which a bird flaps without a pause. */
  climb: number;
  /** Seconds a bird pauses at most between bursts of flapping, flying level. */
  pause: number;
  /** Degrees sinking at which a bird glides and never flaps. */
  dive: number;
  /** Seconds a burst of flapping lasts at most. */
  burst: number;
}

export const FLOCK: FlockSettings = {
  count: 9,
  speed: 9,
  spread: 3,
  size: 1,
  flap: 4,
  bank: 30,
  climb: 10,
  pause: 4,
  dive: 8,
  burst: 1.5,
};

/** Most birds in one flock. */
const MOST_BIRDS = 40;

const degrees = (value: number) => `${value}°`;

export const FLOCK_DESCRIBED: Described<FlockSettings> = {
  count: number({
    label: "Birds",
    min: 0,
    max: MOST_BIRDS,
    step: 1,
    show: (birds) => `${birds}`,
    about: "How many birds fly in each flock, one flock round each loop on the layer.",
  }),
  speed: number({
    label: "Speed",
    min: 0,
    max: 30,
    step: 0.5,
    show: fixed(1, " m/s"),
    about: "How fast the flock flies round its loop.",
  }),
  spread: number({
    label: "Spread",
    min: 0,
    max: 15,
    step: 0.25,
    show: fixed(2, " m"),
    about: "How far from the flock's middle its birds keep, ahead, behind and to the sides, and half that above and below.",
  }),
  size: number({
    label: "Size",
    min: 0.25,
    max: 4,
    step: 0.05,
    show: fixed(2, "×"),
    about: "How large the birds are, as a share of the bird as it was made.",
  }),
  flap: number({
    label: "Wingbeats",
    min: 0.5,
    max: 12,
    step: 0.5,
    show: fixed(1, " /s"),
    about: "How many times a second a bird beats its wings while it flaps.",
  }),
  bank: number({
    label: "Bank",
    min: 0,
    max: 80,
    step: 1,
    show: degrees,
    about: "How far the birds lean at most, in the tightest turns; gentler turns lean them less.",
  }),
  climb: number({
    label: "Flap without pause from",
    min: 0,
    max: 60,
    step: 1,
    show: degrees,
    about: "Climbing this steeply or more, a bird flaps all the time; climbing less, it pauses ever longer, up to the longest pause when level.",
  }),
  pause: number({
    label: "Longest pause",
    min: 0,
    max: 20,
    step: 0.25,
    show: fixed(2, " s"),
    about: "Flying level, a bird glides between bursts of flapping for a random time up to this.",
  }),
  dive: number({
    label: "Only glide from",
    min: 0,
    max: 60,
    step: 1,
    show: degrees,
    about: "Sinking this steeply or more, a bird glides and never flaps; sinking less, its pauses grow from the longest pause.",
  }),
  burst: number({
    label: "Longest burst",
    min: 0.25,
    max: 10,
    step: 0.25,
    show: fixed(2, " s"),
    about: "A burst of flapping lasts a random time up to this.",
  }),
};

/**
 * Seconds a bird pauses at most between bursts of flapping, climbing at
 * `climb` radians, sinking if below 0: none at the settings' `climb` or
 * steeper, `pause` when level, and without end at `dive` or steeper down.
 */
export function longestPause(climb: number, { climb: flapping, pause, dive }: FlockSettings): number {
  // Rounded, as radians from degrees come back a hair off.
  const angle = Math.round(((climb * 180) / Math.PI) * 1e6) / 1e6;
  if (angle >= flapping) return 0;
  if (angle >= 0) return pause * (1 - angle / flapping);
  if (-angle >= dive) return Infinity;
  return pause / (1 - -angle / dive);
}

/** How a bird's wings move: worked out on the processor, since there are few birds. */
export interface Wings {
  /** Radians through the wingbeat. */
  phase: number;
  /** From 0, held in the glide, to 1, flapping. */
  beating: number;
  flapping: boolean;
  /** Seconds of the burst still to flap. */
  left: number;
  /** Seconds paused so far. */
  paused: number;
  /** How much of the longest pause this pause lasts, picked as it starts. */
  share: number;
}

/** Seconds wings take to ease from flapping into the glide, or back. */
const EASE_SECONDS = 0.25;

export const restingWings = (random: () => number): Wings => ({
  phase: random() * Math.PI * 2,
  beating: 0,
  flapping: false,
  left: 0,
  paused: 0,
  share: random(),
});

/** Move a bird's wings on by one frame, the bird climbing at `climb` radians. */
export function beat(wings: Wings, seconds: number, climb: number, settings: FlockSettings, random: () => number) {
  const longest = longestPause(climb, settings);
  if (wings.flapping) {
    wings.left -= seconds;
    if (wings.left <= 0 || longest === Infinity) {
      wings.flapping = false;
      wings.paused = 0;
      wings.share = random();
    }
  } else {
    wings.paused += seconds;
  }
  // A pause can end in the frame a burst does, so a climbing bird never stops.
  if (!wings.flapping && wings.paused >= wings.share * longest) {
    wings.flapping = true;
    wings.left = settings.burst * (0.3 + 0.7 * random());
  }
  const toward = wings.flapping ? 1 : 0;
  const step = seconds / EASE_SECONDS;
  wings.beating = toward > wings.beating ? Math.min(toward, wings.beating + step) : Math.max(toward, wings.beating - step);
  wings.phase = (wings.phase + Math.PI * 2 * settings.flap * seconds) % (Math.PI * 2);
}

/** Metres between the points a loop is kept as, once smoothed. */
const STEP = 0.25;
/** Metres either side of a point over which its turn is measured, so banking eases in and out. */
const TURN_SPAN = 3;
/** Points worked out along each stretch between two corners before they are spaced evenly. */
const DETAIL = 24;

/** Where a smoothed loop is at a distance along it, and how it runs there. */
export interface Along {
  at: Vector3;
  /** The way it runs, of length 1. */
  ahead: Vector3;
  /** Radians it climbs, below 0 where it sinks. */
  climb: number;
  /** How sharply it turns across the floor plan, as 1 over the radius in metres, above 0 turning to the left. */
  turn: number;
}

/**
 * A loop the author drew, its corners smoothed away into a curve through
 * the middle of them all (a closed cubic B-spline), so a flock flies round in
 * arcs however jagged the polyline, at an even speed (#32).
 */
export class Loop {
  readonly length: number;
  private readonly points: Float32Array;
  private readonly aheads: Float32Array;
  private readonly turns: Float32Array;

  constructor(corners: readonly Point[]) {
    const n = corners.length;
    const dense: Vector3[] = [];
    const corner = (i: number) => new Vector3(...corners[((i % n) + n) % n]);
    for (let i = 0; i < n; i++) {
      const [p0, p1, p2, p3] = [corner(i - 1), corner(i), corner(i + 1), corner(i + 2)];
      for (let k = 0; k < DETAIL; k++) {
        const t = k / DETAIL;
        const weights = [(1 - t) ** 3, 3 * t ** 3 - 6 * t ** 2 + 4, -3 * t ** 3 + 3 * t ** 2 + 3 * t + 1, t ** 3];
        dense.push(
          new Vector3()
            .addScaledVector(p0, weights[0] / 6)
            .addScaledVector(p1, weights[1] / 6)
            .addScaledVector(p2, weights[2] / 6)
            .addScaledVector(p3, weights[3] / 6),
        );
      }
    }
    // Spaced evenly along it, so a flock flies round at an even speed.
    const travelled = [0];
    for (let i = 1; i <= dense.length; i++) travelled.push(travelled[i - 1] + dense[i - 1].distanceTo(dense[i % dense.length]));
    this.length = travelled[dense.length];
    const count = Math.max(4, Math.round(this.length / STEP));
    const points = new Float32Array(count * 3);
    for (let i = 0, j = 0; i < count; i++) {
      const distance = (i / count) * this.length;
      while (travelled[j + 1] < distance) j++;
      const t = (distance - travelled[j]) / Math.max(travelled[j + 1] - travelled[j], 1e-9);
      new Vector3().lerpVectors(dense[j], dense[(j + 1) % dense.length], t).toArray(points, i * 3);
    }
    this.points = points;
    const at = (i: number) => new Vector3().fromArray(points, (((i % count) + count) % count) * 3);
    this.aheads = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) at(i + 1).sub(at(i - 1)).normalize().toArray(this.aheads, i * 3);
    const span = Math.max(1, Math.round(TURN_SPAN / (this.length / count)));
    const ahead = (i: number) => new Vector3().fromArray(this.aheads, (((i % count) + count) % count) * 3);
    this.turns = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const [before, after] = [ahead(i - span), ahead(i + span)];
      let turned = Math.atan2(after.x, after.z) - Math.atan2(before.x, before.z);
      turned = Math.atan2(Math.sin(turned), Math.cos(turned));
      // Turning from +z towards +x is a turn to the left, seen from above with y up.
      this.turns[i] = turned / (2 * span * (this.length / count));
    }
  }

  /** Where it is `distance` metres along from where it starts, going round as often as it takes. */
  along(distance: number, into: Along): Along {
    const count = this.turns.length;
    const spot = ((((distance / this.length) * count) % count) + count) % count;
    const i = Math.floor(spot);
    const j = (i + 1) % count;
    const t = spot - i;
    into.at.set(
      this.points[i * 3] + (this.points[j * 3] - this.points[i * 3]) * t,
      this.points[i * 3 + 1] + (this.points[j * 3 + 1] - this.points[i * 3 + 1]) * t,
      this.points[i * 3 + 2] + (this.points[j * 3 + 2] - this.points[i * 3 + 2]) * t,
    );
    into.ahead
      .set(
        this.aheads[i * 3] + (this.aheads[j * 3] - this.aheads[i * 3]) * t,
        this.aheads[i * 3 + 1] + (this.aheads[j * 3 + 1] - this.aheads[i * 3 + 1]) * t,
        this.aheads[i * 3 + 2] + (this.aheads[j * 3 + 2] - this.aheads[i * 3 + 2]) * t,
      )
      .normalize();
    into.climb = Math.asin(Math.max(-1, Math.min(1, into.ahead.y)));
    into.turn = this.turns[i] + (this.turns[j] - this.turns[i]) * t;
    return into;
  }
}

/** The same numbers every time, from a seed. */
export function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where each bird keeps to in its flock, as shares of the spread: across
 * (x), up (y), half as far, and behind the middle (z), not too close to
 * those before it, so the first few of any count are spread out too.
 */
export function homesOf(count: number, random: () => number): Vector3[] {
  const homes: Vector3[] = [];
  for (let b = 0; b < count; b++) {
    let best = new Vector3();
    let bestGap = -1;
    // The best spaced of a few tries.
    for (let tries = 0; tries < 12; tries++) {
      let home: Vector3;
      do home = new Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
      while (home.lengthSq() > 1);
      home.y *= 0.5;
      const gap = Math.min(Infinity, ...homes.map((other) => other.distanceTo(home)));
      if (gap > bestGap) [best, bestGap] = [home, gap];
    }
    homes.push(best);
  }
  return homes;
}

/** Seconds birds take to grow to their size once their file has arrived. */
const GROW_SECONDS = 1;
/** Of the spread, how far a bird wanders about its place in the flock. */
const WANDER = 0.25;
const GRAVITY = 9.81;

/**
 * GLSL bending a point of a bird, or its normal, `rest` being where the point
 * lies in the bird: a wing turns about the bird's length, the more the more
 * it is painted to flap, from a slight upward V in the glide to the wingbeat.
 */
const WING_GLSL = /* glsl */ `
  attribute float flap;
  attribute vec2 wing;

  vec3 flapped(vec3 v, vec3 rest) {
    float stroke = mix(0.12, 0.2 + 0.75 * sin(wing.x), wing.y);
    float angle = stroke * flap * sign(rest.x);
    float c = cos(angle), s = sin(angle);
    return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z);
  }
`;

/** A bird's material, its wings moved by the instanced `wing` attribute. */
function withWings(material: Material): Material {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", `${WING_GLSL}\nvoid main() {`)
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\n  objectNormal = flapped(objectNormal, position);")
      .replace(
        "#include <begin_vertex>",
        // The body rises and falls a little with each wingbeat.
        "#include <begin_vertex>\n  transformed = flapped(transformed, position);\n  transformed.y -= 0.015 * cos(wing.x) * wing.y;",
      );
  };
  material.customProgramCacheKey = () => "wings";
  return material;
}

/** One part of a bird, by material, its corners where they are in the bird, with how much each flaps. */
interface BirdPart {
  geometry: BufferGeometry;
  material: Material;
}

/** Every part of a bird's file, by material. */
export function birdOf(model: Object3D): BirdPart[] {
  model.updateWorldMatrix(true, true);
  const found: BirdPart[] = [];
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = new BufferGeometry();
    for (const name of ["position", "normal", "uv", "_flap"]) {
      const attribute = object.geometry.getAttribute(name);
      if (!attribute) continue;
      // Plain numbers in place of compressed ones.
      const plain = new Float32Array(attribute.count * attribute.itemSize);
      for (let i = 0; i < attribute.count; i++) {
        for (let k = 0; k < attribute.itemSize; k++) plain[i * attribute.itemSize + k] = attribute.getComponent(i, k);
      }
      geometry.setAttribute(name === "_flap" ? "flap" : name, new BufferAttribute(plain, attribute.itemSize));
    }
    if (!geometry.hasAttribute("flap")) geometry.setAttribute("flap", new BufferAttribute(new Float32Array(geometry.getAttribute("position").count), 1));
    if (object.geometry.index) geometry.setIndex(object.geometry.index.clone());
    geometry.applyMatrix4(object.matrixWorld);
    found.push({ geometry, material: withWings((object.material as Material).clone()) });
  });
  return found;
}

/** One bird of a flock: where it keeps to, how it wanders, and its wings. */
interface Bird {
  home: Vector3;
  /** Radians a second and where it starts, for each way it wanders. */
  wander: [number, number][];
  wings: Wings;
}

/**
 * The flocks of one traffic mark, one round each of its loops, each following
 * an unseen leader along the smoothed loop at an even speed; its birds keep
 * their places about it, trailing round turns, banking into them and pitching
 * with the loop, and flap by how steeply the leader climbs. Lit live by the
 * sky alone and casting no shadow (ADR 0003), drawn in one go for each part
 * of the bird, growing to their size once the bird's file has arrived. Out of
 * ambient occlusion's own work, like grass.
 */
export class Flocks {
  /** Everything drawn, to add to the scene once. */
  readonly group = new Group();
  readonly settings: FlockSettings = { ...FLOCK };

  private readonly flocks: { loop: Loop; travelled: number; birds: Bird[] }[];
  private readonly layer: number;
  private readonly random = seeded(32);
  private readonly matrices: InstancedBufferAttribute;
  private readonly wings: InstancedBufferAttribute;
  private meshes: InstancedMesh[] = [];
  private grownFor = -1;
  private time = 0;
  private readonly spot: Along = { at: new Vector3(), ahead: new Vector3(), climb: 0, turn: 0 };
  private readonly matrix = new Matrix4();
  private readonly side = new Vector3();
  private readonly up = new Vector3();
  private readonly across = new Vector3();
  private readonly scale = new Vector3();

  /** `layer` is the camera layer they are drawn on besides the usual one. */
  constructor(loops: readonly (readonly Point[])[], layer: number) {
    this.layer = layer;
    const homes = homesOf(MOST_BIRDS, seeded(7));
    this.flocks = loops.map((corners) => ({
      loop: new Loop(corners),
      travelled: 0,
      birds: homes.map((home) => ({
        home,
        wander: [0, 1, 2].map(() => [0.3 + 0.3 * this.random(), this.random() * Math.PI * 2] as [number, number]),
        wings: restingWings(this.random),
      })),
    }));
    const capacity = Math.max(1, loops.length * MOST_BIRDS);
    this.matrices = new InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
    this.wings = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  }

  /** The bird's file has arrived: fly copies of it round every loop, growing to their size. */
  grow(parts: BirdPart[]) {
    if (parts.length === 0 || this.flocks.length === 0) return;
    for (const { geometry, material } of parts) {
      geometry.setAttribute("wing", this.wings);
      const mesh = new InstancedMesh(geometry, material, this.matrices.count);
      mesh.instanceMatrix = this.matrices;
      // They move every frame, so their bounds would always be out of date.
      mesh.frustumCulled = false;
      mesh.layers.enable(this.layer);
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.grownFor = 0;
  }

  /** Move on by one frame; `still` is true for viewers who ask for reduced motion, who see no birds. */
  update(seconds: number, still: boolean) {
    this.group.visible = !still && this.grownFor >= 0;
    if (!this.group.visible) return;
    this.time += seconds;
    this.grownFor += seconds;
    const { settings, spot, matrix, side, up, across, scale } = this;
    const count = Math.min(MOST_BIRDS, Math.max(0, Math.round(settings.count)));
    const grown = Math.min(1, this.grownFor / GROW_SECONDS);
    // Easing out, so they arrive gently.
    const size = settings.size * grown * (2 - grown);
    scale.set(size, size, size);
    const most = (settings.bank * Math.PI) / 180;
    let n = 0;
    for (const flock of this.flocks) {
      flock.travelled = (flock.travelled + settings.speed * seconds) % flock.loop.length;
      const climb = flock.loop.along(flock.travelled, spot).climb;
      for (const { home, wander, wings } of flock.birds.slice(0, count)) {
        const sway = (k: number) => Math.sin(this.time * wander[k][0] + wander[k][1]) * WANDER;
        const behind = (home.z + sway(2)) * settings.spread;
        flock.loop.along(flock.travelled - behind, spot);
        // Across the loop, level, to the bird's left.
        side.set(spot.ahead.z, 0, -spot.ahead.x).normalize();
        const at = spot.at
          .addScaledVector(side, (home.x + sway(0)) * settings.spread)
          .addScaledVector(across.set(0, 1, 0), (home.y + sway(1) * 0.5) * settings.spread);
        // Leaning into the turn, as far as its speed would need, up to the most allowed.
        const lean = Math.min(most, Math.atan((settings.speed ** 2 * Math.abs(spot.turn)) / GRAVITY)) * Math.sign(spot.turn);
        up.set(0, Math.cos(lean), 0).addScaledVector(side, Math.sin(lean));
        across.crossVectors(up, spot.ahead).normalize();
        up.crossVectors(spot.ahead, across);
        matrix.makeBasis(across, up, spot.ahead).scale(scale).setPosition(at);
        matrix.toArray(this.matrices.array, n * 16);
        beat(wings, seconds, climb, settings, this.random);
        this.wings.array[n * 2] = wings.phase;
        this.wings.array[n * 2 + 1] = wings.beating;
        n++;
      }
    }
    this.matrices.needsUpdate = true;
    this.wings.needsUpdate = true;
    for (const mesh of this.meshes) mesh.count = n;
  }
}
