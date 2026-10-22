# Light from glowing surfaces: baking lamps an author models in Rhino

Researched 2026-10-22, for the idea that a lamp in an environment is a surface whose material glows, and that the bake treats glowing surfaces as lights. Sources are pinned so the line numbers stay valid:

- This repo at commit `dabea8c`. Paths like `scripts/bake.py:122` are relative to the repo root. glTF-Transform is the installed `@gltf-transform/functions` 4.5.1.
- Rhino's glTF exporter, [mcneel/glTF-IO][gltfio] on the `rhino-8.x` branch at [`8d066f24b1`][gltfio-tree]. Its emission code last changed in "Export HDR emissive colors with emissive strength extension" ([`d47e6e57dc`][gltfio-hdr], September 2023).
- Rhino's Raytraced mode, [mcneel/RhinoCycles][rc] on the `rhino-8.x` branch at [`94fe8416d6`][rc-tree].
- Rhino 8 help pages ([Materials][rh-materials], [Lights][rh-lights], [Post Effects][rh-post], [Select color][rh-color], [Render document properties][rh-render], [Raytraced display mode][rh-raytraced]) and the [RhinoCommon API reference][rhinocommon], all fetched on the research date.
- The glTF 2.0 specification and the KHR_materials_emissive_strength extension, in [KhronosGroup/glTF at `7cee0fcddd`][khr-tree].
- Blender 5.2 as installed on the author's laptop. Its glTF add-on, version 5.2.40, is read from `C:\Program Files\Blender Foundation\Blender 5.2\5.2\scripts\addons_core\io_scene_gltf2\` and cited as `io_scene_gltf2/…:line`. Cycles source is the `blender-v5.2-release` branch at [`e13b728c68`][bl-tree]. The Blender manual is its source at [`00a3daa8fd`][bman-tree].
- Mitchell Charity's [blackbody colour table][charity] (version 2001-Jun-22).

How to read the claims in this note:

- A statement followed by a link or a path was **verified** in that source.
- **(tested)** means I ran it in Blender 5.2 on this laptop; the scripts are described where they are used.
- **(computed)** means I worked the number out from figures given in the text.
- **(judgement)** means it is my inference, not something a source says.

Nothing was rendered in Rhino. Every statement about Rhino comes from its help pages, its API reference, or the source code of its glTF exporter and of its Raytraced mode.

## 1. Short answer

**The idea works in Blender, but two steps in today's pipeline throw most of a lamp away.**

- **Rhino lights cannot be carried.** Rhino's glTF exporter writes no lights at all, and Rhino's own lights have no physical unit: an *Intensity* slider that Raytraced mode multiplies by a fixed factor (section 2).
- **A glowing surface does light other surfaces**, both in Rhino's Raytraced mode and in a Blender Cycles bake. Both use Cycles and both treat the emission colour times its strength as the surface's brightness, so the same numbers give the same light (sections 2 and 4).
- **Rhino exports the glow's colour, and its strength only when the strength pushes a colour channel above 1.** A glow driven by a texture comes out black (section 3).
- **`scripts/optimize-environments.mjs` then deletes the strength** (`KHR_materials_emissive_strength` is in its list of dropped extensions), so Blender bakes every lamp at strength 1 or less (section 6).
- **Lumen convert to Blender's emission strength** by *strength = lumen ÷ (683 × π × glowing area)*, for a colour whose luminance is 1. Blender's own Blackbody node gives such a colour from a kelvin value (section 4).
- **The difference between 2700 K and 3000 K is about 11 steps in green and 20 in blue** in 8-bit sRGB, roughly 15 to 27 K a step. The glTF file keeps colours as decimal numbers, but the final light picture is 8-bit, where the two lamps still land several steps apart (section 7).

**What to change, in short (judgement):** keep the emission strength through the optimize step for the bake's sake, and have the author give each lamp its lumen and kelvin, either through the Rhino material, if the author is willing to work out the strength by hand, or in a mark (material name) that `bake.py` converts itself (section 8).

## 2. Rhino 8: how a material glows, and what Rhino's lights are

### Glowing materials

