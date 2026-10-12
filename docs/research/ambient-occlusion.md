# Screen-space ambient occlusion: MXAO, Amplify Occlusion and what three.js already ships

This is the first note in `docs/research/`, the new home for research findings in this repo.

Researched 2026-10-11. Sources are pinned so the line numbers stay valid:

- iMMERSE at commit [`f57d3af`][imm], qUINT at [`98fed77`][quint], Amplify Occlusion at [`cd49e07`][amp], N8AO at [`0fc1555`][n8].
- three.js citations are to the installed package, `node_modules/three` version 0.186.1, written as `path:line`.
- Papers: Jimenez et al., "Practical Real-Time Strategies for Accurate Indirect Occlusion" ([GTAO paper][gtao-paper]); Therrien et al., "Screen Space Indirect Lighting with Visibility Bitmask" ([arXiv 2301.11376][vb-paper]).

Statements marked **(judgement)** are my reading, not something a source says. Effort estimates are all judgement.

## Summary

Both candidates are horizon-based GTAO implementations of the same 2016 Jimenez paper. three.js r186 already ships that algorithm for `WebGLRenderer` as `GTAOPass`, citing the same paper. Neither candidate needs porting to get the algorithm.

MXAO cannot be ported at all: its licence forbids using its source in another project without the author's permission. Amplify Occlusion is MIT and can be ported, but the only things it has that `GTAOPass` lacks are engineering (half-resolution with depth-aware upsample, a cheaper blur, a temporal filter), not a different algorithm.

| | MXAO (iMMERSE, current) | MXAO (qUINT, old) | Amplify Occlusion 2 | three.js `GTAOPass` | N8AO |
|---|---|---|---|---|---|
| Family | GTAO by default; visibility bitmask optional | Obscurance-style spiral sampler by default; GTAO optional | GTAO | GTAO | Hemisphere-kernel SSAO |
| Paper named in source | Jimenez 2016; Therrien 2023 | "Ground Truth Ambient Occlusion by Activision" for the optional mode only | Jimenez 2016 | Jimenez 2016; Mayaux HBIL 2018 | None (credits list tutorials) |
| Inputs | Depth; normals rebuilt from depth | Depth; normals rebuilt from depth; colour if indirect light is on | Depth; normals from depth, Unity depth-normals or G-buffer; motion vectors optional | Depth and a normal buffer from a second scene render | Depth of the beauty render; normals rebuilt from depth |
| Samples per pixel | 8 to 320 in seven tiers | 4 to 255 | 8, 12, 24 or 40 | 36 depth taps at the default setting | 8, 16 or 64 |
| Half resolution | Checkerboard "shading rate" over frames, not a smaller buffer | Render scale 0.5 to 1.0 | Yes, with depth-aware upsample | No | Yes, with depth-aware upsample |
| Temporal | Only in the upscaler mode, needs optical flow | No | Yes, optional | No | Only while the camera is still |
| Colour bleeding | No | Optional coarse indirect light | No (tint only) | No | No (tint only) |
| Multi-bounce | No | No | No | No | No |
| Licence | All rights reserved; reuse needs permission | All rights reserved; no licence file | MIT | MIT | CC0 |
| Can the code go in this repo? | No | No | Yes | Already installed | Yes |

### Recommendation

1. **Do not port either candidate.** MXAO is legally off the table. Amplify is the same algorithm three.js already has.
2. **Before any screen-space work, check whether a denser bake gets the "crisp" look.** Nothing in an environment moves ([ADR 0002][adr2]), so all ambient occlusion here is static and Cycles already bakes it. More lightmap texels cost download size but no frame time. **(judgement)**
3. **If screen-space AO is still wanted, prototype with `GTAOPass` behind a URL flag**, tuned as contact-only (small radius, reduced intensity), and measure it on an old phone before deciding anything. Compare against N8AO in the same prototype, because N8AO avoids the second scene render and has a half-resolution mode, which are the two things most likely to matter on phones.
4. **If `GTAOPass` looks right but is too slow**, borrow Amplify's half-resolution and bilateral-upsample design (MIT) into a custom pass. That is the one place Amplify's code is worth reading closely.
5. **Expect to keep it off by default on phones.** Every option adds at least two full-screen passes and floating-point render targets, removes the cheap canvas MSAA, and changes how the sky is tone mapped (see "Project-specific concerns"). **(judgement)**

## Outcome and an option kept open

Added 2026-10-12, after both were built and compared by eye in the test environment.

