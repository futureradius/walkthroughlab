# walkthroughlab
Walk through an architectural space in the browser: https://futureradius.github.io/walkthroughlab/

## Preparing an environment

1. In Rhino, put the collision mesh on a layer named `Collision Mesh` and export everything as one `.glb` into `models-source/`.
2. Put the sky, an equirectangular `.exr` panorama, into `models-source/` as well.
3. Run `npm run optimize`. It shrinks the textures and writes the file viewers download to `public/models/`. From the sky it writes a picture and a small light file to `public/skies/`.

4. Run `npm run bake`. It needs [Blender](https://www.blender.org/) installed and takes a few minutes: it computes the light and shadow the sky casts on the environment and writes them as one picture next to the environment in `public/models/`. Run it again whenever the environment or its sky changes.

`models-source/` is not committed; `public/models/` and `public/skies/` are.

## Moving through it

- The joystick walks forward and back and turns on the spot.
- Dragging anywhere else is free look: the scene follows the finger or mouse. While a drag is held, pushing the joystick sideways sidesteps instead of turning.
- On a keyboard, W/S or the up/down arrows walk, A/D sidestep, and the left/right arrows turn.
- A view tilted up or down returns to level once the viewer sets off, unless a drag is being held.

## Running it

- `npm run dev` serves the walkthrough on your network, for testing on a phone.
- Add `?fps` to the address to show the frame rate.
- Add `?config` for a panel that changes settings while walking; its sections start folded shut.
- Ambient occlusion is on wherever the device can work it out. The panel's "Ambient occlusion" section changes its settings, switches it off, or shows only the darkening it adds; combine it with `?fps` to see what each setting costs.
- That section's "Method" switches between [N8AO](https://github.com/N8python/n8ao) (`n8ao`), which is the usual one, and three.js's own ambient occlusion (`gtao`).

## Settings for an environment

`public/models/test-environment.md` holds the settings the walkthrough uses for the environment, with a note on each. Change a value there by hand, or tune in the `?config` panel and paste what its "Copy for the settings file" button copies.

## Information and credits

The "i" button in the top-right corner opens a panel whose text is `content/about.md`. Edit that file to name sources and licences; ordinary Markdown works, and links open in a new tab.
