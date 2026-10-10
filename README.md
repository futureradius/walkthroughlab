# walkthroughlab
Walk through an architectural space in the browser: https://futureradius.github.io/walkthroughlab/

## Preparing an environment

1. In Rhino, put the collision mesh on a layer named `Collision Mesh` and export everything as one `.glb` into `models-source/`.
2. Put the sky, an equirectangular `.exr` panorama, into `models-source/` as well.
3. Run `npm run optimize`. It shrinks the textures and writes the file viewers download to `public/models/`. From the sky it writes a picture and a small light file to `public/skies/`.

`models-source/` is not committed; `public/models/` and `public/skies/` are.

## Moving through it

- The joystick walks forward and back and turns on the spot.
- Dragging anywhere else is free look: the scene follows the finger or mouse. While a drag is held, pushing the joystick sideways sidesteps instead of turning.
- On a keyboard, W/S or the up/down arrows walk, A/D sidestep, and the left/right arrows turn.
- A view tilted up or down returns to level once the viewer sets off, unless a drag is being held.

## Running it

- `npm run dev` serves the walkthrough on your network, for testing on a phone.
- Add `?room` to the address for the gridded white room, and `?fps` to show the frame rate.
