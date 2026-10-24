# Moving things stay out of baked light

ADR 0002 bakes light into one picture, which made every environment fully static: anything that moved would leave its baked shadow behind. Environments now need moving parts (doors, windows, shutters, elevators), sway (grass, bushes, trees, curtains, flags) and traffic (birds, metro wagons, cars). Everything in an environment stays static and in the baked light unless the author marks it in the model as one of those three. A marked thing is left out of baked light, lit live by the sky, and darkened by the baked light of the spot where it stands. Baking every state of everything was rejected because download and bake time multiply with each part and it cannot work for sway or traffic; live shadows for everything that moves were rejected because they spend the frame rate on old phones that ADR 0001 and ADR 0002 protect.

Two refinements sit on top of that baseline:

- **Second bake for moving parts.** A moving part that opens or closes an opening may get a second baked picture for its other state, covering only the surfaces whose light differs, which the walkthrough fades as the part moves. Two states only, open and closed. The main picture holds the part as the author modelled it, since that is what viewers see first.
- **Still shadows for sway.** A thing that sways may cast a baked shadow from its resting shape, at the author's choice: trees and bushes usually do, grass does not. The shadow stays still while the thing sways above it. Traffic never casts a baked shadow, because it leaves.

## Consequences

Moving things cast no shadow of their own onto the environment, which shows most on large traffic such as a metro wagon. A second bake is as large as the light change, not as large as the part: a shutter on a room's only window means a second picture of the whole room, and moving parts close together multiply each other's states. For viewers whose device asks for reduced motion, sway rests in its still shape and traffic is absent; only moving parts still move.

## Open

- **Live shadow near the viewpoint.** One small shadow picture around the viewpoint, holding only moving things, would give them a travelling shadow. It is permitted but not adopted until measured on an old phone, and it needs a sky with a sun. Once it exists, a tree's still baked shadow could give way to a live one up close, using a second bake of the ground without that shadow.
- **Moving parts and the viewpoint.** A door that stops the viewpoint and an elevator that carries it change the collision mesh, which is fixed and hand-modelled today. This decision covers appearance only; issue #7 tracks the rest, including generating the collision mesh instead of modelling it by hand.
- **Other viewers.** Seeing other viewers needs a server, which reopens ADR 0001. Under this rule another viewer would be one more moving thing left out of baked light.

## Amended 2026-10-24: moving parts keep their baked light

A door is baked as modelled, closed, and keeps its baked light as it moves: the light travels with its surfaces, and the shadow of the closed door stays in the doorway (#7). Tree trunks and branches do the same when they sway (#28). Looks right closed and passes when open; if the doorway's shadow gives a door away, it is left out of the bake as this decision first said, or gets a second bake for its open state (in `docs/ideas.md`).
