# Tone mapping: what the walkthrough does, a contrast toe, and Gran Turismo 7's curve

Researched 2026-10-31, for whenever the author wants to change the look. Nothing was changed in the walkthrough. Sources are pinned so the line numbers stay valid:

- This repo at commit `4840abf`, written as `path:line`.
- three.js citations are to the installed package, `node_modules/three` version 0.186.1, relative to that folder.
- Polyphony Digital's sample code was read in full. Other pages are listed at the bottom, with how each was read.

How to read the claims in this note:

- A statement followed by a link or a path was **verified** in that source.
- **(computed)** means I worked the number out from a formula given here. The scripts are not kept; section 3 has what is needed to redo them.
- **(judgement)** means it is my inference, not something a source says. Everything about what will look better or cost more on a phone is judgement until measured on the Redmi Note 8.

## 1. Short answer

- **The walkthrough uses a formula, not a LUT:** Khronos PBR Neutral (`src/main.ts:52`), which every surface applies as it is drawn.
- **It already has a toe, and a strong one.** With midtones lined up, its shadows are darker and more contrasty than GT7's curve (section 3). Swapping in GT7's curve would lift the shadows, which is the opposite of adding a contrast toe.
- **To get more contrast, try widening our own toe first**, keeping Neutral's handling of colour. It adds one power function per pixel, one for each of red, green and blue, and no extra drawing step. **(judgement)**
- **GT7's real strength is how very bright colours behave**, and that is the expensive part: about 36 power-type operations per pixel where Neutral has none (section 4). It is the one to consider if lamps or bright skies are what look wrong. If so, precompute it into a small LUT and measure that on the Redmi. **(judgement)**
- **The video was not read.** What Threat Interactive says at 1h05 to 1h19 is missing from this note (section 7). The author's reason for asking is that the video praises GT7's tone mapper and discusses a contrast toe.

## 2. How it works today

### Where the curve is applied

There is no full-screen step at the end. Each surface tone maps itself as it is drawn straight to the canvas, in this order (`src/occlusion.ts:519-538`):

1. Sky and solid surfaces, each tone mapped in its own shader.
2. The darkening of ambient occlusion, multiplied over those finished colours (`src/occlusion.ts:530`).
3. Lamps, glass and water (`src/occlusion.ts:332`).

Materials from three.js get this automatically. Grass and props do it by hand through `#include <tonemapping_fragment>` (`src/scatter.ts:449`, `src/props.ts:183`). Those includes all follow whichever curve the renderer is set to.

Water does not tone map (`toneMapped: false`, `src/water.ts:173`). It reflects the sky picture, which already holds the curve.

The sky picture is an ordinary JPEG written by `npm run optimize`, with the curve applied to it by a hand copy of the formula (`scripts/optimize-environments.mjs:1272-1286`). three.js does not tone map an sRGB background a second time (`src/renderers/webgl/WebGLBackground.js:151`, `:208`).

### What the curve does

The formula is `NeutralToneMapping` (`src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js:170-197`). It has three parts:

- **Toe.** It takes the darkest of red, green and blue, called `x`, and subtracts an offset from all three: `x - 6.25x²` when `x` is below 0.08, otherwise a flat 0.04. So the darkest channel becomes `6.25x²` down in the darks, which is a real toe, reaching only as far as 0.08.
- **Middle.** Between that and about 0.8 brightness passes through, 0.04 lower. This is why material colours stay true.
- **Shoulder.** Above that it rolls off towards white, fading the colour by a small amount (`Desaturation = 0.15`).

The exposure control, `renderer.toneMappingExposure`, stays at three.js's default of 1: nothing in `src/` sets it.

## 3. The curves compared

Neutral against GT7's curve and no curve at all, for a neutral grey, as the 0 to 255 values sent to the screen after sRGB encoding **(computed)**:

| Scene brightness | No curve | Neutral | GT7 |
| --- | --- | --- | --- |
| 0.005 | 16 | 1 | 6 |
| 0.01 | 25 | 2 | 14 |
| 0.02 | 39 | 8 | 26 |
| 0.04 | 56 | 25 | 45 |
| 0.08 | 80 | 56 | 73 |
| 0.18 | 118 | 105 | 117 |
| 0.5 | 188 | 181 | 187 |
| 0.8 | 231 | 226 | 221 |
| 1 | 255 | 240 | 236 |
| 2 | 255 | 250 | 255 |
| 4 | 255 | 253 | 255 |
| 10 | 255 | 254 | 255 |

