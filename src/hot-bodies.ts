/**
 * The colours of glowing hot bodies, for the lamp calculator (lamps.html) to
 * say which colour to paste into Rhino for a temperature (#29).
 */
import { RHINO_GAMMA } from "./lamps";

type Rgb = readonly [number, number, number];

/** Coolest and hottest temperature the table holds, in kelvin. */
export const COOLEST = 1000;
export const HOTTEST = 12000;
const STEP = 100;

/**
 * Linear sRGB colours of a hot body from COOLEST to HOTTEST every STEP, its
 * brightest channel 1: Mitchell Charity's blackbody table (version
 * 2001-Jun-22), CIE 1931 2° rows, the table research section 10 checked the
 * README's hex codes against.
 */
const COLOURS: Rgb[] = [
  [1, 0.0337, 0], [1, 0.0592, 0], [1, 0.0846, 0], [1, 0.1096, 0],
  [1, 0.1341, 0], [1, 0.1578, 0], [1, 0.1806, 0], [1, 0.2025, 0],
  [1, 0.2235, 0], [1, 0.2434, 0], [1, 0.2647, 0.0033], [1, 0.2889, 0.012],
  [1, 0.3126, 0.0219], [1, 0.336, 0.0331], [1, 0.3589, 0.0454], [1, 0.3814, 0.0588],
  [1, 0.4034, 0.0734], [1, 0.425, 0.0889], [1, 0.4461, 0.1054], [1, 0.4668, 0.1229],
  [1, 0.487, 0.1411], [1, 0.5067, 0.1602], [1, 0.5259, 0.18], [1, 0.5447, 0.2005],
  [1, 0.563, 0.2216], [1, 0.5809, 0.2433], [1, 0.5983, 0.2655], [1, 0.6153, 0.2881],
  [1, 0.6318, 0.3112], [1, 0.648, 0.3346], [1, 0.6636, 0.3583], [1, 0.6789, 0.3823],
  [1, 0.6938, 0.4066], [1, 0.7083, 0.431], [1, 0.7223, 0.4556], [1, 0.736, 0.4803],
  [1, 0.7494, 0.5051], [1, 0.7623, 0.5299], [1, 0.775, 0.5548], [1, 0.7872, 0.5797],
  [1, 0.7992, 0.6045], [1, 0.8108, 0.6293], [1, 0.8221, 0.6541], [1, 0.833, 0.6787],
  [1, 0.8437, 0.7032], [1, 0.8541, 0.7277], [1, 0.8642, 0.7519], [1, 0.874, 0.776],
  [1, 0.8836, 0.8], [1, 0.8929, 0.8238], [1, 0.9019, 0.8473], [1, 0.9107, 0.8707],
  [1, 0.9193, 0.8939], [1, 0.9276, 0.9168], [1, 0.9357, 0.9396], [1, 0.9436, 0.9621],
  [1, 0.9513, 0.9844], [0.9937, 0.9526, 1], [0.9726, 0.9395, 1], [0.9526, 0.927, 1],
  [0.9337, 0.915, 1], [0.9157, 0.9035, 1], [0.8986, 0.8925, 1], [0.8823, 0.8819, 1],
  [0.8668, 0.8718, 1], [0.852, 0.8621, 1], [0.8379, 0.8527, 1], [0.8244, 0.8437, 1],
  [0.8115, 0.8351, 1], [0.7992, 0.8268, 1], [0.7874, 0.8187, 1], [0.7761, 0.811, 1],
  [0.7652, 0.8035, 1], [0.7548, 0.7963, 1], [0.7449, 0.7894, 1], [0.7353, 0.7827, 1],
  [0.726, 0.7762, 1], [0.7172, 0.7699, 1], [0.7086, 0.7638, 1], [0.7004, 0.7579, 1],
  [0.6925, 0.7522, 1], [0.6848, 0.7467, 1], [0.6774, 0.7414, 1], [0.6703, 0.7362, 1],
  [0.6635, 0.7311, 1], [0.6568, 0.7263, 1], [0.6504, 0.7215, 1], [0.6442, 0.7169, 1],
  [0.6382, 0.7124, 1], [0.6324, 0.7081, 1], [0.6268, 0.7039, 1], [0.6213, 0.6998, 1],
  [0.6161, 0.6958, 1], [0.6109, 0.6919, 1], [0.606, 0.6881, 1], [0.6012, 0.6844, 1],
  [0.5965, 0.6808, 1], [0.5919, 0.6773, 1], [0.5875, 0.6739, 1], [0.5833, 0.6706, 1],
  [0.5791, 0.6674, 1], [0.575, 0.6642, 1], [0.5711, 0.6611, 1], [0.5673, 0.6581, 1],
  [0.5636, 0.6552, 1], [0.5599, 0.6523, 1], [0.5564, 0.6495, 1], [0.553, 0.6468, 1],
  [0.5496, 0.6441, 1], [0.5463, 0.6415, 1], [0.5431, 0.6389, 1],
];

/** The linear colour of a hot body at this temperature, its brightest channel 1. */
export function hotBodyColour(kelvin: number): Rgb {
  const at = (Math.min(HOTTEST, Math.max(COOLEST, kelvin)) - COOLEST) / STEP;
  const below = Math.min(Math.floor(at), COLOURS.length - 2);
  const along = at - below;
  return COLOURS[below].map((c, i) => c + (COLOURS[below + 1][i] - c) * along) as unknown as Rgb;
}

/** The colour to pick in Rhino for a linear colour: undoes `fromRhino` in lamps.ts. */
export const toRhino = (colour: Rgb): Rgb => colour.map((c) => Math.max(0, c) ** (1 / RHINO_GAMMA)) as unknown as Rgb;

/** A colour from 0 to 1 as Rhino's hex field takes it, such as `#FFAD55`. */
export const hexOf = (colour: Rgb) =>
  "#" + colour.map((c) => Math.round(255 * Math.min(1, Math.max(0, c))).toString(16).padStart(2, "0")).join("").toUpperCase();

/** A colour from 0 to 1 from a hex code such as `#FFAD55` or `ffad55`, or undefined if it is not one. */
export function fromHex(hex: string): Rgb | undefined {
  const digits = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(digits)) return undefined;
  return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16) / 255) as unknown as Rgb;
}
