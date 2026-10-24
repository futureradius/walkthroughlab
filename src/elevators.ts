import { Color, Matrix4, Mesh, MeshBasicMaterial, Vector3, type Material, type Object3D, type Raycaster } from "three";
import type { CollisionMesh, Triangle } from "./collision";
import { Door, type DoorMotion, type DoorSettings, type Leaf } from "./doors";
import type { Footing } from "./motion";
import { fixed, number, type Described } from "./settings";

/** How an elevator rides, set per environment under `## elevator` (#26). */
export interface ElevatorSettings {
  /** Metres a second the car travels at, on average. */
  speed: number;
}

export const ELEVATOR: ElevatorSettings = { speed: 1 };

export const ELEVATOR_DESCRIBED: Described<ElevatorSettings> = {
  speed: number({
    label: "Speed",
    min: 0.2,
    max: 5,
    step: 0.1,
    show: fixed(1, " m/s"),
    about: "How fast the car travels, on average; it starts and stops gently.",
  }),
};

/** How far a button may be from the viewpoint and still be pressed, in metres. */
export const BUTTON_REACH = 2.5;
/** How far above or below the car's floor the viewer may stand and still ride along, in metres. */
const ABOARD = 0.5;

/** An elevator as loaded: its route, its car, its doors and its buttons. */
export interface ElevatorParts {
  /** The car's floor at each corner and the far end of its route: its stops, in order. */
  route: [number, number, number][];
  /** What is seen of the car, with its car doors and buttons inside, and its collision mesh. */
  car: Leaf;
  carDoors: { motion: DoorMotion; leaves: Leaf[] }[];
  floorDoors: { stop: number; motion: DoorMotion; leaves: Leaf[] }[];
  buttons: { object: Object3D; stop: number; call: boolean }[];
}

/** Starts and stops gently, never jerks. */
const ease = (share: number) => share * share * (3 - 2 * share);

/** A button, lit while the car has yet to get where it asks. */
class Button {
  private readonly meshes: { mesh: Mesh; plain: Material; lit: Material }[] = [];

  constructor(readonly object: Object3D, readonly stop: number) {
    object.traverse((each) => {
      if (!(each instanceof Mesh) || Array.isArray(each.material)) return;
      const plain = each.material as Material & { color?: Color; map?: MeshBasicMaterial["map"] };
      // Its own colour, brightened, as if lit from within.
      const colour = (plain.color ?? new Color(1, 1, 1)).clone().multiplyScalar(1.6).addScalar(0.2);
      const lit = new MeshBasicMaterial({ color: colour, map: plain.map ?? null });
      this.meshes.push({ mesh: each, plain, lit });
    });
  }

  light(on: boolean) {
    for (const { mesh, plain, lit } of this.meshes) mesh.material = on ? lit : plain;
  }
}

/**
 * An elevator: a car that carries the viewer between the stops along its
 * route, called and sent by buttons modelled in Rhino, its car doors and the
 * floor doors at a stop opening together when it arrives and closing before
 * it leaves. Stops are served in the order pressed (#26).
 */
export class Elevator {
  private readonly route: Vector3[];
  private readonly car: { model: Object3D | undefined; world: Matrix4; parentInverse: Matrix4; closed: Float32Array[] };
  private readonly carDoors: Door[];
  private readonly floorDoors: { stop: number; door: Door }[];
  private readonly buttons: Button[];
  private readonly settings: ElevatorSettings;
  private readonly doorSettings: DoorSettings;
  /** Where the car has been carried to from where it was modelled, at its first stop. */
  private readonly offset = new Matrix4();
  /** The stop the car is at or last left, counted from 0. */
  private at = 0;
  private trip: { from: number; to: number; share: number; length: number } | null = null;
  /** Stops asked for, in the order pressed, counted from 0. */
  private readonly queue: number[] = [];
  /** Seconds the doors have stood open at the current stop. */
  private openFor: number | null = null;
  private walls: Triangle[] = [];

  constructor(parts: ElevatorParts, settings: ElevatorSettings, doorSettings: DoorSettings) {
    this.route = parts.route.map(([x, y, z]) => new Vector3(x, y, z));
    this.settings = settings;
    this.doorSettings = doorSettings;
    const model = parts.car.model;
    model?.updateWorldMatrix(true, false);
    const closed: Float32Array[] = [];
    for (let i = 0; i + 9 <= parts.car.walls.length; i += 9) closed.push(parts.car.walls.slice(i, i + 9));
    this.car = {
      model,
      world: model ? model.matrixWorld.clone() : new Matrix4(),
      parentInverse: model?.parent ? model.parent.matrixWorld.clone().invert() : new Matrix4(),
      closed,
    };
    const carried = () => this.offset;
    this.carDoors = parts.carDoors.map(({ motion, leaves }) => new Door(motion, leaves, doorSettings, { told: true, carried }));
    this.floorDoors = parts.floorDoors.map(({ stop, motion, leaves }) => ({
      stop: stop - 1,
      door: new Door(motion, leaves, doorSettings, { told: true }),
    }));
    this.buttons = parts.buttons.map(({ object, stop }) => new Button(object, stop - 1));
    this.place();
  }

  /** Every wall and floor of the car and its doors, as they stand now. */
  triangles(): Triangle[] {
    return [...this.walls, ...this.carDoors.flatMap((door) => door.walls()), ...this.floorDoors.flatMap(({ door }) => door.walls())];
  }

  /** Every button, to tell which a tap lands on. */
  get pressable(): Object3D[] {
    return this.buttons.map(({ object }) => object);
  }

