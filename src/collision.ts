import type { Footing, Terrain } from "./motion";

/** How the viewer's body meets a collision mesh, in metres. */
export interface Body {
  /** How close the viewpoint may get to a wall. */
  radius: number;
  /** Walls entirely above this height over the floor are walked under. */
  height: number;
  /** Tallest sudden rise in floor height the viewer walks up; a deeper drop is a fall. */
  maxStep: number;
}

export const BODY: Body = { radius: 0.4, height: 1.6, maxStep: 0.3 };

/** Surfaces tilted less than this from level are floor; steeper ones are wall. */
const MAX_FLOOR_TILT = Math.PI / 4;
const MIN_FLOOR_UP = Math.cos(MAX_FLOOR_TILT);
/** Lets a footing on the seam between two floor triangles count as on both. */
const SEAM = 1e-6;
/** Rounds of pushing out of walls, so corners between walls settle. */
const PUSH_ROUNDS = 3;

/** Nine numbers: the x, y, z of three corners. */
export type Triangle = ArrayLike<number>;
type Point = [x: number, y: number, z: number];

export interface CollisionMesh {
  /**
   * Ends each step short of walls and on the floor beneath, or refuses it.
   * The floor may lie more than a step below: then the viewer falls.
   */
  terrain: Terrain;
  /** Height of the floor at a spot, choosing the level closest to `near`. */
  floorAt(x: number, z: number, near: number): number | undefined;
  /** Where the body at a footing would have to go to be clear of these walls alone. */
  clearOf(walls: Triangle[], at: Footing): [x: number, z: number];
}

function isFloor(t: Triangle): boolean {
  const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2];
  const vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  // Either facing counts: Rhino doesn't care which way a face points.
  return length > 0 && Math.abs(ny) / length >= MIN_FLOOR_UP;
}

/** Height of a floor triangle at a spot on the floor plan, if it covers it. */
function heightOn(t: Triangle, x: number, z: number): number | undefined {
  const d = (t[5] - t[8]) * (t[0] - t[6]) + (t[6] - t[3]) * (t[2] - t[8]);
  if (d === 0) return undefined;
  const u = ((t[5] - t[8]) * (x - t[6]) + (t[6] - t[3]) * (z - t[8])) / d;
  const v = ((t[8] - t[2]) * (x - t[6]) + (t[0] - t[6]) * (z - t[8])) / d;
  const w = 1 - u - v;
  if (u < -SEAM || v < -SEAM || w < -SEAM) return undefined;
  return u * t[1] + v * t[4] + w * t[7];
}

/** The point on a polygon's outline nearest a spot on the floor plan, and how far off it lies. */
function nearestOnOutline(polygon: Point[], x: number, z: number): [point: Point, distance: number] {
  let nearest = polygon[0], distance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
    const span = ex * ex + ez * ez;
    const along =
      span === 0
        ? 0
        : Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[2]) * ez) / span));
    const point: Point = [a[0] + ex * along, a[1] + ey * along, a[2] + ez * along];
    const off = Math.hypot(x - point[0], z - point[2]);
    if (off < distance) {
      nearest = point;
      distance = off;
    }
  }
  return [nearest, distance];
}

