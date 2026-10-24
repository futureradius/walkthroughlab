import { describe, expect, it } from "vitest";
import { buttonOf, copiesOf, headingOf, normalise, readMarks, swingOf, type Layer, type Point } from "./marks";

/** A layer as the export carries it; its node is its own name, to find it again. */
function layer(name: string, contents: { layers?: Layer<string>[]; lines?: Point[][]; surfaces?: number } = {}): Layer<string> {
  return { name, node: name, layers: contents.layers ?? [], lines: contents.lines ?? [], surfaces: contents.surfaces ?? 0 };
}

const flat = (from: [number, number], to: [number, number], y = 0): Point[] => [
  [from[0], y, from[1]],
  [to[0], y, to[1]],
];
const surfaces = (name: string) => layer(name, { surfaces: 1 });
const door = (name: string, line: Point[], extra: Layer<string>[] = []) =>
  layer(name, { lines: [line], layers: [surfaces("model"), surfaces("collision mesh"), ...extra] });
const start = () => layer("start", { lines: [flat([16.62, 3.66], [14.63, 4.45])] });

/** A model with a collision mesh and a start spot, plus these layers inside `Walkthrough`. */
const model = (...inside: Layer<string>[]) => [
  layer("Walkthrough", { layers: [surfaces("collision mesh"), start(), ...inside] }),
  layer("Buildings", { layers: [surfaces("3d_Travertin")] }),
];

