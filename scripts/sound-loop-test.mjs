// Makes the sounds for the sound loop test page (issue #35), public/sound-loop/,
// then decodes them again and checks that the loops join cleanly.
//
// Rerun with `node scripts/sound-loop-test.mjs`. It needs ffmpeg with libopus:
// on PATH, in the FFMPEG environment variable, or installed with
// `winget install --id Gyan.FFmpeg -e`. Both sounds are synthesized here, so
// there is no licence question, and they come out the same on every run.
//
// Each sound becomes two Opus-in-WebM files, 48 kHz mono:
// - "-overlap": [last 100 ms of the loop] + [loop] + [first 100 ms of the loop],
//   played with loopStart = 0.1 s and loopEnd = 0.1 s + the loop's length,
//   as docs/research/sound-format.md recommends;
// - "-plain": just the loop, played end to end, for comparison.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = "public/sound-loop";
const RATE = 48000;
/** The copy of the loop's own sound added before and after it, in samples. */
const OVERLAP = Math.round(0.1 * RATE);
/** Highest peak, as a fraction of full scale: about -6 dBFS. */
const PEAK = 0.5;
const BITRATE = "48k";

const SOUNDS = [
  { name: "chord", seconds: 8, make: chord },
  { name: "wind", seconds: 10, make: wind },
];

/** Repeatable random numbers, so every run makes the same sounds. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A soft A major chord of sines. Every frequency and every swell makes a whole
 * number of cycles in the loop, so the loop is seamless by construction, and
 * the swells all peak at the loop point, where a click would be easiest to hear.
 */
function chord(n) {
  const seconds = n / RATE;
  // [cycles per loop, loudness, swells per loop]
  const voices = [
    [110 * seconds, 0.2, 1],
    [220 * seconds, 0.3, 2],
    [Math.round(277.18 * seconds), 0.22, 1],
    [Math.round(329.63 * seconds), 0.22, 3],
    [440 * seconds, 0.12, 2],
  ];
  const rand = random(35);
  const phases = voices.map(() => rand() * 2 * Math.PI);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    let sum = 0;
    voices.forEach(([cycles, loudness, swells], v) => {
      const swell = 0.75 + 0.25 * Math.cos(2 * Math.PI * swells * x);
      sum += loudness * swell * Math.sin(2 * Math.PI * cycles * x + phases[v]);
    });
    out[i] = sum;
  }
  return out;
}

/**
 * Rushing wind: noise through a band-pass filter whose pitch sways, with a
 * steady hiss on top so that a dropout is heard as a break. The noise is made
 * two seconds longer than the loop and its extra end is crossfaded into its
 * start, so the loop is seamless by construction. The sway repeats exactly
 * once per loop, so both sides of the crossfade sound alike.
 */
function wind(n) {
  const warmup = RATE; // lets the filters settle before the part that is kept
  const fade = 2 * RATE;
  const total = warmup + n + fade;
  const rand = random(3535);
  const raw = new Float64Array(total);
  let low = 0;
  let band = 0;
  let hissLow = 0;
  let hissPrev = 0;
  for (let i = 0; i < total; i++) {
    const x = ((i - warmup) / n) % 1;
    const sway = 0.5 + 0.3 * Math.sin(2 * Math.PI * x) + 0.2 * Math.sin(2 * Math.PI * 3 * x + 1);
    const pitch = 250 + 650 * sway; // Hz
    const f = 2 * Math.sin((Math.PI * pitch) / RATE);
    const q = 0.35;
    const noise = rand() * 2 - 1;
    const high = noise - low - q * band;
    band += f * high;
    low += f * band;
    // hiss: noise with its lows and highest highs taken out
    const hissNoise = rand() * 2 - 1;
    hissLow += 0.35 * (hissNoise - hissLow);
    const hiss = hissLow - hissPrev;
    hissPrev = hissLow;
    raw[i] = band * (0.6 + 0.4 * sway) + 0.25 * hiss;
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const own = raw[warmup + i];
    if (i < fade) {
      // equal-power crossfade from the noise just past the loop's end
      const w = i / fade;
      out[i] = own * Math.sin((w * Math.PI) / 2) + raw[warmup + n + i] * Math.cos((w * Math.PI) / 2);
    } else {
      out[i] = own;
    }
  }
  return out;
}

function normalize(samples) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  return Float32Array.from(samples, (s) => (s / peak) * PEAK);
}

function withOverlap(loop) {
  const n = loop.length;
  const out = new Float32Array(n + 2 * OVERLAP);
  out.set(loop.subarray(n - OVERLAP), 0);
  out.set(loop, OVERLAP);
  out.set(loop.subarray(0, OVERLAP), OVERLAP + n);
  return out;
}