**What is in use.** N8AO, preferred for its look over `GTAOPass`, which stays selectable (`method` in the environment's settings file). Only N8AO's sampling and smoothing run. The scene is still drawn straight to the canvas and the darkening is multiplied on top ([src/occlusion.ts][occlusion], [src/n8.ts][n8-ours]), which keeps canvas MSAA, the tone mapping and the sky as they were, and avoids every problem in "Leaving direct-to-canvas rendering" below. The price is that N8AO's one-scene-render advantage (recommendation 3) is not had: the canvas's depth cannot be read, so the scene is drawn a second time for depth, with a trivial material and at half the width and height. A denser bake (recommendation 2) was ruled out: longer bakes and a bigger download.

**Measured.** The chunk holding N8AO is 160 kB minified, 84 kB compressed; of the `postprocessing` peer dependency only the `Pass` base class is imported. Viewers download it while the environment loads.

**Edge-aware upscaling.** N8AO's half-resolution mode with depth-aware upsampling is wired up (`edges` in the settings file) and looks clearly better: no speckle, and the darkening stops at edges. It is off because it needs the depth drawing at twice the size, four times the pixels, plus one more full-screen pass, which was judged too costly.

**The option kept open: draw the scene once, off screen, with a full-size depth texture.** This is the stock N8AO arrangement. It was judged not worth it now, since the second drawing is cheap for this environment while the costs are certain: canvas MSAA is lost, tone mapping moves to a final pass and the sky picture gets tone mapped twice, the sparing of sunlit surfaces has to get the baked light's brightness another way (a second render target output, say), and every pixel pays for an off-screen target and a copy to the canvas. Two things would change that judgement:

- **A large environment**, where drawing the geometry twice shows in the frame rate.
- **A later effect that needs a full-size depth texture anyway.** The off-screen scene target would then be paid for once and shared, and edge-aware upscaling would come almost free, as its full-size depth is the expensive part today.

Both were reasoned from source and from frame rates seen while tuning; neither route's cost was measured against the other. **(judgement)**

## Candidate 1: MXAO

There are two different shaders with this name.

### Which one the page describes

The page at <https://www.martysmods.com/mxao/> describes the current iMMERSE version: it names "visibility bitmasking" with a link to [arXiv 2301.11376][vb-paper], and its download button points at the iMMERSE repository. The page lists no settings, performance figures or licence terms; it carries only a "© Copyright 2025 MARTY'S MODS. All rights reserved." notice. (Read through a summarising fetch, not verbatim.)

The iMMERSE README says the same thing in the author's words: "iMMERSE MXAO is the successor of the qUINT MXAO effect", using "the state of the art Ground Truth Ambient Occlusion algorithm by [Jimenez et al., 2016]" and "as of recent, Screen Space Indirect Lighting with Visibility Bitmask" ([README.md L29][imm-readme]).

### iMMERSE MXAO (current)

Source: [`Shaders/MartysMods_MXAO.fx`][imm-mxao].

**Algorithm.** Horizon-based, sliced around the view vector. A compile-time switch picks one of four integrators ([L120-L123][imm-mxao-types]):

- `0`: "Ground Truth Ambient Occlusion (high contrast, fast)", the default ([L41-L43][imm-mxao-default]).
- `1`: "Solid Angle (smoother, fastest)".
- `2`: "Visibility Bitmask (DX11+ only, highest quality, slower)".
- `3`: "Visibility Bitmask w/ Solid Angle".

The GTAO branch tracks a maximum horizon cosine per side and evaluates the Jimenez cosine-weighted arc integral per slice ([L571-L576][imm-mxao-horizon], [L596-L600][imm-mxao-integral]). The bitmask branch converts each sample's front and back angles into a run of bits in a 32-sector field and counts the unset bits ([L343-L362][imm-mxao-bits], [L578-L590][imm-mxao-vb]). That is the Therrien technique, which "replaces the two horizon angles by a bit field representing the binary state (occluded / un-occluded) of N sectors" so that light can "pass behind surfaces of constant thickness" ([abstract][vb-paper]).

What the author says he changed relative to the papers: "a better horizon falloff term than baseline GTAO" and a cosine term in the bitmask version ([README.md L29][imm-readme]). Both are visible in source: the falloff blends each sample toward the lowest horizon by `1/(1 + d²·k)` ([L574-L575][imm-mxao-horizon]), and mode 2 warps sector positions with a smoothstep described as approximating "inverse transform sampling for cosine lobe" ([L586-L589][imm-mxao-vb]).

**Inputs.** Depth only. Normals are rebuilt from depth with four weighted cross products, "similar system to Intel ASSAO/AMD CACAO/XeGTAO" ([L288-L318][imm-mxao-normals]). Optionally it reads normals from the separate Launchpad shader, which the tooltip calls "far slower" ([L126-L128][imm-mxao-types]). Motion vectors are used only when the `_MARTYSMODS_TAAU_SCALE` upscaler mode is defined, and they come from Launchpad's optical-flow estimator ([L722-L776][imm-mxao-temporal], [L855-L858][imm-mxao-passes]). No colour input is used for lighting; colour is read only to composite.

**Passes** ([L831-L863][imm-mxao-passes]):

1. Depth is linearised and deinterleaved into tiles (a cache optimisation). Compute shader on D3D11 and up, pixel shader otherwise.
2. AO, as a compute shader or as two pixel-shader passes.
3. A filter pass. It fits AO against depth by linear regression over a 4×4 neighbourhood read with four gathers ([L685-L713][imm-mxao-filter]). In upscaler mode this is replaced by a temporal accumulation pair.
4. A final filter-and-composite pass to the back buffer.

**Sample counts.** Seven presets given as slices × steps: 2×2, 2×4, 2×10, 3×12, 4×14, 6×16, 8×20, which the source totals as 8, 16, 40, 72, 112, 192 and 320 samples ([L229-L239][imm-mxao-presets]). Default is "Medium", 16 ([L53-L59][imm-mxao-ui]).

**Half resolution.** There is no reduced-size buffer. "Shading Rate" renders all, half or a quarter of the pixels each frame in a checkerboard keyed to the frame counter, default half ([L61-L67][imm-mxao-ui], [L364-L373][imm-mxao-bits]). The un-rendered pixels keep the previous frame's value, so this is a temporal trade, not a spatial one.

**Other features.**

- Thickness: bitmask modes use `T = log(1 + radius) / 3`, commented "arbitrary thickness that looks good relative to sample radius" ([L521][imm-mxao-thickness]). GTAO mode has no thickness term.
- Distance fade: a fixed fade to zero at far depth times an exponential fade set by "Fade Out Distance" ([L332-L337][imm-mxao-fade]).
- Radius: world-space by default, optional screen-space ([L509-L517][imm-mxao-thickness]).
- No multi-bounce, no bent normals, no indirect light (no such code in the file).
- Compositing: multiplies the whole image. Because ReShade only sees the finished frame, it squares the colour, applies an inverse tone curve, multiplies by AO, then reverses both ([L799-L805][imm-mxao-composite]). It cannot restrict AO to ambient light.

**Performance.** No figures anywhere I could find. The README claims it is "faster than reference implementations such as XeGTAO" without numbers ([README.md L31][imm-readme]). The guide says only that higher quality and filter settings cost more (<https://guides.martysmods.com/shaders/immerse/mxao>, read through a summarising fetch).

### qUINT MXAO (old)

Source: [`Shaders/qUINT_mxao.fx`][quint-mxao], last repository commit 2023-07-22.

**Algorithm.** Two different ones behind a compile-time switch.

- Default: a single spiral of taps around the pixel, each contributing `saturate(1 + falloff·d²) · saturate(cosθ − bias)`, reading coarser depth mips for farther taps ([L388-L452][quint-ao]). The file titles itself "Ambient Obscurance with Indirect Lighting" ([L10][quint-header]) and names no paper for this mode. It resembles scalable ambient obscurance, but that attribution is mine. **(judgement)**
- `MXAO_HIGH_QUALITY=1`: "a different, more physically accurate but slower SSAO mode. Based on Ground Truth Ambient Occlusion by Activision" ([L42-L44][quint-defines]). The code is the Jimenez horizon search and arc integral ([L454-L571][quint-hq]).

**Inputs and passes** ([L651-L705][quint-passes]): one setup pass copies colour, linear depth and depth-derived normals into mip-mapped textures ([L178-L180][quint-tex], [L356-L375][quint-setup]); a stencil pass masks out sky and pixels too far for the radius to cover a pixel; the AO pass; two edge-aware blur passes weighted by depth and normal, the second of which composites ([L255-L305][quint-blur], [L573-L635][quint-blend]).

**Sample counts.** 4, 8, 16, 24, 32, 64, 255 or automatic ([L53][quint-ui]).

**Features.** Render scale from 0.5 to 1.0 ([L78-L84][quint-ui]). Optional indirect light, described in the README as "a coarse first bounce of light similar to SSDO" ([README.md L26][quint-readme]), sampled from a mip-mapped copy of the frame ([L428-L439][quint-ao]). Optional two-layer mode computing coarse and fine radii on alternating pixels ([L38-L40][quint-defines]). Optional normal smoothing. Four blend modes, all applied to the finished frame and attenuated by pixel brightness ([L602-L621][quint-blend]). Distance fade between two depths ([L600][quint-blend]).

### What changed from qUINT to iMMERSE

- Default algorithm went from the spiral obscurance sampler to GTAO; GTAO was previously opt-in. Visibility bitmasks were added.
- Indirect lighting, the two-layer mode and the blend-mode choices were removed.
- Mip-mapped depth sampling was replaced by deinterleaved depth.
- The two-pass depth-and-normal bilateral blur was replaced by the regression filter.
- Compute-shader paths and an upscaler-aware temporal mode were added.
- The licence went from a bare copyright line to an explicit restrictive licence file.

### Licence

**iMMERSE: study only, do not port.** The repository licence ([LICENSE][imm-license]) begins "Copyright (c) Pascal Gilcher. All rights reserved." and the clause that decides it is section 4:

> Using parts of this projects source code as part of another, original project requires explicit permission from this projects author. Furthermore this project, its author and the parts used have to be clearly credited. Additionally any means of monetization or commercial usage on this modified version are prohibited unless explicit permission is given.

Section 1 adds: "Public propagation of this project or parts of it is strictly forbidden." Section 3: "Public redistribution of a modified version of this project is forbidden, unless explicit permission is given." The shader file's own header is stricter still: "Unauthorized copying of this file, via any medium is strictly prohibited" and "Proprietary and confidential" ([MartysMods_MXAO.fx L12-L15][imm-mxao-header]). A translated port is a modified version of part of the project, so it needs the author's written permission and could not be relicensed as MIT. **(judgement on the last clause; the quoted text is the source.)**

**qUINT: no licence granted.** The repository has no licence file. The README's licence section is one line, "Copyright (c) Pascal Gilcher / Marty McFly. All rights reserved." ([README.md L34-L37][quint-readme]), repeated in the shader header ([L14][quint-header]). With no grant, there is no right to copy or adapt it.

The algorithms themselves come from published papers and are free to implement from those papers. Only the code is restricted.

### Portability to WebGL2

Moot given the licence, but for the record, what the iMMERSE shader leans on:

- **Compute shaders** for its fast path ([L836-L848][imm-mxao-passes]), enabled only on D3D11 and newer ([mmx_global.fxh L33-L36][imm-global]). WebGL 2 "is derived from OpenGL ES 3.0" ([WebGL 2 spec][webgl2]), which has none. The shader does carry a pixel-shader fallback.
- **`textureGather`** throughout the filter. It is GLSL ES 3.10 only ([Khronos reference][gather]); WebGL2 needs four `texelFetch` calls instead.
- **`countbits`** for the bitmask. GLSL ES 3.00 has integer bitwise operators but `bitCount` is 3.10 only ([Khronos reference][bitcount]), so a hand-written popcount is needed.
- **ReShade services**: depth-buffer linearisation settings, the frame counter, the blue-noise texture, and Launchpad for normals and optical flow.

## Candidate 2: Amplify Occlusion

Source: <https://github.com/AmplifyCreations/AmplifyOcclusion>, a Unity built-in-pipeline image effect. Deprecated and unsupported: "It is now deprecated and we no longer support it, so we are releasing it to open-source world under the MIT License" ([README.md L33-L35][amp-readme]).

### Algorithm

**Yes, it is the Jimenez GTAO implementation.** The README says version 1 was HBAO (Bavoil, Sainz, Dimitrov 2008) and version 2, the one in the repository, is "GTAO ... based on a 2016 paper titled 'Practical Realtime Strategies for Accurate Indirect Occlusion' by Jorge Jimenez, Xian-Chun Wu, Angelo Pesce and Adrian Jarabo" ([README.md L22-L29][amp-readme]). The shader confirms it line by line, with comments citing the paper and its SIGGRAPH 2016 slide deck:

- Horizon search with the paper's attenuation, quoting it: "Our attenuation function is a linear blending from 1 to 0 from a given, large enough distance, to the maximum search radius. GTAO - Page 4" ([GTAO.cginc L170-L177][amp-gtao-steps]).
- The paper's thin-occluder heuristic, as a decay of the running horizon ([L177][amp-gtao-steps]).
- Normal projected onto the slice plane, horizons clamped to the normal's hemisphere, and the closed-form inner integral, each with a slide reference ([L330-L354][amp-gtao-integral]).
- The paper's 4×4 spatial offsets and "Interleaved Gradient Noise" for per-pixel directions, plus temporal rotation ([CommonFunctions.cginc L141-L166][amp-noise], [GTAO.cginc L278-L283][amp-gtao-main]).

One departure: a "wallDarkeningCorrection" term added to each slice weight, which is not in the paper ([GTAO.cginc L298-L299, L354][amp-gtao-main]).

It implements only the paper's ambient occlusion. The paper's multi-bounce fit, directional (spherical-harmonic) occlusion and specular occlusion are absent; there is no bent-normal or bounce code in the shader folder.

### Inputs

- Depth, from Unity's camera depth texture ([Common.cginc L70-L72][amp-common]).
- Normals, from one of four sources chosen in the inspector: rebuilt from depth, Unity's depth-normals texture, or the deferred G-buffer in two encodings ([GTAO.cginc L68-L105][amp-gtao-normals], [AmplifyOcclusionEffect.cs L33-L49][amp-cs-settings]). The default is the camera depth-normals texture.
- Motion vectors, only when the temporal filter is on ([AmplifyOcclusionEffect.cs L628-L642][amp-cs-depthmode]).
- No colour input.

### Passes

All in [`Occlusion.shader`][amp-occlusion], [`Blur.shader`][amp-blur] and [`Apply.shader`][amp-apply], driven by Unity command buffers:

1. Optional depth mip chain ("Cache Aware"): repeated 2×2 nearest-depth downsamples copied into mip levels ([AmplifyOcclusionEffect.cs L821-L861][amp-cs-compute], [OcclusionFunctions.cginc L150-L170][amp-funcs]). Farther taps read coarser mips ([GTAO.cginc L154-L159][amp-gtao-steps]).
2. AO, at full or half resolution, writing occlusion and depth to a two-channel half-float target ([AmplifyOcclusionEffect.cs L282, L863-L907][amp-cs-compute]).
3. Optional separable cross-bilateral blur, radius 1 to 4 pixels, repeated 1 to 4 times ([Blur.shader L22-L44][amp-blur], [AmplifyOcclusionEffect.cs L105-L118][amp-cs-settings]).
4. If half resolution: a depth-weighted four-tap upsample back to full size ([OcclusionFunctions.cginc L22-L70][amp-funcs]).
5. Optional temporal filter with variance clipping after Salvi 2016, with and without motion vectors ([TemporalFilter.cginc L88, L294][amp-temporal], [Occlusion.shader L88-L90][amp-occlusion]).
6. Apply.

### Sample counts and performance

Four tiers, given as directions and samples per direction: 2×4, 2×6, 3×8, 4×10 ([Occlusion.shader L24-L46][amp-occlusion]). The step loop takes half that count and reads both sides each step ([OcclusionFunctions.cginc L16][amp-funcs], [GTAO.cginc L199-L209][amp-gtao-steps]), so depth taps per pixel are 8, 12, 24 and 40. Default is Medium ([AmplifyOcclusionEffect.cs L45-L46][amp-cs-settings]).

Stated performance: "Up to 2X faster than Amplify Occlusion 1.0" and "Under 1 ms on a mid-range GPU at Full HD" ([README.md L51, L55][amp-readme]). No GPU is named and no mobile figure is given. For comparison the paper reports its baseline "in just 0.5 ms on a PS4 at 1080p (for a standard halfres occlusion buffer)", relying on one direction per pixel spread over a 4×4 neighbourhood and six frames ([GTAO paper][gtao-paper], figure 1 caption and "Spatio-temporal sampling approach").

### Features

- **Half resolution**: `Downsample`, on by default, with the depth-aware upsample above ([AmplifyOcclusionEffect.cs L73-L74][amp-cs-settings]).
- **Thickness**: the paper's heuristic, exposed as a 0 to 1 slider.
- **Distance fade**: intensity, radius, power, thickness and tint each interpolate to a far value between a start distance and a length ([AmplifyOcclusionEffect.cs L79-L103][amp-cs-settings], [GTAO.cginc L108-L121][amp-gtao-normals]).
- **Tint**, power exponent and intensity ([CommonFunctions.cginc L55-L75][amp-calc]). Tint is a flat colour, not sampled colour bleeding.
- **No multi-bounce, no colour bleeding, no bent normals.**
- **How AO is applied.** Two modes ([AmplifyOcclusionEffect.cs L26-L43][amp-cs-settings]):
  - *Post Effect*: multiplies the frame, `Blend DstColor Zero` ([Apply.shader L309-L312][amp-apply]). Darkens everything, direct light included.
  - *Deferred*: runs before Unity's lighting or reflections ([AmplifyOcclusionEffect.cs L688-L691][amp-cs-events]) and multiplies the G-buffer's emission target and the alpha of the albedo target ([Apply.shader L91-L126, L280-L283][amp-apply]). This is the README's "PBR compatible injection mode". In Unity those are where ambient light and material occlusion live, so direct light is left alone; I did not verify the Unity G-buffer layout from Unity's own documentation.

### Licence

**MIT. It can be ported.** The licence file is the standard MIT text, "Copyright (c) 2023 Amplify Creations", granting the rights "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software" on the condition that "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software." ([LICENSE][amp-license]). A port must carry that notice.

One inconsistency: a leftover text file from the commercial era still says "Amplify Occlusion (c) Amplify Creations, Lda. All rights reserved." and "Redistribution of Amplify Occlusion is frowned upon" ([Assets/AmplifyOcclusion/Readme.txt L3-L7][amp-readme-txt]). The root licence file and the README's explicit statement are later and specific, so I read MIT as governing. **(judgement)**

### Portability to WebGL2

Nothing in the AO maths is beyond GLSL ES 3.00: no compute shaders, no gather, and the mobile branch already avoids integer bit operations ([CommonFunctions.cginc L153-L158][amp-noise]). The work is replacing Unity:

- Depth texture, depth-normals texture, G-buffer and motion-vector texture are all Unity services. This project would supply depth from a render target and rebuild normals from depth (the shader's `NORMALS_NONE` path).
- `LinearEyeDepth`, `Linear01Depth`, stereo macros and reversed-Z handling need rewriting.
- Command buffers become a three.js `Pass`.
- The depth mip chain is possible in WebGL2 by rendering into mip levels, but Amplify itself turns "Cache Aware" off on OpenGL ES 2 and 3 ([AmplifyOcclusionEffect.cs L342-L346][amp-cs-cache]), and the shader excludes ES 2 outright ([Occlusion.shader L10][amp-occlusion]). The README's "All platforms" should be read with that in mind.
- The temporal filter with motion vectors has no equivalent here. A static scene could reproject from the camera matrices alone, which is extra work.

Effort **(judgement)**: three to five days for AO, bilateral blur and half-resolution upsample as a three.js pass; several more for the temporal filter. The result would be a faster `GTAOPass`, not a different look.

## What three.js r186 already ships

### `GTAOPass` (WebGLRenderer)

**Same algorithm family as both candidates.** The shader's header cites the Jimenez paper and Mayaux's "Horizon-Based Indirect Lighting (HBIL)" (`examples/jsm/shaders/GTAOShader.js:17-19`).

- **Algorithm.** Slices around the view vector, a horizon cosine per side, then the cosine-weighted arc integral (`GTAOShader.js:205-246`). Not a line-for-line copy of the paper: "thickness" is a hard cut-off that ignores samples whose depth differs by more than the value (`:225`), not the paper's heuristic, and falloff is a per-step blend (`:227`).
- **Inputs.** Depth and view-space normals. By default it renders the whole scene a second time with a `MeshNormalMaterial` override into its own half-float target with a depth texture (`examples/jsm/postprocessing/GTAOPass.js:161`, `:314-323`, `:502-508`). The shader can instead rebuild normals from depth (`GTAOShader.js:120-140`, `:142-150`).
- **Samples.** `SAMPLES` defaults to 16 (`GTAOShader.js:30`), split into 3 directions of 6 steps, each step reading both sides (`:202-203`, `:219-236`): 36 depth taps per pixel, plus normal, noise and centre depth.
- **Denoise.** One full-screen "Poisson denoise" pass, 16 taps, each reading AO, depth and normal and weighted by luminance, depth-plane distance and normal similarity (`examples/jsm/shaders/PoissonDenoiseShader.js:149-166`, `:187-192`; `GTAOPass.js:138`, `:175-178`).
- **Compositing.** Copies the frame, then multiplies it by `mix(1, ao, intensity)` using `DstColor × src` blending (`GTAOPass.js:205-219`, `:571-581`; `GTAOShader.js:343`). Everything is darkened; there is no ambient-only mode. Sky pixels are skipped (`GTAOShader.js:163-172`).
- **Extra cost per frame.** One additional full scene render, then four full-screen passes (AO, denoise, copy, blend), into two half-float RGBA targets (`GTAOPass.js:143-144`). The composer adds the output pass on top.
- **Missing.** No half-resolution option, no temporal accumulation, no multi-bounce, no colour. The class comment says only that it "provides better quality than SSAOPass but is also more expensive" (`GTAOPass.js:32`); no timings are given.

**A defect worth knowing about.** The documented way to skip the second scene render is to pass your own depth texture (`GTAOPass.js:297-303`). In 0.186.1 that throws. `setGBuffer` ends with `this.depthRenderMaterial.uniforms.tDepth.value = this.normalRenderTarget.depthTexture` (`:341`), and `normalRenderTarget` is only created in the other branch. I confirmed it by constructing the pass in Node with `{ depthTexture: new DepthTexture(64, 64) }`: "Cannot read properties of undefined (reading 'depthTexture')". `setSize` has the same assumption (`:253`). Using an external depth buffer therefore means subclassing or patching the pass.

### `SAOPass` and `SSAOPass` (WebGLRenderer)

- `SAOPass`: "A SAO implementation inspired from @bhouston previous SAO work" (`examples/jsm/postprocessing/SAOPass.js:26`). Seven spiral taps by default (`examples/jsm/shaders/SAOShader.js:24`), a normal-override scene render (`SAOPass.js:118-125`), then a separable depth-limited blur. No paper is cited in the source. Not the same family as either candidate's default; closest to qUINT MXAO's default mode. **(judgement)**
- `SSAOPass`: "A pass for a basic SSAO effect" (`examples/jsm/postprocessing/SSAOPass.js:31`). A 32-sample hemisphere kernel (`:55`) after the John Chapman and LearnOpenGL tutorials (`examples/jsm/shaders/SSAOShader.js:14-17`), again with a normal-override scene render (`SSAOPass.js:157-166`, `:194`). Not the same family.

Both do the same second scene render as `GTAOPass`.

### TSL nodes (`examples/jsm/tsl/display/`)

`GTAONode` is a fuller GTAO: it cites the same paper (`GTAONode.js:44`), has a `resolutionScale` for reduced-size rendering (`:91`) and optional temporal filtering through `TRAANode` (`:162-173`). `SSAONode` is a cheaper Vogel-disk sampler with a built-in depth-aware blur (`SSAONode.js:11-16`).

Both import from `three/webgpu` and `three/tsl` (`GTAONode.js:1-2`, `SSAONode.js:1-2`), so they need `WebGPURenderer` and its node materials, not the `WebGLRenderer` this project uses. `EffectComposer` conversely "can only be used with WebGLRenderer" (`examples/jsm/postprocessing/EffectComposer.js:18`). Adopting the nodes means changing renderer, which is a much larger decision than adding AO. Whether `WebGPURenderer` is acceptable on old phones is outside this note.

### N8AO (community)

<https://github.com/N8python/n8ao>, last commit 2026-08-10, package version 2.0.1.

- **Family.** Hemisphere-kernel SSAO: world-space samples in a normal-oriented hemisphere, each compared against scene depth with a range check ([EffectShader.js L196-L279][n8-shader]). **Not** horizon-based, so not the same family as either candidate. The README cites no paper; its credits are tutorials and other implementations ([README.md L358-L368][n8-readme]).
- **Inputs.** The depth texture of the beauty render. `N8AOPass` "replaces RenderPass" and renders the scene itself into a half-float target with a depth texture ([README.md L39-L46][n8-readme], [N8AOPass.js L188-L196][n8-pass]). Normals are rebuilt from depth ([EffectShader.js L137][n8-shader]). There is no second scene render for opaque geometry.
- **Quality tiers.** "Performance" is 8 AO samples and 4 denoise samples, labelled "Mobile, Low-end iGPUs and laptops"; Low and Medium are 16 AO samples; High and Ultra are 64 ([README.md L192-L201][n8-readme]).
- **Half resolution.** `halfRes`, "generally 2x-4x" faster, with depth-aware upsampling that "generally incurs a fixed cost of around 1ms" ([README.md L173-L181][n8-readme]). No hardware is named for those numbers.
- **Temporal.** Accumulation only "when the camera is still" ([README.md L273-L283][n8-readme]).
- **Compositing.** `pow(ao, intensity)` then a mix of the frame toward an AO colour ([EffectCompositer.js L231, L257-L259][n8-comp]). Everything is darkened.
- **Antialiasing.** "hardware antialiasing does NOT work with ambient occlusion", so SMAA is recommended ([README.md L51][n8-readme]).
- **Licence.** CC0 1.0 ([LICENSE][n8-license]): "You can do whatever you want with it, no attribution is required" ([README.md L354-L356][n8-readme]). Compatible with an MIT project. The `package.json` says `"license": "ISC"` ([package.json][n8-pkg]), which contradicts the licence file; both are permissive.
- **Dependency note.** `package.json` lists both `three` and `postprocessing` as peer dependencies, and the README says "you must have the packages 'three' and 'postprocessing' defined in your environment" ([README.md L30][n8-readme]). I did not check how much of `postprocessing` ends up in a Vite bundle that only uses `N8AOPass`.

## Project-specific concerns

### (a) Screen-space AO on top of Cycles-baked light

Environment surfaces are `MeshBasicMaterial` with a baked `lightMap` ([src/environment.ts L79-L91][env]). That texture already holds sky visibility, so it already contains ambient occlusion at lightmap-texel resolution. Every implementation above composites by multiplying the finished frame, which darkens the same corners a second time.

What the sources say:

- The GTAO paper treats baked light as the normal case and says how to combine them. AO "allows to preserve high-frequency details and contrast in low-frequency precomputed indirect illumination via pre-baked illumination or light probes" (introduction). The technique "can coexist and enhance other sources of global illumination (specifically baked irradiance)" (the paragraph that introduces section 4). And, under "Bounding the sampling area": "we only want to calculate local ambient occlusion, as larger-range low-frequency occlusion can be computed using baked irradiance or occlusion. We compute near-field occlusion using our formulation, and combine it with baked far-field occlusion by calculating their minimum." ([GTAO paper][gtao-paper])
- Engines restrict screen-space AO to ambient light for the same reason. Unity's "Ambient Only" makes "the Ambient Occlusion effect only affect ambient lighting" and "is only available with the Deferred rendering path and HDR rendering" ([Unity docs][unity-ao]). Godot's SSAO "only acts on ambient light. It does not affect direct light", and raising its Light Affect above zero is described as not physically accurate ([Godot docs][godot-ao]). Amplify's Deferred mode is the same idea.
- The ReShade shaders multiply everything because they have no choice; neither MXAO's source nor its guide says anything about baked lighting.

What that means here:

- **Ambient-only is not available.** The lightmap is direct sun, sky and bounce in one texture, so there is no ambient term to isolate.
- **`min(baked, screen-space)` is not available either** without a separate baked AO channel, which the bake does not write today. Adding one is a second texture download. **(judgement)**
- **The practical mitigation is the paper's own framing: near-field only.** Keep the radius well below the scale of features the lightmap already resolves, so the screen-space term adds contact detail the texels miss and little else, and lower the intensity. `GTAOPass` defaults to a radius of 0.25 scene units (`GTAOShader.js:48`), which is 0.25 m here, with `blendIntensity` and `scale` as the strength controls (`GTAOPass.js:114`, `GTAOShader.js:252`). The right values need to be found by eye. **(judgement)**
- Unbaked surfaces lit live by the sky have no AO at all and would benefit most, but they are the fallback, not the product ([src/environment.ts L152-L159][env]).

### (b) Leaving direct-to-canvas rendering

Today the scene is drawn straight to the canvas with `antialias: true` and `NeutralToneMapping` ([src/main.ts L56-L60, L93, L167][main]).

**Tone mapping and colour space.** When three.js renders into a render target, materials are not tone mapped (`src/renderers/WebGLRenderer.js:2387-2393`) and output stays in the linear working space (`:2378`). `OutputPass` then applies the renderer's tone mapping and the sRGB transfer to the whole frame (`examples/jsm/postprocessing/OutputPass.js:17-23`, `:97-116`). AO passes should sit before it, so they multiply linear values.

**This changes the sky.** The background is drawn with `toneMapped` false when its texture is sRGB (`src/renderers/webgl/WebGLBackground.js:151`, `:208`), which is the case for the sky picture ([src/environment.ts L162][env]). `main.ts` relies on that: the tone mapping "Must match the tone mapping baked into sky pictures" ([src/main.ts L92][main]). With a post chain the exemption disappears, because the final pass tone maps every pixel, so the sky picture is tone mapped a second time. I verified the mechanism in source, not the visible size of the change. Fixing it means shipping a sky picture without baked tone mapping, or drawing the sky after the output pass.

**Antialiasing.** Three routes:

- `EffectComposer` builds its own targets with no multisampling and no depth texture (`EffectComposer.js:69`). MSAA needs a hand-made `WebGLRenderTarget` with `samples` set (`src/core/RenderTarget.js:40`, `:264`) passed to the composer. three.js then renders to multisampled renderbuffers and resolves with a blit (`src/renderers/webgl/WebGLTextures.js:2104-2122`, `:2342`), capped at the device's `MAX_SAMPLES` (`:2406`).
- Where the browser exposes `WEBGL_multisampled_render_to_texture`, three.js uses it automatically (`WebGLTextures.js:2410-2414`). The underlying extension exists because tile-based GPUs can resolve multisampled data in on-chip memory: "Since per-sample data is never written out to external memory, this approach saves bandwidth and storage space" ([EXT_multisampled_render_to_texture][msrtt]). Without it, an MSAA render target costs real memory bandwidth on phones, which canvas MSAA largely avoids. I did not find a primary source listing which mobile browsers expose the WebGL version of the extension.
- r186 has a built-in alternative. Constructing the renderer with `outputBufferType: HalfFloatType` creates an internal scene target that is 4× multisampled when `antialias` is on (`src/renderers/webgl/WebGLOutput.js:34-43`), and `renderer.setEffects([...])` runs passes after it with tone mapping and colour conversion applied automatically (`src/renderers/WebGLRenderer.js:565-567`, `:747-771`; `WebGLOutput.js:192-194`, `:237-256`). Passes use the same `render(renderer, writeBuffer, readBuffer)` signature (`WebGLOutput.js:224`), so `GTAOPass` should slot in, but I did not run it. The scene target keeps depth in a renderbuffer, not a texture (`WebGLOutput.js:39-42`), so `GTAOPass` would still do its own non-multisampled depth and normal render, and the sky caveat above applies equally.

In any route the AO is computed from single-sampled depth and multiplied over an antialiased image, so some edge mismatch is expected; N8AO's README gives up on hardware AA for this reason. Canvas `antialias` should be turned off once the scene is no longer drawn to the canvas, since only a full-screen triangle is. **(judgement)**

**Cost on phones.** None of the sources give a mobile figure. What can be counted from source for `GTAOPass` in a composer: the scene is drawn twice, then five full-screen passes run (AO, denoise, copy, blend, output), at the full capped pixel ratio of 2 ([src/main.ts L25][main]), through half-float targets where today there is one draw to an 8-bit canvas. Half-float render targets also depend on a WebGL2 extension; I did not check its availability on old phones. Given [ADR 0001][adr1] makes frame rate on old phones the governing constraint, this needs measuring on a real device before anything else is decided. **(judgement)**

**Download size.** The modules a `GTAOPass` chain pulls in total about 86 kB of unminified, heavily commented source (`GTAOPass`, `GTAOShader`, `PoissonDenoiseShader`, `SimplexNoise`, `EffectComposer`, `RenderPass`, `OutputPass`, `OutputShader`, `ShaderPass`, `Pass`, `MaskPass`, `CopyShader`). Minified and compressed size was not measured.

### (c) Double-sided and transparent surfaces in the depth and normal prepass

`GTAOPass`, `SAOPass` and `SSAOPass` all build their depth and normals by setting `scene.overrideMaterial` to one `MeshNormalMaterial` (`GTAOPass.js:641`). The renderer swaps that material in for every object whose own material allows it (`WebGLRenderer.js:2139-2141`; `src/materials/Material.js:439`). The override brings its own render state, which collides with two things this project does in `prepare` ([src/environment.ts L65-L73][env]):

- **`DoubleSide`.** A new material is `FrontSide` (`Material.js:88`), so in the prepass every Rhino face that points away from the camera is culled. Those pixels get the depth of whatever is behind, or no depth at all, while the visible frame shows the face. The fix is one line, `gtaoPass.normalMaterial.side = DoubleSide`; the normal shader flips the normal for back faces when double-sided (`src/renderers/shaders/ShaderChunk/normal_fragment_begin.glsl.js:14-16`).
- **Transparent surfaces with `depthWrite` off.** The override is opaque and writes depth, so glass becomes a solid wall in the prepass: it receives AO and hides the geometry behind it from the AO. `GTAOPass` only hides points and lines before the prepass (`GTAOPass.js:651-667`). The fix is to hide transparent meshes for that render as well, by subclassing or wrapping the pass. Setting `allowOverride = false` on them is not a fix: they would then draw their own colour into the normal buffer.
- **Compositing over glass.** Even with a correct prepass, the AO of the wall behind a pane is multiplied over the pane's own pixels, because compositing happens after blending. A depth-based post effect cannot avoid that.

N8AO handles the second and third points itself: "transparent objects with depthWrite disabled will not occlude anything and look completely correct", at the price that "all transparent objects will be rendered twice" ([README.md L245-L250][n8-readme]). Because it reads the beauty render's own depth buffer, it also inherits each material's real `side` and `depthWrite` with no override involved.

## Open questions and things I could not verify

- **Amplify's manual.** <http://amplify.pt/unity/amplify-occlusion/manual> redirects to a wiki that returned 403, so the setting descriptions here come from inspector tooltips in source, not the manual.
- **Unity G-buffer layout.** That Amplify's Deferred mode affects only ambient light rests on my reading of which targets it writes, not on Unity documentation.
- **The marketing and guide pages for MXAO** were read through a summarising fetch. Direct quotes from them are short and may not be exact; everything load-bearing is cited to the repository instead.
- **Unreal Engine's AO documentation** could not be fetched (the page returned only a table of contents), so it is not cited.
- **No mobile performance data exists in any source.** Every figure quoted is for desktop or console hardware, or names no hardware.
- **`renderer.setEffects` with `GTAOPass`** was read, not run. Same for whether the sky's double tone mapping is visible enough to matter under `NeutralToneMapping`.
- **Whether the `GTAOPass` external-depth defect is fixed upstream** after 0.186.1 was not checked.
- **Half-float render target support and `WEBGL_multisampled_render_to_texture` availability on old phones** were not checked against a primary source.
- **N8AO's real bundle cost**, including how much of the `postprocessing` peer dependency is pulled in. Since measured; see "Outcome and an option kept open".
- **qUINT MXAO's default algorithm** is not attributed to a paper by its author; "obscurance-style" is my description.
- **Whether Pascal Gilcher would grant permission** for a port. The licence invites asking; nobody has asked.
- **Whether a denser bake is enough.** Recommendation 2 is untested; it needs a side-by-side at two lightmap resolutions.

[imm]: https://github.com/martymcmodding/iMMERSE/tree/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb
[imm-readme]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/README.md?plain=1#L26-L31
[imm-license]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/LICENSE
[imm-global]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods/mmx_global.fxh#L33-L36
[imm-mxao]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx
[imm-mxao-header]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L12-L15
[imm-mxao-default]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L41-L47
[imm-mxao-ui]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L53-L103
[imm-mxao-types]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L117-L128
[imm-mxao-presets]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L229-L239
[imm-mxao-normals]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L288-L318
[imm-mxao-fade]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L332-L337
[imm-mxao-bits]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L343-L373
[imm-mxao-thickness]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L509-L521
[imm-mxao-horizon]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L571-L576
[imm-mxao-vb]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L578-L590
[imm-mxao-integral]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L596-L617
[imm-mxao-filter]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L685-L713
[imm-mxao-temporal]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L722-L776
[imm-mxao-composite]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L785-L808
[imm-mxao-passes]: https://github.com/martymcmodding/iMMERSE/blob/f57d3afa1ebe5d1fd6152d4f6fb9a2e75bd1d1cb/Shaders/MartysMods_MXAO.fx#L831-L863
[quint]: https://github.com/martymcmodding/qUINT/tree/98fed77b26669202027f575a6d8f590426c21ebd
[quint-readme]: https://github.com/martymcmodding/qUINT/blob/98fed77b26669202027f575a6d8f590426c21ebd/README.md?plain=1#L26-L37
[quint-mxao]: https://github.com/martymcmodding/qUINT/blob/98fed77b26669202027f575a6d8f590426c21ebd/Shaders/qUINT_mxao.fx
[quint-header]: https://github.com/martymcmodding/qUINT/blob/98fed77b26669202027f575a6d8f590426c21ebd/Shaders/qUINT_mxao.fx#L10-L14
[quint-defines]: https://github.com/martymcmodding/qUINT/blob/98fed77b26669202027f575a6d8f590426c21ebd/Shaders/qUINT_mxao.fx#L22-L44
[quint-ui]: https://github.com/martymcmodding/qUINT/blob/98fed77b26669202027f575a6d8f590426c21ebd/Shaders/qUINT_mxao.fx#L50-L84
[quint-tex]: https://github.com/martymcmodding/qUINT/blob/98fed77b26669202027f575a6d8f590426c21ebd/Shaders/qUINT_mxao.fx#L178-L180
[quint-blur]: https://github.com/martymcmodding/qUINT/blob/98fed77b26669202027f575a6d8f590426c21ebd/Shaders/qUINT_mxao.fx#L255-L305
[quint-setup]: https://github.com/martymcmodding/qUINT/blob/98fed77b26669202027f575a6d8f590426c21ebd/Shaders/qUINT_mxao.fx#L356-L386
[quint-ao]: https://github.com/martymcmodding/qUINT/blob/98fed77b26669202027f575a6d8f590426c21ebd/Shaders/qUINT_mxao.fx#L388-L452
[quint-hq]: https://github.com/martymcmodding/qUINT/blob/98fed77b26669202027f575a6d8f590426c21ebd/Shaders/qUINT_mxao.fx#L454-L571
[quint-blend]: https://github.com/martymcmodding/qUINT/blob/98fed77b26669202027f575a6d8f590426c21ebd/Shaders/qUINT_mxao.fx#L573-L635
[quint-passes]: https://github.com/martymcmodding/qUINT/blob/98fed77b26669202027f575a6d8f590426c21ebd/Shaders/qUINT_mxao.fx#L641-L706
[amp]: https://github.com/AmplifyCreations/AmplifyOcclusion/tree/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27
[amp-readme]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/README.md?plain=1#L13-L64
[amp-license]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/LICENSE
[amp-readme-txt]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Readme.txt#L3-L10
[amp-occlusion]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Shaders/Occlusion.shader#L10-L90
[amp-blur]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Shaders/Blur.shader#L22-L50
[amp-apply]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Shaders/Apply.shader#L91-L126
[amp-common]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Shaders/Common.cginc#L70-L105
[amp-calc]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Shaders/CommonFunctions.cginc#L55-L75
[amp-noise]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Shaders/CommonFunctions.cginc#L141-L166
[amp-gtao-normals]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Shaders/GTAO.cginc#L68-L121
[amp-gtao-steps]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Shaders/GTAO.cginc#L124-L227
[amp-gtao-main]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Shaders/GTAO.cginc#L230-L299
[amp-gtao-integral]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Shaders/GTAO.cginc#L330-L354
[amp-funcs]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Shaders/OcclusionFunctions.cginc#L8-L170
[amp-temporal]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Shaders/TemporalFilter.cginc#L86-L94
[amp-cs-settings]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Scripts/AmplifyOcclusionEffect.cs#L26-L131
[amp-cs-cache]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Scripts/AmplifyOcclusionEffect.cs#L325-L346
[amp-cs-depthmode]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Scripts/AmplifyOcclusionEffect.cs#L628-L642
[amp-cs-events]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Scripts/AmplifyOcclusionEffect.cs#L688-L696
[amp-cs-compute]: https://github.com/AmplifyCreations/AmplifyOcclusion/blob/cd49e0752f9cbd06ff4c25606aeab2af1bbe5f27/Assets/AmplifyOcclusion/Scripts/AmplifyOcclusionEffect.cs#L800-L907
[n8]: https://github.com/N8python/n8ao/tree/0fc15550c98119758e83ed4c2d0e87273bae9ed9
[n8-readme]: https://github.com/N8python/n8ao/blob/0fc15550c98119758e83ed4c2d0e87273bae9ed9/README.md?plain=1
[n8-license]: https://github.com/N8python/n8ao/blob/0fc15550c98119758e83ed4c2d0e87273bae9ed9/LICENSE
[n8-pkg]: https://github.com/N8python/n8ao/blob/0fc15550c98119758e83ed4c2d0e87273bae9ed9/package.json
[n8-pass]: https://github.com/N8python/n8ao/blob/0fc15550c98119758e83ed4c2d0e87273bae9ed9/src/N8AOPass.js#L188-L196
[n8-shader]: https://github.com/N8python/n8ao/blob/0fc15550c98119758e83ed4c2d0e87273bae9ed9/src/EffectShader.js#L137-L279
[n8-comp]: https://github.com/N8python/n8ao/blob/0fc15550c98119758e83ed4c2d0e87273bae9ed9/src/EffectCompositer.js#L231-L259
[gtao-paper]: https://www.activision.com/cdn/research/Practical_Real_Time_Strategies_for_Accurate_Indirect_Occlusion_NEW%20VERSION_COLOR.pdf
[vb-paper]: https://arxiv.org/abs/2301.11376
[webgl2]: https://registry.khronos.org/webgl/specs/latest/2.0/
[gather]: https://registry.khronos.org/OpenGL-Refpages/es3.1/html/textureGather.xhtml
[bitcount]: https://registry.khronos.org/OpenGL-Refpages/es3.1/html/bitCount.xhtml
[msrtt]: https://registry.khronos.org/OpenGL/extensions/EXT/EXT_multisampled_render_to_texture.txt
[unity-ao]: https://docs.unity3d.com/Packages/com.unity.postprocessing@3.4/manual/Ambient-Occlusion.html
[godot-ao]: https://docs.godotengine.org/en/stable/tutorials/3d/environment_and_post_processing.html
[adr1]: ../adr/0001-threejs-static-page-over-godot.md
[adr2]: ../adr/0002-bake-light-with-scripted-blender.md
[env]: ../../src/environment.ts
[main]: ../../src/main.ts
[occlusion]: ../../src/occlusion.ts
[n8-ours]: ../../src/n8.ts