- **The Physically Based material** has an *Emission* section that "turns an object into a light source", with a *Color* ("The lighting color. When a texture is assigned, colors of the textures will be the lighting colors.") and a *Multiplier* ("Increases or decreases the lighting intensity.") ([Rhino 8 Materials help][rh-materials]). No unit is given for either.
- **The Emission material** (a separate material type) "can be assigned to an object to make the object into a lighting source". It has a *Color*, for which "The Select Color dialog shows a list of Kelvin colors", and an *Intensity*, "The brightness of the light" ([Rhino 8 Materials help][rh-materials]). No unit is given.
- **In the API**, the physically based emission is a floating-point colour (`PhysicallyBasedMaterial.Emission`, type `Color4f`), while the older `Material.EmissionColor` is a `System.Drawing.Color` ([RhinoCommon][rc-emission], [RhinoCommon][rc-emissioncolor]), which holds 8 bits per channel. Rhino "factors intensity (emission-multiplier) into EmissionColor", as a comment in Raytraced mode's source puts it ([`CyclesShader.cs:485`][rc-shader]): the floating-point colour is the chosen colour times the multiplier.
- **The colour dialog** works in 0–255 with a hexadecimal field, and a gear icon switches its sliders to 0–1 or 0–100. Its named colour list is a text file of `<Name>,<Red>,<Green>,<Blue>,<Alpha>` with whole numbers ([Rhino 8 Select color help][rh-color]).

### Raytraced mode lights other surfaces from a glowing material

Raytraced mode "sets the viewport to a rendered mode with Cycles" ([Rhino 8 help][rh-raytraced]). For a physically based material it builds a Cycles Principled BSDF and sets:

- the *Emission Strength* to the material's `emission-multiplier`, or its `intensity` for the Emission material ([`CyclesShader.cs:476-483`][rc-shader], [`RhinoFullNxt.cs:592-603`][rc-full]);
- the *Emission* colour to the floating-point emission divided by that strength, which undoes Rhino's folding of the two ([`CyclesShader.cs:484-492`][rc-shader]).

An emitting surface in Cycles is a light for every other surface (section 4), so yes, a glowing material lights the room in Raytraced mode. The help says the same in its own words ("turns an object into a light source").

### Rhino's light objects have no unit

- The Lights panel offers *Color* ("Setting the color to shades of gray dims the light"), *Intensity* ("Controls the brightness of the light"; "Drag the slider beyond the right end to increase the range of intensity above 100%"), *Shadow intensity* and *Falloff* (constant, linear, inverse square) ([Rhino 8 Lights help][rh-lights]). No watts, lumen or kelvin.
- The API's `Light` class does have `PowerWatts`, `PowerLumens` and `PowerCandela` ([RhinoCommon][rc-light]), but Raytraced mode ignores them. It sets the Cycles light's strength to `lg.Intensity` times a fixed factor ([`ShaderConverter.cs:2406-2468`][rc-convert]): 40 for point lights and spotlights, 17.2 for rectangular lights, 3.2 for the sun and 10 for linear lights ([`DefaultEngineSettings.cs:25-29`][rc-defaults]). A point light at intensity 1 is therefore a 40 W Cycles light, whatever its "power" says.
- **None of this reaches the glTF file** (section 3).

## 3. What Rhino 8's glTF exporter writes for emission

The exporter first turns any Rhino material into a physically based one (`Material.ToPhysicallyBased()`, [`RhinoDocGltfConverter.cs:26-33`][gltfio-doc]). The emission code in full ([`RhinoMaterialGltfConverter.cs:98-151`][gltfio-mat]):

```csharp
//Emission

if (CanExportTexture(emissiveTexture))
{
  material.EmissiveTexture = GetTextureInfo(emissiveTexture);

  float emissionMultiplier = 1.0f;

  var param = pair.RenderMaterial.GetParameter("emission-multiplier");

  if (param != null)
  {
    emissionMultiplier = (float)Convert.ToDouble(param);
  }

  glTFExtensions.KHR_materials_emissive_strength emissiveStrength = new glTFExtensions.KHR_materials_emissive_strength();

  emissiveStrength.EmissiveStrength = emissionMultiplier;

  material.Extensions.Add(glTFExtensions.KHR_materials_emissive_strength.Tag, emissiveStrength);
}
else
{
  Rhino.Display.Color4f emissionColor = pair.PBR.Emission;

  if(emissionColor.R > 1.0f || emissionColor.G > 1.0f || emissionColor.B > 1.0f)
  {
    //The emission color is a system drawing color so always [0-1.0] with the multiplier unapplied
    //So we can get that multiplier back by dividing
    Rhino.Display.Color4f original = new Rhino.Display.Color4f(pair.Material.EmissionColor);

    float intensity = emissionColor.R / original.R;

    glTFExtensions.KHR_materials_emissive_strength emissiveStrength = new glTFExtensions.KHR_materials_emissive_strength();

    emissiveStrength.EmissiveStrength = intensity;

    material.Extensions.Add(glTFExtensions.KHR_materials_emissive_strength.Tag, emissiveStrength);

    emissionColor = new Rhino.Display.Color4f(
      GlTFUtils.Clampf(emissionColor.R / intensity, 0.0f, 1.0f),
      GlTFUtils.Clampf(emissionColor.G / intensity, 0.0f, 1.0f),
      GlTFUtils.Clampf(emissionColor.B / intensity, 0.0f, 1.0f),
      1.0f
    );
  }

  material.EmissiveFactor = new float[]
  {
    emissionColor.R,
    emissionColor.G,
    emissionColor.B,
  };
}
```

