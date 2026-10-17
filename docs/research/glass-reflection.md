# Glass reflection: Fresnel, bright backgrounds, and what it would cost to do properly

Researched 2026-10-12. Sources are pinned so the line numbers stay valid:

- This repo at commit `c6996ed`, written as `path:line`.
- three.js citations are to the installed package, `node_modules/three` version 0.186.1, written as `path:line` relative to that folder.
- Specifications and papers are linked at the bottom. Where I read a page through a summarising fetch and not verbatim, the text says so.

How to read the claims in this note:

- A statement followed by a link or a path was **verified** in that source.
- **(computed)** means I worked the number out myself from a cited formula. The two small scripts are not kept in the repo; the formulas are given so the numbers can be redone.
- **(judgement)** means it is my inference, not something a source says. All statements about what will look better, and all effort and cost rankings, are judgement.

No frame-rate or millisecond figures appear here, because none were measured and no source gives one for phones. Costs are given as counts of what the device has to draw.

## 1. Short answer

**Is it physically right?** The first principle is right as stated. The second is right as an observation, but it is not a second physical effect.

1. *Glass reflects strongly at a grazing angle and weakly head-on.* True. It is the Fresnel effect: one surface of ordinary glass reflects about 4% of the light that meets it head-on and nearly all of it at a very shallow angle ([section 3](#3-the-physics-with-the-real-numbers)).
2. *The reflection looks weaker where something bright is behind the glass.* True to the eye, but the reflection itself is not weaker. Glass adds the reflected light on top of the light coming through. In front of a bright background that addition is a small share of the total and disappears; in front of a dark background the same addition is most of what is there. A renderer does not need a rule for this. It needs to add the two lights together as light, before converting to screen colours, and the effect appears by itself.

**How is each achieved, and where does this project stand?**

- The Fresnel effect is **already in the walkthrough**. Glass is drawn with three.js's physically based material, which computes the reflected share from the glass's index of refraction and the viewing angle ([section 2](#2-what-the-glass-does-today)).
- The bright-background effect is **imitated, not computed**. The glass is blended onto a canvas that already holds finished screen colours, so the two lights cannot be added as light. A blending rule stands in for it: the reflection is scaled by how dark the canvas already is. It points the right way and is exact at white, but by my arithmetic it shows roughly half the physical reflection over black and roughly twice over mid-greys **(computed)**.
- The larger gap is **what the glass reflects**. It reflects only the sky, as if the sky were all around at infinite distance. A window seen from inside a room should reflect the room. Today it reflects whatever part of the sky lies in the mirror direction, which is both the wrong picture and usually far too bright for an interior **(judgement, from the code)**.

**Is it feasible in the performance budget?** Yes for the step that matters most. Because nothing in an environment moves ([ADR 0002][adr2]), the room can be captured into a reflection picture once, while the environment loads, and used every frame afterwards at the same per-frame cost as the sky reflection used today. The exact, physically added blend is also feasible but costs a restructuring of how frames are drawn, and it shares that cost with a change the ambient occlusion note already keeps open.

**Would switching to PBR help?** No, because the glass already is PBR. "PBR" (physically based rendering) means materials described by measurable properties and shaded by energy-conserving formulas. Glass and metal here already use it. The other surfaces deliberately do not: they show their colour times baked light, "the cheapest thing a phone can draw" (`src/environment.ts:126-129`). Converting them would add live reflections to floors and walls at a per-pixel cost on every surface, and would do nothing for glass.

**Recommended path.** Give glass a captured picture of its own room to reflect, corrected for the room's size, taken once at load. Then, only if the result still looks wrong over dark or mid-tone backgrounds, fix the blend. Leave planar mirrors and screen-space reflections alone.

## 2. What the glass does today

### The pipeline around it

- **Renderer.** three.js 0.186.1 (`package.json:17`) with `WebGLRenderer`, drawing straight to the canvas with the browser's built-in antialiasing (`src/main.ts:60-64`). The pixel ratio is capped at 2 because "rendering that many pixels is the main cost" (`src/main.ts:27-28`).
- **Colour workflow.** Shading is done in linear light and each material converts its own result to screen colours as its last step: tone mapping, then display encoding (`src/renderers/shaders/ShaderLib/meshphysical.glsl.js:220-222`). *Tone mapping* is the squeeze from the unlimited brightness range of light into the limited range of a screen; the walkthrough uses the Khronos PBR Neutral curve (`src/main.ts:96-97`). Once a pixel is on the canvas it is a finished screen colour. Nothing later can recover how bright the light was.
- **Solid surfaces.** Surfaces with baked light are swapped to `MeshBasicMaterial`, which shows colour times the baked light picture and computes no reflection at all (`src/environment.ts:126-142`, `:208-216`). Baked light holds brightness up to 4 times white (`src/environment.ts:28-29`, `scripts/bake.mjs:28`), so sunlit surfaces do carry more than screen white before tone mapping.
- **Sky.** There are two skies. The one the viewer sees is an ordinary picture with tone mapping already baked in (`scripts/optimize-environments.mjs:128-166`, `src/main.ts:96`), so it never exceeds screen white. The one that lights and reflects is a 1024-pixel-wide high-dynamic-range file that "keeps its full brightness" (`scripts/optimize-environments.mjs:45-46`, `:188-189`), prefiltered into blurred copies by `PMREMGenerator` (`src/environment.ts:221-226`) and set as `scene.environment` (`src/main.ts:118`). From a 1024-wide panorama the generator makes a cube 256 pixels to a side (`src/extras/PMREMGenerator.js:266`), so each face pixel spans about a third of a degree **(computed)**. Sky reflections are therefore soft.
- **Ambient occlusion.** Each frame the scene is drawn a second time at half width and height for depth, with glass hidden; the scene is drawn to the canvas; a full-screen pass multiplies the darkening on; and glass is drawn last in a separate call with the solid surfaces hidden (`src/occlusion.ts:284-329`, `src/n8.ts:109-110`). That last point matters for [option F](#f-threejss-own-transmission).
- **No reflection captures, no planar reflections, no screen-space reflections, no post-processing chain** other than the ambient occlusion multiply.

### The stated performance budget

There is no number. The budget is stated as a principle in two decision records:

> Walkthroughs must open seamlessly from a link on a general audience's phones, including old ones, so download size and startup time matter more than authoring comfort. ([docs/adr/0001-threejs-static-page-over-godot.md][adr1])

> live shadows on the viewer's device were rejected because they would spend the performance budget that ADR 0001 protects. ([docs/adr/0002-bake-light-with-scripted-blender.md][adr2])

The ambient occlusion note reads this as "frame rate on old phones [is] the governing constraint" ([docs/research/ambient-occlusion.md][ao-note], "Cost on phones"). The only measuring tool is `?fps`, which shows the current and lowest frame rate (`src/main.ts:146-151`, `:202-212`). No target frame rate or reference phone is written down anywhere I found.

### How glass gets to the viewer

1. **Export.** `npm run optimize` treats any material that lets more than half the light through as glass (`scripts/optimize-environments.mjs:27-28`, `:56-60`). It keeps the glass's index of refraction and specular strength from Rhino, drops the glTF transmission extension, and marks the material as blended (`:29-30`, `:62-70`). In the test environment that leaves `Vetro` (index of refraction 1.497, roughness 0) and `Water` (index of refraction 1, roughness left at the default of fully rough), 202 triangles of 8,884 (read from `public/models/test-environment.glb`).
2. **Bake.** The bake lets light pass through glass multiplied by the glass's colour, with no reflection (`scripts/bake.py:59-75`). Glass takes no baked light itself (`scripts/optimize-environments.mjs:87-88`).
3. **Load.** Because the two kept extensions are present, three.js's loader builds a `MeshPhysicalMaterial` for glass (`examples/jsm/loaders/GLTFLoader.js:1261-1265`, `:1301-1305`). I read this from the loader; I did not inspect the running page.
4. **`prepare`** makes every material two-sided and stops see-through ones from writing depth (`src/environment.ts:84-92`).
5. **`asGlass`** (`src/environment.ts:94-124`) then does four things:
   - Sets the material's own colour to black, so the only light the glass itself produces is its reflection of the sky (`:103-104`).
   - Sets a custom blend (`:108-112`). In symbols, with `D` the colour already on the canvas, `S` the glass's reflection and `C` the glass's tint, all as screen colours from 0 to 1: **new canvas = S × (1 − D) + D × C**.
   - Stores the tint display-encoded (`:99-102`) so that multiplying screen colours by it equals multiplying light by the Rhino colour.
   - Raises the reflection to the power 1.25 after display encoding (`:113-123`), a hand-tuned correction because "the canvas can only add after" encoding.

### What that does and does not get right

**Fresnel: present and correct.** The physical material computes the head-on reflectance from the index of refraction as `((ior − 1) / (ior + 1))²` (`src/renderers/shaders/ShaderChunk/lights_physical_fragment.glsl.js:45`), which for 1.497 is 3.96% **(computed)**. It raises that toward the grazing value with a precomputed table indexed by roughness and viewing angle (`lights_physical_pars_fragment.glsl.js:382-389`), which is the "environment BRDF" of Epic's 2013 course notes built on Schlick's Fresnel formula ([Karis 2013][karis], "Environment BRDF"). The result multiplies the sky picture looked up in the mirror direction (`envmap_physical_pars_fragment.glsl.js:22-43`, `lights_physical_pars_fragment.glsl.js:628`).

**Two details in that path:**

- three.js never lets roughness go below 0.0525 (`lights_physical_fragment.glsl.js:10`), so even perfectly smooth glass reflects a slightly blurred picture.
- `Water` has an index of refraction of 1, which gives zero reflection head-on, rising only to its specular strength of 0.5 at grazing (`lights_physical_fragment.glsl.js:35`, `:45`), and it is fully rough. Real water is about 2% head-on at an index of 1.33 ([Filament][filament], "Reflectance remapping" table). This looks like an export quirk worth checking with the author **(judgement)**.

**Transmission: tinted, but not reduced by what is reflected.** Light that is reflected cannot also pass through, so the transmitted share should be the tint times (1 − reflected share). The blend multiplies by the tint alone. Head-on the difference is 4% and invisible; at grazing angles the view through the glass stays brighter than it should **(judgement, from the blend above)**.

**Bright-background effect: imitated in screen colours.** The term `S × (1 − D)` fades the reflection as the canvas gets brighter. The code comment says as much: "the reflection fills in what is left of white, so that it shows most over the dark" (`src/environment.ts:106-107`). Compared with adding the two lights properly, taking display encoding as a 2.2 power and leaving tone mapping out **(computed)**:

| Reflected share | Light behind (0 = black, 1 = white) | Physical: light the reflection adds | Current blend adds |
|---|---|---|---|
| 4% (head-on) | 0 | 0.040 | 0.018 |
| 4% | 0.05 | 0.038 | 0.066 |
| 4% | 0.2 | 0.032 | 0.084 |
| 4% | 0.7 | 0.012 | 0.044 |
| 40% (about 80° off head-on) | 0 | 0.400 | 0.318 |
| 40% | 0.2 | 0.320 | 0.394 |
| 40% | 0.7 | 0.120 | 0.171 |

So the stand-in is within a factor of about two of the physical sum in mid-tones, about half over black, and close at grazing angles. It is a reasonable approximation, not a broken one. Its limits are that the reflection and the background are tone mapped separately, so a reflection brighter than white (the sun, a bright cloud) is clipped before it is combined, and that the correction is one tuned power for all cases.

**What is reflected: only the sky.** `scene.environment` is the only reflection source, and three.js looks it up by direction alone, as if it were infinitely far away (`envmap_physical_pars_fragment.glsl.js:26-33`). A pane facing into a room reflects sky, never the room. Seen from outside, sky is roughly the right thing to reflect, though the environment's own ground and walls are missing from it.

**Why plain alpha blending was rightly abandoned.** The commit before `c6996ed` drew glass as a quarter-opaque surface. three.js's own documentation names the fault: "One limitation of `Material#opacity` is that highly transparent materials are less reflective" (`src/materials/MeshPhysicalMaterial.js:18-20`), and the glTF transmission specification says the same: "alpha-as-coverage reflects light in proportion to its opacity" ([KHR_materials_transmission][gltf-transmission], read through a summarising fetch). The current blend does not have this fault: the reflection is not scaled by any opacity.

## 3. The physics, with the real numbers

**The tutorial.** The video is "SOA Archviz tip: Realistic reflections with Photoshop for archviz projects." by SOA Academy, published 2020-04-07, about nine and a half minutes long ([YouTube][tutorial]; title, channel, date, length and description read from the page). Its description says only that it shares "some tips about how to deal with reflections while working on Photoshop". **I could not retrieve the transcript**: the caption track returned an empty response and a third-party transcript service reported being blocked. The two principles discussed here are therefore as relayed in the question, not as checked against the video.

**Fresnel reflection.** When light meets the boundary between air and glass, part is reflected and part passes through. The split depends on the angle and on the *index of refraction* (IOR), a number saying how much the material slows light: 1.0 for air, 1.33 for water, 1.52 for window glass ([KHR_materials_ior][gltf-ior], table of typical values). The exact split is given by the Fresnel equations, one for each polarisation of light, averaged for ordinary light ([Physically Based Rendering, 4th ed.][pbrt], "Specular Reflection and Transmission", read through a summarising fetch).

Head-on, the reflected share reduces to `((n − 1) / (n + 1))²`, which is 0.04 for an index of 1.5 ([KHR_materials_ior][gltf-ior]; [Filament][filament] lists "Plastics, glass" at 4% to 5%). At a fully grazing angle it is 100% for every material: "An interesting characteristic of the Fresnel factor is that F = 1 at a grazing incidence ... whatever the wavelength" ([Schlick 1994][schlick], section 4.2).

*Schlick's approximation* replaces the exact equations with one cheap formula, `F = f + (1 − f)(1 − u)⁵`, where `f` is the head-on value and `u` the cosine of the angle (equation 15 of [Schlick 1994][schlick], which reports "less than 1% error" against the exact factor). Epic replaced the fifth power with an exponential that is "slightly more efficient to calculate and the difference is imperceptible" ([Karis 2013][karis], "Specular F"); three.js uses exactly that form (`src/renderers/shaders/ShaderChunk/common.glsl.js:109-120`). The glTF specular extension defines the same mix for dielectrics, with the transmitted part weighted by one minus the reflected part ([KHR_materials_specular][gltf-specular], `fresnel_mix`).

Reflected share of light for an index of 1.5, by angle away from head-on **(computed from the Fresnel equations; the Schlick and three.js columns from the formulas cited above)**:

| Angle from head-on | One surface, exact | Schlick | three.js variant | Whole pane, both surfaces |
|---|---|---|---|---|
| 0° | 4.0% | 4.0% | 4.0% | 7.7% |
| 30° | 4.2% | 4.0% | 4.1% | 7.9% |
| 45° | 5.0% | 4.2% | 4.5% | 9.3% |
| 60° | 8.9% | 7.0% | 7.3% | 15.2% |
| 70° | 17.1% | 15.8% | 15.7% | 27.1% |
| 80° | 38.8% | 41.0% | 40.9% | 54.2% |
| 85° | 61.3% | 64.8% | 65.1% | 75.3% |
| 88° | 81.9% | 84.4% | 84.7% | 89.9% |

Two things follow. The rise is late: reflection barely changes until about 50° and then climbs steeply, so "strong at grazing" really means the last 20° to 30°. And Schlick runs a little low between 40° and 65° and a little high beyond 75°, never by enough to see on a window **(judgement)**.

**Two surfaces.** A pane has a front and a back surface and both reflect. Summing all the bounces between them, ignoring absorption, a pane reflects `2R / (1 + R)` where `R` is one surface's share: 7.7% head-on, not 4% **(computed; my derivation, a geometric series)**. In this project that depends on how the pane was modelled. A pane modelled as a slab has two surfaces and each is drawn and adds its own reflection, which lands close to the right total. A pane modelled as a single sheet shows one surface's worth. three.js draws a two-sided see-through material as back faces then front faces (`src/renderers/WebGLRenderer.js:2165-2177`). The tint is likewise applied "once for each of its surfaces the view crosses" (`src/environment.ts:95-96`).

**Why reflections vanish over bright backgrounds.** What reaches the eye through a pane is

> light from behind × tint × (1 − reflected share) + light from in front × reflected share.

The second term does not depend on the first. If the room in front of a window sends 1 unit of light and the sky behind sends 50, a 4% reflection adds 0.04 to about 48: under a tenth of a percent, invisible. Put a dark wall sending 0.02 behind the same pane and the same 0.04 triples what is there. That is the whole effect **(my arithmetic with illustrative values, not measurements)**. The glTF transmission specification states the principle from the renderer's side: "Optical transparency does not require any changes whatsoever to the specular term" ([KHR_materials_transmission][gltf-transmission], read through a summarising fetch).

Tone mapping and the screen then exaggerate it. Past a threshold the Neutral curve compresses highlights toward white ([Khronos PBR Neutral][neutral]; `src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js:170-192`), so near white a fixed addition of light moves the screen colour even less.

**What a renderer must do for it to emerge on its own:**

1. Weight the two lights so they conserve energy: transmitted × (1 − F) plus reflected × F.
2. Add them as linear light, before tone mapping and display encoding.
3. Tone map the sum once.
4. Have real brightness differences in both the scene and what is reflected, since the effect is nothing but one light outweighing another.

Today the project has 1 for the reflected half only, cannot do 2 or 3 because it blends onto a finished canvas, and has 4 for baked surfaces and for the reflected sky but not for the sky seen through glass, which is an ordinary picture.

## 4. Options

*One lookup* means one read of a prefiltered reflection picture per glass pixel, which is what glass costs today.

| | Approach | What it gives | Cost | Risk |
|---|---|---|---|---|
| A | Leave as is | Fresnel from the sky; imitated bright-background effect | Nothing | Interior glass keeps reflecting sky |
| B | Tighten the existing blend | Transmission reduced by what is reflected; reflection strength nearer the physical sum | Glass pixels drawn twice, or the tint reduced to grey; no new passes | Still an approximation in screen colours; needs retuning by eye |
| C | Room captures taken once at load, with box projection | Glass reflects its own room, at about the right place and brightness | Per frame: one lookup, as today, plus a few instructions. At load: six small scene drawings and a prefilter per capture | Reflections are approximate; needs a box per room from the author; captures of the sky through windows need care |
| D | Planar reflection per glass plane | Exact mirror image, including what is off screen | One extra full scene drawing per visible glass plane, every frame | Cost grows with the number of planes; needs a custom glass shader |
| E | Screen-space reflections | Reflections of what is already on screen | Depth, normal and colour buffers plus several full-screen passes; leaves direct-to-canvas drawing | Cannot show what a window mostly reflects, which is behind the viewer |
| F | three.js's own transmission | Correct, energy-conserving sum in linear light, tone mapped once | One extra drawing of all solid surfaces per frame into an antialiased half-float picture with a mipmap chain | Conflicts with how ambient occlusion orders its drawing and with the pre-tone-mapped sky |
| G | Draw the scene once, off screen, in linear light; glass and ambient occlusion both read it | The same correctness as F; removes ambient occlusion's second scene drawing | Loses canvas antialiasing; adds a final full-screen pass; every pixel goes through an off-screen picture | The largest change; the same costs the ambient occlusion note lists |
| H | Make every surface PBR | Live reflections on floors and walls | Per-pixel lighting maths on every surface | Does nothing for glass; works against ADR 0002 |

### A. Leave as is

The baseline. Its real weakness is the reflected picture, not the Fresnel maths.

### B. Tighten the existing blend

The blend can only multiply the canvas by one constant colour per material (`src/environment.ts:108-112`), so it cannot dim the view through the glass by the per-pixel reflected share. Two ways round that stay within direct-to-canvas drawing **(judgement, untested)**:

- Draw each glass surface twice: once only multiplying the canvas by tint × (1 − F) computed per pixel, once adding the reflection as now. Glass covers a modest part of the screen and the first drawing is trivial.
- Or use the output's alpha channel as the per-pixel multiplier, which keeps one drawing but reduces the tint to a grey.

Either makes glass turn mirror-like at grazing angles as it should. Neither can add light properly, because the canvas holds screen colours; the tuned power stays.

### C. Room captures taken once at load, with box projection

A *reflection capture* (also called a reflection probe) is a picture of the surroundings taken from one point in all six directions and stored as a cube. Unreal describes them as "probes that can be placed around the world to capture a static image of the area they cover", "a low-cost method of reflections with no runtime performance cost", and warns that "reflections through this method are approximate" ([Unreal, Reflection Captures][ue-captures], read through a summarising fetch).

A cube looked up by direction alone treats everything as infinitely far away, which is wrong indoors: "the interior walls of a room are clearly not an infinite distance away" ([Unity, Advanced Reflection Probe Features][unity-box], read through a summarising fetch). *Box projection*, or parallax correction, fixes most of that: the shader intersects the mirror direction with a box the size of the room and looks the cube up toward that point ([Lagarde 2012][lagarde]). Lagarde lists the limits: it "only work[s] perfectly with mirror surface[s]", and "concave volumes still have artifacts due to hidden features". Unreal adds that the box shape "generally only works for hallways or rectangular rooms" ([Unreal][ue-captures]).

Why it fits here:

- **Nothing moves** ([ADR 0002][adr2]), so a capture taken once stays valid. three.js's `CubeCamera` draws the scene six times into a cube (`src/cameras/CubeCamera.js:222-247`); done once at load, that is startup time, not frame time.
- **Per-material reflection pictures already work.** A material's own `envMap` takes precedence over the scene's, and three.js prefilters it automatically for physical materials (`src/renderers/WebGLRenderer.js:2379-2380`).
- **The per-frame cost is what glass costs today**: one lookup, plus the box intersection.
- **The errors are forgiving on glass.** The reflection is 4% to 8% strong except near grazing, so a slightly misplaced reflected wall is hard to see **(judgement)**.

What it needs:

- **Box projection is not built in for `WebGLRenderer`.** r186 ships it only as a node function for the WebGPU renderer (`src/nodes/functions/material/getParallaxCorrectNormal.js`; the examples folder at tag `r186` has `webgpu_materials_envmaps_bpcem.html` and no WebGL counterpart, checked by listing it). Here it would be a small patch to the reflection lookup through `onBeforeCompile`, the same mechanism `asGlass` already uses. The physical shader has no world position unless transmission is on (`src/renderers/shaders/ShaderChunk/transmission_pars_fragment.glsl.js:30`), so the patch must pass one through.
- **A capture point and box per room**, which only the author knows. The config file per environment (`public/models/test-environment-config.md`) is the natural place **(judgement)**.
- **A rule for which picture a pane uses.** A pane between inside and outside should reflect the room when seen from inside and the sky when seen from outside. Choosing by whether the viewpoint is inside the room's box is the simplest rule **(judgement)**.
- **Care with brightness during capture.** Drawing into an off-screen picture skips tone mapping (`src/renderers/WebGLRenderer.js:2387-2393`), so baked surfaces are captured with their true brightness, which is what is wanted. But the sky seen through the room's windows would be captured from the ordinary sky picture and so no brighter than white. Glass should be hidden during capture, as its blend assumes a display-encoded canvas.

A variant is to render the captures in Blender during `npm run bake`, which already traces the environment with Cycles. That gives correct brightness and bounced light, at the price of one more downloaded file per room.

Large windows in particular: a wall of glass seen at a shallow angle is where the reflection is strongest and behaves most like a mirror, so it is where a capture's wrong parallax would show first. That is the case to look at when judging this option **(judgement)**.

### D. Planar reflection per glass plane

A *planar reflection* draws the scene again from the mirrored viewpoint and shows that picture on the surface. three.js ships it as `Reflector`, which draws the whole scene into its own picture before each frame (`examples/jsm/objects/Reflector.js:116`, `:228-233`), at 512 pixels by default with fourfold antialiasing in half-float (`:79-83`, `:101`), skipping the work when the plane faces away (`:130-133`).

It is exact for flat glass and shows what is off screen. The cost is why engines ration it: "Planar Reflections cause your entire scene to be rendered twice", and "limit the number of Planar Reflections placed in the world. Often times, one will still be too much" ([Unreal, Planar Reflections][ue-planar], read through a summarising fetch). Each distinct glass plane in view needs its own drawing. `Reflector` is also a plain mirror with no Fresnel and no view through it (`:359-368`), so the glass would need a custom shader that reads its picture.

This is the one option that could make a single showcase pane look exactly right. As a general answer for a glazed building it spends the budget ADR 0001 protects **(judgement)**.

### E. Screen-space reflections

*Screen-space reflections* (SSR) search the already-drawn frame for what a surface should reflect. three.js ships `SSRPass`, which draws the scene again with a normal-recording material and then runs the search, blurs and copies as full-screen passes (`examples/jsm/postprocessing/SSRPass.js:550-661`).

The defining limit is that "SSR can not reflect objects that are off-screen" ([Unreal, Planar Reflections][ue-planar]). A window looked at from inside a room reflects the room behind the viewer, which is never on screen. SSR can only help where the reflection is of something also in view, which for glass means shallow angles. Glass also writes no depth here (`src/environment.ts:87-88`), so the search would see through it without extra work. It needs the post-processing chain the ambient occlusion note decided against. Not suited to this goal **(judgement)**.

### F. three.js's own transmission

`MeshPhysicalMaterial.transmission` is three.js's physically based see-through: "Thin, transparent or semitransparent, plastic or glass materials remain largely reflective even if they are fully transmissive" (`src/materials/MeshPhysicalMaterial.js:519-525`). It implements the glTF transmission extension, which this project currently strips.

How it works, from source:

1. Before drawing see-through objects, the renderer draws the background and all solid objects again into a separate picture, with tone mapping switched off (`src/renderers/WebGLRenderer.js:2002-2076`).
2. That picture is half-float where supported, antialiased with at least four samples, and has a full mipmap chain rebuilt every frame (`:2014-2027`, `:2078-2079`).
3. Two-sided glass draws its back faces into the picture as well and rebuilds the chain a second time, unless the device has a particular extension (`:2081-2116`).
4. The glass shader reads that picture where the bent ray lands, with eight texture reads per pixel for smoothness (`src/renderers/shaders/ShaderChunk/transmission_pars_fragment.glsl.js:109-119`, `:145-150`, `:207-217`), multiplies by the tint and by one minus the Fresnel term (`:218-231`), adds the reflection, and tone maps the sum once (`src/renderers/shaders/ShaderLib/meshphysical.glsl.js:197-222`).

That is exactly the list of four requirements in section 3. The picture's size can be scaled down: "lowering this value can result in significant performance improvements" (`src/renderers/WebGLRenderer.js:289-297`).

Three problems specific to this project **(judgement, from source; not run)**:

- **Cost.** One more drawing of every solid surface per frame, on top of the canvas drawing and the ambient occlusion depth drawing: three scene drawings where there were two, plus the resolve and mipmap work.
- **Ambient occlusion's ordering.** Glass is drawn in a separate call with solids hidden (`src/occlusion.ts:320-329`). In that call the transmission picture would contain no solid surfaces. The ordering would have to change, and the picture three.js makes would not include the ambient occlusion darkening, so surfaces seen through glass would lose it.
- **The sky.** The visible sky picture already has tone mapping baked in and is exempt from tone mapping when drawn (`src/renderers/webgl/WebGLBackground.js:151`, `:208`). Seen through transmissive glass it would be tone mapped again by the glass shader, so sky through a window would not match sky beside it. The ambient occlusion note found the same hazard for post-processing ([ao-note][ao-note], "This changes the sky").

### G. Draw the scene once, off screen, in linear light

The ambient occlusion note keeps one option open: "draw the scene once, off screen, with a full-size depth texture", and names what would tip the decision: "a later effect that needs a full-size depth texture anyway. The off-screen scene target would then be paid for once and shared" ([ao-note][ao-note], "Outcome and an option kept open").

Physically added glass is such an effect. With the solid scene in an off-screen linear picture, a glass shader can read what is behind each pixel, apply tint × (1 − F), add the reflection, and one final pass tone maps everything once. Ambient occlusion reads the same drawing's depth and its second scene drawing goes away. Compared with F there is no mipmap chain and no extra scene drawing.

The costs are the ones that note lists: canvas antialiasing is lost and must be replaced, a final full-screen pass is added, and the sky picture needs to stop carrying baked tone mapping. This is the correct end state if the imitation in B proves not good enough, and it is the largest change on this list **(judgement)**.

### H. Make every surface PBR

Concretely this would mean keeping `MeshStandardMaterial` on baked surfaces, with the baked light as its `lightMap`, so that floors and walls also reflect. It changes nothing about glass, which is already a physical material. It moves every surface from "the cheapest thing a phone can draw" (`src/environment.ts:126-129`) to three.js's most expensive family: the physical material "has a higher performance cost, per pixel, than other three.js materials" (`src/materials/MeshPhysicalMaterial.js:26-29`), and the standard material shares its shader. The baked light picture also holds sun, sky and bounce together ([ao-note][ao-note], section (a)), so a reflection added on top would need its own tuning to avoid counting light twice. The assets would not need rework: Rhino already exports roughness and metalness, and the loader already builds PBR materials before `withBakedLight` replaces them.

A polished floor that mirrors the room would be a real gain, and option C's captures would serve it too. It is a separate decision from glass **(judgement)**.

## 5. Recommendation

Cheapest step first. Each stage ends with a look and a measurement, and the next is taken only if the look is not yet right.

**Stage 0: fix the comparison.** Before changing anything, record the `?fps` reading (current and lowest) on the oldest phone available, with ambient occlusion on, at three fixed viewpoints: head-on to a window from inside with sky behind it; along a glazed wall at a shallow angle; from outside toward a window with a dark interior behind it. Take a screenshot at each. These are the three cases the two principles are about.

**Stage 1: let glass reflect its room (option C).** One capture per room at load, a box per room in the environment's config file, a patched reflection lookup, and a rule for inside versus outside.
*Measure:* frame rate at the three viewpoints, expected unchanged since the per-pixel work is nearly the same **(judgement)**; time added to loading, which ADR 0001 names explicitly; and whether the capture is created on the oldest phone at all, since it needs the same half-float support ambient occlusion already checks for (`src/occlusion.ts:198-203`).
*Look for:* interior panes no longer glowing with sky; reflected walls roughly where they belong along the glazed wall.

**Stage 2: tighten the blend (option B).** Reduce what comes through by what is reflected, then retune or remove the 1.25 power against the table in section 2.
*Measure:* frame rate along the glazed wall, where glass covers most of the screen and any second drawing costs most.
*Look for:* glass going mirror-like in the last 20° or so, and reflections over dark frames and mullions neither too faint nor glowing.

**Stage 3, only if the imitation still falls short: the shared off-screen picture (option G), not option F.** F adds a third scene drawing and fights the ambient occlusion ordering; G removes a drawing and settles both. This is where trading comes in. In rough order of how much each frees **(judgement)**:

- *Ambient occlusion.* It costs a second scene drawing at half size plus its sampling and smoothing passes every frame. Its `detail` and `samples` settings scale it down and `on: no` removes it (`public/models/test-environment-config.md`). Under option G its scene drawing disappears anyway.
- *Pixel ratio.* The cap of 2 (`src/main.ts:28`) sets how many pixels everything is computed for. Lowering it for phones cuts every per-pixel cost at once, at the price of sharpness.
- *Antialiasing.* Canvas antialiasing would be given up under option G in any case; what replaces it is a choice between cost and edge quality.
- *Edge-aware upscaling* is already off because it was "judged too costly" ([ao-note][ao-note]); under option G it comes nearly free.

*Measure:* the same three viewpoints with and without ambient occlusion, so the cost of the off-screen route is separated from the cost of what runs on it.

**Not recommended:** screen-space reflections (cannot see what windows reflect), planar reflections as a general solution (one scene drawing per plane), and converting all surfaces to PBR for the sake of glass (does not touch glass).

## 6. Open questions and things I could not verify

- **The tutorial's content.** Only its title, channel, date, length and description were retrieved. The transcript was not. Whether it makes further claims, for instance about reflection colour or blur, is unknown.
- **Nothing here was run.** Every statement about three.js is from reading source at 0.186.1. In particular: that glass is a `MeshPhysicalMaterial` at run time; how transmission would behave inside the ambient occlusion drawing order; and the sky being tone mapped twice through transmissive glass.
- **No performance was measured**, and no source read gives a phone figure for any of these techniques. The Unreal and Lagarde timings that exist are for consoles and desktop demos and are deliberately not quoted as guidance.
- **The comparison table in section 2** assumes a 2.2 display curve, a neutral tint and no tone mapping. It shows the size of the error, not exact screen values.
- **The pane formula `2R / (1 + R)`** is my derivation and ignores absorption in the glass. I did not find it in a source I could cite.
- **How panes are modelled in Rhino**: single sheets or slabs. This decides whether a pane shows one surface's reflection or two, and the test environment's glass was counted, not inspected for thickness.
- **`Water`** is exported with an index of refraction of 1 and full roughness. Whether that is intended is a question for the author.
- **Box projection on `WebGLRenderer`** has no shipped three.js example in r186. The patch is small in principle but unwritten and untested, including how it interacts with the prefiltered cube layout.
- **Capturing true sky brightness through windows** during a load-time capture needs the high-dynamic-range sky as the background for that drawing; the loader currently disposes of it after prefiltering (`src/environment.ts:223-226`). Not tried.
- **Memory and load time of captures on old phones.** Each capture is prefiltered into its own texture; how many rooms an old phone tolerates was not established.
- **Whether one capture per room is enough** for long or L-shaped rooms, where Lagarde's and Unreal's warnings about box shapes apply.
- **Pages read through a summarising fetch**, where short quotes may not be exact: the glTF extension READMEs, Filament, Physically Based Rendering, the Unreal and Unity manuals, Lagarde's article and the Khronos tone mapping README. Schlick's paper and Epic's course notes were read as extracted text from the original files.
- **Unity's high-definition pipeline pages** on the order in which reflection methods fall back were not usable (contents pages only), so no claim about engine fallback order is made.

[adr1]: ../adr/0001-threejs-static-page-over-godot.md
[adr2]: ../adr/0002-bake-light-with-scripted-blender.md
[ao-note]: ambient-occlusion.md
[tutorial]: https://www.youtube.com/watch?v=pDBNQJ2i_7Q
[schlick]: https://dept-info.labri.fr/~schlick/DOC/eur2.html
[karis]: https://cdn2.unrealengine.com/Resources/files/2013SiggraphPresentationsNotes-26915738.pdf
[filament]: https://google.github.io/filament/Filament.md.html
[pbrt]: https://pbr-book.org/4ed/Reflection_Models/Specular_Reflection_and_Transmission
[gltf-transmission]: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_transmission/README.md
[gltf-ior]: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_ior/README.md
[gltf-specular]: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_specular/README.md
[neutral]: https://github.com/KhronosGroup/ToneMapping/blob/main/PBR_Neutral/README.md
[lagarde]: https://seblagarde.wordpress.com/2012/09/29/image-based-lighting-approaches-and-parallax-corrected-cubemap/
[ue-captures]: https://dev.epicgames.com/documentation/en-us/unreal-engine/reflections-captures-in-unreal-engine
[ue-planar]: https://dev.epicgames.com/documentation/en-us/unreal-engine/planar-reflections-in-unreal-engine
[unity-box]: https://docs.unity3d.com/Manual/AdvancedRefProbe.html
