# walkthroughlab
Walk through an architectural space in the browser: https://futureradius.github.io/walkthroughlab/

## Preparing an environment

1. In Rhino, put the collision mesh on a layer named `Collision Mesh` and export everything as one `.glb` into `models-source/`.
2. Run `npm run optimize`. It shrinks the textures and writes the file viewers download to `public/models/`.

`models-source/` is not committed; `public/models/` is.

## Running it

- `npm run dev` serves the walkthrough on your network, for testing on a phone.
- Add `?room` to the address for the gridded white room, and `?fps` to show the frame rate.
