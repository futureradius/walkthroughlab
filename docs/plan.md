# Plan

From the end goal to the build order. Charted on the map (#8) between
2026-10-12 and 2026-10-23; each decision links the ticket that settled it.
Words are used as `GLOSSARY.md` defines them. Good ideas that the finish line
does not need are in `docs/ideas.md`.

## The end goal

**The study question**: how convincing can an architectural walkthrough be when
it opens from a plain link on a seven-year-old phone? The answer is the
published walkthrough plus a short written account of what worked, what didn't
and what it cost.

**The finish line**: the test environment, grown piece by piece, is verifiably
ready for the author to model the real building they have in mind, knowing the
effort is worth it. "Verifiably" means the checklist at the end of this plan is
ticked. Modelling the real building comes after the finish line.

**The real building**, as far as it decides what is built: one environment
behind one link, two to four times the size of the pavilion, one and a half
storeys, much more inside than outside. Outside: grass, bushes and trees.
Inside: potted plants, chairs and tables. Still water, curtains and flags,
doors and elevators. (#11, #14)

## Ground rules

- **Performance floor**: a Redmi Note 8 never drops below 30 frames per second.
- **Download budget**: the viewer can move within 10 s on Chrome's "Slow 4G";
  the whole walkthrough stays under 10 MB, sound under 3 MB of it. Held for the
  test environment; the real building may wait longer. (#14)
- **Other authors are a principle, not a component**: nothing is built that
  only works for one environment, and the Rhino model alone decides how things
  look and behave. Author conveniences are in the ideas log.
- **Fixed ground**, not reopened: ADR 0001 (a static three.js page), ADR 0002
  (light baked through Blender), ADR 0003 (moving things stay out of baked
  light), ADR 0004 (marks are layer names under one `Walkthrough` layer).
- **Lights the author places are baked**, never shaded live.
- **The collision mesh stays hand-modelled.** Doors and elevators each move a
  marked piece of it.
- **Movement is done until the finish line.** Further movement work comes
  after.

## What exists

- **Movement**: steering with the joystick and keys, free look, running, zoom,
  coasting, collision with the fixed world, and falling off a ledge.
- **The sky**, as a picture beyond the architecture and as the light on it.
- **Baked light** in one 2048 picture, by `npm run bake` in Blender.
- **Ambient occlusion**, with three methods (N8AO, three.js's own, Glamarye).
- **Glass**, tinting what lies behind it and reflecting the sky, drawn from
  the front alone.
- **The config file** and the `?config` panel, for ambient occlusion and zoom;
  `?fps` for the frame rate.
- **The information panel** with credits.
- **A loading bar**, and the pipeline: `npm run optimize`, `npm run bake`, and
  publishing to GitHub Pages on every push to main.
- **The new test environment** in `models-source/`: the pavilion plus areas
  for each feature, with its elevator already marked and checked (#16).

Measured on the Redmi Note 8 (#9): startup about 4 s on Wi-Fi and mobile data;
ordinary views at 60 fps; the worst view, zoomed in through stacked glass, at
32 fps, about 1 ms per frame above the floor. Later per-frame costs need
savings of their own.

## Components

Each missing component has its own issue, which holds what is already decided,
what is left to decide when it is built, and the checklist lines it must tick.

| Step | Component | Issue | Depends on | Brings, for later components |
|---|---|---|---|---|
| 1 | Marks | #22 | | marks, the warnings list, config sections per mark |
| 2 | Loading | #23 | | the file list and the trailing download |
| 3 | Safety net | #24 | | the frame-rate meter |
| 4 | Scatter and grass | #25 | Marks | copies, the clock, the wind, reduced motion, live light for moving things |
| 5 | Materials | #6 | | |
| 6 | Doors | #7 | Marks | a collision mesh that moves |
| 7 | Elevators | #26 | Doors | |
| 8 | Baked light in several pictures | #27 | | |
| 9 | Props | #28 | Marks, Scatter and grass | |
| 10 | Lamps | #29 | | |
| 11 | Water | #30 | Marks, Scatter and grass | |
| 12 | Curtains and flags | #31 | Marks, Scatter and grass | |
| 13 | Birds | #32 | Marks, Scatter and grass | |
| 14 | Sound | #33 | Marks, Loading, Doors, Elevators, the loop test | one sound engine |
| 15 | Stress copy and the readiness check | #34 | everything | |

Two small steps sit outside the order:

- **Sound loop test on old phones** (#35), done early, alongside Marks. If it
  fails, MP3 becomes a second format before any sound is exported.
- **Bake on the NVIDIA laptop** (#36), driven from the main laptop, set up
  whenever the author is home with a USB keyboard. Until then, bakes run on
  the main laptop.

### How they fit together

**In the pipeline** (Rhino → optimize → bake):

- **Marks** come first. Optimize reads the layers under `Walkthrough`, keeps
  marked things apart instead of merging them, reports mistakes, and takes the
  start spot from the model. The bake reads the same marks to leave moving
  things out of baked light.
- **Lamps, still props, the still shadows of swaying things and several
  baked light pictures** change the baked light, so each needs a bake.
- **The opening and trailing download** need optimize to write a list of the
  environment's files, with their sizes and which download they belong to.

**In the walkthrough**:

- **Doors** need marks, a collision mesh that moves, and live light for moving
  things. **Elevators** are built on doors; their doors are sliding doors.
- **Sway** (grass, curtains and flags, swaying plants) needs marks, the wind,
  live light and reduced motion. Grass needs copies too, and swaying plants
  need props.
- **Birds** need copies, the clock, live light and reduced motion.
- **Materials and water** need little else; water needs the clock and
  reduced motion.
- **Sound**: ambient sound, footsteps and placed sounds stand alone; door and
  elevator sounds wait for moving parts.
- **Loading and the safety net** stand alone.

**Shared pieces** are each built once, by the first component that needs
them, and only as far as that component needs, then extended by later ones
(#16). The table above names which component brings each.

## Build order

**Foundations first, then risk first**: both the risk of missing 30 fps on the
Redmi and the risk of the author having to remodel. The safe ones come last.
(#16)

*Foundations*

1. Marks (#22)
2. Loading (#23)
3. Safety net (#24)

*Risk first*

4. Scatter and grass (#25): the biggest frame-rate unknown
5. Materials (#6): shine costs frame rate, and the setups decide how every
   material in the real building is made
6. Doors (#7)
7. Elevators (#26)
8. Baked light in several pictures (#27): bake time and sharpness at size

*The rest*

9. Props (#28)
10. Lamps (#29)
11. Water (#30)
12. Curtains and flags (#31)
13. Birds (#32)
14. Sound (#33)
15. Stress copy and the readiness check (#34)

**Before step 1**, the author models every finish-line thing into the test
environment in one session (lamps, a door, an elevator, props, grass ground,
curtains, water, a bird loop, sound spots), each under its mark. Every later
component then finds its things waiting, and the marking convention is tried
as a whole. (#16)

## Ready for the real building

Ticked by the author after walking on the Redmi Note 8. **Every box is ticked
on one version** of the walkthrough. "Convincing" is the author's own
judgement; other people's impressions belong in the written account. (#15)

**The fixed route** is a list of stops: the start spot, the stacked-glass view
zoomed in, an elevator ride, a door, outside among the grass and birds, and so
on. It is written here once the last component is in the test environment.

**The stress copy** is the finished test environment with its pavilion copied
side by side until there are four. It is served from the laptop to the Redmi
and never published (#15, #16, #34).

### Test environment, on the Redmi Note 8, each present and convincing

- [ ] Movement as it stands, including falling off a ledge
- [x] Baked light from the sky and from lamps (glowing materials)
- [ ] Ambient occlusion
- [ ] Glass
- [ ] Water: tints, reflects the sky through small waves, still for reduced
      motion
- [ ] Materials: plain, relief, shine and both, each used at least once, tuned
      in the test environment
- [ ] Grass as swaying scatter
- [ ] Still props (chairs, tables) with baked shadow; potted plants swaying;
      trees and bushes placed by hand, swaying as painted
- [ ] Curtains and flags swaying
- [ ] Birds on their loop, absent for reduced motion
- [ ] A door that opens, closes and stops the viewpoint when closed
- [ ] An elevator that carries the viewpoint between floors
- [ ] Sound: ambient, footsteps, a placed sound, door and elevator sounds;
      starts on first touch, pauses off screen
- [ ] Loading: "Loading into <name>", the trailing download fading in, a
      dropped connection recovered (flight mode on halfway, then off)

### Numbers

- [ ] The fixed route on the Redmi: lowest reading at least 30 fps, ambient
      occlusion on in ordinary views, safety net allowed
- [ ] On Slow 4G in DevTools: moving within 10 s, opening download about 2 MB
      at most
- [ ] Reported by `optimize`: whole walkthrough under 10 MB, sound under 3 MB
- [ ] One run on the Redmi over mobile data

### The author's side

- [ ] Every mark from ADR 0004 used at least once in the test model
- [ ] `optimize` reports a deliberately misspelt mark
- [ ] One change, such as moving a door, goes from Rhino to the published
      walkthrough without touching code

### Stress copy

- [ ] Bakes in under 2 hours on the NVIDIA laptop
- [ ] Baked light as sharp as in the test environment, with no visible seams
- [ ] The fixed route through its first pavilion holds the same frame-rate rule
- [ ] Its opening download and time to move are recorded; going over budget is
      allowed

### Optional, not part of the gate

- The oldest available iPhone opens, steers and plays sound.
- A laptop browser with keyboard works.

## Still open

- **The shape of the written account**: where the study's findings are
  written, and how much of it the ADRs and research notes already cover.
  Decided at the finish line.
- **Each component's own open decisions**, listed in its issue under "To
  decide when it is built".

## Out of scope

- A guided route for viewers who don't steer.
- Modelling the real building, which comes after the finish line.
- Switching engine, settled by ADR 0001 and
  `docs/research/particles-and-engine-switch.md`.
