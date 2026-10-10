# Bake light with scripted Blender instead of by hand or live on the phone

Shadows and bounced light make an environment readable, but computing them live costs frame rate that old phones don't have, and environments are prepared in Rhino, which cannot paint lighting into a texture for export. We bake light with `npm run bake`, which drives Blender in the background: it loads the optimised environment and its sky, traces the light with Cycles, and writes one picture that the walkthrough multiplies onto the surfaces. Baking by hand in a 3D tool on every export was rejected as slow and easy to get subtly wrong; live shadows on the viewer's device were rejected because they would spend the performance budget that ADR 0001 protects.

## Consequences

Blender becomes a second 3D tool the project depends on, though authors never open it: it only has to be installed. Baked light is fixed for one sky at one rotation, so changing either means baking again, which takes minutes. Nothing in an environment can move, since its shadow would stay behind. An environment without baked light still works; its sky lights it live, without shadows.
