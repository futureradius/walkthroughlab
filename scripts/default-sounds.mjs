// Makes the default sounds every environment has unless it brings its own:
// footsteps, doors and the elevator (#33). Run with
// `node scripts/default-sounds.mjs`, then `npm run optimize`, which lists them
// in the environment. It needs ffmpeg; see scripts/sound-files.mjs.
//
// The recordings, as downloaded, are in models-source/default-sounds/originals/,
// each with a .txt saying where it came from. CUTS below says which bit of
// each recording becomes which sound; the cut is written as a WAV to
// models-source/default-sounds/<name>.wav, then encoded to public/sounds/,
// which is committed. A cut WAV already there is kept, so one fine-tuned by
// hand in an editor such as Audacity survives the next run: delete it to cut
// it again from the table.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decode, RATE, SOUND_FILE, wav, writeLoop, writeOnce } from "./sound-files.mjs";

const ORIGINALS = "models-source/default-sounds/originals";
const CUT = "models-source/default-sounds";
const OUT = "public/sounds";

/**
 * Seconds into each recording. A start before 0 begins with that much
 * silence, so a door's slam lands as the door shuts, about 0.6 s after it
 * starts to close. `fade` is the fade out at the end. `loop` makes a seamless
 * loop instead. Footsteps are found by themselves: each step heard before
 * `until`, `length` seconds of it.
 */
const CUTS = [
  { name: "footstep", from: "footsteps", steps: { until: 3.7, length: 0.35 } },
  { name: "door-hinged-open", from: "door-hinged-open", start: 0, end: 1.4, fade: 0.3 },
  { name: "door-hinged-close", from: "door-hinged-close", start: -0.2, end: 1.1, fade: 0.2 },
  // An alternative close, a front door with weather stripping: its slam is at 2.4 s.
  // { name: "door-hinged-close", from: "door-hinged-close-2", start: 1.8, end: 3.2, fade: 0.3 },
  { name: "door-sliding-open", from: "door-sliding", start: 3.15, end: 5.2, fade: 0.6 },
  { name: "door-sliding-close", from: "door-sliding", start: 11.4, end: 13.4, fade: 0.4 },
  { name: "elevator-start", from: "elevator", start: 0, end: 1.1, fade: 0.4 },
  { name: "elevator-hum", from: "elevator", start: 0.6, end: 3.9, loop: true },
  { name: "elevator-arrive", from: "elevator-arrive", start: 0, end: 0.95, fade: 0.15 },
];

/** Seconds a cut fades in over, so it never starts with a click. */
const FADE_IN = 0.005;
/** How far below the loudest step a sound may be and still count as a step, in decibels. */
const STEP_RANGE = 15;
/** Seconds between two steps at the least. */
const STEP_GAP = 0.25;
/** Seconds of a step kept before it is heard. */
const STEP_LEAD = 0.015;

function original(name) {
  const file = readdirSync(ORIGINALS).find((each) => SOUND_FILE.test(each) && each.replace(SOUND_FILE, "") === name);
  if (!file) throw new Error(`There is no ${ORIGINALS}/${name} recording.`);
  return join(ORIGINALS, file);
}

/** Seconds `start` to `end` of the samples, with silence before 0, fading in and out. */
function cut(samples, start, end, fade = 0.05) {
  const out = new Float32Array(Math.round((end - start) * RATE));
  const from = Math.round(start * RATE);
  for (let i = 0; i < out.length; i++) out[i] = samples[from + i] ?? 0;
  const lead = Math.max(0, -from);
  const fadeIn = Math.round(FADE_IN * RATE);
  for (let i = 0; i < fadeIn && lead + i < out.length; i++) out[lead + i] *= i / fadeIn;
  const fadeOut = Math.round(fade * RATE);
  for (let i = 0; i < fadeOut; i++) out[out.length - 1 - i] *= i / fadeOut;
  return out;
}

/** Where each footstep begins: rises in loudness, 5 ms at a time, near the loudest. */
function stepsIn(samples, until) {
  const frame = Math.round(0.005 * RATE);
  const levels = [];
  for (let i = 0; i + frame <= Math.min(samples.length, until * RATE); i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) sum += samples[j] * samples[j];
    levels.push(10 * Math.log10(sum / frame + 1e-12));
  }
  const floor = Math.max(...levels) - STEP_RANGE;
  const starts = [];
  levels.forEach((level, i) => {
    const seconds = (i * frame) / RATE;
    if (level >= floor && (starts.length === 0 || seconds - starts.at(-1) >= STEP_GAP)) starts.push(seconds);
  });
  return starts;
}

mkdirSync(OUT, { recursive: true });
for (const { name, from, steps, start, end, fade, loop } of CUTS) {
  const [samples] = decode(original(from), 1);
  const pieces = steps
    ? stepsIn(samples, steps.until).map((at, i) => ({ name: `${name}-${i + 1}`, made: () => cut(samples, at - STEP_LEAD, at + steps.length, 0.08) }))
    : [{ name, made: () => cut(samples, start, end, loop ? 0 : fade) }];
  if (steps) {
    // Steps found before, beyond as many as there are now, would play too.
    for (const old of readdirSync(OUT).filter((file) => file.startsWith(`${name}-`))) rmSync(join(OUT, old));
  }
  for (const piece of pieces) {
    const raw = join(CUT, `${piece.name}.wav`);
    if (!existsSync(raw)) writeFileSync(raw, wav([piece.made()]));
    const target = join(OUT, `${piece.name}.webm`);
    if (loop) console.log(`${piece.name}: a loop of ${writeLoop(raw, target).toFixed(2)} s`);
    else {
      writeOnce(raw, target);
      console.log(`${piece.name}`);
    }
  }
}
