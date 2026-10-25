# Preparing a prop in Blender

A prop is a thing made once as its own small file and placed wherever the
model marks it, such as a chair, a table, a potted plant or a tree (see
**Prop** in `GLOSSARY.md`, decided in #28). This is how to make one.

## The file

- Export it as glTF binary (`.glb`) to `models-source/props/<name>.glb`.
  `npm run optimize` compresses it into the walkthrough's files.
- A layer `prop-<name>` inside `Walkthrough` in the Rhino model places it:
  `prop-chair` places `chair.glb`.
- Work in metres, at the size it really is.

## Where it stands and which way it faces

- **The origin is where it stands**: the foot of a chair's legs, the bottom
  of a pot, the base of a trunk.
- **Its front is what Blender's Front view (numpad 1) looks at**: the side
  facing −Y in Blender. A chair's front is where you sit down from.

In Rhino, each copy is one horizontal line on the prop's layer, from where it
stands, pointing the way its front faces. **The line's length is its size**:
1 m keeps the size it was modelled at, 2 m doubles it.

## What sways

- Parts with a material whose name begins with `sway-`, such as `sway-leaves`
  or `sway-plant`, sway, are lit live, and arrive just after the viewer can
  move. Leaves are best as cards: a picture whose clear parts are cut away
  (alpha clip), the way a crown is affordable on a phone.
- Everything else is baked like the rest of the environment: a pot, a chair, a
  tree's trunk and branches.
- The word after `sway-` is only a name. A prop's own settings go in the
  config file under `## prop-<name>`: `shadow` (yes or no) and `sway`, a share
  of the wind.

## Painting sway

Paint how much each part sways as vertex colour: black stands still, white
sways the most. On a tree, keep the trunk nearly black, let the branches
lighten towards their tips, and paint the leaves lightest at the top and
outside of the crown. Where a branch tip meets its leaves, give both the same
grey, so they move together.

**Export with Data › Mesh › Vertex Color: Active.** Blender writes vertex
colour only if a material uses it, and otherwise drops the paint without a
word.

Without paint, a `sway-` part sways more the higher it is and the further from
the upright line through the origin, and the rest stands still. Optimize says
when a prop's `sway-` parts arrive unpainted.

## Stopping the viewer

An object named `collision mesh` in the file is copied into the collision
mesh at every copy, scaled with it, and never seen. Upright walls round a
trunk or the legs of a table are enough: walls stop the viewer, and floors
carry them. A prop without one can be walked through.

## Shadow and light

A prop casts a still shadow from its resting shape, unless its config file
section says `shadow: no`; that needs a new `npm run optimize` and bake. The
leaves take their light from a small square above the crown, which the bake
lights and viewers never see.

A prop can be a lamp, such as a table lamp with a glowing shade: give the
glowing part an Emission colour and strength in Blender, which writes them as
the bake uses them, unlike Rhino (see "Lamps" in the README). It glows from
its front, the side its normals face, and optimize lists its copies with the
environment's lamps. A glowing `sway-` part glows but lights nothing, since
swaying parts stay out of the bake.

`node scripts/placeholder-props.mjs` writes placeholder props to try all of
this with.
