import { Mesh, Texture, type Material, type Object3D } from "three";
import { MissingFile, type Downloads } from "./download";

/** A downloaded picture, as the graphics card can take it. */
export type Decode = (bytes: ArrayBuffer) => Promise<TexImageSource>;

/**
 * When a picture goes to the graphics card, which stalls a frame or two on an
 * old phone however it is done, and how.
 */
export interface Pace {
  /** Resolves at a good moment to hand over the next picture. */
  moment: () => Promise<void>;
  /** Hand this texture's picture to the card now, whether or not it is in view. */
  upload: (texture: Texture) => void;
}

const NO_PACE: Pace = { moment: async () => {}, upload: () => {} };

/** Seconds at least between two pictures handed to the graphics card. */
const SHORTEST_GAP_SECONDS = 0.25;
/** Seconds at most the next picture waits for the viewer to stand still. */
const LONGEST_GAP_SECONDS = 2;

/**
 * A moment for the next picture: soon after the last while the viewer stands
 * still, where a stalled frame hardly shows, and otherwise after a while, so
 * a viewer who keeps walking still sees the textures sharpen, one at a time.
 */
export async function quietMoment(
  still: () => boolean,
  wait: (seconds: number) => Promise<void> = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
): Promise<void> {
  let waited = 0;
  do {
    await wait(SHORTEST_GAP_SECONDS);
    waited += SHORTEST_GAP_SECONDS;
  } while (!still() && waited < LONGEST_GAP_SECONDS);
}

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
 * They download together but go to the graphics card one at a time, at the
 * pace's moments, because several at once make a long stutter. A picture the
 * site does not have leaves the one showing.
 */
export async function sharpenTextures(
  textures: Map<string, Texture[]>,
  address: (name: string) => string,
  downloads: Downloads,
  { pace = NO_PACE, decode = BROWSER_DECODE }: { pace?: Pace; decode?: Decode } = {},
): Promise<void> {
  let queue = Promise.resolve();
  await Promise.all(
    [...textures].map(async ([name, holding]) => {
      try {
        const picture = await decode(await downloads.get(address(name)));
        await (queue = queue.then(pace.moment).then(() => {
          const shown = holding[0]?.image as { close?: () => void } | null | undefined;
          for (const texture of holding) {
            texture.image = picture;
            // A picture of another size can't go into what the card set aside for the tiny one.
            texture.dispose();
            texture.needsUpdate = true;
          }
          // Only once all have let go: they share that place on the card while any holds it.
          for (const texture of holding) pace.upload(texture);
          // The page's own copy of the picture it replaces, which the card no longer needs.
          shown?.close?.();
          // Handing it to the card may stall a frame, as unpacking one does.
          downloads.onArrival();
        }));
      } catch (error) {
        if (!(error instanceof MissingFile)) throw error;
        console.warn(`Texture ${name}'s picture is not on the site, so its surfaces stay as they are.`, error);
      }
    }),
  );
}