What this writes:

- **A plain glowing colour** becomes `emissiveFactor`, three decimal numbers, with the multiplier already multiplied in. If no channel exceeds 1, there is no `KHR_materials_emissive_strength` and the brightness is all in the factor. A colour (0.5, 0.3, 0.1) with multiplier 1.5 is written as (0.75, 0.45, 0.15) **(computed, from the code)**.
- **A colour pushed above 1 by its multiplier** is split back into a colour and an `emissiveStrength`. The strength is found from the red channel alone, by dividing the floating-point red by the red of the 8-bit `EmissionColor`, so it carries that 8-bit rounding: under 0.2 % when red is 255 **(computed)**. When the red of the 8-bit colour is 0, as in a pure green or blue glow, the division is by zero **(judgement, from the code; not run)**. For warm lamps red is the largest channel, so this case does not arise.
- **The colour is not converted.** The base colour gets Rhino's gamma applied when the document's linear workflow asks for it ([`RhinoMaterialGltfConverter.cs:317-322`][gltfio-mat]); the emission colour does not. glTF defines `emissiveFactor` as "linear multipliers" ([material schema][khr-schema]), so whatever number Rhino holds is read as linear light.
- **A glow driven by a texture comes out black.** The exporter writes the texture and the strength but never sets `emissiveFactor`, whose default is `[0, 0, 0]` and which is then left out of the file ([`Material.cs:56-59`, `:276-281`][gltfio-schema]). The glTF spec says "the `emissiveFactor` property has to be defined for the emissive texture to have any effect" ([spec][khr-emissive]). Blender's importer agrees: it takes a missing factor as `[0, 0, 0]` and folds that grey into a strength of 0 (`io_scene_gltf2/blender/imp/pbrMetallicRoughness.py:553-564`).
- **Lights are not exported at all.** The exporter's sources contain no light handling and it never writes `KHR_lights_punctual` ([exporter folder][gltfio-exp]). It does list `KHR_materials_emissive_strength` as used in every file, whether or not any material uses it ([`RhinoDocGltfConverter.cs:194`][gltfio-doc]).

What glTF says the numbers mean: "The units for the multiplicative product of the emissive texture and factor are candela per square meter (cd / m²), sometimes called *nits*", but converting that into screen brightness "requires knowledge of the camera's exposure settings, which are left as an implementation detail" ([spec][khr-emissive]). The extension adds "a unitless multiplier" that "does not alter the physical units" ([extension][khr-strength]). Rhino attaches no unit to its numbers, and Blender reads them without one (section 4), so in practice the nits are only a label.

**Lost on export:** every Rhino light; any glow driven by a texture; Rhino's kelvin choice (only the resulting RGB is kept); and, in a corner case, a strength computed from a red of 0.

## 4. Blender Cycles: what emission strength means, and lumen to strength

### What the strength is

- The manual says "Emission shaders on meshes are also in Watts/m²", and that for materials "a value of 1.0 will ensure that the object in the image has the exact same color as the Color input" (`manual/render/shader_nodes/shader/emission.rst:14-30`, [source][bman-emission]).
- The code settles which: a glowing surface's brightness (radiance) is simply *colour × strength*, with nothing divided out ([`emissive.h:43-62`][bl-emissive]). A light object, by contrast, is converted "from radiant flux to radiance" by dividing its watts by π and by its area ([`light.cpp:142-145`][bl-light], [`area.h:313`][bl-area]).
- So a surface of strength *S* and area *A* sends out **π × S × A** "watts" from each side, the flux of a diffuse emitter **(computed, from the code)**. The manual's "W/m²" is per unit of brightness, not the flux per square metre.
- **A single-sided surface glows from both faces.** `emissive_pdf` uses the absolute angle to the surface ([`emissive.h:43-47`][bl-emissive]), and a test plane lit a target 1 m in front of it and a target 1 m behind it equally (0.313 and 0.314) **(tested)**. The material setting *Emission Sampling* can restrict which side is *sampled* as a light (None, Auto, Front, Back, Front and Back) (`manual/render/cycles/material_settings.rst:32-48`, [source][bman-matsettings]). Imported glTF materials get `AUTO` **(tested)**.

