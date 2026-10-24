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
  once measured. (#11)
- **Cheap live light for what moves, instead of a second bake.** Mostly baked
  light, with a cheap live approximation of bounced light for moving parts,
  sway and traffic. To try: Glamarye's bundled version (Glamarye is already
  one of the ambient occlusion methods), other screen-space methods, and light
  probes: a grid of points whose light is baked in Blender, from which moving
  things take the light of the nearest points. Screen-space methods know only
  what is on screen and cost time every frame, of which about 1 ms is left in
  the worst view on the Redmi Note 8 (#9); probes cost almost nothing while
  walking but are coarser. Measure each on the Redmi. (#11)

## Moving through

Movement is done until the finish line (#8).

- **Head bob while walking or running**: a gentle rise and fall of the
  viewpoint with each step. Suggested while deciding how running works
  (3a1ae8a) and left out of that step on purpose. (#17)

## Movement in place

- **Vertex animation textures for curtains and flags.** A looping animation,
  such as a cloth simulated in Blender, stored frame by frame in a picture the
  walkthrough plays back. Birds flap by a simple formula instead; this is the
  upgrade for sway that looks fake by formula. (#11)

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

## Author conveniences

The map keeps these off the finish line: other authors are a principle, not a
component. (#8)

- **A dedicated editor**, shelved on 2026-10-12. Revisit only if a concrete
  wall appears while building grass or the first door.
- **A one-command pipeline** from the Rhino model to the published walkthrough.
- **A setup guide** for a new author.
- **Generating the collision mesh** instead of modelling it by hand.
