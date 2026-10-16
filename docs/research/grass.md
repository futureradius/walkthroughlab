# Rebuilding Girardot's card grass for WebGL2

Ghislain Girardot's grass is not a per-blade system: it is a mesh of flat, straight, alpha-textured cards (several blades per card) whose entire shape is produced in the vertex shader from four baked per-card values (pivot, normalised height, a random scalar, a random 2D direction), in a fixed order: centre on the pivot, scale, turn toward the camera in 2D, bend with a sine/cosine arc, rotate by a 3x3 basis whose up axis has been tilted by a clump vector and a wind vector, then translate back ([V@2:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=151s), [V@23:30](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1410s)). "Clumping" here means a pre-generated tiling texture of 2D lean vectors, made by additively stamping a few hundred ring-masked radial brushes, sampled once per card at the pivot and added to the card's up axis before normalising; it is not Voronoi cells and it carries no height or colour ([V@11:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=691s), [V@14:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=840s)). Wind uses exactly the same slot: a tiling 2D velocity texture, sampled at the pivot, scaled by how much the card faces the wind, added to the same axis, and also used to straighten the resting bend ([V@15:50](https://www.youtube.com/watch?v=yYE1Hfg067I&t=950s), [V@19:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1171s)). Every step ports to three.js r186 `WebGLRenderer` with an `InstancedMesh`, a `ShaderMaterial` and two vertex-stage texture fetches; what does not port is Unreal's Two Sided Foliage shading, temporally resolved dithered opacity and pixel depth offset, which need the substitutes described below. The critical caveat for the implementer is evidential: **the video's project files are Patreon-only, no source code was read, the frames were not seen, and the video speaks almost no numeric constants**, so every formula here is either the author's spoken description or a labelled reconstruction, and every strength, tile size and count is a tunable. In walkthroughlab the grass must additionally stay out of (or cooperate with) the override-material ambient-occlusion pass, stay `transparent = false`, and take its light from the baked light picture sampled at each card's root, because the project has no lights and its ADR 0002 currently forbids anything in an environment from moving.

## How to read this: four evidence labels and three blind spots

Every technical statement below carries one of four labels. **STATED** means the author says it in the target video, with a timestamp link of the form `V@m:ss`. **COMPANION** means he says it in part 1 (the wind video, [P7lZ-D-Fkus](https://www.youtube.com/watch?v=P7lZ-D-Fkus)) or part 3 (the Blender asset video, [BFnwkBv19TA](https://www.youtube.com/watch?v=BFnwkBv19TA)) of the same series. **CODE** means text read from a named open-source file or from three.js r186 itself; none of it is Girardot's. **INFERENCE** means a reconstruction by the researchers or by this report, unverified and never run. **UNKNOWN** marks a value no source gives.

Three blind spots bound what the labels can promise. First, the source is the English auto-generated caption track, read end to end, with timestamps accurate to about 30 seconds; node graphs, parameter panels and the one on-screen HLSL snippet (the bend node) were not captured. Second, the description links only a paywalled Patreon, the Ghost of Tsushima GDC talk and a Tech Art Aid optimisation video; there is no repository, gist or blog, and the tweet holding the bend HLSL was not found ([watch page](https://www.youtube.com/watch?v=yYE1Hfg067I)). Third, the author himself corrected axis signs mid-video after disabling two-sided rendering to check facing, so the earlier on-screen graph is not the final one ([V@29:30](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1770s)); cross-product operand order and signs are therefore not recoverable and must be verified the way he did, by rendering single-sided.

The video is a 43:51 Unreal Engine 5 tutorial published 2024-02-29, part 2 of three. Its stated goal is to reproduce the feature set of the Ghost of Tsushima grass (clump, tilt, bend, wind, camera facing) "using nothing but World Position Offset tricks", without geometry or compute shaders ([V@1:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=60s), [V@2:01](https://www.youtube.com/watch?v=yYE1Hfg067I&t=121s)). That lineage is treated in its own section near the end so that the two approaches stay distinct. One convention matters throughout: Unreal is Z-up and the video's cards face +X with height along Z; all reconstructed code in this report is rewritten for three.js Y-up, with cards whose plane normal is +X, height along +Y and width along Z. That rewrite is itself INFERENCE.

## The unit is a multi-blade card carrying four baked values

The source mesh is "flat cards ... straight, purposely undeformed and ... all oriented towards the positive x-axis" (STATED, [V@1:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=91s)). Each card is an alpha-textured polygon showing a group of blades; one grass asset (one instance) is a scatter of such cards. The author is explicit that the card-per-several-blades compromise is deliberate: "it's unlikely you can afford one single grass card or mesh per grass blade ... got to find some kind of in between" ([V@38:32](https://www.youtube.com/watch?v=yYE1Hfg067I&t=2312s)). Blade silhouette, taper and the root-to-tip colour gradient all live in the texture atlas, which is rendered from high-poly blades in Blender; the shader computes none of them (the gradient part is INFERENCE from part 3's description of the texture set, [part 3 @35:17](https://www.youtube.com/watch?v=BFnwkBv19TA&t=2117s)).

Per-vertex data, as STATED: UV0 maps the grass texture; card pivots are baked into UVs with his Blender "data baker" add-on; a further UV holds "normalized height in UV in the vertical axis and a random value per card in the horizontal axis" ([V@1:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=91s)); and because the normal is rebuilt from scratch, the vertex normal channel is repurposed to store "a random 2D direction" per card ([V@5:32](https://www.youtube.com/watch?v=yYE1Hfg067I&t=332s)). The random direction and scalar must be identical for the same card in every LOD, or a LOD switch makes the card jump; an in-engine attempt to assign them per mesh component failed because LODs delete cards and reorder components, so the bake is done in Blender ([V@6:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=391s), [part 3 @33:01](https://www.youtube.com/watch?v=BFnwkBv19TA&t=1981s)). The direction is reused three times: as the card's yaw, and as a UV offset that decorrelates the clump lookup and the wind lookup ([V@8:30](https://www.youtube.com/watch?v=yYE1Hfg067I&t=510s), [V@14:32](https://www.youtube.com/watch?v=yYE1Hfg067I&t=872s), [V@15:50](https://www.youtube.com/watch?v=yYE1Hfg067I&t=950s)).

In WebGL2 there is no reason to hide data in the normal; plain extra attributes do the job. The layout below is INFERENCE that preserves the STATED content.

| Attribute | Type | Rate | Content | Source of the content |
|---|---|---|---|---|
| `position` | vec3 | vertex | Flat card in tuft-local space, plane normal +X, height +Y | STATED (axes converted) |
| `uv` | vec2 | vertex | Atlas coordinates | STATED |
| `cardPivot` | vec3 | vertex, constant per card | Card root in tuft-local space | STATED (baked in UVs in UE) |
| `heightNorm` | float | vertex | 0 at root, 1 at tip | STATED |
| `cardRand` | float | vertex, constant per card | Random 0..1, LOD-stable | STATED |
| `cardDir` | vec2 | vertex, constant per card | Random unit direction in the ground plane, LOD-stable | STATED (stored in normal in UE) |
| `instanceMatrix` | mat4 | instance | Position, uniform scale, optional ground alignment | STATED (UE foliage instance) |
| `aLightUv` | vec2 | instance | Baked-light UV of the lawn under the instance | INFERENCE (walkthroughlab only) |

Card authoring is COMPANION material: cards are hand-traced polygons around groups of blades on a rendered opacity atlas, with vertices placed to minimise transparent overdraw and to allow deformation; LOD0 is traced first, then LOD1 and LOD2 "ideally reducing the vertex count by half each time", the last LOD being "a single quad or even a single triangle"; cards are scattered inside one asset with Blender's randomize-transform and hand-tuned to be evenly spaced with a good silhouette from any angle ([part 3 @25:00](https://www.youtube.com/watch?v=BFnwkBv19TA&t=1500s), [part 3 @27:02](https://www.youtube.com/watch?v=BFnwkBv19TA&t=1622s), [part 3 @31:32](https://www.youtube.com/watch?v=BFnwkBv19TA&t=1892s)). The texture set rendered from Blender is albedo, opacity, normal, roughness, specular, height, a per-blade random map and transmission, worked in linear and dilated (mip-flooded) so background colour does not bleed into lower mips ([part 3 @35:17](https://www.youtube.com/watch?v=BFnwkBv19TA&t=2117s)). **Vertex counts per card, cards per mesh, card dimensions, instance density and cull distances are UNKNOWN**: none is spoken.

Placement is delegated to Unreal's foliage instancing with "align to normal" enabled, and instances are assumed uniformly scaled ([V@9:02](https://www.youtube.com/watch?v=yYE1Hfg067I&t=542s), [V@3:01](https://www.youtube.com/watch?v=yYE1Hfg067I&t=181s)). The video adds only one placement control of its own, the per-card spread described in the next section.

## One vertex chain: centre, scale, face, bend, tilt-rotate, place

The order of operations is the technique. It is forced by three STATED constraints: camera facing must precede the bend (otherwise the result is "really bizarre"); the bend must act on X-aligned cards, so it precedes the per-card rotation; and because that later rotation would destroy the facing, the view vector is pre-rotated by the inverse of the card's yaw ([V@23:30](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1410s), [V@24:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1440s)). Each stage follows in execution order.

### Centre on the pivot and scale

STATED, in Unreal terms: subtract the world position to collapse every vertex to the origin, add the vertex local position, subtract the baked pivot so each card is centred on zero, apply scale and rotation, then add the pivot transformed to world space; the sum is output as an offset ([V@2:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=151s), [V@3:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=211s)). Because the position is rebuilt from scratch, instance rotation is discarded and cards "all remain straight regardless of the instance rotation" ([V@4:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=240s)). In three.js the collapse trick is unnecessary: compute the world position directly from `position - cardPivot` and the instance translation and scale (INFERENCE).

Scale is a product of four factors (STATED): the per-instance fade amount, a 0-to-1 value derived from the instance's start and end cull distances that shrinks cards as they approach the cull distance; the instance's uniform scale, obtained as the length of a local up unit vector transformed to world; a user scale parameter; and a texture-driven factor that includes a baked landscape-layer mask shrinking cards near other ground layers ([V@3:01](https://www.youtube.com/watch?v=yYE1Hfg067I&t=181s), [V@25:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1531s), [V@27:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1651s)).

### Turn toward the camera, in 2D, in the card's own frame

The purpose is "perceived grass density": a card edge-on to the camera costs "vertex processing for no pixel coverage" ([V@20:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1231s)). STATED construction: take the camera forward vector (a view-space Z transformed to world); drop its vertical component and normalise, which removes the billboard tilt; if the squared length is close to zero (looking straight up or down), substitute the camera's up vector transformed to world; then express that 2D vector in the card's pre-rotation frame by rotating it "by the inverse of that upcoming card rotation", which "because I work in 2D space here ... can be simplified" using the card's forward vector ([V@21:01](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1261s), [V@21:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1291s), [V@24:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1440s)). After the bend, "the mesh kind of rolls on itself to face the camera"; the effect is stronger on wide cards and his are thin ([V@22:02](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1322s)). He claims "quite a visible difference in grass density but same vertex count", odd on a single mesh but "pretty much invisible" in context ([V@25:02](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1502s)).

The reconstruction (INFERENCE): with card forward `F = cardDir` and its in-plane perpendicular `W0`, the view vector in the card frame is `vLocal = (dot(v, F), dot(v, W0))`; the card is then yawed about its local up so its plane normal lies along `vLocal`. Whether the video applies this at full strength or blends it is UNKNOWN, so expose a `uFacing` amount. In Unreal's shadow pass "view space" is the light's, so cards face the light there; he accepts either that or a camera-based variant and notes a shadow-pass switch can disable it ([V@22:30](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1350s)). Walkthroughlab has no shadow pass, so this caveat only matters for the AO depth pass, where the camera is the same.

### Bend with a sine and a cosine

STATED: the rest curve is "a mathematical approach, it uses a sine and a cosine", an HLSL custom node "pretty much identical to the bend modifier I shared on my Twitter"; it requires X-aligned cards, and "only once cards are bent do I apply the rotation matrix"; the node "not only bends the mesh but also outputs the bend direction", which seeds the normal ([V@18:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1080s), [V@19:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1140s)). The bend amount is varied by a noise texture and reduced by the wind's horizontal magnitude: "grass is naturally curved when standing still but is straightened the stronger the wind force" ([V@19:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1171s)). He reports the trigonometry "didn't measurably impact performance", with the caveat "don't quote me on that" ([V@18:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1080s)). Alternatives he names are a baked 2D curvature map (as Epic did for Fortnite grass) and morph targets baked in vertex colours or UVs.

**The HLSL text was not captured.** The reconstruction (INFERENCE) is the standard length-preserving arc bend: for a point at arc length `s` along the blade (its pre-bend height) and offset `d` along the card normal, with curvature `k` in radians per unit and `a = k * s`, the centre line is `(±(1 - cos a) / k, sin a / k)` in the (forward, up) plane and the point lands at `centre + d * n(a)`, where `n` is the unit normal of the arc. Two things in the source constrain the sign. He says the forward normal "starts at +X and shifts toward Z as the card curves" ([V@31:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1860s)), which in Y-up means the +X face ends up facing the sky, so the blade arcs toward -X and `n = (cos a, sin a)`. He also says the node "bends the mesh around the x-axis", which read literally contradicts a bend in the forward/up plane; the research notes flag this conflict as unresolved. Use the arc form, guard `k` near zero, and settle the sign visually.

### Rotate by a basis whose up axis has been tilted

This is the core device. Instead of stacking trigonometric rotations, the card is re-expressed in a 3x3 basis built from vectors: pick an X axis, pick a Z (up) axis, take Y as their cross product, and multiply the centred position by the matrix ([V@5:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=300s)). All of the following is STATED. For random yaw, X is the baked per-card 2D direction with zero vertical component, up is world up, and the material must be two-sided ([V@8:30](https://www.youtube.com/watch?v=yYE1Hfg067I&t=510s)). For terrain alignment, the instance's local up transformed to world and normalised is the ground normal at the instance; because the flat direction and the slanted up are no longer orthogonal, do two cross products (axis1 = cross of up and the direction, axis2 = cross of axis1 and up, axis3 = up) and "make sure to normalize cross products when using non-orthogonal vectors"; a lerp between world up and the ground normal controls straight versus slanted and can be pushed past 1 ([V@9:02](https://www.youtube.com/watch?v=yYE1Hfg067I&t=542s), [V@10:01](https://www.youtube.com/watch?v=yYE1Hfg067I&t=601s)). And the tilt: "as long as [the up vector] doesn't equal that [X] vector ... that 3x3 matrix is well defined and stable so I can shift this Z vector in X and Y as much as I want to tilt cards more and more" ([V@10:32](https://www.youtube.com/watch?v=yYE1Hfg067I&t=632s)).

Clump and wind are both nothing more than horizontal offsets added to that up vector before it is normalised. The baked height gradient can lerp the offset in along the blade "to fade in that offset along the grass length and create some kind of curvature", with separate multipliers for clump and wind ([V@17:01](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1021s)). Because everything is normalised together, "the more wind the less that other offset participates ... it will reorient itself to face the wind the stronger the wind blows" ([V@20:01](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1201s)). As a formula (INFERENCE as written, STATED in substance):

`up = normalize( mix(worldUp, groundNormal, alignAmt) + horizontal( clumpXY * kClump * g + windXY * kWind * g ) )`, with `g = mix(1, heightNorm, curvature)`.

When `g` is constant the tilt is a rigid lean about the pivot and blade length is preserved; when `g` varies with height the basis differs per vertex, the card curves, and some stretch appears (INFERENCE).

### Place the card, with spread

STATED: the card's final translation is `lerp(instance world position, pivot transformed to world, spread)`. At 0 every card sits on the instance origin; raising it spreads them; values above the authored layout exceed the mesh bounds, so "you might want to increase the mesh bounds a bit"; **the base value used is 1**, one of the very few numbers spoken ([V@3:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=211s), [V@4:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=240s)). Driving `spread` with a noise texture gives positional clumping (next section).

### The whole stage as one GLSL sketch

The block below is INFERENCE end to end: a synthesis of the spoken description in three.js conventions, never compiled. Signs, cross-product order and every `u*` uniform are unverified placeholders. It is original to this research, not quoted from any licensed source.

```glsl
// three.js Y-up. Card rest pose: plane normal +X, height +Y, width Z, tuft-local.
// ShaderMaterial on an InstancedMesh: three injects position, uv, instanceMatrix,
// modelMatrix, viewMatrix, projectionMatrix.
attribute vec3  cardPivot;   // constant per card
attribute vec2  cardDir;     // constant per card, unit, world XZ
attribute float cardRand;    // constant per card
attribute float heightNorm;  // 0 root .. 1 tip
attribute vec2  aLightUv;    // per instance

void main() {
  mat4  inst      = modelMatrix * instanceMatrix;
  vec3  instPos   = inst[3].xyz;
  float instScale = length(inst[1].xyz);          // uniform scale assumed
  vec3  groundN   = inst[1].xyz / instScale;      // valid if instances are aligned to the surface
  vec3  pivotW    = (inst * vec4(cardPivot, 1.0)).xyz;

  // one lookup point per card: the pivot, decorrelated by the card's random direction
  vec2 lookup = pivotW.xz + cardDir * uUvRandomness;
  vec2 clump  = (textureLod(uClumpMap, lookup / uClumpTile, 0.0).rg - uZero) * 2.0;
  vec2 wind   = (textureLod(uWindMap, lookup / uWindTile + uWindOffset, 0.0).rg - uZero) * 2.0 * uWindMax;
  float sail  = abs(dot(normalize(wind + 1e-5), cardDir));   // abs vs clamp: UNKNOWN
  wind       *= mix(1.0, sail, uSail);

  // 0. centre on pivot, scale
  vec3 p = (position - cardPivot) * instScale * uScale * fadeAndMask;   // fadeAndMask: see text

  // 1. 2D camera facing, expressed in the card's pre-rotation frame
  vec2 v = -vec2(viewMatrix[0][2], viewMatrix[2][2]);                   // camera forward, XZ
  if (dot(v, v) < 1e-4) v = vec2(viewMatrix[0][1], viewMatrix[2][1]);   // camera up, XZ
  v = normalize(v);
  vec2 widthDir = vec2(-cardDir.y, cardDir.x);
  vec2 n2 = vec2(dot(v, cardDir), dot(v, widthDir));
  if (n2.x < 0.0) n2 = -n2;                       // two-sided: take the nearer face
  n2 = normalize(mix(vec2(1.0, 0.0), n2, uFacing));
  p.xz = p.x * n2 + p.z * vec2(-n2.y, n2.x);

  // 2. rest bend, straightened by wind
  float k = uBendMax * bendNoise * (1.0 - clamp(length(wind) * uWindStraighten, 0.0, 1.0));
  float a = k * p.y;
  vec2  arcN = vec2(cos(a), sin(a));              // arcs toward -X; sign UNVERIFIED
  if (abs(k) > 1e-4) p.xy = vec2(-(1.0 - cos(a)) / k, sin(a) / k) + p.x * arcN;

  // 3. tilted card basis
  float g    = mix(1.0, heightNorm, uCurvature);
  vec2  tilt = (clump * uClumpStrength + wind * uWindStrength) * g;
  vec3  U  = normalize(mix(vec3(0.0, 1.0, 0.0), groundN, uAlign) + vec3(tilt.x, 0.0, tilt.y));
  vec3  F0 = vec3(cardDir.x, 0.0, cardDir.y);
  vec3  W  = normalize(cross(F0, U));
  vec3  F  = cross(U, W);
  p = mat3(F, U, W) * p;

  // 4. placement
  vec3 worldPos = mix(instPos, pivotW, uSpread) + p;
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
```

The basis check for the conventions above: with `F0 = (1,0,0)` and `U = (0,1,0)`, `cross(F0, U) = (0,0,1)` and `cross(U, W) = (1,0,0)`, so an untilted card is unchanged. Everything in stages 1 and 3 that depends only on per-card data is constant across a card's vertices but is recomputed per vertex; the author's own summary is that "the pixel shader is actually quite simple and cheap; the vertex shader however, there's quite a lot going on", so vertex count must be kept "under control" with aggressive LODs ([V@40:34](https://www.youtube.com/watch?v=yYE1Hfg067I&t=2434s)).

## Clumps are a stamped lean-vector texture, not Voronoi cells

The author says clumps "played a key role in the final look" ([V@11:01](https://www.youtube.com/watch?v=yYE1Hfg067I&t=661s)). His clump map is a static, tiling texture of 2D direction vectors, and it controls exactly one thing: which way, and how far, each card leans. There is no clump ID and no per-clump height, colour, width or yaw (INFERENCE from the absence of any such mechanism in the transcript). Height variation comes separately from scale noise and the landscape mask.

The generator, all STATED: an editor tool draws a "brush material" into a render target in a loop "a few hundred times", randomising brush parameters and position each time, "using an additive process", then saves a static texture ([V@11:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=691s), [V@12:01](https://www.youtube.com/watch?v=yYE1Hfg067I&t=721s)). The brush computes "the 2D position delta between the brush position in UV space and UVs; that delta is then safely normalized to derive a radial direction", with the UVs first distorted by a noise node for "a bit more flow" ([V@12:32](https://www.youtube.com/watch?v=yYE1Hfg067I&t=752s)). The direction is masked by a bilinear sphere mask, a ring that fades in from the outer edge and fades out again near the centre, because pure convergence "may result in cards crossing each other at the center point"; the vector shifts the card's up axis "toward that point", so cards lean toward the clump centre ([V@13:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=780s)). To make the map tile, each brush is "duplicated and offset three times" ([V@13:30](https://www.youtube.com/watch?v=yYE1Hfg067I&t=810s)); the principle from part 1 is that four copies offset by a tile around a wrapped position always tile provided the element is no wider than the tile ([part 1 @13:30](https://www.youtube.com/watch?v=P7lZ-D-Fkus&t=810s)). Approaches he rejected: a Blender height map with baked normals ("tedious ... not too convincing") and hand-painting directions in Krita ([V@11:01](https://www.youtube.com/watch?v=yYE1Hfg067I&t=661s)).

Sampling, all STATED: never sample at the vertex's world position, because neighbouring vertices of one card would get different directions and the card would deform; use "the baked pivots in world space as texture coordinates" for one sample per card, and "add this X and Y offset to the Z vector before it's normalized" ([V@14:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=840s)). Offsetting the lookup coordinates by the per-card random direction (optionally also by the local pivot) decorrelates neighbours: zero offset gives spatially coherent clumps, more offset gives more randomness, at a cost to texture-cache coherence ([V@14:32](https://www.youtube.com/watch?v=yYE1Hfg067I&t=872s), [V@15:01](https://www.youtube.com/watch?v=yYE1Hfg067I&t=901s)).

A second, optional kind of clumping is positional: drive the `spread` lerp with "a noisy looking texture" so cards in some areas gather toward their instance origin. He calls it limited, since the gathering point can only be the instance origin, and suggests an arbitrary clump point from "a 2D distance field, something to try" ([V@15:01](https://www.youtube.com/watch?v=yYE1Hfg067I&t=901s)). His own summary of what textures control is "the scale, bend, position clumping and orientation clumping" ([V@25:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1531s)).

For the web, bake the map offline (INFERENCE; no open web implementation of this stamped map was found). A deterministic Node script allocates a float array of two channels; for each of a few hundred seeded-random stamps it visits the texels in the stamp's bounding box using wrapped distance per axis, `d = mod(p - c + 0.5, 1.0) - 0.5`, which is equivalent to the four-copy trick for any stamp narrower than the tile; it optionally warps the lookup position with low-frequency noise and accumulates `normalize(c - p) * ring(|d| / radius) * strength`; finally it divides by the maximum magnitude and writes `rg = v * 0.5 + 0.5` as 8-bit. The project already depends on sharp, which can write the buffer as PNG. In three.js load it with `colorSpace` left at `NoColorSpace` (an sRGB tag would gamma-distort the direction), `RepeatWrapping` on both axes and linear filtering, and decode with an explicit zero: 0.5 is not representable in 8 bits, so bake and shader must share one constant such as `127.0 / 255.0` or the grass leans slightly everywhere. **Resolution, world tile size, stamp count, stamp radius range, ring radii and falloff, warp strength and clump strength are all UNKNOWN.** If the vertex stage proves too heavy on old phones, the clump lean is static and can be evaluated per card on the CPU at scatter time and stored as an attribute.

## Wind is a tiling velocity field that tilts cards and straightens them

In this video wind has no sine bobbing and no per-blade phase term (INFERENCE from their absence); temporal variety comes from a moving gust texture, a turbulence layer, the per-card lookup offset and the sail term. The application is STATED: "this Z vector could be used to tilt cards away from the wind ... same exact principle, I'm going to use the same setup to sample the wind texture", including the per-card UV randomisation to "break the spatial coherence" ([V@15:50](https://www.youtube.com/watch?v=yYE1Hfg067I&t=950s)). The sample is a velocity, not a scalar: normalise it for a direction and "use a dot product with the direction cards are facing to modulate how much wind to apply", on the reasoning that a flat blade acts like a sail; he concedes the physics is "probably negligible" and the idea "might be stupid", but it is cheap and adds variation ([V@16:02](https://www.youtube.com/watch?v=yYE1Hfg067I&t=962s), [V@16:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=991s)). Whether that dot product is taken as an absolute value, clamped or remapped is UNKNOWN. The same wind magnitude reduces the resting bend, and through the shared normalisation strong wind overrides clump and terrain lean.

The field itself is COMPANION material from part 1. The motivation is that scrolling a noise texture by `time * speed` makes the field jump whenever speed or direction changes: after 600 seconds, changing speed from 1.0 to 1.1 moves the UVs by 60 units ([part 1 @7:30](https://www.youtube.com/watch?v=P7lZ-D-Fkus&t=450s)). His answer is a tiling texture regenerated every frame from simulated "wave particles" that are integrated per tick. The final version uses **a fixed 60 particles**, each holding 12 floats in three vec4s (2D position, 2D direction, speed, radius, normalised age, lifetime, opacity, plus wind-reaction parameters), over a region the captions render as 500 by 500 cm. Each particle's target velocity comes from the global wind direction and speed, "somewhat randomized per particle"; its current velocity lerps toward the target for inertia; position is integrated and wrapped by whole tiles ([part 1 @20:01](https://www.youtube.com/watch?v=P7lZ-D-Fkus&t=1201s), [part 1 @29:30](https://www.youtube.com/watch?v=P7lZ-D-Fkus&t=1770s)). Rasterisation is brute force: for every texel, for every particle, for each of four tiled offsets, compute two gradients along the particle's forward and right axes from its radius ("some kind of box mask") and accumulate `velocity * mask * opacity`, where opacity rises then falls over normalised age; then add a constant push and a scrolling-noise turbulence whose UV offset is accumulated per tick rather than derived from the clock ([part 1 @30:31](https://www.youtube.com/watch?v=P7lZ-D-Fkus&t=1831s), [part 1 @26:35](https://www.youtube.com/watch?v=P7lZ-D-Fkus&t=1595s)). The target is **128 pixels square** ("128 is plenty enough"), two 16-bit channels of wind XY, extended to RGBA with the previous frame's wind in blue and alpha so the material can output motion vectors for temporal anti-aliasing ([part 1 @16:30](https://www.youtube.com/watch?v=P7lZ-D-Fkus&t=990s), [part 1 @32:30](https://www.youtube.com/watch?v=P7lZ-D-Fkus&t=1950s)). He quotes about 0.05 ms for the simulation against about 1 ms for an earlier scene-capture version, on a GPU the captions garble ([part 1 @32:30](https://www.youtube.com/watch?v=P7lZ-D-Fkus&t=1950s)). An earlier sprite-based version used a spawn rate of 20 per second and a 3-second lifetime, with sprites as wide as the tile and half as deep, randomly scaled down ([part 1 @18:31](https://www.youtube.com/watch?v=P7lZ-D-Fkus&t=1111s)). Global controls are direction, speed, turbulence and gust, with presets interpolated by one intensity value ([part 1 @33:14](https://www.youtube.com/watch?v=P7lZ-D-Fkus&t=1994s)). Because the field tiles, it cannot carry local interaction; that needs a second, camera-centred system layered on top ([part 1 @15:02](https://www.youtube.com/watch?v=P7lZ-D-Fkus&t=902s)).

For walkthroughlab the recommended start (INFERENCE) is a pre-baked tiling noise texture scrolled by an accumulated offset, sampled at the card pivot and decoded as a biased 2D velocity. The accumulation pattern exists verbatim in Bruno Simon's folio-2025 (MIT, "Copyright (c) 2025 Bruno Simon"; TSL/WebGPU, so learn-from rather than paste):

```js
this.localTime.value += this.game.ticker.deltaScaled * this.timeFrequency * this.strength.value
```

([folio-2025 Wind.js](https://raw.githubusercontent.com/brunosimon/folio-2025/main/sources/Game/Wind.js), CODE). Its field is two samples of one Perlin texture at scales 0.2 and 0.1, the second scrolling at 0.2 of the first's rate, summed and multiplied by direction and strength. The shader interface, one sampler and one tile size, is the same as for a simulated field, so the 60-particle version can replace it later as one full-screen pass into a 128-square `RGBA8` render target (always renderable and linearly filterable on WebGL2) that loops over a uniform array of particles and four wrap offsets. Float targets need `EXT_color_buffer_float` or `EXT_color_buffer_half_float` ([Khronos](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/)), which the project already treats as optional in `src/occlusion.ts` L198-L203. Sample with `textureLod(..., 0.0)` because the vertex stage has no derivatives. The project has no clock or time uniform today; the wind offset is the first one, and it should be frozen under the `prefers-reduced-motion` setting the project already honours. **Wind strength multipliers, the wind tile's world size, the amount of bend reduction and all turbulence parameters are UNKNOWN.**

## Normals and opacity lean on Unreal features that WebGL must replace

### The reconstructed normal

Heavy vertex displacement makes repairing stored normals harder than rebuilding them, and the stored normals were overwritten with random directions anyway ([V@27:53](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1673s)). The author frames two schools: stylised grass uses upward normals so cards and ground light alike; realistic grass uses true geometric normals with a model that lets light bleed through, ideally Unreal's Two Sided Foliage ([V@28:30](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1710s)). He builds a switch between them, in five STATED steps. Take the bend direction output by the bend node, which "is a 3D vector but lies on a 2D plane", so "choosing between an upward and a forward normal is just a matter of swizzling components", with an absolute value on the vertical component (a fix he did not analyse) and a lerp between the two variants ([V@30:32](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1832s)). Compute it in the vertex shader and interpolate ([V@31:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1860s)). Rotate it by the same 3x3 card matrix as the positions ([V@31:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1891s)). Then the admitted cheat: because a forward normal aligned with the tilt axis shows no lighting change from tilt, "lerp the world normal towards the tilt direction, the greater the tilt" ([V@32:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1920s), [V@32:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1951s)). Finally, apply the normal map through a hand-built tangent basis whose Z axis is the reconstructed normal and whose other two axes are cross products, with no safe normalisation ([V@33:02](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1982s)). His final setting: upward looks better in daylight, forward at sunrise and sunset, and he "mainly use[s] a forward normal but slightly shifted toward Z" ([V@34:32](https://www.youtube.com/watch?v=yYE1Hfg067I&t=2072s)). He rates this whole part "a bit too much on the hacky sketchy side" ([V@41:30](https://www.youtube.com/watch?v=yYE1Hfg067I&t=2490s)). The swizzle patterns, lerp weights and the tilt-to-normal factor are UNKNOWN.

In the sketch above the forward variant is `vec3(arcN, 0.0)` and a plausible upward variant swaps its two in-plane components; rotate by `mat3(F, U, W)`, then mix toward the tilted up axis by an amount proportional to `length(tilt)` (INFERENCE). For this project the simpler end of his switch is the right default: baked-light grass with a mostly upward normal needs no normal map and no tangent basis.

### Shading inputs and their three.js stand-ins

In Unreal the base colour is "a simple texture", roughness and specular are two textures, subsurface colour equals base colour, and under Two Sided Foliage "the material opacity controls the transmission amount, zero is fully translucent" ([V@40:01](https://www.youtube.com/watch?v=yYE1Hfg067I&t=2401s)). Landscape-colour tinting is deliberately omitted ([V@25:53](https://www.youtube.com/watch?v=yYE1Hfg067I&t=1553s)); part 3's simpler example shader multiplies albedo by colours from a top-down noise texture and the per-instance and per-card random values ([part 3 @37:32](https://www.youtube.com/watch?v=BFnwkBv19TA&t=2252s)). No root ambient-occlusion term or fog handling is discussed.

three.js has no foliage shading model. The cheapest known translucency substitute is the wrap-diffuse plus view-dependent backscatter in SimonDev's Quick_Grass (MIT, [LICENSE](https://raw.githubusercontent.com/simondevyoutube/Quick_Grass/main/LICENSE); written for r156, and its lighting-chunk override does not compile on r186 because the `GeometricContext` struct was removed, which is irrelevant here since the project has no lights). The lines, CODE from [grass-lighting-model-fsh.glsl](https://raw.githubusercontent.com/simondevyoutube/Quick_Grass/main/public/shaders/grass-lighting-model-fsh.glsl) L46-L60:

```glsl
float wrap = 0.5;
float dotNL = saturate( (dot( geometry.normal, directLight.direction ) + wrap) / (1.0 + wrap) );
vec3 irradiance = dotNL * directLight.color;
...
// Backscatter fakery
wrap = 0.5;
float backLight = saturate((dot(geometry.viewDir, -directLight.direction) + wrap) / (1.0 + wrap));
float falloff = 0.5;
vec3 scatter = directLight.color * pow(backLight, 1.0) * falloff *  BRDF_Lambert(material.diffuseColor);
reflectedLight.indirectDiffuse += scatter * (1.0 - vGrassParams.z);
```

The same repository supplies a root-darkening term, `float ao = mix(aoForDensity, 1.0, easeIn(heightPercent, 2.0));` with `aoForDensity = mix(1.0, 0.25, density)`, and a distance blend of the normal toward world up that makes far grass light like the ground (`SKY_RATIO = 0.25`, so near blades already use 75% up) ([grass-lighting-model-vsh.glsl](https://raw.githubusercontent.com/simondevyoutube/Quick_Grass/main/public/shaders/grass-lighting-model-vsh.glsl) L160-L166). FluffyGrass (MIT, [LICENSE](https://raw.githubusercontent.com/thebenezer/FluffyGrass/main/LICENSE)), the only three.js reference found that uses alpha-textured cards on an `InstancedMesh`, has no normal-based diffuse at all: colour is a base-to-tip gradient times an intensity, darkened by a shadow factor ([GrassMaterial.ts](https://raw.githubusercontent.com/thebenezer/FluffyGrass/main/src/GrassMaterial.ts) L199-L203, L237), which is the shape walkthroughlab needs.

### Opacity, mips, shadows and depth offset

The video uses dithered LOD transitions and dithered masked opacity, "quite uncommon for grass", for smoother edges and a "fluffy look" ([V@34:55](https://www.youtube.com/watch?v=yYE1Hfg067I&t=2095s)). The problem it creates is STATED precisely: mip-mapping averages opacity toward grey, so distant cards go semi-transparent under dithering. His fixes are texture mip-generation settings that preserve values, or mips authored by hand (one Photoshop layer per mip down to 1x1, exported as DDS) so the threshold is never crossed ([V@35:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=2131s), [V@36:01](https://www.youtube.com/watch?v=yYE1Hfg067I&t=2161s)). Hand-made mips also carry tricks: a black mip 0 gives a free near fade, and lower specular with higher roughness in far mips tames distant highlights ([V@36:31](https://www.youtube.com/watch?v=yYE1Hfg067I&t=2191s)). Shadow-pass switches make distant LODs fully opaque to thicken far shadows and dither near shadows to fake light bleeding ([V@37:00](https://www.youtube.com/watch?v=yYE1Hfg067I&t=2220s), [V@38:02](https://www.youtube.com/watch?v=yYE1Hfg067I&t=2282s)). Pixel depth offset pushes each pixel away from the camera by a per-blade random value read from a texture, giving depth inside a flat card; it causes self-shadowing artefacts and its mips average to a constant, so he fades it out in hand-edited mips ([V@38:41](https://www.youtube.com/watch?v=yYE1Hfg067I&t=2321s)). Shadows are classic shadow maps; Nanite and virtual shadow maps are avoided because "they don't cope well with World Position Offset" ([V@41:01](https://www.youtube.com/watch?v=yYE1Hfg067I&t=2461s)).

None of the dithering transfers, because it relies on Unreal's temporal anti-aliasing and `WebGLRenderer` has none; three's own documentation of `alphaHash` says its grain needs TAA ([Material.js](https://github.com/mrdoob/three.js/blob/r186/src/materials/Material.js) L126-L135). The recommended path (INFERENCE synthesised from r186 source; no measured mobile comparison exists) is an opaque-queue, depth-writing, alpha-tested material with `alphaToCoverage: true` when the canvas really has MSAA, and a hard `discard` otherwise. In r186 the flag enables `SAMPLE_ALPHA_TO_COVERAGE`, adds `#define ALPHA_TO_COVERAGE`, and the alpha-test chunk sharpens alpha to about one pixel of gradient (CODE, [alphatest_fragment.glsl.js](https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderChunk/alphatest_fragment.glsl.js), whole chunk):

```glsl
#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif
```

A hand-written `ShaderMaterial` receives the define but must include this chunk or reproduce it, and must write the sharpened alpha to the output. Verify MSAA at start-up with `gl.getParameter(gl.SAMPLES) > 0`. The mip problem transfers unchanged: three's default mip generation box-filters alpha, so coverage at a fixed threshold falls with distance. Castano's fix rescales each mip's alpha until its coverage at the reference threshold matches the top level ([Computing Alpha Mipmaps](https://www.ludicon.com/castano/blog/articles/computing-alpha-mipmaps/)); it fits an offline script. Lowering the threshold with distance is the fallback. Alpha blending is ruled out because three sorts objects, not instances inside an `InstancedMesh`. Pixel depth offset maps to writing `gl_FragDepth`, which defeats early depth testing; skip it on phones (INFERENCE).

## Tsushima's per-blade lineage is the inspiration, not the method

The video borrows its feature list from Eric Wohllaib's GDC 2021 talk on Ghost of Tsushima, and the difference in mechanism is large enough that mixing the two would mislead an implementer. The research note covering this lineage was interrupted before completion and could not read the talk itself; everything below is the talk as relayed by secondary write-ups, or code from recreations, and absent detail is not a finding.

As relayed, Tsushima generates one blade per compute-shader thread on a jittered grid inside world tiles, culls per blade, and draws instances with no vertex streams, building each blade in the vertex shader as a cubic Bezier ribbon of **15 vertices near and 7 far** ([tigerabrodi](https://tigerabrodi.blog/what-we-can-learn-from-grass-in-ghost-of-tsushima-renders), [gist.ly summary](https://gist.ly/youtube-summarizer/procedural-grass-systems-in-ghost-of-tsushima-achieving-art-direction)). The same write-up reports about 83,000 blades on screen at about 2.5 ms, on unnamed hardware. Its clumping is the thing the word usually means: a Voronoi algorithm assigns each blade to its nearest clump point, and each clump shares height, direction, colour and bend, with blades pulled toward the cell centre ([tigerabrodi](https://tigerabrodi.blog/what-we-can-learn-from-grass-in-ghost-of-tsushima-renders)). Its wind is scrolling 2D Perlin noise plus a per-blade sine bob with hash phase ([tigerabrodi](https://tigerabrodi.blog/grass-in-ghost-of-tsushima)). The team moved to blades because cards animated poorly and overdrew heavily at high density ([gist.ly summary](https://gist.ly/youtube-summarizer/procedural-grass-systems-in-ghost-of-tsushima-achieving-art-direction)), which is precisely the trade Girardot reverses.

| Feature | Tsushima lineage (relayed, or recreation code) | Girardot video (STATED) |
|---|---|---|
| Unit | One procedural blade, Bezier ribbon | Alpha card with several blades |
| Generation | Compute shader, per-blade culling | Stock foliage instances, vertex shader only |
| Curve | Cubic Bezier from height, tilt, bend | Sine/cosine arc on a flat card |
| Clump | Voronoi cell with shared height, facing, colour, pull to centre | Lean vector from a stamped texture; optional spread noise |
| Wind | Scalar noise turns and bends; sine bob | 2D velocity texture added to the up axis |
| Edge-on fix | Shift or rotate blade vertices in view space | Yaw the whole card toward the camera in 2D |
| Randomness | Hashes of grid cell | Baked per-card attributes |

The clearest code picture of Voronoi clumping is the Unity recreation by cainrademan, which describes itself as "essentially an implementation of the approach used in Ghost of Tsushima" ([Unity-Grass](https://github.com/cainrademan/Unity-Grass)). **Its licence, and that of 2Retr0/GodotGrass, was not recorded by the researchers; treat both as read-only references until checked.** Its per-clump parameter set is `pullToCentre`, `pointInSameDirection`, then base and random-range pairs for height, width, tilt and bend, and the lookup is two lines (CODE, [Grass.compute](https://github.com/cainrademan/Unity-Grass/blob/HEAD/Grass/Assets/Grass.compute)):

```hlsl
float2 clumpCentre = (clumpData.yz + floor(clumpUV))/float2(_ClumpScale.xx);
position.xz = lerp(position.xz, clumpCentre, bladeParameters.pullToCentre);
```

Three ideas from this lineage are worth importing into a card system as optional extras, each labelled by origin. Distance thinning by a stable per-element hash against a smoothstep with a density floor, `hash > 1 - distanceSmoothStep` (CODE, same file), maps onto drawing fewer instances per chunk. Blending normals toward the terrain normal with distance to kill shimmer is attributed to the talk by the Unity README. And Girardot's own unbuilt idea, an arbitrary clump point from a 2D distance field, is exactly what the Voronoi cell centre provides: a `spread`-style lerp toward a cell centre instead of the instance origin would give true positional clumps (INFERENCE). What should not be imported is per-blade geometry itself; that is a different project.

## In walkthroughlab the grass must dodge the AO pass and borrow the lightmap

Project facts first, all read from the working tree. The renderer is `WebGLRenderer` with `antialias: true`, `NeutralToneMapping` and a pixel ratio capped at 2 (`src/main.ts` L57-L82). Solid surfaces are `MeshBasicMaterial` with a baked light picture on the second UV set at `lightMapIntensity = Math.PI * 4` (`src/environment.ts` L130-L142). There are no three.js lights, no instancing, no time uniform, and the test environment has no vegetation at all. ADR 0002 states "Nothing in an environment can move, since its shadow would stay behind" (`docs/adr/0002-bake-light-with-scripted-blender.md`), so wind-animated grass needs that decision amended, with grass excluded from the bake, before it has a place to live. The project also has no numeric frame-rate target and no reference phone; `?fps` on a real device is the only measure.

### Material plumbing in r186

Use an `InstancedMesh` with a `ShaderMaterial`: three defines `USE_INSTANCING` and declares `instanceMatrix` for non-raw shader materials ([WebGLProgram.js](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLProgram.js) L487, L607). Keep `transparent = false`. That keeps grass in the depth-writing opaque list, and it matters doubly here because `AmbientOcclusion.render` classes any material with `transparent === true` as glass and redraws it in a final glass-only pass (`src/occlusion.ts` L78-L81); FluffyGrass's `transparent: true, alphaTest: 0.1` must not be copied. End the fragment shader with `#include <tonemapping_fragment>` and `#include <colorspace_fragment>`, or the grass will be brighter and flatter than the baked surfaces. Culling uses the `InstancedMesh` bounding sphere, computed lazily from instance matrices ([InstancedMesh.js](https://github.com/mrdoob/three.js/blob/r186/src/objects/InstancedMesh.js) L151-L164); since the shader moves cards, call `computeBoundingSphere()` after filling matrices and enlarge the radius by blade height plus maximum lean, the three.js form of the author's "increase the mesh bounds a bit".

### The override-material depth pass

The default AO path renders the whole scene into a non-multisampled target with `scene.overrideMaterial` set to a shader whose vertex stage is the plain `projectionMatrix * modelViewMatrix * vec4(position, 1.0)` (`src/n8.ts` L34-L53, L107-L111). r186 applies an override like this (CODE, [WebGLRenderer.js](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js) L2128-L2151):

```js
if ( material.allowOverride === true && overrideMaterial !== null ) {
	material = overrideMaterial;
}
```

`Material.allowOverride` defaults to `true`, and `customDepthMaterial` is read only by the shadow-map renderer ([WebGLShadowMap.js](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLShadowMap.js) L433), so it does nothing here. Left alone, grass in that pass would be drawn with a shader that ignores `instanceMatrix`: every instance stacked undeformed and opaque at the mesh origin, with no `uv1` (INFERENCE). Three remedies exist, in rising cost. Exclude grass from the pass by adding it to the existing hide/show lists or a camera layer; the ground beneath still receives AO, grass pixels inherit the AO of what lies behind them because the darkening is a screen-space multiply, and thin animated cards in a half-resolution AO buffer would shimmer anyway. Or set `grassMaterial.allowOverride = false` and add a `uAoPass` uniform under which the fragment shader hard-discards and writes `vec4(0.0, 0.0, 0.0, bakedLuminance)` to match the override's output, at the price of running the grass vertex stage twice. Or render grass into the same target in a second override pass with a dedicated depth material sharing the vertex source. Start with exclusion.

### Lighting with no lights

The baked light picture at the lawn already contains sky, sun and shadow, so sampling it once per instance at the root makes grass sit in the lawn's exposure and darken in baked shadow. r186's basic material computes `lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI` ([meshbasic.glsl.js](https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderLib/meshbasic.glsl.js) L88-L91), so with the project's intensity the multiplier on albedo is `texel.rgb * 4.0`. spacejack's terra uses exactly this structure, lighting each blade from the terrain lightmap at its ground position (grass files marked `// LICENSE: MIT`, Copyright (c) 2016/2017 Mike Linkovich; repository otherwise CC BY-NC 4.0; [grass.frag.glsl](https://raw.githubusercontent.com/spacejack/terra/master/public/shader/grass.frag.glsl) L19-L30). A recipe assembled from those patterns (INFERENCE, constants are placeholders):

```glsl
// vertex: vBaked = texture(bakedLight, aLightUv).rgb * 4.0;
vec3  albedo = texture(grassAtlas, vUv).rgb * tint;
float root   = mix(0.35, 1.0, h * h);                       // root darkening
float sunVis = smoothstep(lo, hi, dot(vBaked, vec3(0.2126, 0.7152, 0.0722)));
float wrapNL = clamp((dot(n, sunDir) + 0.5) / 1.5, 0.0, 1.0);
float back   = clamp((dot(viewDir, -sunDir) + 0.5) / 1.5, 0.0, 1.0);
vec3  light  = vBaked * mix(1.0, 0.7 + 0.6 * wrapNL, sunVis) + sunColor * back * 0.5 * sunVis * h;
gl_FragColor = vec4(albedo * light * root, alpha);
```

Whether a custom shader sampling the sRGB-tagged light picture receives linear values on every device was not verified; compare a card against the lawn in one lit and one shaded spot.

### Placement, LOD and what nobody has measured

For small architectural lawns, scatter once at load with `MeshSurfaceSampler` on the lawn mesh, as FluffyGrass does with 8000 instances ([main.ts](https://raw.githubusercontent.com/thebenezer/FluffyGrass/main/src/main.ts) L139-L182). The r186 sampler returns position, normal, colour and the first UV set only ([MeshSurfaceSampler.js](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/math/MeshSurfaceSampler.js)), so to obtain the baked-light UV build the sampler on a clone whose `uv` is replaced by `uv1`, and seed its random generator so the lawn is identical on every load (INFERENCE). Split the lawn into a few chunk meshes for frustum culling and per-chunk LOD; order instances randomly within a chunk and lower `InstancedMesh.count` with distance, which pairs with the video's per-instance fade that shrinks cards toward the cull distance. A camera-following wrapped grid, as in terra and folio-2025, only pays when the grassed area far exceeds the draw distance. The video's LOD plan is three card meshes with roughly halved vertex counts and a cheaper far material with wind and depth offset off and constant normals ([part 3 @38:31](https://www.youtube.com/watch?v=BFnwkBv19TA&t=2311s)).

**No measured phone figures for web grass were found**: no source gives instance count, triangle count and frame rate on a named phone. The author-reported desktop claims that exist (a million instances after splitting terrain into 256 chunks, on a MacBook) come without methodology ([Codrops](https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/)). The test environment today is 8,884 triangles whose cost is almost entirely fill rate; grass will be its first vertex-heavy and first overdraw-heavy content, so density, card count and facing must ship as tunables in the existing `?config` panel.

### Every constant the implementer must tune

| Quantity | Status | Note |
|---|---|---|
| Spread | **1** (STATED base value) | Noise-driven for positional clumping |
| Wind texture size | **128 px**, 2 x 16-bit (COMPANION) | Use RGBA8 with bias on phones |
| Wind particles | **60**, 12 floats each (COMPANION) | Only if the simulated field is built |
| Clump stamps | "a few hundred" (STATED) | Exact count UNKNOWN |
| Clump map resolution, world tile size | UNKNOWN | 256 or 512 px is a researcher guess |
| Stamp radius range, ring inner/outer falloff, warp strength | UNKNOWN | |
| Clump strength, wind strength, curvature lerp | UNKNOWN | Separate multipliers are STATED to exist |
| UV randomness offset | UNKNOWN | 0 gives coherent clumps |
| Bend curvature, bend noise scale, wind straightening | UNKNOWN | HLSL not captured |
| Bend sign and axis; cross-product order | UNKNOWN | Verify single-sided, as the author did |
| Sail dot product remap (abs or clamp) | UNKNOWN | |
| Camera-facing strength | UNKNOWN | |
| Normal swizzle, forward/up mix, tilt-to-normal lerp | UNKNOWN | "Forward, slightly shifted toward up" |
| Alpha threshold, mip coverage correction | UNKNOWN | Dither does not transfer |
| Cards per tuft, vertices per card, density, LOD and cull distances | UNKNOWN | None spoken |

## Conclusion

What this research changes is the reading of the word "clump". In the Tsushima lineage a clump is a data structure, a cell that owns a parameter set; in Girardot's shader it is just one more horizontal vector added to an axis before a `normalize`. That single slot, the card's up axis, is the whole design: terrain slope, clump lean and wind all enter it additively and the normalisation arbitrates between them, which is why wind overpowers clumps for free and why a viewer-following interaction vector, the subject of the project's earlier research, would enter as a third term with no new machinery. The technique's cost structure is equally plain once the Unreal specifics are stripped away: a trivial fragment stage, a heavy vertex stage whose inputs are constant per card, and alpha overdraw. On phones the first two suggest moving per-card work (the static clump lean certainly, the facing and basis possibly) out of the per-vertex path, and the third decides density.

The honest limit is that this is a specification of intent and order, not of numbers. The parts with real implementation risk are the ones the audio could not supply: the bend's sign and axis, the basis handedness, and every strength. A sensible first build therefore fixes the order of operations exactly as given, renders single-sided to settle signs before anything else, starts with upward normals, root-sampled baked light and hard alpha test, and adds the camera-facing, the reconstructed normal and alpha-to-coverage one at a time under `?config` switches, judged with `?fps` on the oldest phone at hand. The gating decision sits outside the shader: until ADR 0002 says how unbaked, moving things are lit, the grass has no sanctioned place in an environment.
