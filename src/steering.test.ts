import { describe, expect, it } from "vitest";
import { collisionMesh } from "./collision";
import { WALKING, withinLimits, type Terrain, type Viewpoint } from "./motion";
import { RUNNING } from "./running";
import { JOYSTICK, Steering, type Keys, type Stick, type View } from "./steering";
import { ZOOM } from "./zoom";

const UPRIGHT = { width: 400, height: 800 };
const SIDEWAYS = { width: 800, height: 400 };
const MIDDLE = { x: 200, y: 400 };
const FRAME = 1 / 60;
const start: Viewpoint = { x: 0, z: 0, floor: 0, heading: 0, pitch: 0 };
const open = withinLimits({ halfWidth: 1000, halfDepth: 1000 });
const noKeys: Keys = { walk: 0, sidestep: 0, turn: 0, run: false };
const centred: Stick = { x: 0, y: 0 };
const right: Stick = { x: 1, y: 0 };
const forward: Stick = { x: 0, y: 1 };
/** Radians per second at full push, standing still. */
const STANDING_TURN_SPEED = (Math.PI * 2) / WALKING.standingTurn;

/** A walkthrough on an upright screen, stepped a frame at a time. */
function walkthrough(terrain: Terrain = open) {
  const steering = new Steering({ terrain, start });
  let view = steering.step({ knob: centred, keys: noKeys }, 0, UPRIGHT);
  /** One frame, and how far the viewpoint moved and turned in it. */
  const frame = (knob = centred, keys = noKeys, seconds = FRAME) => {
    const before = view;
    view = steering.step({ knob, keys }, seconds, UPRIGHT);
    const moved = Math.hypot(view.x - before.x, view.z - before.z);
    return { view, moved, turned: view.heading - before.heading };
  };
  /** Hold the joystick and the keys for this long, and return the last frame. */
  const hold = (knob: Stick, seconds: number, keys = noKeys) => {
    let last = frame(knob, keys);
    for (let held = FRAME; held < seconds - 1e-9; held += FRAME) last = frame(knob, keys);
    return last;
  };
  return { steering, frame, hold, view: () => view };
}

/** The share of a sideways push that sidestepped in a frame, from how far it moved. */
const sidestepping = (moved: number) => moved / (WALKING.speed * FRAME);

describe("standing still", () => {
  it("says so until the viewer walks, and again once they stop", () => {
    const { steering, frame, hold } = walkthrough();
    frame();
    expect(steering.still).toBe(true);
    hold({ x: 0, y: 1 }, 0.2);
    expect(steering.still).toBe(false);
    hold(centred, 3);
    expect(steering.still).toBe(true);
  });
});

/** How far the view is zoomed in, from its field of view on an upright screen. */
const zoomOf = (view: View) =>
  Math.tan((ZOOM.upright * Math.PI) / 360) / Math.tan((view.fov * Math.PI) / 360);

/** Drag, then throw the view to the right at this many pixels a second. */
function thrown(steering: Steering, speed = 2000) {
  steering.touch();
  steering.drag(-speed / 10, 0);
  steering.letGo(-speed, 0);
}

