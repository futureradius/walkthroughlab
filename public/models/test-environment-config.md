# Config file for the test environment

The walkthrough reads this file each time it opens the environment. To change
a setting, change its value, save, and publish.

Only headings and lines of the form `- name: value` are read; everything else
is notes. A value is a number, `yes` or `no`, or a single word. A setting left
out keeps its usual value. One the walkthrough cannot use, such as a misspelt
name, a number outside its range or a word it does not know, is reported in
the browser's console and keeps its usual value too.

Add `?config` to the walkthrough's address for a panel that changes these
while walking and says what each one does. A section's "Copy for the config
file" button copies its list with the panel's values, ready to paste over the
one below. Only Ambient occlusion and Zoom can be set here.

## Ambient occlusion

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