### The bake counts a glowing surface as a light

In a test scene, a 10 × 10 cm plane of strength 100, 1 m above a white surface, with a black sky, was baked the way `scripts/bake.py` bakes (`DIFFUSE`, direct and indirect). The baked value was 0.313; a small diffuse emitter gives an irradiance of *S × A ÷ d²* = 1 W/m² there, and the diffuse bake stores irradiance ÷ π = 0.318 **(tested and computed)**. So glowing surfaces light other surfaces in the bake today, in the same units as the sky's light, and the walkthrough's `lightMapIntensity` of π × 4 (`src/environment.ts:160`) undoes the same π for both.

The glowing surface's own glow is not in that picture: the bake's *Emit* type is separate from *Diffuse* (`manual/render/cycles/baking.rst:93-99`, [source][bman-baking]).

### From lumen to strength

- **683 lm/W** is the glTF add-on's own constant, `PBR_WATTS_TO_LUMENS = 683`, "Industry convention, biological peak at 555nm, scientific standard as part of SI candela definition" (`io_scene_gltf2/blender/com/conversion.py:10-11`). The add-on divides a glTF light's lumen-based intensity by 683 to get Blender watts (`io_scene_gltf2/blender/imp/light.py:58-77`).
- **The manual uses a different rule of thumb.** "this is not the electrical Watts that consumer light bulbs are rated at. It is Radiant Flux", and its table gives an 800 lm LED bulb as 2.1 W, a 1000 lm bulb as 2.9 W and a 2500 lm fluorescent tube as 4.5 W (`manual/render/lights/light_object.rst:261-290`, [source][bman-lights]). That is roughly 230 to 560 lm per Blender watt, not one constant **(computed)**.
- **Which constant does not matter for lamps against each other**, as long as every lamp uses the same one. It matters only against the sky, whose absolute brightness this pipeline does not know (section 5) **(judgement)**.

With 683 and a colour whose luminance is 1:

> **strength = lumen ÷ (683 × π × A)**

where *A* is the glowing area that faces the room. For a single-sided plane that glows from both faces, count both faces' area if both face the room. For a closed shape such as a sphere, the inside faces glow into the closed volume, so count only the outside area **(judgement, from the two-sided emission above)**.

| Lamp, modelled as | Glowing area | Strength (683 lm/W) |
|---|---|---|
| 800 lm bulb, sphere 10 cm across | 0.031 m² | 11.9 |
| 800 lm downlight, disc 10 cm across, one side facing the room | 0.0079 m² | 47.5 |
| 1500 lm panel, 60 × 60 cm, one side facing the room | 0.36 m² | 1.9 |
| 3000 lm tube, 1.2 m long, 26 mm across | 0.098 m² | 14.3 |

All strengths are **(computed)**. If the colour is not normalised to a luminance of 1, divide the strength by its luminance, 0.2126 R + 0.7152 G + 0.0722 B for linear Rec.709 colours. A 2700 K colour scaled so red is 1 has a luminance of only about 0.52, so it needs about twice the strength for the same lumen **(computed, from section 7)**.

### Colour temperature: the Blackbody node

- The node "converts a blackbody temperature to RGB value"; its input is "The temperature in Kelvin" (`manual/render/shader_nodes/color/blackbody.rst`, [source][bman-blackbody]). Blender 5.2's lights also have a *Temperature* option, "Blackbody temperature in Kelvin" (`manual/render/lights/light_object.rst:21-25`).
- In the code, the colour comes from a curve fit valid from 800 to 12,000 K ([`math_util.h:211-243`][bl-mathutil], coefficients in [`tables.h`][bl-tables]), converted from Rec.709 into the scene's colour space ([`shader_nodes.cpp:6535-6541`][bl-nodes]).
- **Its luminance is always 1**, so the colour carries no brightness and the strength alone sets it: the fit gives a luminance of 0.9998 to 1.0002 from 2600 to 12,000 K **(computed, from the coefficients)**. At 2700 K it is (1.935, 0.804, 0.192), with red above 1, which a glTF `emissiveFactor` cannot hold (the schema allows 0 to 1, [material schema][khr-schema]).

### How Blender's glTF importer maps emission

