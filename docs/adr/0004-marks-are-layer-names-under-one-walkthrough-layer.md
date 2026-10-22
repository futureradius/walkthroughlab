# Marks are layer names under one Walkthrough layer

An author tells the walkthrough what things are (the collision mesh, the start spot, doors, elevators, sway, props, scatter, traffic, placed sounds) by putting them on layers inside one top layer named `Walkthrough` in the Rhino model. Each layer's name is a kind followed by a name, joined by dashes, such as `door-hinged-1`, `prop-chair` or `sound-fountain`; lines drawn on it say where and which way. Of the three labels that survive Rhino's glTF export (layer, object and material names), layers were chosen because they all show in one panel, a whole group of things is marked at once, and the clash of a layer and an object sharing a name never arises; object names were rejected because they hide in the Properties panel and naming a layer does not name its objects (#18). Marks are read only inside `Walkthrough` because an author's own layers, such as "Door frames", would otherwise be misread as marks. Dashes join the parts because Rhino writes sublayer paths with `::` and a colon in a layer name has been reported to cut the name short.

## Consequences

- Water is the one exception: it is marked by a material named `water` or `water-…`, because it is a kind of surface wherever it is used. Glass and lamps need no mark; they are recognised from their material's transparency and glow.
- A marked thing cannot be a block, because blocks arrive as nameless copies on the block's inner layers. Props take the place of blocks for things placed many times.
- Every drawn mark is a line or polyline: points, arcs and smooth curves do not survive export, and hidden objects and turned-off layers are not exported.
- The optimize step must keep the things on a marked layer apart instead of merging them, since each line or object there can mean one copy, one source or one cloth.
- Numbers and yes-or-no choices never go in a name; they sit in the config file under a heading that repeats the mark.
