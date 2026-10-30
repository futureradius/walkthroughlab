# Ideas log

Good ideas that the finish line does not need: the test environment can be
ready for the real building without them, and leaving them for later does not
mean remodelling it. Each entry says where it came from. When one is picked
up, it becomes an issue and leaves this log.

## The environment

- **Fountains, waterfalls and cascades.** Water on the finish line is still,
  with small moving waves; water that flows or falls is for later. (#11)
- **Trains and cars as traffic**, and how an author sets them up in Rhino.
  Birds are the only traffic on the finish line. (#11)
- **Elevators with doors on more than one side**, opening only the car door
  facing that stop's floor door. On the finish line every car door opens at
  every stop. (#26)
- **A shared call button for a bank of elevators**, sending whichever car
  is nearest. On the finish line each car has its own buttons. (#26)
- **Windows and shutters as moving parts.** Doors and elevators are the only
  moving parts on the finish line. (#11)
- **More than one environment behind one link.** One link opens one
  environment. (#11)
- **Sliding doors with several leaves stacking to one side**, for large
  openings, each leaf travelling its own distance. A sliding door on the
  finish line has one leaf, or two that part, marked by the sublayers
  `leaf-left` and `leaf-right`; more leaves need a way to name them. (#12)

## Materials

Each was on #6, #20 or #21 and is left out of the finish line. (#11)

- **Frosted glass**, where a glass material's roughness blurs the view through
  it, not only its reflection. It needs a blurred copy of the picture behind
  every frame it is in view, to be measured on an old phone first (#6).
- **Dirty or opaque glass that catches baked light** (#20).
- **Milky glass and translucent plastics** such as polycarbonate, which scatter
  light rather than only filtering it (#21).
- **Mirrors and fabric.**
- **Scratches on glass**, shown in the sky's reflection (#6).
- **The look of light coming through plant leaves** (#6).
- **Transparency below 100 %.** Today transparency only decides whether a
  material is glass (#6).
- **Glass across its range**, from clear to dark enough to be nearly opaque, as
  a set of samples in the test environment (#21).
- **A switch for one material to opt out of being simplified.** The optimize
  step turns a texture that is almost one value into that value and drops the
  texture, which leaves a small detail that differs, such as one shiny nail in
  a rough texture, without its own value. A material marked in the model could
  keep all its textures. (#11)

## Light

- **Spotlights and other directed light the author places.** On the finish
  line a lamp is a surface whose material glows; Rhino's own lights do not
  export. (#12)
- **A second bake for a moving part's other state.** ADR 0003 allows one, for
  a moving part that opens or closes an opening. Come back to it only if a door
  in the test environment looks wrong when it opens. (#11)
- **A live shadow near the viewpoint** for moving things, as ADR 0003 permits
  once measured. (#11) Cloth would gain most: a flag turned downwind keeps the
  light it was baked with where modelled, and its shadow stays there. (#31)
- **Cheap live light for what moves, instead of a second bake.** Mostly baked
  light, with a cheap live approximation of bounced light for moving parts,
  sway and traffic. To try: Glamarye's bundled version (Glamarye is already
  one of the ambient occlusion methods), other screen-space methods, and light
  probes: a grid of points whose light is baked in Blender, from which moving
  things take the light of the nearest points. Screen-space methods know only
  what is on screen and cost time every frame, of which about 1 ms is left in
  the worst view on the Redmi Note 8 (#9); probes cost almost nothing while
  walking but are coarser. Measure each on the Redmi. (#11)
- **Swaying lamps that light their surroundings**, such as glowing paper
  lanterns hung in a tree. A glowing `sway-` part glows but lights nothing,
  because swaying things stay out of the bake. Keep it in mind when choosing
  how moving and swaying things are lit and shadowed: the lantern's light
  could be baked from its resting place, as a tree's still shadow is, or come
  from whichever live light wins above. (#29)
- **An exposure for each environment**, like a camera's, for night scenes
  lit by lamps at their real lumen. Today brightness is fixed by the sky at
  intensity 1 and tone mapping at exposure 1, so a night scene at real lumen
  looks dim, as it does in Raytraced; the only way to brighten it is to make
  every lamp stronger by the same factor, which makes the lumen list fiction
  and clips near lamps sooner. The bake would multiply the light by the
  exposure before writing its pictures, so dim light keeps its precision in
  them and the light range of 4 counts after the exposure, and the walkthrough
  would divide it back out only where it must. In Rhino, the author would
  match it with tone mapping's white point (perhaps 0.25 for an exposure of 4;
  check against a render first). (#29)
- **Eyes that adjust to the dark** as the viewer walks: the exposure eases
  towards how bright it is around the viewpoint, so a dark corridor entered
  from a sunny outside slowly brightens, and the sky outside a window burns
  out from inside. How bright it is could be read from the baked light probes
  the props already use, which costs almost nothing on the Redmi, rather than
  measured from each frame. It needs a limit either way, so night stays night.
  (#29)
- **A curve on the baked light**, as in Photoshop, for styles of abstraction
  where light is drawn rather than measured. The curve is applied to the
  bake's raw light (`models-source/baked/*.exr`) as it is written to the WebP
  pictures, so it touches only light, never textures or the glow of lamps,
  costs nothing in the walkthrough, and lifting shadows causes no banding.
  Changing it needs no new render, only the conversion again, in seconds. One
  curve per channel can tint light, such as warmer shadows. To find a curve,
  a preview in the walkthrough applies it live in the shader, tuned from the
  tuning panel on the phone, and the curve found there is copied into the
  conversion. It breaks the match with Raytraced on purpose; to compare, the
  author can render Rhino's lighting on its own and put the same curve on it
  in an image editor. The lamp list stays true of the light before the curve.
  (#29)

## Moving through

Movement is done until the finish line (#8).

- **Head bob while walking or running**: a gentle rise and fall of the
  viewpoint with each step. Suggested while deciding how running works
  (3a1ae8a) and left out of that step on purpose. (#17)

- **Feeling acceleration**: the head, the camera, dips slightly as an
  elevator speeds up going up and rises slightly as it speeds up going down,
  and sways sideways in a curve, so a ride is felt as well as seen, for
  elevators now and later for riding traffic such as metro cars round a
  bend. Asked for by the author after riding the first elevator. (#26)
- **Smoother elevator rides**, if any stutter is left after the car moves
  before the view is worked out (#26): for instance, the viewer standing in
  the car's own coordinates while riding, as some games do.

## Movement in place

- **`sway-` materials in the Rhino model**, so a climbing plant or a hedge
  drawn in Rhino sways like a prop's leaves, without becoming a prop. (#28)

- **Vertex animation textures for curtains and flags.** A looping animation,
  such as a cloth simulated in Blender, stored frame by frame in a picture the
  walkthrough plays back. Birds flap by a simple formula instead; this is the
  upgrade for sway that looks fake by formula. (#11)
- **Water's waves worked out wave by wave** in its shader, from a handful of
  wave trains, as the walkthrough drew them for a day (commit cb3d282). Its
  waves showed a recognisable repeating pattern, and full-screen water ran at
  32 fps on the Redmi against 36 with the two sliding ripple pictures and 39
  flat. Worth another go, without the pattern, after the finish line. (#30)
- **Indoor water out of the wind.** Water's waves follow the environment's
  one wind, so an indoor pool ripples as much as one outside. Revisit after
  the finish line, perhaps with a layer or a setting for sheltered water. (#30)

## Grass

- **The author's own grass tuft, made in Blender** following Ghislain
  Girardot's tutorial on making grass assets (https://youtu.be/BFnwkBv19TA),
  as solid blades, which ran faster than see-through cards on phones. The
  generated placeholder blades (`scripts/placeholder-grass.mjs`) serve until
  then. (#25)

- **A wooded patch as tree scatter** (`scatter-trees`): many trees grown
  over marked surfaces like grass. The finish line places trees by hand as
  props (#28); the scatter machinery is general enough to take trees later,
  with their own sway. (#25)
- **The author's own trees, made in Blender**, with sway painted as vertex
  colour; a generated placeholder tree serves until then. (#25, #28)

## Viewer interaction

- **A warning when a door's swing cuts through a wall**, worked out by
  optimize from the leaf's sweep and the collision mesh. (#7)
- **The closed door's baked shadow in an open doorway**: if it gives a door
  away, leave the door out of the bake or give it a second bake for its open
  state (ADR 0003). Fine as it is for the finish line. (#7)
- **Opening a door by tapping it**, as an option beside doors that open by
  themselves as the viewer comes near. (#7)

- **Trampling grass, dust in the air, and ripples from the viewer.** See
  `docs/research/particles-and-engine-switch.md` for how they could work on
  the current stack. (#11)

## Drawing many props quickly

Still props are copied into the environment as ordinary geometry by the
optimize step, before the bake, so they get baked light and shadow like
everything else. That costs download for every copy. If the download budget
(#14) cannot afford it, these come back. (#11)

- **One shape for every copy of a prop, each copy with its own patch of the
  light picture**, so a prop placed thirty times downloads once.
- **Frustum culling of copies**, so copies out of view are not drawn.
- **Levels of detail**: simpler shapes for copies far from the viewpoint.
- **Splitting big objects into pieces**, so the parts out of view can be
  skipped.

## Making the opening download smaller

The opening download is about 2.2 MB on the wire (2026-10-23, after the baked
light became WebP), over the 2 MB budget. That is accepted while the test environment isn't optimised for size;
come back to these when the real building's opening download is too big.
Measured on the test environment, from smallest change to biggest. (#23)

- **Stronger texture compression**: WebP quality 70 instead of 80, a little
  softer up close.
- **Smaller textures**: at most 512 px instead of 1024, about a fifth of the
  size, but visibly blurrier up close.
- **Textures in the trailing download.** Surfaces first show in their own
  average colour with baked light, like a clay model, and their textures fade
  in a few seconds later, so the opening download stays about 1 MB however
  many textures there are. Kept in reserve: Loading makes the files smaller
  with WebP textures and compressed geometry first; come back to this if
  Materials (#6) pushes the opening download over 2 MB again. (#23)
- **GPU texture compression (KTX2/Basis)**: much less graphics memory, though
  files are not always smaller than WebP; worth weighing if phones run short
  of memory rather than bandwidth.
- **Loading a big building in parts**, under Loading below.

## Loading

- **Loading a big building in parts as the viewer walks**, so only the part
  around the start spot has to arrive before they can move. The real building
  may be two to four times the test environment and wait longer than the
  budget; come back to this only if that wait becomes a real problem. (#14)
- **A picture of the view from the start spot while loading**, rendered by the
  bake, shown under the loading bar until the walkthrough replaces it. For now
  the page stays white behind the bar. (#14)
- **Coming back to the tab shows a white page.** Seen by the author on
  returning to a walkthrough left open in another tab; the walkthrough then
  needs reloading. Not yet looked into. (#14)
- **A fade from the small sky to the sharp one**, for the light reflected on
  glass, water and metal and for the picture beyond the architecture. The
  sharp sky replaces the small one at once; that is hardly noticed so far. (#30)

## Comparing with renders

- **Named views for comparing with a render**: a `view-` layer, as the fixed
  route's stops use (#34), and a named view of the same spot saved in Rhino, so
  the walkthrough opened at that view can be set side by side with a render of
  it. The two need the same lens; the walkthrough's is not yet matched to
  Rhino's. After the finish line. (#27)

## Author conveniences

The map keeps these off the finish line: other authors are a principle, not a
component. (#8)

- **A dedicated editor**, shelved on 2026-10-12. Revisit only if a concrete
  wall appears while building grass or the first door.
- **A one-command pipeline** from the Rhino model to the published walkthrough.
- **A setup guide** for a new author.
- **Generating the collision mesh** instead of modelling it by hand.
- **Seeing props in Rhino**: a Grasshopper script that finds the
  `models-source/props/` folder next to the model, reads each `prop-<name>`
  layer's lines and shows `<name>.glb` on every line the way optimize places
  it: origin at the line's start, front along it, length as scale, a
  polyline by its first stretch. It would be a preview only, never exported.
  It matters most once props stand on props, such as a plant on a table or
  books on a shelf, where a line's height has to meet the top of another
  prop. Asked for by the author after placing the first props. (#28)
- **Baking on the second laptop, driven remotely**, so a long bake leaves the
  main laptop free. The bake script already uses its NVIDIA card. It needs a
  USB keyboard once for setup (its own is broken), then SSH (OpenSSH Server
  works on Windows 11 Home and Pro alike; Remote Desktop only on Pro), Node,
  Blender, a clone of the repo, and `models-source/` copied over, since it
  isn't in git. Left out of the finish line because the main laptop has an
  NVIDIA card too. (#36)