/** Keep the part of a polygon on one side of a horizontal plane. */
function clip(polygon: Point[], height: number, keepAbove: boolean): Point[] {
  const kept: Point[] = [];
  const inside = (p: Point) => (keepAbove ? p[1] >= height : p[1] <= height);
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (inside(a)) kept.push(a);
    if (inside(a) !== inside(b)) {
      const t = (height - a[1]) / (b[1] - a[1]);
      kept.push([a[0] + (b[0] - a[0]) * t, height, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return kept;
}

/**
 * Build the walking rules for a collision mesh from its triangles, and those
 * of things that move, such as doors and an elevator's car, as they stand at
 * the moment: their walls stop the viewer and their floors carry them.
 */
export function collisionMesh(
  triangles: ArrayLike<number>,
  body: Body = BODY,
  moving: () => Triangle[] = () => [],
): CollisionMesh {
  const stillFloors: Triangle[] = [];
  const stillWalls: Triangle[] = [];
  for (let i = 0; i + 9 <= triangles.length; i += 9) {
    const triangle = Array.prototype.slice.call(triangles, i, i + 9);
    (isFloor(triangle) ? stillFloors : stillWalls).push(triangle);
  }
  let floors = stillFloors;
  let walls = stillWalls;
  /** Take in where moving things stand now, before working anything out. */
  function look() {
    const moved = moving();
    if (moved.length === 0) {
      floors = stillFloors;
      walls = stillWalls;
      return;
    }
    floors = [...stillFloors];
    walls = [...stillWalls];
    for (const triangle of moved) (isFloor(triangle) ? floors : walls).push(triangle);
  }

  function floorAt(x: number, z: number, near: number): number | undefined {
    let best: number | undefined;
    for (const floor of floors) {
      const height = heightOn(floor, x, z);
      if (height === undefined) continue;
      if (best === undefined || Math.abs(height - near) < Math.abs(best - near)) {
        best = height;
      }
    }
    return best;
  }

  /** Height of the highest floor under a spot that lies no higher than `top`. */
  function floorUnder(x: number, z: number, top: number): number | undefined {
    let best: number | undefined;
    for (const floor of floors) {
      const height = heightOn(floor, x, z);
      if (height === undefined || height > top) continue;
      if (best === undefined || height > best) best = height;
    }
    return best;
  }

  /**
   * Height of floor within the body's radius of a spot, no more than a step
   * from `level`: a ledge the viewer still stands on with part of the body.
   */
  function ledgeAt(x: number, z: number, level: number): number | undefined {
    let best: number | undefined;
    for (const floor of floors) {
      const corners: Point[] = [
        [floor[0], floor[1], floor[2]],
        [floor[3], floor[4], floor[5]],
        [floor[6], floor[7], floor[8]],
      ];
      const [edge, distance] = nearestOnOutline(corners, x, z);
      if (distance >= body.radius) continue;
      const height = heightOn(floor, x, z) ?? edge[1];
      if (Math.abs(height - level) > body.maxStep) continue;
      if (best === undefined || Math.abs(height - level) < Math.abs(best - level)) {
        best = height;
      }
    }
    return best;
  }

  /** Move a spot away from every one of these walls the body would touch at this floor height. */
  function pushOut(x: number, z: number, floor: number, among: Iterable<Triangle>): [x: number, z: number] {
    const low = floor + body.maxStep;
    const high = floor + body.height;
    for (let round = 0; round < PUSH_ROUNDS; round++) {
      let pushed = false;
      for (const t of among) {
        if (Math.max(t[1], t[4], t[7]) <= low) continue;
        if (Math.min(t[1], t[4], t[7]) >= high) continue;
        if (Math.min(t[0], t[3], t[6]) - x > body.radius) continue;
        if (x - Math.max(t[0], t[3], t[6]) > body.radius) continue;
        if (Math.min(t[2], t[5], t[8]) - z > body.radius) continue;
        if (z - Math.max(t[2], t[5], t[8]) > body.radius) continue;

        // The slice of the wall at body height, seen from above.
        const corners: Point[] = [
          [t[0], t[1], t[2]],
          [t[3], t[4], t[5]],
          [t[6], t[7], t[8]],
        ];
        const slice = clip(clip(corners, low, true), high, false);
        if (slice.length === 0) continue;
        const [[nearestX, , nearestZ], nearest] = nearestOnOutline(slice, x, z);
        if (nearest >= body.radius || nearest === 0) continue;
        const push = (body.radius - nearest) / nearest;
        x += (x - nearestX) * push;
        z += (z - nearestZ) * push;
        pushed = true;
      }
      if (!pushed) break;
    }
    return [x, z];
  }

  function step(from: Footing, x: number, z: number): Footing | undefined {
    const [clearX, clearZ] = pushOut(x, z, from.floor, walls);
    const floor = floorUnder(clearX, clearZ, from.floor + body.maxStep);
    if (floor === undefined) return undefined;
    if (floor >= from.floor - body.maxStep) return { x: clearX, z: clearZ, floor };
    // Off a ledge the viewer stays on it while any of the body is over it,
    // so a fall begins clear of the ledge's edge.
    return { x: clearX, z: clearZ, floor: ledgeAt(clearX, clearZ, from.floor) ?? floor };
  }

  return {
    floorAt: (x, z, near) => {
      look();
      return floorAt(x, z, near);
    },
    clearOf: (among, at) => pushOut(at.x, at.z, at.floor, among),
    // A refused step is retried along each axis so the viewer slides along
    // an edge instead of sticking to it.
    terrain: (from, x, z) => {
      look();
      return (
        step(from, x, z) ??
        step(from, x, from.z) ??
        step(from, from.x, z) ?? { x: from.x, z: from.z, floor: from.floor }
      );
    },
  };
}
