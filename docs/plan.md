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

One small step sat outside the order:

- **Sound loop test on old phones** (#35), done before Sound. Opus loops
  cleanly on the Redmi Note 8 and a Pixel 6, and fades nicely as the page
  leaves the screen and comes back, so Opus stays the one format. No iPhone
  was at hand; if iPhones turn out to have a problem, sound is adjusted then.

Bakes run on the main laptop's NVIDIA card. Baking on the second laptop,
driven remotely, is in the ideas log (#36).

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

**One version** is one commit, whose hash is written at the top of this
checklist when the sitting begins. Any change after that, even to a config
file, makes a new version, and the walk starts again. Ticks made before the
sitting only say a component passed then, so they are cleared when it begins.
Moving a door from Rhino to the published walkthrough, one of the boxes below,
is the last commit before the hash. Editing this checklist is not a change to
the walkthrough. (#34)

**Every box was ticked on `cfb91d8`** by 2026-10-31, so the finish line is
reached (#34).

**The fixed route** is walked in one go from the start spot with `?fps`, without
reloading, and the `lowest` it shows is the reading that counts. Each stop is a
named view, to come back to one with `?view=<name>` when something needs a
second look; that reload resets `lowest`. In order: (#34)

1. The start spot: the sculpture and the grass hill
2. `view-grass`: outside among the grass and birds, the flag seen in passing
3. `view-glass`: the stacked-glass view, zoomed in
4. `view-water`: the pool's edge, water filling the screen
5. `view-blocks`: the material blocks
6. `view-stairs`: the pavilion stairs, then through a door
7. `view-inside`: inside the pavilion, past the curtain
8. `view-elevator`: a ride to every stop and back

**The stress copy** is the finished test environment with its pavilion copied
in Rhino. As built, that adds four copies of its door, a second elevator with
five stops beside the first, and six placed hums in place of one. Its views
are the same as the test environment's, so the route stays in the original
pavilion. Its files stay out of git, so it is never published. It opens with
`?environment=stress-copy`, served from the laptop to the Redmi with
`npm run build` and `npm run preview`, so what is walked is built as the
published walkthrough is (#15, #16, #34). It is walked once as a rehearsal
before the hash is written, so what it turns up is fixed before the sitting.
A frame-rate, sharpness or bake-time box that fails holds up the finish line
until the walkthrough is fixed; the bar does not drop.

### Test environment, on the Redmi Note 8, each present and convincing

- [x] Movement as it stands, including falling off a ledge
- [x] Baked light from the sky and from lamps (glowing materials)
- [x] Ambient occlusion
- [x] Glass
- [x] Water: tints, reflects the sky through small waves, still for reduced
      motion
- [x] Materials: plain, relief, shine and both, each used at least once, tuned
      in the test environment
- [x] Grass as swaying scatter
- [x] Still props (chairs, tables) with baked shadow; potted plants swaying;
      trees and bushes placed by hand, swaying as painted
- [x] Curtains and flags swaying
- [x] Birds on their loop, absent for reduced motion
- [x] A door that opens, closes and stops the viewpoint when closed
- [x] An elevator that carries the viewpoint between floors
- [x] Sound: ambient, footsteps, a placed sound, door and elevator sounds;
      starts on first touch, pauses off screen
- [x] Loading: "Loading into <name>", the trailing download fading in, a
      dropped connection recovered (flight mode on halfway, then off)

### Numbers

- [x] The fixed route on the Redmi: lowest reading at least 30 fps, ambient
      occlusion on in ordinary views, safety net allowed (35 fps)
- [x] On Slow 4G in DevTools: moving within 10 s, opening download about 2 MB
      at most (about 8.4 s at 1500 kbit/s, 1.17 MB)
- [x] Reported by `optimize`: whole walkthrough under 10 MB, sound under 3 MB
      (7.00 MB and 0.80 MB)
- [x] One run on the Redmi over mobile data

### The author's side

- [x] Every mark from ADR 0004 used at least once in the test model
- [x] `optimize` reports a deliberately misspelt mark
- [x] One change, such as moving a door, goes from Rhino to the published
      walkthrough without touching code (`door-hinged-2`, 1 m)

### Stress copy

- [x] Bakes in under 2 hours on the main laptop's NVIDIA card (21.7 min)
- [x] Baked light as sharp as in the test environment, with no visible seams
- [x] The fixed route through its original pavilion holds the same frame-rate
      rule (30 fps, the very limit)
- [x] Its placed sounds playing at once, at least 4 (#33), hold the same
      frame-rate rule; as built there are 6, and if those fail, 4 are tried
      (all 6 held it)
- [x] Its bake time, number of light pictures, opening download, time to move
      and frame rates are recorded here with the hash; going over budget is
      allowed. On `cfb91d8`: 21.7 min, 4 pictures, 2.01 MB, moving after about
      16.2 s at the same slow setting as the test environment and 3.8 s over the
      local network, lowest 30 fps

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
