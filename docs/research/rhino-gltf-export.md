# What Rhino's glTF export carries from the model

Researched 2026-10-12 for [issue #10][issue]. The question: when an author exports an environment from Rhino as one `.glb`, what reaches the file and what is lost? The principle that the Rhino model alone decides how things look and behave depends on the answer.

## Sources and how far to trust each

- **The exporter's own source.** Rhino 8's built-in glTF exporter is open source at [mcneel/glTF-IO][repo] (MIT). All line citations are pinned to commit [`8d066f2`][commit], the tip of the `rhino-8.x` branch on 2026-10-12. The repository has one branch per service release (`rhino-8.0` to `rhino-8.20`), which is how the version notes below were worked out.
- **McNeel's help page** for Rhino 8, [GL Transmission Format (.glb, .gltf) Import/Export][help].
- **The glTF 2.0 specification** from Khronos, [glTF 2.0][spec].
- **First-hand evidence.** The raw Rhino export of the test environment (`models-source/test-environment.glb`, 47 MB, not in git) and the optimized file (`public/models/test-environment.glb`), both read directly from their JSON.
- **The installed glTF-Transform**, version 4.5.1 in `node_modules/@gltf-transform/functions`, for what `npm run optimize` does.

Nothing here was tested by exporting from Rhino during this research. Every statement about blocks, user text, vertex colours and second texture coordinates comes from reading the exporter's source, which is the strongest source short of a test, but a five-minute test export would settle them for good (see "A test file worth making"). Statements marked **(judgement)** are my reading, not something a source says.

## Summary

| Thing in the Rhino model | Does it reach the `.glb`? | Rhino version | After `npm run optimize` |
|---|---|---|---|
| Layer names and nesting | Yes, but only with **Export Layers** ticked, which is off by default | 8.0 onward | Kept |
| Object names | Yes, as the name of the object's node | 8.0 onward | **Lost**: objects on a layer are merged into one mesh |
| User text (custom attributes) | **No.** Nothing is written to glTF `extras` anywhere | 8.0 to 8.20 | Nothing to keep |
| Blocks | **Copied geometry**, not instances. The block's own name, layer and placement are lost | 8.0 onward | Copies merged further |
| Where an object sits (position, rotation, pivot) | **No.** Every node sits at the origin; positions are written into the vertices | 8.0 onward | Same |
| Base colour and its texture | Yes | 8.0 onward | Kept; texture becomes a JPEG of at most 1024 pixels |
| Roughness and metalness, values and textures | Yes | 8.0 onward | Kept |
| Bump or normal texture | Yes, always as a normal map | 8.0 onward | Kept, as a JPEG |
| Transparency | Yes, in two different forms (see below) | 8.0 onward | Reduced to "glass or solid" |
| Emission | Yes, colour, texture and strength | 8.0 onward | Colour and texture kept, **strength dropped** |
| Texture position, rotation, scale | Yes | 8.1 onward | Kept |
| Vertex colours | Yes, but only with **Export vertex colors** ticked, which is off by default | 8.0 onward | Kept |
| A second set of texture coordinates | Only if a texture of the object's material uses a second mapping channel | 8.2 onward | **Overwritten** by the set made for baked light |
| Animation | **No.** The exporter writes none | 8.0 to 8.20 | Nothing to keep |
| Lights, cameras | No | 8.0 to 8.20 | Nothing to keep |

In one sentence: **names and materials arrive; user text, blocks as blocks, placement and animation do not.** The only labels an author can attach in Rhino that survive the export are layer names, object names and material names.

## Each item in detail

### Layer names

With **Export Layers** on, each Rhino layer that holds an exported object becomes an empty node named after the layer, and sublayers become child nodes of their parent layer's node. Objects hang under their layer's node ([`RhinoDocGltfConverter.cs` lines 284 to 332][doc-layers]).

Details that matter:

- **It is off by default.** The saved setting starts as `false` ([`Export_glTFPlugin.cs` lines 274 to 281][plugin-layers]). With it off, every object is put directly in the scene and no layer name is written at all. The walkthrough finds the collision mesh by the layer name "Collision Mesh", so this box must be ticked for every export.
- **The name is the layer's short name**, not its full path (`Name = layer.Name`, [line 313][doc-layers]). Two sublayers called "Doors" under different parents both produce a node called "Doors"; only their parent tells them apart.
- **A layer with nothing exported on it produces no node.** Nodes are made only when an object is added to them.
- Layer colour, visibility, lock state and any other layer property are not written. The help page adds that not every program reads the layers ([help][help]).
- The option exists in every Rhino 8 branch checked, from `rhino-8.0` onward.

First-hand: the raw test export has 15 named layer nodes ("Collision Mesh", "Buildings" and thirteen sublayers such as "3d_Glass") with 902 mesh nodes under them.

### Object names

Each exported object becomes one node, and the node's name is the Rhino object's name. An object with no name gets no name ([`RhinoDocGltfConverter.cs` lines 260 to 264 and 334 to 337][doc-names]). The glTF mesh itself is never named.

First-hand: none of the 902 mesh nodes in the raw test export has a name. That is what an unnamed object produces, so it is consistent with the source, but it means the test environment has not yet shown a name surviving. **Not verified by an export.**

### User text (custom attributes)

**User text does not reach the file.** The exporter's source never reads an object's user text (there is no call to `GetUserStrings`, `GetUserString` or the user dictionary in any export file) and never writes glTF `extras`: the only two mentions of `extras` in the export code are placeholders that are always left empty ([`gltfSchemaDummy.cs`][dummy], [`gltfSchemaSceneDummy.cs`][scene-dummy]). I checked the branches `rhino-8.0`, `8.5`, `8.12`, `8.13`, `8.20` and `rhino-8.x`; none contains it. The repository's issue list has no request for it either.

First-hand: the raw test export has no `extras` on any node, mesh, primitive, material or scene.

For reference, `extras` is the place the glTF specification gives for application data on any object ([spec, "extras"][spec-extras]), and three.js would hand it over as `userData`. The gap is in Rhino's exporter, not in the format.

**Not verified:** whether a later Rhino (9, in development) adds it. No branch for Rhino 9 with such a change was found.

### Blocks

**A block instance is exported as copied geometry.** Before export, every block instance is taken apart, nested blocks included, into the plain objects of its definition, each paired with the instance's placement ([`RhinoDocGltfConverter.cs` lines 475 to 504 and 622 to 641][doc-blocks]). The placement is then applied to a private copy of each object's mesh ([lines 531 to 541 and 568 to 577][doc-blocks-mesh]). So:

- Ten instances of one block produce ten separate meshes with ten copies of the vertices. Nothing in the file says they were the same thing. The glTF way to share geometry (several nodes pointing at one mesh) is not used.
- **The block instance leaves no trace of its own.** There is no node for it. Its name, and the name of its block definition, are not written. Each piece carries the name of the object *inside* the definition, so every instance's pieces have the same names.
- **Each piece goes under the layer of the object inside the definition**, not the layer the instance was placed on (`AddNode(nodeIndex, exportData.Object)`, [line 268][doc-names], where `Object` is the piece). A block placed on a layer called "Doors" whose contents were drawn on "3d_polished_metal" ends up under "3d_polished_metal".
- The pieces of one instance are not grouped together in any way.

This behaviour is in every Rhino 8 branch checked. A forum user asked McNeel for instancing in glTF export on 2026-03-09 and reported the same thing from the outside; the thread has no answer ([forum][forum-instancing]). That post is a user's report, not a McNeel statement.

First-hand: in the raw test export no mesh is used by more than one node. Whether that model contains blocks is **not verified**.

### Where things sit: no positions, no pivots

This was not on the ticket's list but decides a lot for moving parts. **No node in the export has a position, rotation or scale.** The exporter never sets them. The conversion to metres, the turn from Rhino's Z-up to glTF's Y-up, and any block placement are all applied to the vertices themselves ([`RhinoMeshGltfConverter.cs` lines 58 to 68][mesh-pre]).

So a door does not arrive with a hinge, an elevator does not arrive with a start point, and nothing arrives with a local centre to turn around. Every object's origin is the world origin.

First-hand: 0 of 917 nodes in the raw test export have a transform.

Units and up direction: the file is always in metres whatever the Rhino model's units, as the specification requires ([`RhinoDocGltfConverter.cs` lines 125 to 128][doc-units]). "Map Rhino Z to glTF Y" is on by default.

### Material properties and textures

With **Export materials** on (the default), every Rhino material is written as a glTF metal-and-roughness material. A material that is not already a Physically Based material in Rhino is converted to one first ([`RhinoDocGltfConverter.cs` lines 20 to 35][doc-pbr]). The material's name is kept. All of the following are in [`RhinoMaterialGltfConverter.cs`][mat].

| Rhino (Physically Based material) | glTF | Lines |
|---|---|---|
| Base colour, base colour texture | `baseColorFactor`, `baseColorTexture` | [302 to 388][mat-base] |
| Alpha, alpha texture | The alpha of the base colour or of its texture; the material is marked `BLEND` when any alpha is below 1 | [324 to 387][mat-base] |
| Metallic, roughness | `metallicFactor`, `roughnessFactor` | [69 to 86][mat-mr] |
| Metallic and roughness textures | Combined into one `metallicRoughnessTexture` | [675 to 790][mat-mrtex] |
| Bump / normal texture | `normalTexture`, with the texture's amount as its strength. A height (bump) picture is converted into a normal map | [88 to 91][mat-mr], [637 to 647][mat-normal] |
| Ambient occlusion texture | `occlusionTexture` | [93 to 96][mat-mr] |
| Emission colour and texture | `emissiveFactor`, `emissiveTexture`, and `KHR_materials_emissive_strength` when the emission is brighter than 1 or has a texture | [98 to 151][mat-emission] |
| Opacity and opacity texture | `KHR_materials_transmission`, as 1 minus opacity | [153 to 169][mat-transmission] |
| Clearcoat, its roughness, its bump | `KHR_materials_clearcoat` | [171 to 200][mat-clearcoat] |
| Index of refraction | `KHR_materials_ior` | [202 to 209][mat-clearcoat] |
| Specular | `KHR_materials_specular` | [211 to 226][mat-clearcoat] |
| Texture offset, rotation, repeat | `KHR_texture_transform` on each texture | [900 to 942][mat-transform] |

Details that matter:

- **Transparency arrives in two different forms.** Rhino's *Opacity* becomes transmission (light passing through, as glass). Rhino's *Alpha* becomes plain see-through alpha with `BLEND`. The walkthrough's glass rule reads the first.
- **Every material carries all four of the transmission, clearcoat, index-of-refraction and specular extensions**, even when they do nothing. The raw test export confirms it on all 13 materials.
- **A texture is exported only if it is switched on in the material and its picture file exists on disk** at the path Rhino has for it ([lines 982 to 1000][mat-can]). A missing file drops the texture silently. Pictures packed inside the `.3dm` with no file on disk, and Rhino's procedural textures, are a risk here: **not verified**.
- **Every texture is stored again as a PNG** inside the file ([lines 879 to 891][mat-png]), whatever it was before. This is a large part of why the raw export is 47 MB.
- **Textures are asked to be shown without mipmaps** (the one sampler is plain linear, [`RhinoDocGltfConverter.cs` lines 176 to 182][doc-sampler]), which the optimize step already corrects.
- **Surfaces are one-sided by default.** "Cull backfaces" is on by default, which writes `doubleSided: false` ([line 51][mat-mr]).
- Displacement is not exported. Other Rhino material features with no glTF counterpart (for example subsurface scattering) have nowhere to go.
- Texture offset, rotation and repeat are in `rhino-8.1` and later, not in `rhino-8.0`.

First-hand, from the raw test export: material names such as "Vetro", "Water", "Travertine Wall" and "Metallo" arrive intact; "Vetro" carries transmission 1 and index of refraction 1.497; "Plastica" carries roughness 0.666 and transmission 0.39; six base colour textures arrive, each with a texture transform. The test environment has no normal, roughness, metalness or emission textures, so **those rest on the source alone**.

**Not verified:** how a material assigned to single faces of a polysurface (rather than to the whole object) is exported.

### Vertex colours

Vertex colours are written as `COLOR_0` only when the mesh has them **and** "Export vertex colors" is ticked ([`RhinoMeshGltfConverter.cs` lines 217 to 222 and 278 to 281][mesh-colour]). The box is **off by default** ([`Export_glTFPlugin.cs` lines 211 to 218][plugin-colour]). They are written as four numbers per vertex (red, green, blue, alpha) ([lines 717 to 736][mesh-colour-acc]). Present from `rhino-8.0`.

Only meshes carry vertex colours in Rhino. A surface or polysurface has none unless something has put them on its render mesh. The help page names the Rhino commands `ComputeVertexColors` and `RebuildMesh` in this context ([help][help]).

The glTF specification asks every program that shows glTF to support at least one set of vertex colours, and says they multiply the base colour ([spec, meshes][spec-mesh]). The test export has none, so this is **not verified by an export**.

### A second set of texture coordinates

Since `rhino-8.2`, the exporter writes one set of texture coordinates per Rhino mapping channel, as `TEXCOORD_0`, `TEXCOORD_1` and so on ([`RhinoMeshGltfConverter.cs` lines 70 to 107 and 200 to 215][mesh-uv]). In `rhino-8.0` and `8.1` there is only ever one set.

The catch is which channels count. A channel is written only if the object has a texture mapping on that channel **and** a texture of the object's material uses it; the source says so in a comment: "only the mappings used by the material are set in the cached texture coordinates" ([line 99][mesh-uv]). So an author cannot ship a spare second set (say, a hand-made unwrap for baked light) just by adding a second mapping channel in Rhino. It would arrive only if some texture in the material were set to use channel 2.

Other details:

- The sets are numbered in the order they are found, not by Rhino's channel number, and each texture is pointed at the right one ([`RhinoMaterialGltfConverter.cs` lines 960 to 980][mat-texcoord]).
- Since `rhino-8.14` (the change is dated 2024-10-09), textures using Rhino's "WCS" and "WCS box" mapping get extra sets of their own ([`RhinoMeshGltfConverter.cs` lines 111 to 140][mesh-wcs]).
- With Draco compression on, only the first set is declared in the compressed data ([lines 237 to 240][mesh-draco]). **Not verified** whether further sets survive Draco; the pipeline does not use Draco on export, so it does not matter today.
- Objects with no texture coordinates at all get none: in the raw test export only 144 of 902 meshes have `TEXCOORD_0`, and none has a second set.

### Animation

**The exporter writes no animation.** It has an empty list for animations, skins and cameras and never adds to any of them ([`gltfSchemaDummy.cs`][dummy]). There are no morph targets either. The plug-in's announcement on McNeel's forum listed lights, cameras and animations as known limitations ([forum thread](https://discourse.mcneel.com/t/gltf-binexport/114378); read through a search summary, not quoted directly).

First-hand: the raw test export has 0 animations, 0 skins and 0 cameras.

### Other things that do or do not arrive

- **Surfaces arrive as their render meshes.** Each object becomes one glTF mesh with one part per render mesh. "Export open meshes" is on by default; with it off, anything not closed is dropped.
- **Lines and polylines arrive as lines**, with their object name and under their layer ([`RhinoDocGltfConverter.cs` lines 218 to 251][doc-curves]). Other curves are not exported at all ([help][help]). Point clouds arrive as points.
- **Not verified:** whether hidden objects and objects on layers that are turned off are exported. The exporter simply walks Rhino's list of objects ([`Export_glTFPlugin.cs` lines 84 to 95][plugin-objects]) and I could not confirm from McNeel's documentation what that list includes.
- **Rhino 7** had no built-in glTF exporter; it used the plug-in this code grew from ([Stykka/glTF-Bin][stykka], now marked deprecated in favour of mcneel/glTF-IO). Nothing above was checked against it.

## What the optimize step keeps and throws away

From `scripts/optimize-environments.mjs` and the installed glTF-Transform, checked against the committed `public/models/test-environment.glb`.

**Kept**

- Layer nodes, with their names and nesting. The collision mesh is found by the layer name "Collision Mesh".
- Material names.
- Base colour, base colour texture, roughness, metalness, normal texture, occlusion texture, emission colour and emission texture.
- Texture offset, rotation and repeat.
- Vertex colours, if the export had them: `prune()` removes unused texture coordinates but leaves `COLOR_0` alone (`listUnusedSemantics` in `@gltf-transform/functions`).

**Thrown away or changed**

- **Object names and separate objects.** `join()` merges every mesh under the same layer that shares a material into one, and runs with `keepNamed: false` by default, so named objects are merged like the rest. The test environment goes from 902 mesh nodes to 14, one per layer. After this step there is no "this door" to find; there is only "everything on this layer".
- **Transmission, clearcoat and emission strength** on every material, and **index of refraction and specular** on everything that is not glass (`DROPPED_EXTENSIONS`, `KEPT_ON_GLASS`).
- **Graded transparency.** A material is glass (`BLEND`) if its transmission is above 0.5 and solid otherwise, and every base colour's alpha is set to 1. "Plastica", exported with transmission 0.39, becomes solid. The two test materials Rhino marked `BLEND` because their textures have alpha ("Custom", "Custom (1)") become solid too.
- **Alpha in textures.** Every texture is re-saved as a JPEG, which cannot hold alpha, at no more than 1024 pixels on its longest side. Cut-out textures (leaves, fences) cannot survive this as written. Normal maps are also saved as JPEG.
- **Any second set of texture coordinates from Rhino.** On every surface that takes baked light, `unwrapPrimitives(..., { texcoord: 1, overwrite: true })` replaces `TEXCOORD_1` with the set made for baked light. If a Rhino material ever pointed a texture at a second mapping channel, that texture would then read the baked-light set and look wrong. Nothing in the test environment does this.
- Empty nodes, unused materials and unused pictures (`prune()`).

`npm run bake` does not rewrite the `.glb`: `scripts/bake.py` only opens it in Blender and writes the baked light as a separate picture, so it loses nothing further.

One loose end seen while comparing the two files: "Water" has index of refraction 1.33 in the raw export but 1 in the committed optimized file. The committed file may simply come from an older export. **Not investigated.**

## What this means for the plan **(judgement)**

1. **The principle holds for how things look, and only partly for how they behave.** Materials come across well. But the Rhino model has just three places to say what something *is* that survive export: its layer's name, its object name and its material's name. User text, the natural place for settings such as "this is a door, it swings 90 degrees", does not survive.
2. **Moving parts, sway and traffic need a naming convention.** Since `extras` is out, behaviour has to be read from layer names or object names (for example a layer per kind of moving part, or a name pattern), or from the environment's settings file that sits beside the `.glb`.
3. **Pivots and routes have to be drawn as geometry.** Nothing arrives with a position or a hinge. A line or polyline does arrive, as a line with its name and layer, so an author could draw a hinge axis or a traffic route as a named line on a known layer. The walkthrough would have to work out a moving part's pivot from such a line or from the part's own bounding box.
4. **Blocks give no saving and no grouping.** An author may still use blocks to model repeated things, but the file gets a full copy of each, on the layers used inside the block, with nothing tying an instance's pieces together. Things that must stay together as one moving part are safer as one named object or on a layer of their own than as a block. Repeated things that should be drawn cheaply (grass, trees) would have to be recognised as repeats after export, since the export does not say so. This bears on the open question about the 34 MB grass environment.
5. **The optimize step must stop merging whatever needs to stay separate.** As written it erases object names. `join()` accepts `keepNamed: true` and a `filter`, either of which could protect moving parts while still merging the still architecture.
6. **Two export boxes are off by default and matter:** "Export Layers" (required today) and "Export vertex colors" (required if vertex colours are ever used, for example to mark how much each part of a plant sways). An author's export settings are not recorded in the file, so the setup notes should list them.

## A test file worth making

Ten minutes in Rhino would turn every "not verified" above into a fact. One small model containing:

- a named box on a named sublayer, with one user text key;
- a block of two named objects, placed twice on a different layer from its contents;
- a mesh with vertex colours (export with "Export vertex colors" ticked);
- a box whose material has a roughness texture, a bump texture and an emission colour above 1;
- a box with two mapping channels, with the material's bump texture set to channel 2;
- a named line;
- one hidden object and one object on a layer that is turned off.

Exported once as `.glb` with "Export Layers" on, then read with the same small script used for this note (it prints names, `extras`, transforms, shared meshes and attributes from the file's JSON).

[issue]: https://github.com/futureradius/walkthroughlab/issues/10
[repo]: https://github.com/mcneel/glTF-IO
[commit]: https://github.com/mcneel/glTF-IO/tree/8d066f24b1f74423490ab97c8931842a0478e642
[stykka]: https://github.com/Stykka/glTF-Bin
[help]: https://docs.mcneel.com/rhino/8/help/en-us/fileio/gltf_import_export.htm
[spec]: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
[spec-extras]: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-extras
[spec-mesh]: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#meshes-overview
[forum-instancing]: https://discourse.mcneel.com/t/gltf-instancing-support/216765
[doc-layers]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoDocGltfConverter.cs#L284-L332
[doc-names]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoDocGltfConverter.cs#L253-L337
[doc-blocks]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoDocGltfConverter.cs#L475-L504
[doc-blocks-mesh]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoDocGltfConverter.cs#L525-L580
[doc-units]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoDocGltfConverter.cs#L125-L128
[doc-pbr]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoDocGltfConverter.cs#L20-L35
[doc-sampler]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoDocGltfConverter.cs#L176-L182
[doc-curves]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoDocGltfConverter.cs#L218-L251
[plugin-layers]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/Export_glTFPlugin.cs#L274-L281
[plugin-colour]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/Export_glTFPlugin.cs#L211-L218
[plugin-objects]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/Export_glTFPlugin.cs#L84-L95
[dummy]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/gltfSchemaDummy.cs
[scene-dummy]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/gltfSchemaSceneDummy.cs
[mesh-pre]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMeshGltfConverter.cs#L58-L68
[mesh-uv]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMeshGltfConverter.cs#L70-L107
[mesh-wcs]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMeshGltfConverter.cs#L111-L140
[mesh-draco]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMeshGltfConverter.cs#L237-L240
[mesh-colour]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMeshGltfConverter.cs#L217-L281
[mesh-colour-acc]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMeshGltfConverter.cs#L717-L736
[mat]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMaterialGltfConverter.cs
[mat-base]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMaterialGltfConverter.cs#L302-L388
[mat-mr]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMaterialGltfConverter.cs#L44-L96
[mat-mrtex]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMaterialGltfConverter.cs#L675-L790
[mat-normal]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMaterialGltfConverter.cs#L637-L647
[mat-emission]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMaterialGltfConverter.cs#L98-L151
[mat-transmission]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMaterialGltfConverter.cs#L153-L169
[mat-clearcoat]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMaterialGltfConverter.cs#L171-L226
[mat-transform]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMaterialGltfConverter.cs#L900-L942
[mat-texcoord]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMaterialGltfConverter.cs#L960-L980
[mat-can]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMaterialGltfConverter.cs#L982-L1000
[mat-png]: https://github.com/mcneel/glTF-IO/blob/8d066f24b1f74423490ab97c8931842a0478e642/glTF-BinExporter/RhinoMaterialGltfConverter.cs#L879-L891