describe("reading marks", () => {
  it("reads the start spot from its line, looking along it", () => {
    const marks = readMarks(model());
    expect(marks.errors).toEqual([]);
    expect(marks.warnings).toEqual([]);
    expect(marks.start).toMatchObject({ x: 16.62, y: 0, z: 3.66 });
    expect(marks.start!.heading).toBeCloseTo(headingOf([16.62, 0, 3.66], [14.63, 0, 4.45]));
  });

  it("counts headings as steering does: 0 looks towards -z, a quarter turn right looks towards +x", () => {
    expect(headingOf([0, 0, 0], [0, 0, -1])).toBeCloseTo(0);
    expect(headingOf([0, 0, 0], [1, 0, 0])).toBeCloseTo(Math.PI / 2);
  });

  it("ignores capitals and spaces around dashes", () => {
    expect(normalise("  Door - Hinged -2 ")).toBe("door-hinged-2");
    expect(normalise("Collision  Mesh")).toBe("collision mesh");
  });

  it("will not open without a Walkthrough layer, a collision mesh or a start spot", () => {
    expect(readMarks([layer("Buildings")]).errors).toHaveLength(1);
    const bare = readMarks([layer("Walkthrough", { layers: [layer("door-hinged-1")] })]);
    expect(bare.errors).toEqual([
      'There is no "collision mesh" layer inside "Walkthrough" with surfaces on it.',
      'There is no "start" layer inside "Walkthrough" with a line on it.',
    ]);
  });

  it("gathers every collision mesh, the still one and each moving part's, and nothing outside Walkthrough", () => {
    const marks = readMarks(model(door("door-hinged-1", flat([0, 0], [1, 0]))));
    expect(marks.collision).toEqual(["collision mesh", "collision mesh"]);
    expect(marks.parts.map(({ kind, name }) => `${kind} ${name}`)).toEqual(["door-hinged 1"]);
  });

  it("reads the test environment's elevator without a warning", () => {
    const leaves = (y: number) => [
      layer("leaf-left", { lines: [flat([12.36, 7.66], [13.06, 7.66], y)], layers: [surfaces("model"), surfaces("collision mesh")] }),
      layer("leaf-right", { lines: [flat([12.34, 7.66], [11.64, 7.66], y)], layers: [surfaces("model"), surfaces("collision mesh")] }),
    ];
    const route: Point[] = [[11.36, 0, 10.83], [11.36, 3.5, 10.83], [11.36, 6.5, 10.83]];
    const elevator = layer("elevator-1", {
      lines: [route],
      layers: [
        layer("door-sliding-3", { layers: leaves(6.5) }),
        layer("door-sliding-2", { layers: leaves(3.5) }),
        layer("model", { surfaces: 16, layers: [layer("door-sliding-car-1", { layers: leaves(0) })] }),
        layer("door-sliding-1", { layers: leaves(0) }),
        surfaces("collision mesh"),
      ],
    });
    const marks = readMarks(model(elevator));
    expect(marks.warnings).toEqual([]);
    expect(marks.parts.map(({ path }) => path)).toEqual([
      "elevator-1",
      "elevator-1 › door-sliding-3",
      "elevator-1 › door-sliding-2",
      "elevator-1 › model › door-sliding-car-1",
      "elevator-1 › door-sliding-1",
    ]);
    // The still one, the car's, and two leaves on each of four doors.
    expect(marks.collision).toHaveLength(10);
  });

  it("warns about a door without a collision mesh, which still opens but won't stop the viewpoint", () => {
    const marks = readMarks(model(layer("door-hinged-2", { lines: [flat([4.41, 7.88], [5.13, 7.17], 2.25)], layers: [surfaces("model")] })));
    expect(marks.warnings).toEqual([`door-hinged-2: has no "collision mesh" layer, so it won't stop the viewpoint.`]);
    expect(marks.parts).toHaveLength(1);
  });

  it("warns about a misspelt kind, a kind without a name, and a door without its line", () => {
    const marks = readMarks(
      model(
        layer("dor-hinged-1", { surfaces: 1 }),
        layer("door-2", { surfaces: 1 }),
        layer("elevator", { surfaces: 1 }),
        layer("door-sliding-4", { layers: [surfaces("model"), surfaces("collision mesh")] }),
      ),
    );
    expect(marks.warnings).toEqual([
      expect.stringMatching(/^dor-hinged-1: is not a kind of mark/),
      expect.stringMatching(/^door-2: is not a kind of mark.*door-hinged-… or door-sliding-…/),
      "elevator: has no name after its kind; call it elevator-1. Its things stay still until then.",
      expect.stringMatching(/^door-sliding-4: has no line/),
    ]);
    expect(marks.parts.map(({ path }) => path)).toEqual(["door-sliding-4"]);
  });

  it("warns about a door that parts in two with only one leaf, and about leaves outside a sliding door", () => {
    const leaf = () => layer("leaf-left", { lines: [flat([0, 0], [1, 0])], layers: [surfaces("model"), surfaces("collision mesh")] });
    const marks = readMarks(model(layer("door-sliding-1", { layers: [leaf()] }), door("door-hinged-1", flat([0, 0], [1, 0]), [leaf()])));
    expect(marks.warnings).toEqual([
      "door-sliding-1: has only one leaf; a door that parts in two needs leaf-right as well.",
      "door-hinged-1 › leaf-left: leaves belong only inside a door-sliding-… layer.",
    ]);
  });

  it("uses the first start spot when there are two, and says so", () => {
    const marks = readMarks([layer("Walkthrough", { layers: [surfaces("collision mesh"), start(), layer("start", { lines: [flat([0, 0], [0, -1])] })] })]);
    expect(marks.start!.x).toBe(16.62);
    expect(marks.warnings).toEqual(["start: there is more than one start layer; only the first is used."]);
  });
});

