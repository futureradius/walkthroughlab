import type { Footing, Terrain } from "./motion";

/** How the viewer's body meets a collision mesh, in metres. */
export interface Body {
  /** How close the viewpoint may get to a wall. */
  radius: number;
  /** Walls entirely above this height over the floor are walked under. */
  height: number;
  /** Tallest sudden change in floor height the viewer walks over. */
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
type Triangle = ArrayLike<number>;
type Point = [x: number, y: number, z: number];

export interface CollisionMesh {
  /** Ends each step short of walls and on the floor, or refuses it. */
  terrain: Terrain;
  /** Height of the floor at a spot, choosing the level closest to `near`. */
  floorAt(x: number, z: number, near: number): number | undefined;
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

/** Build the walking rules for a collision mesh from its triangles. */
export function collisionMesh(
  triangles: ArrayLike<number>,
  body: Body = BODY,
): CollisionMesh {
  const floors: Triangle[] = [];
  const walls: Triangle[] = [];
  for (let i = 0; i + 9 <= triangles.length; i += 9) {
    const triangle = Array.prototype.slice.call(triangles, i, i + 9);
    (isFloor(triangle) ? floors : walls).push(triangle);
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

  /** Move a spot away from every wall the body would touch at this floor height. */
  function pushOut(x: number, z: number, floor: number): [x: number, z: number] {
    const low = floor + body.maxStep;
    const high = floor + body.height;
    for (let round = 0; round < PUSH_ROUNDS; round++) {
      let pushed = false;
      for (const t of walls) {
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
        let nearestX = 0, nearestZ = 0, nearest = Infinity;
        for (let i = 0; i < slice.length; i++) {
          const a = slice[i];
          const b = slice[(i + 1) % slice.length];
          const ex = b[0] - a[0], ez = b[2] - a[2];
          const span = ex * ex + ez * ez;
          const along =
            span === 0
              ? 0
              : Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[2]) * ez) / span));
          const px = a[0] + ex * along, pz = a[2] + ez * along;
          const distance = Math.hypot(x - px, z - pz);
          if (distance < nearest) {
            nearest = distance;
            nearestX = px;
            nearestZ = pz;
          }
        }
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
    const [clearX, clearZ] = pushOut(x, z, from.floor);
    const floor = floorAt(clearX, clearZ, from.floor);
    if (floor === undefined || Math.abs(floor - from.floor) > body.maxStep) {
      return undefined;
    }
    return { x: clearX, z: clearZ, floor };
  }

  return {
    floorAt,
    // A refused step is retried along each axis so the viewer slides along
    // an edge instead of sticking to it.
    terrain: (from, x, z) =>
      step(from, x, z) ??
      step(from, x, from.z) ??
      step(from, from.x, z) ?? { x: from.x, z: from.z, floor: from.floor },
  };
}
