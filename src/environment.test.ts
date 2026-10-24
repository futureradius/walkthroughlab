import {
  BoxGeometry,
  BufferAttribute,
  CustomBlending,
  Group,
  Layers,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Texture,
  type Material,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LAYERS, prepareSurfaces } from "./environment";

/** What three.js loads for a material the optimize script marked BLEND. */
const glassMaterial = () => new MeshStandardMaterial({ color: 0x80c0ff, transparent: true });
const solidMaterial = () => new MeshStandardMaterial({ color: 0xc0b0a0 });

/** A mesh as the model holds it, with a second set of coordinates where the bake painted it. */
function mesh(material: Material, baked = false) {
  const geometry = new BoxGeometry();
  if (baked) geometry.setAttribute("uv1", geometry.getAttribute("uv").clone());
  return new Mesh(geometry, material);
}

/** A model holding these meshes, prepared with or without a baked light picture. */
function prepared(meshes: Mesh[], bakedLight: Texture | null = new Texture()) {
  const model = new Group();
  // The loader nests meshes under the groups of Rhino's layers.
  model.add(new Group().add(...meshes));
  prepareSurfaces(model, bakedLight ? [bakedLight] : [], 4);
  return meshes;
}

/** The layers a mesh is on, by name: the usual layer 0 and its kind. */
function layersOf(mesh: Mesh) {
  const on = (layer: number) => {
    const only = new Layers();
    only.set(layer);
    return mesh.layers.test(only);
  };
  return {
    usual: on(0),
    kinds: Object.entries(LAYERS)
      .filter(([, layer]) => on(layer))
      .map(([kind]) => kind),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sorting surfaces", () => {
  it("puts every mesh on the usual layer and on exactly one kind's", () => {
    const [glass, baked, plain] = prepared([mesh(glassMaterial()), mesh(solidMaterial(), true), mesh(solidMaterial())]);
    expect(layersOf(glass)).toEqual({ usual: true, kinds: ["glass"] });
    expect(layersOf(baked)).toEqual({ usual: true, kinds: ["solid"] });
    expect(layersOf(plain)).toEqual({ usual: true, kinds: ["solid"] });
  });

  it("blends glass with what is behind it, without hiding it", () => {
    const [glass] = prepared([mesh(glassMaterial())]);
    const material = glass.material as MeshStandardMaterial;
    expect(material.blending).toBe(CustomBlending);
    expect(material.depthWrite).toBe(false);
    // Its colour moved to how it tints what is behind; it shows only the reflection.
    expect(material.color.getHex()).toBe(0);
    expect(material.blendColor.getHex()).not.toBe(0);
  });

  it("gives a solid surface the bake painted its baked light", () => {
    const bakedLight = new Texture();
    const [baked] = prepared([mesh(solidMaterial(), true)], bakedLight);
    expect(baked.material).toBeInstanceOf(MeshBasicMaterial);
    expect((baked.material as MeshBasicMaterial).lightMap).toBe(bakedLight);
    expect((baked.material as MeshBasicMaterial).depthWrite).toBe(true);
  });

  it("gives each surface the baked light picture its material names, and keeps it on the surface for ambient occlusion", () => {
    const pictures = [new Texture(), new Texture()];
    const second = solidMaterial();
    second.userData.lightPicture = 1;
    const model = new Group().add(mesh(solidMaterial(), true), mesh(second, true));
    prepareSurfaces(model, pictures, 4);
    const [first, other] = model.children as Mesh[];
    expect((first.material as MeshBasicMaterial).lightMap).toBe(pictures[0]);
    expect((other.material as MeshBasicMaterial).lightMap).toBe(pictures[1]);
    expect(other.userData.bakedLight).toBe(pictures[1]);
  });

  it("leaves a solid surface as it is without baked coordinates or a baked light picture", () => {
    const [unpainted] = prepared([mesh(solidMaterial())]);
    const [unbaked] = prepared([mesh(solidMaterial(), true)], null);
    for (const solid of [unpainted, unbaked]) {
      expect(solid.material).toBeInstanceOf(MeshStandardMaterial);
      expect((solid.material as MeshStandardMaterial).color.getHex()).toBe(0xc0b0a0);
    }
  });

  it("keeps glass that carries baked coordinates glass, and says so once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const material = glassMaterial();
    const panes = prepared([mesh(material, true), mesh(material, true)]);
    for (const pane of panes) {
      expect(pane.material).toBe(material);
      expect(layersOf(pane).kinds).toEqual(["glass"]);
    }
    expect(material.blending).toBe(CustomBlending);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("says nothing when glass carries no baked coordinates", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    prepared([mesh(glassMaterial()), mesh(solidMaterial(), true)]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("sways a prop's baked part painted to sway, keeping its baked light, out of ambient occlusion's work", () => {
    const bakedLight = new Texture();
    const bark = solidMaterial();
    bark.userData.prop = "tree";
    const [trunk, still] = [mesh(bark, true), mesh(bark, true)];
    trunk.geometry.setAttribute("_sway", new BufferAttribute(new Float32Array(trunk.geometry.getAttribute("position").count), 1));
    prepared([trunk, still], bakedLight);
    expect(layersOf(trunk).kinds).toEqual(["sway"]);
    expect(trunk.geometry.hasAttribute("sway")).toBe(true);
    expect((trunk.material as MeshBasicMaterial).lightMap).toBe(bakedLight);
    expect((trunk.material as Material).customProgramCacheKey()).toBe("sway");
    // The same material without paint stands still, as before.
    expect(layersOf(still).kinds).toEqual(["solid"]);
    expect(still.material).not.toBe(trunk.material);
  });

  it("converts a material shared by several meshes once", () => {
    const glass = glassMaterial();
    const solid = solidMaterial();
    const meshes = prepared([mesh(glass), mesh(glass), mesh(solid, true), mesh(solid, true)]);
    expect(meshes[0].material).toBe(meshes[1].material);
    expect(meshes[2].material).toBe(meshes[3].material);
    // Made into glass twice, the tint would have been lost with the colour.
    expect(glass.blendColor.getHex()).not.toBe(0);
  });
});
