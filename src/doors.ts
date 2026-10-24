import { Matrix4, Vector3, type Object3D } from "three";
import type { CollisionMesh, Triangle } from "./collision";
import type { Footing } from "./motion";
import { fixed, number, type Described } from "./settings";

/** How a kind of door moves, set per environment under `## door-hinged` and `## door-sliding` (#7). */
export interface DoorSettings {
  /** Seconds a door takes to open or close. */
  seconds: number;
  /** Metres from a door within which the viewer opens it. */
  near: number;
  /** Seconds a door waits, once the viewer is out of range, before it closes. */
  wait: number;
}

export const HINGED_DOOR: DoorSettings = { seconds: 1.2, near: 1.5, wait: 3 };
export const SLIDING_DOOR: DoorSettings = { seconds: 1, near: 1.5, wait: 3 };

export const DOOR_DESCRIBED: Described<DoorSettings> = {
  seconds: number({
    label: "Opening time",
    min: 0.3,
    max: 5,
    step: 0.1,
    show: fixed(1, " s"),
    about: "How long a door takes to open or close; it starts and stops gently.",
  }),
  near: number({
    label: "Opens within",
    min: 0.5,
    max: 5,
    step: 0.1,
    show: fixed(1, " m"),
    about: "How near the viewer comes before a door opens by itself. On the side a hinged door swings to, at least its width and half a metre.",
  }),
  wait: number({
    label: "Closes after",
    min: 0,
    max: 30,
    step: 0.5,
    show: fixed(1, " s"),
    about: "How long a door stays open once the viewer is out of range.",
  }),
};

/** What `npm run optimize` notes on a door's layer about how it moves. */
export interface DoorMotion {
  kind: "hinged" | "sliding";
  parts: {
    /** The leaf's layer, such as "leaf-left", or none for a door of one leaf. */
    leaf: string | null;
    /** A hinged leaf's hinge on the floor plan, how far it turns, and how far its free edge reaches. */
    pivot?: [number, number];
    angle?: number;
    reach?: number;
    /** How far a sliding leaf moves, on the floor plan. */
    offset?: [number, number];
  }[];
  /** Middle of the closed door on the floor plan, and its lowest and highest point. */
  centre: [number, number];
  bottom: number;
  top: number;
}

/** A leaf as loaded: what is seen of it, and its collision mesh as modelled, closed. */
export interface Leaf {
  model: Object3D | undefined;
  /** Nine numbers per triangle, in world space. */
  walls: Float32Array;
}

/** Starts and stops gently, never jerks. */
const ease = (share: number) => share * share * (3 - 2 * share);
/** How far a push may fall short of where it was meant to go and still count, in metres. */
const PUSH_TOLERANCE = 0.02;

/** How a leaf has moved, as a transformation of the world, when it is `share` open. */
function motionOf(part: DoorMotion["parts"][number], share: number, into: Matrix4): Matrix4 {
  if (part.pivot && part.angle !== undefined) {
    const [x, z] = part.pivot;
    // The angle turns from +x towards +z; three.js turns the other way round.
    return into
      .makeTranslation(x, 0, z)
      .multiply(new Matrix4().makeRotationY(-part.angle * share))
      .multiply(new Matrix4().makeTranslation(-x, 0, -z));
  }
  const [dx, dz] = part.offset ?? [0, 0];
  return into.makeTranslation(dx * share, 0, dz * share);
}

/**
 * A door that opens by itself as the viewer comes near and closes a while
 * after they leave, starting and stopping gently. Its collision is always
 * real: moving, it pushes the viewer, and where it can't, it stops and
 * waits; a closing door goes back open (#7). It keeps its baked light,
 * which moves with it (ADR 0003).
 */
export class Door {
  private readonly motion: DoorMotion;
  private readonly settings: DoorSettings;
  private readonly leaves: { leaf: Leaf; world: Matrix4; parentInverse: Matrix4; closed: Float32Array[] }[];
  /** 0 closed to 1 open, before easing. */
  private openness = 0;
  private target = 0;
  private awayFor = Infinity;
  private current: Triangle[];