(`io_scene_gltf2/blender/imp/pbrMetallicRoughness.py:552-590`):

- *Emission Color* is set to `emissiveFactor`, or to white when the factor is grey, in which case the grey is folded into the strength.
- *Emission Strength* is set to `emissiveStrength` (default 1), multiplied by that grey.
- There is no photometric conversion: the glTF numbers become Cycles numbers one for one.

Checked by importing three test materials **(tested)**:

| glTF | Blender Emission Color | Blender Emission Strength |
|---|---|---|
| factor (1, 0.682, 0.329), strength 12 | (1, 0.682, 0.329) | 12 |
| factor (0.5, 0.5, 0.5), strength 12 | (1, 1, 1) | 6 |
| factor (1, 0.682, 0.329), no extension | (1, 0.682, 0.329) | 1 |

## 5. Can Rhino's Raytraced view and the bake agree on brightness?

**The light itself, yes.** Both are Cycles. Rhino's Raytraced mode gives the Principled BSDF the same colour-and-strength pair that the glTF file carries and Blender reads back (sections 2 to 4). As long as the strength survives the pipeline (it does not today, section 6), a lamp throws the same light in both **(judgement, from the code of both sides)**.

**The picture on screen, only roughly.** What differs:

| | Rhino Raytraced | Walkthrough (bake, then three.js) |
|---|---|---|
| Sky | The Rhino environment, scaled by the *Skylight* intensity and environment strength factors ([`RhinoBackground.cs`][rc-bg], [Rhino 8 help][rh-render]) | The same EXR at `SKY_EXPOSURE = 1`, turned half a turn (`scripts/bake.py:38-56`) |
| Sun | A separate Rhino sun, if on | Only what the EXR holds |
| Rhino light objects | Lit, at intensity × 40 and similar factors | Lost on export |
| Glossy light, reflections of lamps | Rendered | Not baked; only diffuse light is (`scripts/bake.py:120-127`) |
| The glowing surface itself | Seen at its full brightness | Drawn as base colour × light falling on it, because baked surfaces become `MeshBasicMaterial` with no emission (`src/environment.ts:152-164`) |
| Brightest light kept | Floating point | 4 × the brightest white a surface can show, then clipped (`scripts/bake.mjs:24-28`) |
| Tone mapping | *Tone Mapping* tab: black/white point or logarithmic ([Post Effects help][rh-post]) | Khronos PBR Neutral (`src/main.ts:26`), exposure left at three.js's default |
| Display curve | Linear workflow with a gamma power ([Render document properties][rh-render]) | sRGB |
| Extra effects | Optional *Multiplier*, *Bloom*, *Glow*, *Brightness/Contrast* ([Post Effects help][rh-post]) | None |

To compare like with like, the author would have to keep these fixed **(judgement)**:

1. Light only with glowing materials and the sky: no Rhino light objects and no separate Rhino sun.
2. The same EXR as Rhino's skylight environment, at skylight and environment intensity 1, with no rotation besides the half turn the bake already makes.
3. Raytraced post effects off, or at least no *Multiplier*, *Bloom* or *Glow*, and tone mapping on a black point of 0 and a white point of 1.
4. Judge lamps against each other and against the sky by eye in Rhino, then check them once in the walkthrough. Rhino's tone curve and three.js's Neutral curve differ in the bright end, so very bright patches will not match exactly.

**Lamps against the sky.** With 683 lm/W, a sky pixel of 1.0 means 683 cd/m², and a sky of 1.0 all round gives π × 683 ≈ 2150 lux on open ground **(computed)**. Whether that matches the real sky behind `golden_gate_hills_8k.exr` depends on how its photographer scaled it, which nothing in this pipeline records. Lamps in lumen will be right against each other but not necessarily against the sky; one overall sky factor, `SKY_EXPOSURE`, can correct that **(judgement)**.

## 6. What the pipeline does with emission today

