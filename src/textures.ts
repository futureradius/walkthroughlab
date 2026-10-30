import { Mesh, Texture, type Material, type Object3D } from "three";
import { MissingFile, type Downloads } from "./download";

/** A downloaded picture, as the graphics card can take it. */
export type Decode = (bytes: ArrayBuffer) => Promise<TexImageSource>;

/** Unpacked away from the walkthrough's frames, and left as it is, because a texture may hold relief rather than colour. */
const BROWSER_DECODE: Decode = (bytes) =>
  createImageBitmap(new Blob([bytes]), { premultiplyAlpha: "none", colorSpaceConversion: "none" });

/**
 * Every texture a model's materials hold, by its name, which `npm run
 * optimize` makes the name of its file. One picture may sit behind several
 * textures, since each material's use of it can have its own settings.
 */
export function texturesOf(model: Object3D): Map<string, Texture[]> {
  const found = new Map<string, Set<Texture>>();
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of [object.material].flat() as Material[]) {
      for (const value of Object.values(material)) {
        if (!(value instanceof Texture) || value.name === "") continue;
        if (!found.has(value.name)) found.set(value.name, new Set());
        found.get(value.name)!.add(value);
      }
    }
  });
  return new Map([...found].map(([name, textures]) => [name, [...textures]]));
}

/**
 * Download a picture for each of these textures and put it in place of the one
 * showing, the tiny one the environment arrived with or an earlier sharp one
 * (#34). Every material goes on holding the same texture and draws with the
 * same shader, so nothing has to be worked out again while the viewer walks.
 * A picture the site does not have leaves the one showing.
 */
export async function sharpenTextures(
  textures: Map<string, Texture[]>,
  address: (name: string) => string,
  downloads: Downloads,
  decode: Decode = BROWSER_DECODE,
): Promise<void> {
  await Promise.all(
    [...textures].map(async ([name, holding]) => {
      try {
        const picture = await decode(await downloads.get(address(name)));
        const shown = holding[0]?.image as { close?: () => void } | null | undefined;
        for (const texture of holding) {
          texture.image = picture;
          // A picture of another size can't go into what the card set aside for the tiny one.
          texture.dispose();
          texture.needsUpdate = true;
        }
        // The page's own copy of the picture it replaces, which the card no longer needs.
        shown?.close?.();
        // Handing it to the card may stall a frame, as unpacking one does.
        downloads.onArrival();
      } catch (error) {
        if (!(error instanceof MissingFile)) throw error;
        console.warn(`Texture ${name}'s picture is not on the site, so its surfaces stay as they are.`, error);
      }
    }),
  );
}
