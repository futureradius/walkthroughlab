import { PerspectiveCamera, Scene, type WebGLRenderer } from "three";
import { describe, expect, it, vi } from "vitest";
import { AmbientOcclusion, METHODS, OCCLUSION_DESCRIBED, type Method, type OcclusionWorkings } from "./occlusion";

/** Methods that only note what was fetched, in place of the real ones, which need WebGL. */
function fakeMethods(fails: string[] = []) {
  const fetched: string[] = [];
  const methods: Method[] = METHODS.map(({ name, uses }) => ({
    name,
    uses,
    load: async () => {
      fetched.push(name);
      if (fails.includes(name)) throw new Error("offline");
      return {} as OcclusionWorkings;
    },
  }));
  const occlusion = new AmbientOcclusion({} as WebGLRenderer, new Scene(), new PerspectiveCamera(), methods);
  return { occlusion, fetched };
}

describe("fetching a method", () => {
  it("fetches only the one the settings ask for", async () => {
    const { occlusion, fetched } = fakeMethods();
    occlusion.settings.method = "glamarye";
    await occlusion.ready();
    expect(fetched).toEqual(["glamarye"]);
  });

  it("fetches nothing while ambient occlusion is off", async () => {
    const { occlusion, fetched } = fakeMethods();
    occlusion.settings.on = false;
    await occlusion.ready();
    expect(fetched).toEqual([]);
  });

  it("fetches a method once, however often it is asked for", async () => {
    const { occlusion, fetched } = fakeMethods();
    await Promise.all([occlusion.ready(), occlusion.ready()]);
    await occlusion.ready();
    expect(fetched).toEqual(["n8ao"]);
  });

  it("is ready without a method that cannot be had", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { occlusion, fetched } = fakeMethods(["n8ao"]);
    await expect(occlusion.ready()).resolves.toBeUndefined();
    expect(fetched).toEqual(["n8ao"]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("the methods", () => {
  it("are the words the method setting takes", () => {
    const { method } = OCCLUSION_DESCRIBED;
    expect(method.kind === "choice" && method.words).toEqual(METHODS.map(({ name }) => name));
  });
});