- **`scripts/optimize-environments.mjs`**:
  - deletes `KHR_materials_emissive_strength` from every material and from the file, along with the other extensions Rhino adds (`:31-38`, `:62-77`). Any brightness above 1 is lost here.
  - leaves `emissiveFactor` alone; it is a core glTF property that `simplifyMaterials` does not touch (`:54-78`).
  - re-encodes every texture, emissive ones included, as 8-bit JPEG at quality 80 and at most 1024 px (`:226-231`). `textureCompress` gets no `slots` filter, so all slots are included (glTF-Transform's `TEXTURE_COMPRESS_DEFAULTS`, `node_modules/@gltf-transform/functions/dist/index.js:5520-5531`).
  - gives glowing surfaces second texture coordinates like any other solid, non-metal surface, so they are baked (`:80-96`).
- **`scripts/bake.py`** does nothing on purpose with emission. It imports the glTF, so a glowing material arrives as a Principled BSDF with its *Emission Color* and a strength of 1 (or less, folded from a grey factor). Cycles then counts it as a light in the `DIFFUSE` bake (section 4). Today a lamp therefore lights the bake, but only at the strength left after the optimize step: a white glow of multiplier 12 is baked at 1/12 of its brightness **(computed, from the code)**.
- **The walkthrough** draws a baked glowing surface without its glow (section 5). A glowing metal or glass surface is not baked and keeps three.js's `emissive` from the file, but without the deleted strength **(judgement, from `src/environment.ts:171-205` and three.js's GLTFLoader)**.
- **No file in `models-source/` has a glowing material yet.** Its two Rhino test exports have five materials each, none with `emissiveFactor` or extensions **(tested, by reading their JSON)**.

## 7. 2700 K and 3000 K in 8-bit sRGB, and where the colour is stored at 8 bits

### The colours

From Mitchell Charity's table ([bbr_color.txt][charity]). Its 0–1 columns are linear and the 0–255 columns are sRGB-encoded with red scaled to 255. The 0.4250 of the first row encodes to 174, for example **(computed)**:

| | CIE 1931 2° observer | CIE 1964 10° observer |
|---|---|---|
| 2700 K | 255, 174, 84 `#ffae54` | 255, 169, 87 `#ffa957` |
| 3000 K | 255, 185, 105 `#ffb969` | 255, 180, 107 `#ffb46b` |
| Steps apart | 0, 11, 21 | 0, 11, 20 |

Over those 300 K, one 8-bit step is about **27 K in green and 14 to 15 K in blue (computed)**. Blender's Blackbody node, scaled so red is 1 and sRGB-encoded, gives 255, 173, 89 at 2700 K and 255, 184, 109 at 3000 K **(computed, from the Cycles coefficients)**, within 5 steps of Charity's 2° row.

**One trap (judgement):** the hex code is sRGB-encoded, but Rhino passes the emission colour on unconverted, and glTF and Cycles read it as linear (sections 2 and 3). Typed into Rhino as 255, 174, 84, the 2700 K colour would be used as linear (1, 0.682, 0.329), which looks much whiter than the linear (1, 0.425, 0.089) it stands for. Whether Rhino's colour dialog linearises a picked colour for emission is not confirmed (section 9).

### Where the colour is held at 8 bits

| Stage | Precision |
|---|---|
| Rhino's physically based emission | Floating point (`Color4f`) ([RhinoCommon][rc-emission]). The dialog and named colour list work in whole 0–255 steps ([Rhino help][rh-color]). The exporter reads the 8-bit `EmissionColor` only to recover the strength (section 3) |
| glTF `emissiveFactor`, `emissiveStrength` | Decimal numbers in JSON |
| `optimize-environments.mjs` | Leaves the factor as it is; deletes the strength. Turns any emissive texture into 8-bit JPEG (section 6) |
| Blender and the bake | Floating point; the bake writes a floating-point EXR (`scripts/bake.py:86-131`) |
| `bake.mjs`, the light picture viewers download | **8-bit sRGB JPEG**, quality 90, 4:4:4 chroma, after dividing by 4 (`scripts/bake.mjs:57-81`) |

