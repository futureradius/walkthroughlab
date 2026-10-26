# Preparing a bird in Blender

Birds are the walkthrough's only traffic so far: a **flock** of copies of one
bird flying round a loop the author draws (see **Traffic** and **Flock** in
`GLOSSARY.md`, decided in #11, #12 and #32). This is how to make the bird and
draw its loop.

## The file

- Export it as glTF binary (`.glb`) to `models-source/traffic/<name>.glb`.
  `npm run optimize` compresses it into the walkthrough's files.
- A layer `traffic-<name>` inside `Walkthrough` in the Rhino model flies it:
  `traffic-birds` flies `birds.glb`.
- Work in metres, at the size it really is. A crow is about 0.7 m across its
  wings. Keep it to a few hundred triangles: it is seen small, and many times.

## Where its middle is and which way it faces

- **The origin is its middle**, between the wings. That point follows the loop.
- **Its front is what Blender's Front view (numpad 1) looks at**: the side
  facing −Y in Blender. The beak points that way.
- **The wings lie level, spread out along X**, as in a glide. The walkthrough
  turns each wing about the bird's length, from the body outwards.

## Painting the flap

Paint how much each part flaps as vertex colour: black stands still, white
flaps the most. Keep the body and the shoulders black and lighten the wings
evenly to white at their tips. A wing painted that way bends as it beats,
rather than swinging stiffly.

**Export with Data › Mesh › Vertex Color: Active.** Blender writes vertex
colour only if a material uses it, and otherwise drops the paint without a
word.

Without paint, a part flaps more the further it is from the centre line, and
optimize says the bird arrived unpainted.

## The loop in Rhino

Draw one closed polyline per flock on the `traffic-<name>` layer, the loop
the flock flies round. It may rise and fall, and its corners may be sharp:
the walkthrough smooths them into arcs, and the flock cuts inside every
corner. An open polyline is closed from its last point back to its first,
and optimize says so when its ends are more than 1 m apart.

A bird climbing steeply flaps without a pause, flying level it pauses
between bursts of flapping, and sinking steeply it only glides. So the
loop's rises and falls show in how the birds fly. On a loop that climbs only
gently, lower the angles in the config file.

## Its settings

A traffic mark's settings go in the config file under `## traffic-<name>`:
`count`, `speed`, `spread`, `size`, `flap` (wingbeats a second), `bank`
(degrees, in the tightest turns), `climb` and `dive` (degrees), `pause` and
`burst` (seconds). The `?config` panel explains each one.

Birds have no shadow and stay out of the baked light. They are lit by the sky
and arrive near the end of the trailing download. Viewers who ask for reduced
motion see none.

`node scripts/placeholder-birds.mjs` writes a placeholder bird to try all of
this with.
