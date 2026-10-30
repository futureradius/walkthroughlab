import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Texture } from "three";
import { describe, expect, it, vi } from "vitest";
import { Downloads, type Network } from "./download";
import { quietMoment, sharpenTextures, texturesOf, type Decode } from "./textures";

const named = (name: string) => Object.assign(new Texture(), { name });
const mesh = (material: MeshBasicMaterial | MeshStandardMaterial) => new Mesh(new BoxGeometry(), material);

/** A site with these files, each an empty picture; anything else is not on it. */
function site(...files: string[]): Network {
  return {
    fetch: async (address) => new Response(files.includes(address) ? new ArrayBuffer(4) : "", { status: files.includes(address) ? 200 : 404 }),
    wait: () => () => {},
  };
}

const PICTURE = { width: 512, height: 512 } as unknown as TexImageSource;
const decode: Decode = async () => PICTURE;

describe("texturesOf", () => {
  it("finds every texture a material holds, gathered by name, whichever slot it is in", () => {
    const colour = named("0");
    const relief = named("1");
    const sameColour = named("0");
    const model = new Group().add(
      mesh(new MeshStandardMaterial({ map: colour, normalMap: relief })),
      mesh(new MeshBasicMaterial({ map: sameColour })),
      mesh(new MeshBasicMaterial({ map: new Texture() })),
    );
    const found = texturesOf(model);
    expect([...found.keys()].sort()).toEqual(["0", "1"]);
    expect(found.get("0")).toEqual([colour, sameColour]);
    expect(found.get("1")).toEqual([relief]);
  });
});

describe("quietMoment", () => {
  /** How long it waited, in seconds, with the viewer still as `still` says. */
  async function waited(still: (seconds: number) => boolean) {
    let seconds = 0;
    await quietMoment(
      () => still(seconds),
      async (more) => {
        seconds += more;
      },
    );
    return seconds;
  }

  it("comes soon while the viewer stands still", async () => {
    expect(await waited(() => true)).toBe(0.25);
  });

  it("comes as soon as a walking viewer stops", async () => {
    expect(await waited((seconds) => seconds >= 1)).toBe(1);
  });

  it("does not wait for ever for a viewer who keeps walking", async () => {
    expect(await waited(() => false)).toBe(2);
  });
});

describe("sharpenTextures", () => {
  it("puts the picture into every texture holding it, in a fresh place on the graphics card", async () => {
    const first = named("0");
    const second = named("0");
    const dispose = vi.fn();
    first.addEventListener("dispose", dispose);
    const version = first.version;
    await sharpenTextures(new Map([["0", [first, second]]]), (name) => `${name}.webp`, new Downloads(site("0.webp")), { decode });
    expect(first.image).toBe(PICTURE);
    expect(second.image).toBe(PICTURE);
    expect(dispose).toHaveBeenCalledOnce();
    expect(first.version).toBeGreaterThan(version);
  });

  it("lets go of the picture it replaces, once for all the textures that held it", async () => {
    const close = vi.fn();
    const first = named("0");
    const second = named("0");
    first.image = second.image = { close };
    await sharpenTextures(new Map([["0", [first, second]]]), (name) => `${name}.webp`, new Downloads(site("0.webp")), { decode });
    expect(close).toHaveBeenCalledOnce();
  });

  it("hands pictures to the graphics card one at a time, each after its own moment", async () => {
    const said: string[] = [];
    const pace = {
      moment: async () => {
        said.push("moment");
      },
      upload: (texture: Texture) => {
        said.push(`upload ${texture.name}`);
      },
    };
    const files = new Map([["0", [named("0")]], ["1", [named("1")]]]);
    await sharpenTextures(files, (name) => `${name}.webp`, new Downloads(site("0.webp", "1.webp")), { pace, decode });
    expect(said).toHaveLength(4);
    expect(said[0]).toBe("moment");
    expect(said[1]).toMatch(/^upload/);
    expect(said[2]).toBe("moment");
    expect(said[3]).toMatch(/^upload/);
  });

  it("uploads only after every texture holding the picture has let go of the old one", async () => {
    const said: string[] = [];
    const first = named("0");
    const second = named("0");
    first.addEventListener("dispose", () => said.push("first lets go"));
    second.addEventListener("dispose", () => said.push("second lets go"));
    const pace = {
      moment: async () => {},
      upload: () => {
        said.push("upload");
      },
    };
    await sharpenTextures(new Map([["0", [first, second]]]), (name) => `${name}.webp`, new Downloads(site("0.webp")), { pace, decode });
    expect(said).toEqual(["first lets go", "second lets go", "upload", "upload"]);
  });

  it("keeps the same textures, so materials and shaders need nothing new", async () => {
    const texture = named("0");
    const material = new MeshBasicMaterial({ map: texture });
    const version = material.version;
    await sharpenTextures(new Map([["0", [texture]]]), (name) => `${name}.webp`, new Downloads(site("0.webp")), { decode });
    expect(material.map).toBe(texture);
    expect(material.version).toBe(version);
  });

  it("leaves a texture the site does not have as it is, and still sharpens the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const missing = named("0");
    const there = named("1");
    const tiny = missing.image;
    await sharpenTextures(new Map([["0", [missing]], ["1", [there]]]), (name) => `${name}.webp`, new Downloads(site("1.webp")), { decode });
    expect(missing.image).toBe(tiny);
    expect(there.image).toBe(PICTURE);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("tells the frame rate's watchers each time a picture goes in", async () => {
    const downloads = new Downloads(site("0.webp"));
    const onArrival = vi.fn();
    downloads.onArrival = onArrival;
    await sharpenTextures(new Map([["0", [named("0")]]]), (name) => `${name}.webp`, downloads, { decode });
    // Once for the download, once for handing it to the card.
    expect(onArrival).toHaveBeenCalledTimes(2);
  });
});