describe("steering", () => {
  it("starts with the eyes at eye height above the starting spot", () => {
    const { view } = walkthrough();
    expect(view()).toMatchObject({ x: 0, y: WALKING.eyeHeight, z: 0, heading: 0, pitch: 0 });
    expect(view().fov).toBeCloseTo(ZOOM.upright);
  });

  it("walks forward at walking pace when the joystick is pushed forward", () => {
    const { frame } = walkthrough();
    const { view, turned } = frame(forward);
    expect(view.z).toBeCloseTo(-WALKING.speed * FRAME);
    expect(turned).toBe(0);
  });

  it("turns on the spot when the joystick is pushed sideways on its own", () => {
    const { frame } = walkthrough();
    const { moved, turned } = frame(right);
    expect(moved).toBe(0);
    expect(turned).toBeCloseTo(STANDING_TURN_SPEED * FRAME);
  });

  it("leaves a push inside the dead zone out, and picks up smoothly from its edge", () => {
    const { frame } = walkthrough();
    expect(frame({ x: 0, y: 0.1 }).moved).toBe(0);
    const halfway = JOYSTICK.deadZone + (1 - JOYSTICK.deadZone) / 2;
    expect(frame({ x: 0, y: halfway }).moved).toBeCloseTo((WALKING.speed * FRAME) / 2);
    expect(frame({ x: 0, y: 1 }).moved).toBeCloseTo(WALKING.speed * FRAME);
  });

  it("sidesteps with A and D and turns with the arrows", () => {
    const { frame } = walkthrough();
    const sidestep = frame(centred, { ...noKeys, sidestep: 1 });
    expect(sidestep.view.x).toBeCloseTo(WALKING.speed * FRAME);
    expect(sidestep.turned).toBe(0);
    expect(frame(centred, { ...noKeys, turn: 1 }).turned).toBeGreaterThan(0);
  });

  it("is no faster with the joystick and a key pushing the same way", () => {
    const { frame } = walkthrough();
    expect(frame(forward, { ...noKeys, walk: 1 }).moved).toBeCloseTo(WALKING.speed * FRAME);
  });

  it("follows walking settings changed while walking", () => {
    const { steering, frame, hold } = walkthrough();
    steering.settings.walking.speed = 2;
    steering.settings.walking.eyeHeight = 1.2;
    expect(frame(forward).moved).toBeCloseTo(2 * FRAME);
    expect(hold(centred, 2).view.y).toBeCloseTo(1.2);
  });

  describe("eyes", () => {
    /** A floor that steps up by 30 cm half a metre ahead. */
    const stepUp: Terrain = (_from, x, z) => ({ x, z, floor: z < -0.5 ? 0.3 : 0 });

    it("ease up a step rather than jump, and settle at eye height above it", () => {
      const { frame, hold } = walkthrough(stepUp);
      let { view } = frame(forward);
      while (view.z > -0.5) view = frame(forward).view;
      expect(view.y).toBeGreaterThan(WALKING.eyeHeight);
      expect(view.y).toBeLessThan(WALKING.eyeHeight + 0.3);
      expect(hold(centred, 2).view.y).toBeCloseTo(WALKING.eyeHeight + 0.3);
    });
  });

  describe("falling", () => {
    /** A floor that drops by 3 m half a metre ahead. */
    const ledge: Terrain = (_from, x, z) => ({ x, z, floor: z < -0.5 ? -3 : 0 });

    /** Walk forward until just off the ledge. */
    function steppedOff() {
      const walked = walkthrough(ledge);
      let { view } = walked.frame(forward);
      while (view.z > -0.5) view = walked.frame(forward).view;
      return walked;
    }

    it("falls faster and faster, and lands at eye height on the floor below", () => {
      const { hold } = steppedOff();
      const early = hold(centred, 0.1).view.y;
      const later = hold(centred, 0.3).view.y;
      // The frame that stepped off began the fall.
      const fallen = 0.4 + FRAME;
      expect(WALKING.eyeHeight - later).toBeCloseTo((WALKING.gravity * fallen ** 2) / 2, 1);
      expect(WALKING.eyeHeight - early).toBeLessThan((WALKING.eyeHeight - later) / 4);
      // Three metres take about 0.8 s.
      expect(hold(centred, 0.5).view.y).toBeCloseTo(WALKING.eyeHeight - 3);
    });

    it("keeps the speed it stepped off with and can't steer in the air", () => {
      const { frame } = steppedOff();
      const { moved, turned, view } = frame({ x: 1, y: -1 }, { ...noKeys, turn: 1 });
      expect(moved).toBeCloseTo(WALKING.speed * FRAME);
      expect(turned).toBe(0);
      expect(view.x).toBe(0);
    });

    it("still looks around in the air", () => {
      const { steering, frame } = steppedOff();
      steering.touch();
      steering.drag(-100, 0);
      expect(frame().turned).toBeGreaterThan(0);
    });

    it("falls past a modelled ledge without being shoved off its edge", () => {
      const quad = ([a, b, c, d]: number[][]) => [...a, ...b, ...c, ...a, ...c, ...d];
      // Floor, the ledge's face, and floor 3 m below.
      const { terrain } = collisionMesh([
        ...quad([[-5, 0, -1], [5, 0, -1], [5, 0, 5], [-5, 0, 5]]),
        ...quad([[-5, -3, -1], [5, -3, -1], [5, 0, -1], [-5, 0, -1]]),
        ...quad([[-5, -3, -9], [5, -3, -9], [5, -3, -1], [-5, -3, -1]]),
      ]);
      const { frame } = walkthrough(terrain);
      let farthest = 0;
      let view = frame(forward).view;
      for (let frames = 0; frames < 120; frames++) {
        const next = frame(forward);
        farthest = Math.max(farthest, next.moved);
        view = next.view;
      }
      expect(view.y).toBeCloseTo(WALKING.eyeHeight - 3);
      expect(farthest).toBeLessThan(WALKING.speed * FRAME * 1.01);
    });

    it("steers again once landed", () => {
      const { hold, frame } = steppedOff();
      hold(centred, 1);
      expect(frame(centred).moved).toBe(0);
      expect(frame(right).turned).toBeGreaterThan(0);
    });
  });

  describe("running", () => {
    it("runs while Shift is held with a key walking forward", () => {
      const { hold } = walkthrough();
      const keys = { ...noKeys, walk: 1, run: true };
      expect(hold(centred, 1, keys).moved).toBeCloseTo(RUNNING.speed * FRAME);
    });

    it("walks when Shift was held without walking forward", () => {
      const { hold, frame } = walkthrough();
      hold(centred, 1, { ...noKeys, run: true });
      const walked = frame(centred, { ...noKeys, walk: 1, run: true });
      expect(walked.moved).toBeLessThan(RUNNING.speed * FRAME);
      expect(frame(centred, { ...noKeys, walk: 1 }).moved).toBeCloseTo(WALKING.speed * FRAME);
    });

    it("runs after a quick push forward, a dip and a second push on the joystick", () => {
      const { hold } = walkthrough();
      hold(forward, 0.1);
      hold(centred, 0.1);
      expect(hold(forward, 1).moved).toBeCloseTo(RUNNING.speed * FRAME);
    });
  });

  describe("free look", () => {
    it("turns the view by its field of view for a drag the height of the screen", () => {
      const { steering, frame } = walkthrough();
      steering.touch();
      steering.drag(-UPRIGHT.height, 0);
      expect(frame().turned).toBeCloseTo((ZOOM.upright * Math.PI) / 180);
    });

    it("tilts the view up when dragged down", () => {
      const { steering, frame } = walkthrough();
      steering.touch();
      steering.drag(0, 100);
      expect(frame().view.pitch).toBeGreaterThan(0);
    });

    it("coasts on after a throw, until the next touch catches it", () => {
      const { steering, frame } = walkthrough();
      thrown(steering);
      frame();
      expect(frame().turned).toBeGreaterThan(0);
      expect(frame().turned).toBeGreaterThan(0);
      steering.touch();
      expect(frame().turned).toBe(0);
    });

    it("stays put after a drag let go at rest", () => {
      const { steering, frame } = walkthrough();
      steering.touch();
      steering.drag(-100, 0);
      steering.letGo();
      frame();
      expect(frame().turned).toBe(0);
    });
  });

  describe("the joystick during free look", () => {
    it("sidesteps when pushed sideways", () => {
      const { steering, frame } = walkthrough();
      steering.touch();
      const { view, moved, turned } = frame(right);
      expect(sidestepping(moved)).toBeCloseTo(1);
      expect(view.x).toBeGreaterThan(0);
      expect(turned).toBe(0);
    });

    it("walks the same way with or without free look", () => {
      const { steering, frame } = walkthrough();
      steering.touch();
      expect(frame(forward).moved).toBeCloseTo(WALKING.speed * FRAME);
    });

    it("eases back to turning once a drag is let go at rest", () => {
      const { steering, frame, hold } = walkthrough();
      steering.touch();
      frame(right);
      steering.letGo();
      const soon = sidestepping(hold(right, 0.1).moved);
      expect(soon).toBeLessThan(1);
      expect(soon).toBeGreaterThan(0.5);
      const later = hold(right, 2);
      expect(sidestepping(later.moved)).toBe(0);
      expect(later.turned).toBeCloseTo(STANDING_TURN_SPEED * FRAME);
    });

    it("hands back to turning as a thrown view slows, well before it rests", () => {
      const resting = walkthrough();
      thrown(resting.steering);
      let rested = 0;
      while (resting.frame().turned !== 0) rested++;

      const { steering, frame } = walkthrough();
      thrown(steering);
      expect(sidestepping(frame(right).moved)).toBeCloseTo(1);
      let handed = 1;
      while (sidestepping(frame(right).moved) > 0.5) handed++;
      expect(handed).toBeLessThan(rested * 0.8);
    });

    it("hands back sooner with reduced motion", () => {
      const share = (reduced: boolean) => {
        const { steering, frame, hold } = walkthrough();
        steering.reducedMotion = reduced;
        steering.touch();
        frame(right);
        steering.letGo();
        return sidestepping(hold(right, 0.2).moved);
      };
      expect(share(true)).toBeLessThan(share(false));
    });

    it("follows coasting settings changed while walking", () => {
      const { steering, frame, hold } = walkthrough();
      steering.touch();
      frame(right);
      steering.letGo();
      steering.settings.coasting.glide = 1000;
      expect(sidestepping(hold(right, 0.1).moved)).toBe(0);
    });

    it("is back to turning at once when the joystick is let go during the ease", () => {
      const { steering, frame } = walkthrough();
      steering.touch();
      frame(right);
      steering.letGo();
      frame(right);
      frame(centred);
      expect(sidestepping(frame(right).moved)).toBe(0);
    });
  });

  describe("zoom", () => {
    it("counts from the field of view for the screen's shape", () => {
      const steering = new Steering({ terrain: open, start });
      const still = { knob: centred, keys: noKeys };
      expect(steering.step(still, FRAME, UPRIGHT).fov).toBeCloseTo(ZOOM.upright);
      expect(steering.step(still, FRAME, SIDEWAYS).fov).toBeCloseTo(ZOOM.sideways);
    });

    it("turns the view more slowly, by as much as it is zoomed, but walks as fast", () => {
      const { steering, frame } = walkthrough();
      steering.pinch(MIDDLE, 2);
      frame();
      expect(frame(right).turned).toBeCloseTo((STANDING_TURN_SPEED * FRAME) / 2);
      expect(frame(forward).moved).toBeCloseTo(WALKING.speed * FRAME);
    });

    it("stays while standing still, and wears off as the view levels out walking", () => {
      const { steering, frame, hold } = walkthrough();
      steering.touch();
      steering.drag(0, 200);
      steering.letGo();
      frame();
      steering.pinch(MIDDLE, 2);
      const zoomed = hold(centred, 1).view;
      expect(zoomOf(zoomed)).toBeCloseTo(2);
      const walked = hold(forward, 0.2).view;
      expect(zoomOf(walked)).toBeLessThan(2);
      expect(Math.log(zoomOf(walked)) / Math.log(2)).toBeCloseTo(walked.pitch / zoomed.pitch);
    });
  });
});
