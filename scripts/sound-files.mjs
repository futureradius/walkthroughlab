// Turns raw sound files into the Opus-in-WebM files the walkthrough plays,
// for `npm run optimize` and scripts/default-sounds.mjs (#33). Every loop is
// made seamless here and gets OVERLAP seconds of its own sound copied onto
// both ends, so the walkthrough loops only the middle and the join never
// touches the file's edges; see docs/research/sound-format.md.
//
// It needs ffmpeg with libopus: on PATH, in the FFMPEG environment variable,
// or installed with `winget install --id Gyan.FFmpeg -e`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const RATE = 48000;
/** Seconds of the loop's own sound copied before and after it: loopStart in the walkthrough. */
export const OVERLAP = 0.1;
/** Kilobits a second: the stereo ambient sound, and every other sound, in mono (#19). */
const STEREO_BITRATE = "64k";
const MONO_BITRATE = "40k";
/** Longest crossfade made where a loop's end runs into its start, in seconds. */
const CROSSFADE = 1;
/** Highest peak a sound is raised or lowered to, as a share of full scale. */
const PEAK = 0.9;
/** Average loudness a loop is raised or lowered to, short of PEAK: about -20 dBFS. */
const LOOP_RMS = 0.1;
/** Kinds of file read as sound. */
export const SOUND_FILE = /\.(wav|flac|mp3|ogg|oga|opus|webm|m4a|aac|aiff?|caf)$/i;

let found;
/** Where ffmpeg is, found once. */
export function ffmpeg() {
  if (found) return found;
  if (process.env.FFMPEG) return (found = process.env.FFMPEG);
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return (found = "ffmpeg");
  } catch {
    // not on PATH; try where winget puts it
  }
  const packages = join(process.env.LOCALAPPDATA ?? "", "Microsoft/WinGet/Packages");
  if (existsSync(packages)) {
    for (const pkg of readdirSync(packages).filter((d) => d.startsWith("Gyan.FFmpeg"))) {
      for (const build of readdirSync(join(packages, pkg))) {
        const exe = join(packages, pkg, build, "bin/ffmpeg.exe");
        if (existsSync(exe)) return (found = exe);
      }
    }
  }
  throw new Error("ffmpeg not found: put it on PATH, set FFMPEG to its path, or `winget install --id Gyan.FFmpeg -e`");
}

/**
 * A sound file's samples at RATE, as one Float32Array per channel. Only the
 * first `seconds` are read, if given.
 */
export function decode(file, channels, seconds) {
  const raw = execFileSync(
    ffmpeg(),
    ["-v", "error", "-i", file, ...(seconds ? ["-t", String(seconds)] : []), "-f", "f32le", "-ac", String(channels), "-ar", String(RATE), "-"],
    { maxBuffer: 1024 * 1024 * 1024 },
  );
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const frames = all.length / channels;
  return Array.from({ length: channels }, (_, c) => Float32Array.from({ length: frames }, (_, i) => all[i * channels + c]));
}

/**
 * Make the sound loop without a seam: its last `fade` samples are blended
 * into its first, with equal power, and dropped from the end. Played round
 * and round, the end then runs straight into what followed it in the file.
 */
export function seamless(channels) {
  const frames = channels[0].length;
  const fade = Math.min(Math.round(CROSSFADE * RATE), Math.floor(frames / 4));
  const length = frames - fade;
  return channels.map((samples) => {
    const out = samples.slice(0, length);
    for (let i = 0; i < fade; i++) {
      const t = ((i + 0.5) / fade) * (Math.PI / 2);
      out[i] = samples[i] * Math.sin(t) + samples[length + i] * Math.cos(t);
    }
    return out;
  });
}

/**
 * Every sound at the same level, so one loudness setting means the same for
 * any file: a loop by its average loudness, short of clipping, and a sound
 * that plays once by its peak.
 */
export function levelled(channels, { loop }) {
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (const samples of channels) {
    for (const sample of samples) {
      peak = Math.max(peak, Math.abs(sample));
      sum += sample * sample;
      count++;
    }
  }
  if (peak === 0) return channels;
  const gain = loop ? Math.min(LOOP_RMS / Math.sqrt(sum / count), PEAK / peak) : PEAK / peak;
  return channels.map((samples) => samples.map((sample) => sample * gain));
}

/** [last OVERLAP of the loop] + [loop] + [first OVERLAP of the loop]. */
export function withOverlap(channels) {
  const overlap = Math.round(OVERLAP * RATE);
  return channels.map((loop) => {
    const n = loop.length;
    const out = new Float32Array(n + 2 * overlap);
    out.set(loop.subarray(n - overlap), 0);
    out.set(loop, overlap);
    out.set(loop.subarray(0, overlap), overlap + n);
    return out;
  });
}

/** A 32-bit float WAV file of these channels. */
export function wav(channels) {
  const frames = channels[0].length;
  const count = channels.length;
  const data = Buffer.alloc(frames * count * 4);
  for (let i = 0; i < frames; i++) for (let c = 0; c < count; c++) data.writeFloatLE(channels[c][i], (i * count + c) * 4);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float
  header.writeUInt16LE(count, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * count * 4, 28);
  header.writeUInt16LE(count * 4, 32);
  header.writeUInt16LE(32, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Encode these channels as Opus in WebM at `target`. */
export function encode(channels, target) {
  const scratch = mkdtempSync(join(tmpdir(), "sound-"));
  try {
    const source = join(scratch, "sound.wav");
    writeFileSync(source, wav(channels));
    execFileSync(ffmpeg(), [
      "-v", "error", "-y", "-i", source,
      "-c:a", "libopus", "-b:a", channels.length > 1 ? STEREO_BITRATE : MONO_BITRATE,
      "-map_metadata", "-1", "-fflags", "+bitexact", target,
    ]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Write a loop for the walkthrough from a raw file: at most its first
 * `seconds`, made seamless, with the overlap. Returns the loop's length in
 * seconds, which the walkthrough loops between OVERLAP and OVERLAP + length.
 */
export function writeLoop(file, target, { stereo = false, seconds } = {}) {
  const loop = levelled(seamless(decode(file, stereo ? 2 : 1, seconds && seconds + CROSSFADE)), { loop: true });
  encode(withOverlap(loop), target);
  return loop[0].length / RATE;
}

/** Write a sound that plays once, such as a footstep, in mono, from a raw file. */
export function writeOnce(file, target) {
  encode(levelled(decode(file, 1), { loop: false }), target);
}

/** Seconds an encoded file plays for, decoded as the walkthrough will. */
export function lengthOf(file) {
  return decode(file, 1)[0].length / RATE;
}