So a plain colour is first held at 8 bits in the light picture, after the bake. How far apart the two lamps end up there: a white wall lit by each, at the same luminance, is stored as follows **(computed, with `bake.mjs`'s formula, before JPEG)**:

| Wall's baked luminance | 2700 K | 3000 K | Green and blue steps apart |
|---|---|---|---|
| 0.25 | 98, 63, 29 | 93, 65, 35 | 2, 6 |
| 1 | 185, 124, 62 | 178, 127, 74 | 3, 12 |
| 2 | 251, 170, 87 | 242, 174, 103 | 4, 16 |

The two lamps stay several steps apart, more than JPEG at quality 90 usually shifts a smooth area **(judgement)**. Sky light falling on the same wall will dilute the difference, as it does in a real room.

## 8. What would make lamps bake correctly

These are judgements, ordered from smallest change:

1. **Keep the strength for the bake.** Either stop deleting `KHR_materials_emissive_strength`, or fold it into a value the bake can read before deleting it, so Blender sees *factor × strength*. Without this, no Rhino brightness above 1 reaches the bake.
2. **Give glowing surfaces their glow in the walkthrough.** Otherwise a lamp looks unlit while its light falls on the walls. The glow belongs on the `MeshBasicMaterial` that `withBakedLight` makes, and it would need tone-mapping headroom, because a strength of 12 is far beyond white.
3. **Let the author state lumen and kelvin rather than RGB and multiplier.** Section 3 shows that the RGB route loses texture-driven glows, can mix up sRGB and linear colours, and needs the author to work out the strength by hand from the area. A mark such as the material name `Lamp 800lm 2700K` would let `bake.py` set the colour with the Blackbody node and the strength from the surface's measured area, using *lumen ÷ (683 × π × A)*. The author can still set a matching emission in Rhino to preview it in Raytraced mode, but the bake would not depend on it.
4. **Decide once how the sky compares to lamps**, by setting `SKY_EXPOSURE` against a known daylight level or by eye, and then leave it alone.

## 9. Not verified

- **Nothing was rendered in Rhino.** How Raytraced mode handles emission comes from the RhinoCycles `rhino-8.x` source; the author's Rhino 8 service release may differ.
- **Whether Rhino's colour dialog stores a picked emission colour as sRGB numbers or converts it to linear.** The exporter and Raytraced mode both pass the stored number through unconverted, but how the dialog fills it was not traced.
- **Which RGB values Rhino's "list of Kelvin colors" gives**, and whether they are sRGB-encoded.
- **How Rhino's Emission material type (not the physically based one) exports.** The exporter converts it with `ToPhysicallyBased()`, but whether its *Intensity* ends up in the floating-point emission colour, and so in `emissiveStrength`, was not checked.
- **The division by zero** when a glow with no red is pushed above 1 was read from the code, not run.
- **Rhino's default tone mapping and gamma** for Raytraced mode were not looked up; the help describes the settings but not their defaults.
- **Whether Rhino's skylight at intensity 1 shows an EXR at the same brightness as the bake's `SKY_EXPOSURE = 1`.** `RhinoBackground.cs` mixes several strength factors that were not traced to the end.
- **The absolute scale of `golden_gate_hills_8k.exr`**, and so how lamps in lumen compare with its daylight.
- **Rhino's light *Intensity* scale** (0–1 behind a 0–100 % slider) is assumed from the slider's wording, not confirmed in the API reference.
- **The RhinoCommon API pages** describe the current build (they name Rhino 9.0); the properties cited all say "Since 5.0" or "Since 7.0", so they apply to Rhino 8.
- **The Rhino help** was fetched as HTML with the formatting stripped; the help pages for physically based materials and lights could not be fetched directly (403), so their text comes from the Materials and Lights pages that include it.

[gltfio]: https://github.com/mcneel/glTF-IO
[gltfio-tree]: https://github.com/mcneel/glTF-IO/tree/8d066f24b1f74423490ab97c8931842a0478e642
[gltfio-hdr]: https://github.com/mcneel/glTF-IO/commit/d47e6e57dc
[gltfio-mat]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMaterialGltfConverter.cs
[gltfio-doc]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoDocGltfConverter.cs
[gltfio-schema]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTFLoader/Schema/Material.cs
[gltfio-exp]: https://github.com/mcneel/glTF-IO/tree/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter
[rc]: https://github.com/mcneel/RhinoCycles
[rc-tree]: https://github.com/mcneel/RhinoCycles/tree/94fe8416d6aa3f708f075a67a5eb8e08ddd1a418
[rc-shader]: https://github.com/mcneel/RhinoCycles/blob/94fe8416d6aa3f708f075a67a5eb8e08ddd1a418/CyclesShader.cs
[rc-full]: https://github.com/mcneel/RhinoCycles/blob/94fe8416d6aa3f708f075a67a5eb8e08ddd1a418/Shaders/RhinoFullNxt.cs
[rc-convert]: https://github.com/mcneel/RhinoCycles/blob/94fe8416d6aa3f708f075a67a5eb8e08ddd1a418/Converters/ShaderConverter.cs
[rc-defaults]: https://github.com/mcneel/RhinoCycles/blob/94fe8416d6aa3f708f075a67a5eb8e08ddd1a418/Settings/DefaultEngineSettings.cs
[rc-bg]: https://github.com/mcneel/RhinoCycles/blob/94fe8416d6aa3f708f075a67a5eb8e08ddd1a418/Shaders/RhinoBackground.cs
[rh-materials]: https://docs.mcneel.com/rhino/8/help/en-us/commands/materials.htm
[rh-lights]: https://docs.mcneel.com/rhino/8/help/en-us/commands/lights.htm
[rh-post]: https://docs.mcneel.com/rhino/8/help/en-us/properties/posteffects.htm
[rh-color]: https://docs.mcneel.com/rhino/8/help/en-us/user_interface/select_color.htm
[rh-render]: https://docs.mcneel.com/rhino/8/help/en-us/documentproperties/render.htm
[rh-raytraced]: https://docs.mcneel.com/rhino/8/help/en-us/options/view_displaymodes_raytraced.htm
[rhinocommon]: https://mcneel.github.io/rhinocommon-api-docs/api/RhinoCommon/html/R_Project_RhinoCommon.htm
[rc-emission]: https://mcneel.github.io/rhinocommon-api-docs/api/RhinoCommon/html/P_Rhino_DocObjects_PhysicallyBasedMaterial_Emission.htm
[rc-emissioncolor]: https://mcneel.github.io/rhinocommon-api-docs/api/RhinoCommon/html/P_Rhino_DocObjects_Material_EmissionColor.htm
[rc-light]: https://mcneel.github.io/rhinocommon-api-docs/api/RhinoCommon/html/T_Rhino_Geometry_Light.htm
[khr-tree]: https://github.com/KhronosGroup/glTF/tree/7cee0fcddd5730e90d488bfb5aa2e52171483dde
[khr-emissive]: https://github.com/KhronosGroup/glTF/blob/7cee0fcddd5730e90d488bfb5aa2e52171483dde/specification/2.0/Specification.adoc#emissive
[khr-schema]: https://github.com/KhronosGroup/glTF/blob/7cee0fcddd5730e90d488bfb5aa2e52171483dde/specification/2.0/schema/material.schema.json
[khr-strength]: https://github.com/KhronosGroup/glTF/blob/7cee0fcddd5730e90d488bfb5aa2e52171483dde/extensions/2.0/Khronos/KHR_materials_emissive_strength/README.md
[bl-tree]: https://github.com/blender/blender/tree/e13b728c6880d3084d9d57c30031ed5df8b39dee
[bl-emissive]: https://github.com/blender/blender/blob/e13b728c6880d3084d9d57c30031ed5df8b39dee/intern/cycles/kernel/closure/emissive.h
[bl-light]: https://github.com/blender/blender/blob/e13b728c6880d3084d9d57c30031ed5df8b39dee/intern/cycles/scene/light.cpp
[bl-area]: https://github.com/blender/blender/blob/e13b728c6880d3084d9d57c30031ed5df8b39dee/intern/cycles/kernel/light/area.h
[bl-mathutil]: https://github.com/blender/blender/blob/e13b728c6880d3084d9d57c30031ed5df8b39dee/intern/cycles/kernel/svm/math_util.h
[bl-tables]: https://github.com/blender/blender/blob/e13b728c6880d3084d9d57c30031ed5df8b39dee/intern/cycles/kernel/tables.h
[bl-nodes]: https://github.com/blender/blender/blob/e13b728c6880d3084d9d57c30031ed5df8b39dee/intern/cycles/scene/shader_nodes.cpp
[bman-tree]: https://projects.blender.org/blender/blender-manual/src/commit/00a3daa8fd7043ac3bcc52ebe1b73f2f6475dc0b
[bman-emission]: https://projects.blender.org/blender/blender-manual/src/commit/00a3daa8fd7043ac3bcc52ebe1b73f2f6475dc0b/manual/render/shader_nodes/shader/emission.rst
[bman-lights]: https://projects.blender.org/blender/blender-manual/src/commit/00a3daa8fd7043ac3bcc52ebe1b73f2f6475dc0b/manual/render/lights/light_object.rst
[bman-matsettings]: https://projects.blender.org/blender/blender-manual/src/commit/00a3daa8fd7043ac3bcc52ebe1b73f2f6475dc0b/manual/render/cycles/material_settings.rst
[bman-baking]: https://projects.blender.org/blender/blender-manual/src/commit/00a3daa8fd7043ac3bcc52ebe1b73f2f6475dc0b/manual/render/cycles/baking.rst
[bman-blackbody]: https://projects.blender.org/blender/blender-manual/src/commit/00a3daa8fd7043ac3bcc52ebe1b73f2f6475dc0b/manual/render/shader_nodes/color/blackbody.rst
[charity]: http://www.vendian.org/mncharity/dir3/blackbody/UnstableURLs/bbr_color.html
