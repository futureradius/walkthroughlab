import { BoxGeometry, DoubleSide, FrontSide, Group, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { prepareSurfaces } from "./environment";
import { Faces } from "./faces";

/** A glass pane and a wall, prepared as the environment would be. */
function environment() {
  const glass = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: 0x80c0ff, transparent: true }));
  const wall = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: 0xc0b0a0 }));
  const model = new Group().add(glass, wall);
  prepareSurfaces(model, undefined, 4);
  return { model, glass: glass.material, wall: wall.material };
}

describe("drawing faces", () => {
  it("draws both sides of everything as usual", () => {
    const { model, glass, wall } = environment();
    new Faces(model).update();
    expect(glass.side).toBe(DoubleSide);
    expect(wall.side).toBe(DoubleSide);
  });

  it("draws glass from the front alone, letting its colour through twice", () => {
    const { model, glass, wall } = environment();
    const once = glass.blendColor.clone();
    const faces = new Faces(model);
    faces.settings.front = "glass";
    faces.update();
    expect(glass.side).toBe(FrontSide);
    expect(wall.side).toBe(DoubleSide);
    expect(glass.blendColor.r).toBeCloseTo(once.r ** 2);
    expect(glass.blendColor.b).toBeCloseTo(once.b ** 2);
  });

  it("draws everything from the front alone", () => {
    const { model, glass, wall } = environment();
    const faces = new Faces(model);
    faces.settings.front = "all";
    faces.update();
    expect(glass.side).toBe(FrontSide);
    expect(wall.side).toBe(FrontSide);
  });

  it("gives glass back its own colour when both sides are drawn again", () => {
    const { model, glass } = environment();
    const once = glass.blendColor.clone();
    const faces = new Faces(model);
    faces.settings.front = "glass";
    faces.update();
    faces.settings.front = "none";
    faces.update();
    expect(glass.side).toBe(DoubleSide);
    expect(glass.blendColor.equals(once)).toBe(true);
  });
});