describe("prop copies", () => {
  it("places a copy where each line starts, facing along it, as large as it is long", () => {
    const marks = readMarks(model(layer("prop-tree", { lines: [flat([2, 3], [2, 5], 1.5), flat([0, 0], [0.5, 0])] })));
    expect(marks.warnings).toEqual([]);
    const [first, second] = marks.parts[0].copies!;
    expect(first.at).toEqual([2, 1.5, 3]);
    // Its front, +z in the prop's file, faces +z.
    expect(first.turn).toBeCloseTo(0);
    expect(first.size).toBeCloseTo(2);
    // A quarter turn, from +z towards +x.
    expect(second.turn).toBeCloseTo(Math.PI / 2);
    expect(second.size).toBeCloseTo(0.5);
  });

  it("flattens a sloped line, uses a polyline's first stretch, and skips a line with no length across", () => {
    const warnings: string[] = [];
    const warn = (path: string, text: string) => warnings.push(`${path}: ${text}`);
    const copies = copiesOf(
      layer("prop-chair", {
        lines: [
          [[0, 0, 0], [3, 4, 4]],
          [[0, 0, 0], [0, 0, -1], [5, 0, -1]],
          [[1, 0, 1], [1, 2, 1]],
        ],
      }),
      "prop-chair",
      warn,
    );
    expect(copies.map(({ size }) => size)).toEqual([5, 1]);
    expect(copies[1].turn).toBeCloseTo(Math.PI);
    expect(warnings).toHaveLength(3);
  });

  it("warns about a prop layer without lines, and things drawn on it", () => {
    const marks = readMarks(model(layer("prop-table", { surfaces: 2 })));
    expect(marks.parts[0].copies).toEqual([]);
    expect(marks.warnings).toHaveLength(2);
  });
});

describe("how far a hinged door turns", () => {
  it("turns the short way to a straight line, either side", () => {
    expect(swingOf([0, 0], [1, 0], [[0, 1]]).angle).toBeCloseTo(Math.PI / 2);
    expect(swingOf([0, 0], [1, 0], [[0, -1]]).angle).toBeCloseTo(-Math.PI / 2);
  });

  it("turns 135° for the test environment's folding door", () => {
    // door-hinged-2: hinge at 4.41, 7.88, leaf reaching to 3.40, line to 5.13, 7.17.
    const { angle } = swingOf([4.41, 7.88], [3.4, 7.83], [[5.13, 7.17]]);
    expect(Math.abs(angle)).toBeCloseTo((135 * Math.PI) / 180, 1);
  });

  it("follows a polyline's corners past 180°, and reports a straight line at 180° as unclear", () => {
    const { angle, halfTurn } = swingOf([0, 0], [1, 0], [[0, 1], [-1, 0], [0, -1]]);
    expect(angle).toBeCloseTo((3 * Math.PI) / 2);
    expect(halfTurn).toBe(false);
    expect(swingOf([0, 0], [1, 0], [[-1, 0.05]]).halfTurn).toBe(true);
  });
});

describe("elevator buttons", () => {
  const route: Point[] = [[0, 0, 0], [0, 3.5, 0], [0, 6.5, 0]];
  const elevator = (...inside: Layer<string>[]) =>
    layer("elevator-1", {
      lines: [route],
      layers: [layer("model", { surfaces: 1, layers: inside.filter(({ name }) => !name.includes("call")) }), surfaces("collision mesh"), ...inside.filter(({ name }) => name.includes("call"))],
    });

  it("reads call buttons and car buttons by the stop they go to", () => {
    expect(buttonOf("button-call-2")).toEqual({ call: true, stop: 2 });
    expect(buttonOf("Button - 3")).toEqual({ call: false, stop: 3 });
    expect(buttonOf("button-up")).toBeUndefined();
    const marks = readMarks(model(elevator(surfaces("button-call-1"), surfaces("button-call-3"), surfaces("button-1"), surfaces("button-2"))));
    expect(marks.warnings).toEqual([]);
  });

  it("reports a button for a stop the elevator doesn't have, and a button outside an elevator", () => {
    const marks = readMarks(model(elevator(surfaces("button-4")), surfaces("button-call-1")));
    expect(marks.warnings).toEqual([
      "elevator-1 › model › button-4: the elevator has 3 stops, so there is no stop 4.",
      expect.stringMatching(/^button-call-1: is not a kind of mark.*Buttons belong inside an elevator/),
    ]);
  });
});