  constructor(motion: DoorMotion, leaves: Leaf[], settings: DoorSettings) {
    this.motion = motion;
    this.settings = settings;
    this.leaves = leaves.map((leaf) => {
      leaf.model?.updateWorldMatrix(true, false);
      const closed: Float32Array[] = [];
      for (let i = 0; i + 9 <= leaf.walls.length; i += 9) closed.push(leaf.walls.slice(i, i + 9));
      return {
        leaf,
        world: leaf.model ? leaf.model.matrixWorld.clone() : new Matrix4(),
        parentInverse: leaf.model?.parent ? leaf.model.parent.matrixWorld.clone().invert() : new Matrix4(),
        closed,
      };
    });
    this.current = this.wallsAt(0);
  }

  /** The door's walls as it stands now. */
  walls(): Triangle[] {
    return this.current;
  }

  /** Whether the viewer is near enough to open it, on the door's own floor. */
  private near(at: Footing): boolean {
    const { centre, bottom, top, kind, parts } = this.motion;
    if (at.floor < bottom - 1 || at.floor > top) return false;
    const away = Math.hypot(at.x - centre[0], at.z - centre[1]);
    let reach = this.settings.near;
    const [part] = parts;
    if (kind === "hinged" && part.pivot && part.angle !== undefined && part.reach !== undefined) {
      // On the side the leaf swings to, open before the viewer is in its way.
      const [px, pz] = part.pivot;
      const across = (centre[0] - px) * (at.z - pz) - (centre[1] - pz) * (at.x - px);
      if (Math.sign(across) === Math.sign(part.angle)) reach = Math.max(reach, part.reach + 0.5);
    }
    return away <= reach;
  }

  private wallsAt(share: number): Triangle[] {
    const walls: Triangle[] = [];
    const turned = new Matrix4();
    const corner = new Vector3();
    this.leaves.forEach(({ closed }, i) => {
      motionOf(this.motion.parts[i], ease(share), turned);
      for (const triangle of closed) {
        const moved = new Float32Array(9);
        for (let c = 0; c < 9; c += 3) corner.fromArray(triangle, c).applyMatrix4(turned).toArray(moved, c);
        walls.push(moved);
      }
    });
    return walls;
  }

  private show(share: number) {
    const turned = new Matrix4();
    this.leaves.forEach(({ leaf, world, parentInverse }, i) => {
      if (!leaf.model) return;
      motionOf(this.motion.parts[i], ease(share), turned);
      leaf.model.matrixAutoUpdate = false;
      leaf.model.matrix.copy(parentInverse).multiply(turned).multiply(world);
      leaf.model.matrixWorldNeedsUpdate = true;
    });
  }

  /** Move on by one frame: open or close, pushing the viewer, or stop where they can't be pushed. */
  update(seconds: number, collision: CollisionMesh, viewer: { footing: Footing; shove(to: Footing): void }) {
    const at = viewer.footing;
    if (this.near(at)) {
      this.target = 1;
      this.awayFor = 0;
    } else {
      this.awayFor += seconds;
      if (this.awayFor >= this.settings.wait) this.target = 0;
    }
    if (this.openness === this.target) return;
    const step = seconds / Math.max(this.settings.seconds, 0.01);
    const next =
      this.target > this.openness ? Math.min(this.target, this.openness + step) : Math.max(this.target, this.openness - step);
    const before = this.current;
    this.current = this.wallsAt(next);
    const [x, z] = collision.clearOf(this.current, at);
    if (x !== at.x || z !== at.z) {
      // The door pushes the viewer, unless something stops them going there.
      const pushed = collision.terrain(at, x, z);
      const [clearX, clearZ] = collision.clearOf(this.current, pushed);
      const held =
        Math.hypot(pushed.x - x, pushed.z - z) > PUSH_TOLERANCE ||
        Math.hypot(clearX - pushed.x, clearZ - pushed.z) > PUSH_TOLERANCE;
      if (held) {
        this.current = before;
        if (this.target === 0) {
          // A closing door that meets the viewer goes back open.
          this.target = 1;
          this.awayFor = 0;
        }
        return;
      }
      viewer.shove(pushed);
    }
    this.openness = next;
    this.show(next);
  }
}