/** A 32-bit float WAV file. */
function wav(samples) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(32, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return "ffmpeg";
  } catch {
    // not on PATH; try where winget puts it
  }
  const packages = join(process.env.LOCALAPPDATA ?? "", "Microsoft/WinGet/Packages");
  if (existsSync(packages)) {
    for (const pkg of readdirSync(packages).filter((d) => d.startsWith("Gyan.FFmpeg"))) {
      for (const build of readdirSync(join(packages, pkg))) {
        const exe = join(packages, pkg, build, "bin/ffmpeg.exe");
        if (existsSync(exe)) return exe;
      }
    }
  }
  throw new Error("ffmpeg not found: put it on PATH or set FFMPEG to its path");
}

function decode(ffmpeg, file) {
  const raw = execFileSync(
    ffmpeg,
    ["-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", String(RATE), "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

const dB = (x) => (x > 0 ? `${(20 * Math.log10(x)).toFixed(1)} dBFS` : "exact");

/** Largest and RMS difference between a and b over [from, to) of a, with b offset by shift. */
function diff(a, b, from, to, shift = 0) {
  let max = 0;
  let sum = 0;
  for (let i = from; i < to; i++) {
    const d = a[i] - b[i + shift];
    max = Math.max(max, Math.abs(d));
    sum += d * d;
  }
  return { max, rms: Math.sqrt(sum / (to - from)) };
}

const both = (...ds) => ({
  max: Math.max(...ds.map((d) => d.max)),
  rms: Math.sqrt(ds.reduce((s, d) => s + d.rms * d.rms, 0) / ds.length),
});

const show = ({ max, rms }) => `largest ${dB(max)}, RMS ${dB(rms)}`;

const ffmpeg = findFfmpeg();
const scratch = mkdtempSync(join(tmpdir(), "sound-loop-"));
try {
  for (const { name, seconds, make } of SOUNDS) {
    const n = seconds * RATE;
    const loop = normalize(make(n));
    const files = { plain: loop, overlap: withOverlap(loop) };
    for (const [kind, samples] of Object.entries(files)) {
      const source = join(scratch, `${name}-${kind}.wav`);
      const target = join(OUT, `${name}-${kind}.webm`);
      writeFileSync(source, wav(samples));
      execFileSync(ffmpeg, [
        "-v", "error", "-y", "-i", source,
        "-c:a", "libopus", "-b:a", BITRATE, "-ac", "1",
        "-map_metadata", "-1", "-fflags", "+bitexact", target,
      ]);
    }

    // Check: decode both files again and look at the join.
    const ms10 = RATE / 100;
    const overlap = decode(ffmpeg, join(OUT, `${name}-overlap.webm`));
    const plain = decode(ffmpeg, join(OUT, `${name}-plain.webm`));
    // Codec error over the loop away from its ends, for scale.
    const codec = diff(overlap, files.overlap, OVERLAP + 5 * ms10, OVERLAP + n - 5 * ms10);
    // With overlap: the sound just after loopEnd is what would naturally follow
    // the loop's end; it should match the sound at loopStart, where playback jumps.
    const seam = diff(overlap, overlap, OVERLAP - ms10, OVERLAP + ms10, n);
    const seamVsSource = both(
      diff(overlap, files.overlap, OVERLAP - ms10, OVERLAP + ms10),
      diff(overlap, files.overlap, OVERLAP + n - ms10, OVERLAP + n + ms10),
    );
    // Plain: how far its first and last 10 ms stray from the sound that was encoded.
    const plainEdges = both(diff(plain, loop, 0, ms10), diff(plain, loop, n - ms10, n));
    const step = (a, b) => Math.abs(a - b).toFixed(4);
    console.log(`${name}: loop ${seconds} s = ${n} samples`);
    console.log(
      `  files: overlap ${statSync(join(OUT, `${name}-overlap.webm`)).size} bytes, ` +
        `plain ${statSync(join(OUT, `${name}-plain.webm`)).size} bytes`,
    );
    console.log(
      `  decoded length: overlap ${overlap.length} (expected ${n + 2 * OVERLAP}), ` +
        `plain ${plain.length} (expected ${n})`,
    );
    const peak = (a) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    console.log(`  decoded peak: overlap ${dB(peak(overlap))}, plain ${dB(peak(plain))}`);
    console.log(`  codec error over the loop, away from its ends: ${show(codec)}`);
    console.log(`  overlap: sound around loopEnd vs around loopStart (+-10 ms): ${show(seam)}`);
    console.log(`  overlap: decoded vs source within 10 ms of both loop points: ${show(seamVsSource)}`);
    console.log(
      `  overlap: step at the jump ${step(overlap[OVERLAP + n - 1], overlap[OVERLAP])}, ` +
        `natural step there ${step(overlap[OVERLAP + n - 1], overlap[OVERLAP + n])}`,
    );
    console.log(`  plain: decoded vs source within 10 ms of its ends: ${show(plainEdges)}`);
    console.log(
      `  plain: step at the jump ${step(plain[n - 1], plain[0])}, ` +
        `natural step there ${step(loop[n - 1], loop[0])}`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
