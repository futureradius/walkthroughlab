# Adding sound to an environment

What the viewer hears: one **ambient sound**, **footsteps**, **placed
sounds**, and the sounds of doors and elevators (see `GLOSSARY.md`, decided in
#13, #19 and #33). This is where each comes from and how to change it.

## The files

- Put raw sound files in `models-source/sounds/`, in any common format (WAV,
  FLAC, MP3, Ogg, M4A…). Beside each, a `<name>.txt` says where it came from
  and its licence: only CC0 or CC BY.
- `npm run optimize` turns them into the files viewers download, in
  `public/models/sounds/`, and reports how much sound there is. All sound
  together stays under 3 MB.
- Only files a mark or a fixed name below asks for are published; optimize
  warns about any other file in the folder.
- Every sound is brought to the same level, so a loudness setting means the
  same for any file. Loops are made seamless: the end is blended into the
  start, so a recording needs no careful cut.
- Credit every sound by hand under "Sounds" in `content/about.md`.

## Fixed names

| Name | What it is | Plays |
|---|---|---|
| `ambient` | heard everywhere, in stereo; only its first 2 minutes are kept | as a loop |
| `footstep-1`, `footstep-2`, … | one footstep each, as many as you like, played in random order | once per stride |
| `door-hinged-open`, `door-hinged-close` | a hinged door starting to open or close | once |
| `door-sliding-open`, `door-sliding-close` | a sliding door, the elevator's doors too | once |
| `elevator-start` | the car setting off | once |
| `elevator-hum` | the car travelling | as a loop |
| `elevator-arrive` | the car arriving at a stop, such as a chime | once |

The walkthrough ships with default footsteps, door and elevator sounds, in
`public/sounds/`. A file in `models-source/sounds/` with one of these names
replaces the default for the whole environment. Footsteps of your own replace
all the default ones.

## Changing the default sounds

- The recordings, as downloaded, are in
  `models-source/default-sounds/originals/`, each with a `.txt` credit.
- `node scripts/default-sounds.mjs` cuts each into the bit that is heard,
  by the table at its top, writes it as a WAV to
  `models-source/default-sounds/<name>.wav`, and encodes it into
  `public/sounds/`. Then run `npm run optimize` and commit `public/sounds/`.
- To fine-tune a cut, edit its WAV in an editor such as Audacity and run the
  script again: a cut already there is kept. Delete it to cut it again from
  the table, for instance after changing its times.
- Footsteps are found in their recording by themselves, each one a file.
- A close sound plays as the door starts to close, so its slam sits about
  0.6 s in, when a door of the usual opening time shuts.

## Placed sounds

- A layer `sound-<name>` inside `Walkthrough` in the Rhino model plays
  `models-source/sounds/<name>` as a loop from the middle of each object on
  the layer: `sound-hum` plays `hum.wav`.
- Draw a line where the sound is if nothing should be seen there: a bare
  line is invisible. An object, such as a machine, is shown as it is.
- Only the nearest few placed sounds play at once.

## How things sound with distance

Placed sounds, doors and the elevator are heard from their direction. Each
is at full strength within a metre, halves with each doubling of distance up
to its **realistic** distance, then fades in a straight line to silence at its
**silent** distance. Walls do not muffle and rooms do not echo. While riding
the elevator, its sounds are at full strength.

## Settings

Each is set in the environment's config file and can be tried while walking
with `?config`:

- `## Sound`: `on: no` turns all sound off, and `ambient: no` the ambient
  sound alone, for walks where sound would distract, such as surveys in
  public places. What is off is not downloaded either.
- `## Ambient sound`: its loudness.
- `## Footsteps`: their loudness, and the stride walking and running.
- `## Placed sounds`: how many play at once.
- `## sound-<name>`: a placed sound's loudness and distances.
- `## door-hinged`, `## door-sliding`, `## elevator`: their sounds' loudness
  and distances, beside how they move.

## Starting and stopping

Sound begins on the viewer's first touch or key, with a gentle fade, and
pauses whenever the page is off screen. There is no mute button. An iPhone on
silent stays silent. Each sound is heard once its file has arrived, last in
the trailing download.
