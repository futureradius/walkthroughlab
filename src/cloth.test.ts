import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { clothSettings, CURTAINS, FLAGS, prepareCloth } from "./cloth";

/** A cloth as `npm run optimize` leaves it: corners and the triangles between them. */
function cloth(corners: number[][], triangles: number[][]) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(corners.flat()), 3));
  geometry.setIndex(triangles.flat());
  return new Mesh(geometry, new MeshBasicMaterial());
}

const values = (mesh: Mesh, name: string) => Array.from(mesh.geometry.getAttribute(name).array as Float32Array);

describe("a curtain", () => {
  // Hanging 3 m from a rod at 4 m along z, its top 10 cm below the rod.
  const curtain = () =>
    cloth(
      [
        [0, 3.9, 0],
        [0, 3.9, 2],
        [0.1, 0.9, 0],
        [0.1, 0.9, 2],
      ],
      [
        [0, 2, 1],
        [1, 2, 3],
      ],
    );

  it("moves by how far a corner hangs below its rod, its top held still though off the rod", () => {
    const mesh = curtain();
    prepareCloth(mesh, { sway: "curtains", line: [[0, 4, 0], [0, 4, 2]] });
    const reach = values(mesh, "reach");
    expect(reach[0]).toBeCloseTo(0);
    expect(reach[1]).toBeCloseTo(0);
    expect(reach[2]).toBeCloseTo(3);
    expect(reach[3]).toBeCloseTo(3);
  });

  it("moves across itself as a whole", () => {
    const mesh = curtain();
    prepareCloth(mesh, { sway: "curtains", line: [[0, 4, 0], [0, 4, 2]] });
    const [x, y, z] = values(mesh, "facing");
    // Nearly along x, the way the curtain faces, whichever way round.
    expect(Math.abs(x)).toBeGreaterThan(0.99);
    expect(Math.abs(y)).toBeLessThan(0.1);
    expect(Math.abs(z)).toBeLessThan(1e-6);
  });
});

describe("a flag", () => {
  // 1 m square, 10 cm out from its pole along +z.
  const flag = () =>
    cloth(
      [
        [0, 7, 0.1],
        [0, 8, 0.1],
        [0, 7, 1.1],
        [0, 8, 1.1],
      ],
      [
        [0, 2, 1],
        [1, 2, 3],
      ],
    );

  it("moves by how far a corner lies out from its pole, less its gap", () => {
    const mesh = flag();
    prepareCloth(mesh, { sway: "flags", line: [[0, 8, 0], [0, 7, 0]] });
    const reach = values(mesh, "reach");
    expect(reach[0]).toBeCloseTo(0);
    expect(reach[1]).toBeCloseTo(0);
    expect(reach[2]).toBeCloseTo(1);
    expect(reach[3]).toBeCloseTo(1);
  });

  it("knows where its pole stands and which way it was modelled pointing", () => {
    const mesh = flag();
    prepareCloth(mesh, { sway: "flags", line: [[0, 8, 0], [0, 7, 0]] });
    const [x, z, pointing] = values(mesh, "pole");
    expect([x, z]).toEqual([0, 0]);
    // Along +z.
    expect(pointing).toBeCloseTo(Math.PI / 2);
  });
});

describe("cloth settings", () => {
  it("start lively for flags and calm for curtains and any other name", () => {
    expect(clothSettings("flags")).toEqual(FLAGS);
    expect(clothSettings("curtains")).toEqual(CURTAINS);
    expect(clothSettings("banners")).toEqual(CURTAINS);
  });

  it("are one set per name, shared by every cloth of it", () => {
    expect(clothSettings("curtains")).toBe(clothSettings("curtains"));
  });
});