  /** A button was pressed: call or send the car to its stop. */
  press(object: Object3D) {
    const button = this.buttons.find((each) => each.object === object);
    if (!button) return;
    const stop = button.stop;
    if (!this.trip && stop === this.at) {
      // Already there: open up, or stay open a while longer.
      this.openDoors();
      return;
    }
    if (!this.queue.includes(stop)) this.queue.push(stop);
    for (const each of this.buttons) if (each.stop === stop) each.light(true);
  }

  /** Move on by one frame: ride, open and close doors, carry the viewer. */
  update(seconds: number, collision: CollisionMesh, viewer: { footing: Footing; shove(to: Footing): void }) {
    if (this.trip) {
      this.ride(seconds, viewer);
    } else if (this.openFor !== null) {
      if (this.doorsAt(this.at).every((door) => door.opened)) this.openFor += seconds;
      if (this.openFor >= this.doorSettings.wait) {
        this.openFor = null;
        for (const door of this.doorsAt(this.at)) door.close();
      }
    } else if (this.queue.length > 0 && this.doorsAt(this.at).every((door) => door.shut)) {
      const next = this.queue.shift()!;
      if (next === this.at) this.arrive();
      else this.trip = { from: this.at, to: next, share: 0, length: this.lengthBetween(this.at, next) };
    }
    for (const door of this.carDoors) door.update(seconds, collision, viewer);
    for (const { door } of this.floorDoors) door.update(seconds, collision, viewer);
  }

  private doorsAt(stop: number): Door[] {
    return [...this.carDoors, ...this.floorDoors.filter((each) => each.stop === stop).map(({ door }) => door)];
  }

  private openDoors() {
    this.openFor = 0;
    for (const door of this.doorsAt(this.at)) door.open();
  }

  private arrive() {
    for (const button of this.buttons) if (button.stop === this.at) button.light(false);
    this.openDoors();
  }

  /** Metres along the route from one stop to another. */
  private lengthBetween(from: number, to: number): number {
    let length = 0;
    const step = to > from ? 1 : -1;
    for (let i = from; i !== to; i += step) length += this.route[i].distanceTo(this.route[i + step]);
    return length;
  }

  /** The car's floor `along` metres from one stop towards another. */
  private pointAlong(from: number, to: number, along: number): Vector3 {
    const step = to > from ? 1 : -1;
    for (let i = from; i !== to; i += step) {
      const leg = this.route[i].distanceTo(this.route[i + step]);
      if (along <= leg || i + step === to) return this.route[i].clone().lerp(this.route[i + step], leg === 0 ? 1 : Math.min(1, along / leg));
      along -= leg;
    }
    return this.route[to].clone();
  }

  private ride(seconds: number, viewer: { footing: Footing; shove(to: Footing): void }) {
    const trip = this.trip!;
    const before = this.floor();
    const aboard = this.aboard(viewer.footing, before);
    trip.share = Math.min(1, trip.share + (seconds * this.settings.speed) / Math.max(trip.length, 0.01));
    const point = this.pointAlong(trip.from, trip.to, ease(trip.share) * trip.length);
    this.offset.makeTranslation(point.x - this.route[0].x, point.y - this.route[0].y, point.z - this.route[0].z);
    this.place();
    if (aboard) {
      const now = this.floor();
      const { x, z, floor } = viewer.footing;
      viewer.shove({ x: x + now.x - before.x, z: z + now.z - before.z, floor: floor + now.y - before.y });
    }
    if (trip.share === 1) {
      this.at = trip.to;
      this.trip = null;
      this.arrive();
    }
  }

  /** Where the car's floor is now, at the route's first point as modelled. */
  private floor(): Vector3 {
    return this.route[0].clone().applyMatrix4(this.offset);
  }

  /** Whether the viewer stands in the car. */
  private aboard(at: Footing, floor: Vector3): boolean {
    if (Math.abs(at.floor - floor.y) > ABOARD) return false;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const t of this.walls) {
      for (let c = 0; c < 9; c += 3) {
        minX = Math.min(minX, t[c]);
        maxX = Math.max(maxX, t[c]);
        minZ = Math.min(minZ, t[c + 2]);
        maxZ = Math.max(maxZ, t[c + 2]);
      }
    }
    return at.x > minX && at.x < maxX && at.z > minZ && at.z < maxZ;
  }

  /** Put the car, what is seen of it and its walls, where the offset says. */
  private place() {
    const { model, world, parentInverse, closed } = this.car;
    if (model) {
      model.matrixAutoUpdate = false;
      model.matrix.copy(parentInverse).multiply(this.offset).multiply(world);
      model.matrixWorldNeedsUpdate = true;
    }
    const corner = new Vector3();
    this.walls = closed.map((triangle) => {
      const moved = new Float32Array(9);
      for (let c = 0; c < 9; c += 3) corner.fromArray(triangle, c).applyMatrix4(this.offset).toArray(moved, c);
      return moved;
    });
    for (const door of this.carDoors) door.follow();
  }
}

/**
 * The button a tap or click lands on, exactly on its surface and within
 * reach, if any: the first thing it meets, so nothing is pressed through a
 * wall or a closed door.
 */
export function buttonUnder(raycaster: Raycaster, everything: Object3D, buttons: Object3D[]): Object3D | undefined {
  const [hit] = raycaster.intersectObject(everything, true);
  if (!hit || hit.distance > BUTTON_REACH) return undefined;
  for (let at: Object3D | null = hit.object; at; at = at.parent) if (buttons.includes(at)) return at;
  return undefined;
}
