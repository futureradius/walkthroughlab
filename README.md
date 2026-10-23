# walkthroughlab
Walk through an architectural space in the browser: https://futureradius.github.io/walkthroughlab/

## Preparing an environment

1. In Rhino, mark what the walkthrough needs to know with layers inside one top layer named `Walkthrough` (ADR 0004; the full convention is in issue #12). At the least: the collision mesh on `Walkthrough › collision mesh`, and one flat line on `Walkthrough › start` from where the viewer stands towards where they look. Keep those layers switched on, and export everything with "Export Layers" ticked as one `.glb` into `models-source/`.
2. Put the sky, an equirectangular `.exr` panorama, into `models-source/` as well.
3. Run `npm run optimize` (or `npm run optimize -- <environment>` when `models-source/` holds more than one Rhino export). It reads the marks and lists what is wrong with them, shrinks the textures and writes the file viewers download to `public/models/`. From the sky it writes a picture and a small light file to `public/skies/`. A model without a collision mesh or a start spot is refused; other mistakes are warnings, also listed under "Warnings and errors" in the `?config` panel.

4. Run `npm run bake`. It needs [Blender](https://www.blender.org/) installed and takes a few minutes: it computes the light and shadow the sky casts on the environment and writes them as one picture next to the environment in `public/models/`. Run it again whenever the environment or its sky changes.

`models-source/` is not committed; `public/models/` and `public/skies/` are.

## Moving through it

- The joystick walks forward and back and turns on the spot.
- Dragging anywhere else is free look: the scene follows the finger or mouse. While a drag is held, pushing the joystick sideways sidesteps instead of turning.
- A drag let go of while moving throws the view: it coasts on, slowing to a stop, and the next touch on the view catches it. A finger that rests before lifting leaves the view where it is. With the device's reduced-motion setting on, it settles almost at once.
- Running goes forward at two and a half times walking pace. On the joystick, push it forward, let it back towards the middle (or let go) and push it forward again, each quickly; a push counts as long as it goes more forward than sideways. Running lasts until the push forward slows to walking pace or the joystick is let go, and then has to be started again. Walking backward, sidestepping and turning stay at walking pace, and turning eases off further the faster the viewer goes. The pace picks up and drops back over about a third of a second.
- On a keyboard, W/S or the up/down arrows walk, A/D sidestep, and the left/right arrows turn. Holding Shift while walking forward runs.
- A view tilted up or down returns to level once the viewer sets off, unless a drag is being held.
- Two fingers on the view zoom: spreading them zooms in towards the spot between them, which stays under the fingers, and moving them together drags the view as one finger does. On a computer the mouse wheel, or pinching on a trackpad, zooms towards the pointer. Zoom goes from 1× to 2.5×, stays while the viewer stands still or holds the view, and wears off as they walk, together with the view levelling out. Zoomed in, the joystick and the arrow keys turn more slowly.

## Running it

- `npm run dev` serves the walkthrough on your network, for testing on a phone.
- Add `?fps` to the address to show the frame rate.
- Add `?config` for a panel that changes settings while walking, with a line under each saying what it does; its sections start folded shut. Combine it with `?fps` to see what ambient occlusion's settings cost.
- Ambient occlusion is on wherever the device can work it out. Its "Method" switches between [N8AO](https://github.com/N8python/n8ao) (`n8ao`), which is the usual one, three.js's own ambient occlusion (`gtao`), and the fast ambient occlusion from [Glamarye Fast Effects for ReShade](https://github.com/rj200/Glamarye_Fast_Effects_for_ReShade) (`glamarye`). Only the method the config file chooses is downloaded, while the environment loads; one picked in the panel is downloaded then, and frames go without ambient occlusion until it arrives. The panel shows only the settings the chosen method uses, as each method lists them in `METHODS` in `src/occlusion.ts`.
- What suits Walking, Running, Coasting and the Joystick goes into their usual values by hand, since it is the same for every environment: in `src/motion.ts`, `src/running.ts`, `src/coasting.ts` and `src/steering.ts`. Each setting's range and what it does are written beside its usual value.
- `sound-loop/` (after the address) is a test page for how looping sounds play on phones (#35). `node scripts/sound-loop-test.mjs` remakes its sounds; it needs ffmpeg.

## Config file for an environment

`public/models/test-environment-config.md` is the environment's config file, which sets its ambient occlusion and zoom. Change a value there by hand, or tune in the `?config` panel and paste what a section's "Copy for the config file" button copies. A value the walkthrough cannot use is reported in the browser's console.

## Information and credits

The "i" button in the top-right corner opens a panel whose text is `content/about.md`. Edit that file to name sources and licences; ordinary Markdown works, and links open in a new tab.
