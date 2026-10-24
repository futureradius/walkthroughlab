# Bake light with scripted Blender instead of by hand or live on the phone

Shadows and bounced light make an environment readable, but computing them live costs frame rate that old phones don't have, and environments are prepared in Rhino, which cannot paint lighting into a texture for export. We bake light with `npm run bake`, which drives Blender in the background: it loads the optimised environment and its sky, traces the light with Cycles, and writes one picture that the walkthrough multiplies onto the surfaces. Baking by hand in a 3D tool on every export was rejected as slow and easy to get subtly wrong; live shadows on the viewer's device were rejected because they would spend the performance budget that ADR 0001 protects.

## Consequences

Blender becomes a second 3D tool the project depends on, though authors never open it: it only has to be installed. Baked light is fixed for one sky at one rotation, so changing either means baking again, which takes minutes. A thing that moves would leave its baked shadow behind; ADR 0003 says how moving things are handled. An environment without baked light still works; its sky lights it live, without shadows.

## Amended 2026-10-24: relief and shine over baked light

Baked light no longer has to be all a surface shows. A material with a normal map or a smooth or metal finish adds, live, relief lit by the sky against the flat surface, and the sky's reflection, dimmed by the share of open sky's light the baked light says reaches the spot (#6). Metal is baked too, for its light only, so its reflections can be dimmed indoors. Plain materials still show colour times baked light and nothing else. Measured on the Redmi Note 8 with the safety net off, in the worst view through stacked glass: 37 fps at the lowest with relief and shine, 40 without, so they cost about 3 fps there. The safety net takes them away, as one step, before ambient occlusion.
