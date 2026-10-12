# Settings for the test environment

The walkthrough reads this file each time it opens the environment. To change
a setting, change its value, save, and publish.

Only headings and lines of the form `- name: value` are read; everything else
is notes. A value is a number, `yes` or `no`, or a single word. A setting left
out keeps its usual value, and a misspelt name is reported in the browser's
console.

## Ambient occlusion

Add `?ao` to the walkthrough's address for a panel that changes these while
walking. Its "Copy for the settings file" button copies this list with the
panel's values, ready to paste over the one below.

- on: yes
- method: gtao
- reach: 0.2
- strength: 2
- spare: 1
- sunlit: 0.2
- samples: 8
- detail: 0.5
- smooth: yes
- falloff: 1

What they mean:

- `on`: `no` leaves ambient occlusion out altogether.
- `method`: how the darkening is worked out. `gtao` is the one three.js
  brings; `n8ao` is N8AO, on trial beside it.
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
- `falloff`: with `n8ao` only. Smaller leaves less of a dark outline around
  whatever stands in front of a wall, and less darkening altogether.
