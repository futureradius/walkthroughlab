/**
 * Lamps: surfaces whose material glows with a plain colour (#29). What
 * `npm run optimize` works out about them, to tell the author how bright and
 * how warm each one is, so they can check it against the real fixture.
 */

type Rgb = readonly [number, number, number];

/**
 * Rhino's Raytraced view raises a glow's colour to this power before it lights
 * anything, under the linear workflow every document starts with; the glTF
 * exporter writes the colour as picked. The bake does as Raytraced does, so
 * what the author tunes there is what the bake throws (#29).
 */
export const RHINO_GAMMA = 2.2;

/** Lumen per watt of light at its most visible, as Blender's glTF add-on takes it. */
const LUMEN_PER_WATT = 683;

/**
 * How far from the colour of a glowing hot body a colour may lie, in CIE 1960
 * u, v, and still be named by a temperature. Lamps sold as one colour lie
 * within about 0.006 of it.
 */
const OFF_THE_LINE = 0.02;

/** A glow's colour as Rhino's Raytraced view uses it, from the colour Rhino exported. */
export const fromRhino = (colour: Rgb): Rgb => colour.map((c) => c ** RHINO_GAMMA) as unknown as Rgb;

/** How bright a linear colour looks, from 0 to 1. */
export const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Lumen a lamp sends out of its front, which is all its area: a surface glows
 * only from its front (#29), and a closed solid's front is its outside.
 */
export const lumenOf = (strength: number, colour: Rgb, area: number) =>
  strength * luminance(colour) * LUMEN_PER_WATT * Math.PI * area;

/** A colour in CIE 1960 u, v, from linear red, green and blue. */
function uvOf([r, g, b]: Rgb): [number, number] {
  const x = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const d = x + 15 * y + 3 * z;
  return [(4 * x) / d, (6 * y) / d];
}

/** The colour of a glowing hot body at this temperature, in CIE 1960 u, v (Kim et al., 2002). */
function hotBodyAt(kelvin: number): [number, number] {
  const t = 1e3 / kelvin;
  const x =
    kelvin <= 4000
      ? -0.2661239 * t ** 3 - 0.2343589 * t ** 2 + 0.8776956 * t + 0.17991
      : -3.0258469 * t ** 3 + 2.1070379 * t ** 2 + 0.2226347 * t + 0.24039;
  const y =
    kelvin <= 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : kelvin <= 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  const d = -2 * x + 12 * y + 3;
  return [(4 * x) / d, (6 * y) / d];
}

/**
 * The temperature whose glow is nearest a linear colour, to the nearest 50 K,
 * or undefined for a colour no lamp gives, such as green or blue.
 */
export function kelvinOf(colour: Rgb): number | undefined {
  if (luminance(colour) <= 0) return undefined;
  const [u, v] = uvOf(colour);
  let best = 0;
  let nearest = Infinity;
  for (let kelvin = 1700; kelvin <= 25000; kelvin += 10) {
    const [hu, hv] = hotBodyAt(kelvin);
    const away = Math.hypot(u - hu, v - hv);
    if (away < nearest) [best, nearest] = [kelvin, away];
  }
  return nearest > OFF_THE_LINE ? undefined : Math.round(best / 50) * 50;
}

/** Which way a lamp faces: worth saying only of a flat one, whose front could face away from the room. */
export type Facing = "up" | "down" | "sideways";

/**
 * Which way a lamp's front faces, from the sum of its triangles' fronts, each
 * as long as its area, or undefined if it is not flat.
 */
export function facingOf(fronts: Rgb, area: number): Facing | undefined {
  const length = Math.hypot(...fronts);
  if (area <= 0 || length < 0.98 * area) return undefined;
  const up = fronts[1] / length;
  return up > 0.7 ? "up" : up < -0.7 ? "down" : "sideways";
}

/** One glowing material's lamps, for the list `npm run optimize` prints. */
export interface Lamps {
  name: string;
  /** Lumen of each object glowing with it. */
  lumens: number[];
  /** Its colour as the bake uses it, linear. */
  colour: Rgb;
  /** Which way each of its lamps faces, if flat. */
  facings?: (Facing | undefined)[];
  /** Whether its lamps sway, which keeps them out of the bake: they glow and light nothing. */
  sways?: boolean;
}

const lumen = (value: number) =>
  `${(value >= 100 ? Math.round(value / 10) * 10 : Math.round(value)).toLocaleString("en")} lm`;

/** Which way flat lamps face, such as `faces down`, or `3 face up, 1 faces down` when they differ. */
function facingsOf(facings: (Facing | undefined)[]): string | undefined {
  const counts = new Map<Facing, number>();
  for (const facing of facings) if (facing) counts.set(facing, (counts.get(facing) ?? 0) + 1);
  if (counts.size === 0) return undefined;
  const [[only, count]] = counts;
  if (counts.size === 1 && count === facings.length) return `faces ${only}`;
  return [...counts].map(([facing, n]) => `${n} ${n === 1 ? "faces" : "face"} ${facing}`).join(", ");
}

/** One line of the list, such as `pendant: 3 lamps, 790 lm each, ~2750 K, faces down`. */
export function describeLamps({ name, lumens, colour, facings = [], sways }: Lamps): string {
  const low = Math.min(...lumens);
  const high = Math.max(...lumens);
  const count = lumens.length === 1 ? "1 lamp" : `${lumens.length} lamps`;
  const brightness =
    lumens.length === 1 ? lumen(low) : high <= low * 1.01 ? `${lumen(low)} each` : `${lumen(low).slice(0, -3)}–${lumen(high)}`;
  const kelvin = kelvinOf(colour);
  const parts = [count, brightness, kelvin ? `~${kelvin} K` : "not a lamp colour"];
  const facing = facingsOf(facings);
  if (facing) parts.push(facing);
  if (sways) parts.push("sways, lights nothing");
  return `${name}: ${parts.join(", ")}`;
}