Contrast, as the slope on a log-log graph, where 1 means unchanged and higher means more contrast **(computed)**:

| Range | Neutral | GT7 |
| --- | --- | --- |
| 0.01 to 0.04, deep shadows | 2.00 | 1.31 |
| 0.04 to 0.18, shadows | 1.75 | 1.28 |

How to read them:

- **Our shadows are deeper than GT7's at every step below 0.5.** Neutral also darkens the midtones a little, 105 against 117 at 0.18.
- **GT7 reaches full white at a scene brightness of about 1.47** with this exposure **(computed)**. Neutral approaches white and never quite arrives.
- **The comparison depends on one choice of mine: an exposure of 2.5 for GT7.** Its SDR mode divides the result by 2.5 (`sdrCorrectionFactor_`, line 386), so multiplying the input by 2.5 first lines the midtones up. A lower exposure makes everything darker, GT7 included.
- **Greys only.** With no colour in the input, GT7's colour handling does nothing, so the curve alone gives its result. No coloured values were compared.

To redo the numbers, with `x` as the scene brightness:

- **Neutral:** the formula in section 2.
- **GT7:** `curve(2.5x) / 2.5`, capped at 1, with the curve from section 4 and a peak of 2.5.

## 4. What GT7's operator is

Polyphony Digital published a sample in C++ under the MIT licence, so it may be ported if the copyright notice stays with it ([source][gt7-code]). Line numbers below are to that file.

**The curve** (`GTToneMappingCurveV2`, lines 97-148), with the settings from line 347: peak 2.5 in SDR, alpha 0.25, mid point 0.538, linear section 0.444, toe strength 1.28.

- **Below 1.11** (linear section × peak): `weight × x + (1 - weight) × mid × (x / mid)^1.28`, where `weight` is a smoothstep from 0 to the mid point. This is the toe, fading out by the mid point.
- **From 1.11 up:** the shoulder, `kA + kB × exp(x × kC)`, with `k = (0.444 - 1) / (0.25 - 1)`, `kA = peak × (0.444 + k)`, `kB = -peak × k × exp(0.444 / k)` and `kC = -1 / (k × peak)`.

The toe strength is the single setting that controls it, which makes this a clean model for a toe of our own. The toe's slope of about 1.3 is gentler than Neutral's 2.

**The colour handling** (`applyToneMapping`, lines 396-429):

1. Run the curve on red, green and blue separately. The source calls this the "skewed" colour, because doing this shifts hues in bright colours.
2. Convert both the original and the skewed colour to ICtCp, a colour space that separates brightness from colour.
3. Build a second result: brightness from the skewed colour, colour from the original, faded out as it nears the display's peak (`fadeStart_` 0.98, `fadeEnd_` 1.16).
4. Blend the two, 60% the second and 40% the skewed (`blendRatio_`, line 350).

Input is linear Rec. 2020 (line 390). Our colours are linear sRGB, so a port needs a conversion first and a conversion back.

**Its cost per pixel (computed, from counting the source):** six conversions into ICtCp at four operations each (a power, two logarithms, an exponential), three conversions back at two powers each, and three curves at a power and an exponential each. That is **about 36 power-type operations per pixel**, where Neutral has none. Phone costs are not measured.

## 5. What could be done

| Option | Extra work per pixel | What it changes | Notes |
| --- | --- | --- | --- |
| **A. Leave it** | None | Nothing | Already looks good to the author |
| **B. Widen Neutral's toe** | One power per channel | Deeper shadows and lower midtones, with colour handling unchanged | **Recommended first try** |
| **C. GT7's curve alone** | Six operations | Lifts shadows, gives a different shoulder | Skews hues in bright colours, which is what GT7's blend exists to soften |
| **D. All of GT7, live** | About 36 operations | Lifts shadows and changes how bright colours behave | Too costly to use untested: the stress copy has no margin |
| **E. All of GT7, precomputed into a small LUT** | One texture read | As D, approximately | The affordable way to D, if it holds up; check for banding |
| **F. A full-screen pass at the end** | A whole extra drawing | A true final grade | Against it: it gives up the cheap canvas anti-aliasing and needs floating-point pictures (`docs/research/ambient-occlusion.md:38`) |

