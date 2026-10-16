# Settings for the test environment

The walkthrough reads this file each time it opens the environment. To change
a setting, change its value, save, and publish.

Only headings and lines of the form `- name: value` are read; everything else
is notes. A value is a number, `yes` or `no`, or a single word. A setting left
out keeps its usual value, and a misspelt name is reported in the browser's
console.

## Ambient occlusion

Add `?config` to the walkthrough's address for a panel that changes these
while walking. Its "Copy for the settings file" button copies this list with
the panel's values, ready to paste over the one below.

- on: yes
- method: n8ao
- reach: 0.2
- strength: 4
- spare: 1
- sunlit: 0.2
- samples: 12
- detail: 0.5
- smooth: yes
- blur: box2
- falloff: 3
- edges: no
- shade: 1.65
- shine: 0.5
- radius: 0.6
- points: 4
- shape: 1432
- gap: 1.04
- fade: 0.25
- dither: no

What they mean:

- `on`: `no` leaves ambient occlusion out altogether.
- `method`: how the darkening is worked out. `n8ao` is N8AO; `gtao` is the
  one three.js brings; `glamarye` is the one from Glamarye Fast Effects.
- `reach`: how far a surface looks for neighbours that shade it, in metres.
- `strength`: how hard the darkening is pressed. 0 is none, 1 is as worked
  out, more is darker.
- `spare`: how much of the darkening sunlit surfaces are let off, from 0
  (none) to 1 (all).
- `sunlit`: how bright the baked light must be for a surface to count as
  sunlit, from 0 to 1. Lower spares more surfaces.
- `samples`: how many spots around each pixel are checked. More is smoother
  and slower.
- `detail`: the share of the screen's width and height the darkening is
  worked out at. 0.5 is a quarter of the pixels; 1 is sharpest and slowest.
- `smooth`: whether the speckle that few samples leave is smoothed away.
- `blur`: with any method, how the darkening is blurred once worked out.
  `off` leaves it as it is; `box2` washes out a pattern that repeats every
  2 by 2 pixels, such as the checkerboard `glamarye` leaves; `box4` reaches
  twice as far and costs four times as much; `depth4` is `box4` that keeps
  the darkening from smearing over the edges of things, and costs the most.
- `falloff`: with `n8ao` only. Smaller leaves less of a dark outline around
  whatever stands in front of a wall, and less darkening altogether.
- `edges`: with `n8ao` only, and a `detail` of 0.5 or less. `yes` enlarges
  the darkening with an eye on where surfaces end, so it stays within their
  edges. It costs more: the depths it goes by are drawn at twice the detail.
- `shade`: with `glamarye` only, in place of `strength`. How deep hollows
  are shaded, from 0 to 1 and more.
- `shine`: with `glamarye` only. How much bumps facing the viewpoint are
  brightened, from 0.
- `radius`: with `glamarye` only, in place of `reach`. How far around each
  pixel it looks, as a share of the screen: 1 is a hundredth of its diagonal.
- `points`: with `glamarye` only, in place of `samples`. How many spots on a
  circle around each pixel are checked, from 2 to 16.
- `shape`: with `glamarye` only. How deep a hollow must be before it is
  shaded, from 1 to 4000.
- `gap`: with `glamarye` only. How much nearer or farther a spot may be and
  still count, in hundredths of the depth. Smaller leaves less of a dark
  outline around whatever stands in front of a wall.
- `fade`: with `glamarye` only. The depth at which the darkening has faded
  out; 0.5 is about 100 m.
- `dither`: with `glamarye` only. `yes` uses four sizes of circle in a
  pattern of 2 by 4 pixels instead of two in a checkerboard; `box4` blurs it
  away, `box2` does not.