All judgement except the counts in section 4.

**How to plug in a curve.** three.js has a slot for it: `CustomToneMapping` (`src/constants.js:465`), an empty function in the shared shader text (`tonemapping_pars_fragment.glsl.js:199`) to replace before any material compiles. This was read, not run. Only `toneMappingExposure` is a ready-made shared value there (`:7`), so a live slider in `?config` needs its value passed some other way, or a recompile on each change.

## 6. What has to change together

The curve is one decision spread over several places (also listed in #37):

1. `renderer.toneMapping` in `src/main.ts:52`.
2. The hand copy for the sky in `scripts/optimize-environments.mjs:1272`, followed by `npm run optimize`. Sky pictures hold the curve, so a live slider will not move the sky.
3. Water follows through the sky picture, once step 2 is done.
4. Check by eye:
   - **Glass and water reflections:** their `pow(…, 1.25)` correction was tuned over today's colours (`src/environment.ts:223`, `src/water.ts:154`).
   - **Ambient occlusion:** it multiplies finished colours, so a stronger toe also deepens it. Its strength may need lowering.
5. Compare lamps with Rhino's Raytraced view again. ADR 0005 records them matching by eye on 2026-10-25. A new curve does not contradict that decision, but it does reopen the comparison.
6. Measure on the Redmi Note 8 with the safety net off. The stress copy held exactly 30 fps, the very limit (`docs/plan.md:254`).

No new bake should be needed: neither `scripts/bake.py` nor `scripts/bake.mjs` has any tone curve setting, only `SKY_EXPOSURE`, so baked light is stored before any curve. This was read from the scripts, not tested with a bake.

## 7. Open questions and things I could not verify

- **The video's argument.** Only the title of the page could be read: "Tutorial: How To Optimize Almost Every Step In Modern Game Rendering" ([video][video]). An attempt to fetch its captions was blocked and not pursued. So this note does not know what "contrast toe" means there, or why GT7 is praised. The author's transcript or summary of 1h05 to 1h19 would settle whether option B is what the video means.
- **Polyphony's slides were not read** ([slides][gt7-slides]), only the sample code. Their reasoning, and any costs they state, may add to section 4. The code is what ships as the sample, and may differ from the game.
- **No picture was made.** No curve has been tried in the walkthrough. The tables say what the numbers do, not whether anyone prefers them. The next step would be a side-by-side at `?at=42,-8,30,1.2` (inside the pavilion) and at the start spot.
- **Coloured values were not compared**, so the claim that GT7 handles bright colours better rests on the source's design and not on a test here.
- **Whether a small LUT is really cheaper on the Redmi** is unmeasured, as is what any option costs there.
- **Other users of the curve**, seen in search results only and not read: BeamNG.drive 0.39 adopted it in place of ACES ([GTPlanet][beamng]), and Filament is listed with a `GT7ToneMapper` ([docs][filament]).

## Sources

- [Polyphony Digital, GT7 tone mapping sample code, version 1.0, MIT][gt7-code]: read in full.
- [SIGGRAPH 2025 Physically Based Shading course page][course]: "Driving Toward Reality: Physically Based Tone Mapping and Perceptual Fidelity in Gran Turismo 7", by Kenichiro Yasutomi, Kentaro Suzuki and Hajime Uchimura. Read through a summarising fetch.
- [The talk's slides][gt7-slides]: not read.
- [The video][video]: title only.
- [GTPlanet on BeamNG.drive][beamng] and [Filament's tone mapper docs][filament]: search results only.

[gt7-code]: https://blog.selfshadow.com/publications/s2025-shading-course/pdi/supplemental/gt7_tone_mapping.cpp
[course]: https://blog.selfshadow.com/publications/s2025-shading-course/
[gt7-slides]: https://blog.selfshadow.com/publications/s2025-shading-course/pdi/s2025_pbs_pdi_slides_v1.1.pdf
[video]: https://www.youtube.com/watch?v=SnNm7rSSvlg
[beamng]: https://www.gtplanet.net/beamng-drive-is-using-gran-turismo-7s-hdr-tone-mapping-technology-20260803/
[filament]: https://www.mintlify.com/google/filament/api/tone-mapper
