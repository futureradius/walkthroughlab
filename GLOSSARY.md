# Walkthroughlab

A lightweight, browser-based tool for experiencing architectural spaces from the inside, built as a study prototype.

## Language

**Walkthrough**:
A real-time, first-person traversal of a three-dimensional architectural space, steered by the person viewing it.
_Avoid_: Tour, flythrough, animation, render

**Environment**:
The architectural space an author prepares and a viewer sees and moves through in a walkthrough.
_Avoid_: Model, scene, level, map

**Sky**:
The surrounding panorama an author chooses for an environment, which the viewer sees beyond the architecture and which lights it.
_Avoid_: HDRI, skybox, environment map, backdrop

**Baked light**:
The light and shadow computed once in advance for an environment under its sky and its lamps and stored with it, so a viewer's device only has to display it.
_Avoid_: Lightmap, global illumination, GI

**Lamp**:
A surface of an environment whose material glows with a plain colour, set by the author in Rhino. It glows from its front only, the side its surface faces in Rhino: that side lights the environment through its baked light, and the viewer sees it glowing. Rhino's own lights are not lamps.
_Avoid_: Light, light source, emitter, luminaire, emissive

**Ambient occlusion**:
The soft darkening a viewer's device adds live where surfaces meet or come close, finer than baked light can hold.
_Avoid_: AO, SSAO, contact shadow

**Collision mesh**:
The simplified, invisible geometry an author builds alongside an environment to decide where the viewpoint can go: its floors and slopes carry the viewpoint and its walls stop it.
_Avoid_: Collider, navmesh, hitbox, physics mesh

**Viewer**:
A member of the general audience who opens a walkthrough and moves through it. Viewers never prepare or change a walkthrough.
_Avoid_: Player, user, visitor, player controller

**Author**:
The person who prepares a walkthrough from their own architectural model and publishes it for viewers.
_Avoid_: Admin, creator, uploader

**Mark**:
A layer name, or for water a material name, in the author's Rhino model that says what the things under it are, such as a door, a placed sound or the collision mesh. Lines drawn under a mark say where and which way: a hinge, a route, a start spot.
_Avoid_: Tag, label, annotation, user text

**Config file**:
The file an author writes beside an environment to give it the name viewers see while it loads, and to change how ambient occlusion and zoom work in it, overriding their usual values. Adding `?config` to a walkthrough's address opens a panel that changes the same values while walking and copies them for the config file.
_Avoid_: Settings file, preferences, options file

**Viewpoint**:
The position and direction of the viewer's eyes within the space.
_Avoid_: Camera, player, character

**Start spot**:
The spot and direction where the viewpoint begins when a viewer opens an environment, drawn by the author in the model.
_Avoid_: Spawn point, start position, origin

**Steering**:
How the viewer's joystick, keys, free look and zoom move the viewpoint, frame by frame.
_Avoid_: Player controller, camera controller, input handling

**Joystick**:
The single on-screen control that moves the viewpoint through a walkthrough: pushing it forward or back walks, and pushing it sideways turns on the spot. During free look, and while the view coasts after it, pushing it sideways sidesteps instead; as the view slows to rest, it eases back to turning.
_Avoid_: Gamepad, controller, D-pad, thumbstick

**Running**:
Moving the viewpoint forward faster than walking pace. On the joystick the viewer starts it by pushing forward, back towards the middle and forward again, each quickly, and it lasts until they slow to walking pace; on a keyboard, they hold Shift.
_Avoid_: Sprint, dash, boost, fast travel

**Free look**:
Turning the view, including up and down, by dragging one or two fingers anywhere outside the joystick. A drag let go of while moving ends in coasting.
_Avoid_: Camera control, orbit, mouse look

**Coasting**:
The view carrying on turning after a free-look drag is let go, slowing to a stop unless the viewer catches it by touching the view.
_Avoid_: Inertia, momentum, fling, kinetic scrolling

**Zoom**:
Narrowing the view to bring distant detail closer, without the viewpoint moving. The viewer pinches or scrolls towards a spot, which stays under their fingers or pointer. It stays while they stand still or hold the view, and wears off as they walk, like the view levelling out.
_Avoid_: Field of view, FOV, dolly, magnify

**Scatter**:
Many copies of one thing, such as a grass tuft, a pebble, a fallen leaf or a tree in a wooded patch, spread over a surface by the author.
_Avoid_: Instancing, foliage, particles, scattered texture

**Prop**:
A thing prepared once as its own small file and placed by hand wherever the author marks it in an environment, such as a chair, a table, a potted plant or a single tree. Each copy is one horizontal line in the model: from where it stands, the way its front faces, as long as its size, 1 m for its own. One prop can be placed many times; most stand still, and the parts of some, in a material named `sway-…` such as a tree's leaves, sway.
_Avoid_: Asset, object, block, instance

**Test environment**:
The one environment where every part of the walkthrough is tried before the real building is modelled: the pavilion, an ordinary piece of architecture to walk through, with areas around it for things such as water, materials, an elevator and grass.
_Avoid_: Material test environment, sandbox, demo scene

**Stress copy**:
The finished test environment with its pavilion copied side by side in Rhino until there are four, baked and walked once on an old phone to show that the walkthrough holds at the size of the real building. It is never published, and thrown away afterwards.
_Avoid_: Stress test, benchmark scene, load test

### Loading

**Download budget**:
How long a viewer may wait on a slow connection before they can move, which limits the size of the opening download.
_Avoid_: Payload limit, size limit, performance budget

**Opening download**:
Everything that must arrive before the viewer can move: the environment with its still props, moving parts and collision mesh, its baked light and a small sky picture. The loading bar measures it alone.
_Avoid_: Preload, first load, initial payload

**Trailing download**:
Everything that arrives after the viewer can move, each part fading in where it belongs as it arrives: ambient occlusion, reflections of the sky, scatter, swaying things, a sharper sky picture, birds and sound. A part that fails is tried again until it arrives, unless the site does not have it at all: that part is left out and the rest still arrive.
_Avoid_: Late arrival, lazy loading, streaming, deferred assets

### Movement

**Moving part**:
A piece of the architecture that moves between set positions, such as a door, a window, a shutter, or an elevator and its doors.
_Avoid_: Dynamic object, animated object, actor

**Window**:
A moving part that opens and closes an opening in a wall. The see-through surface in it is glass.
_Avoid_: Using "window" for the material

**Sway**:
The movement in place of soft things in the wind, such as grass, bushes, trees, curtains and flags, which never leave their spot.
_Avoid_: Wind animation, vertex animation, foliage motion

**Traffic**:
Things that travel through an environment along fixed routes to make it busy, such as birds, metro wagons and cars. Viewers never steer them.
_Avoid_: NPCs, vehicles, agents, crowd

### Materials

**Glass**:
A surface of an environment that the viewer sees through, which dims and tints what lies beyond it by its own colour and reflects the sky.
_Avoid_: Window, transparent material, transmission, see-through surface

**Water**:
A still surface of an environment, such as a pool, that tints what lies below it and reflects the sky through small moving waves.
_Avoid_: Glass, liquid, fluid, ocean

### Sound

**Ambient sound**:
The one continuous sound an author chooses for an environment, which the viewer hears everywhere in it.
_Avoid_: Background sound, ambience, soundscape, atmosphere

**Placed sound**:
A continuous sound an author attaches to a spot in an environment, such as a fountain or a humming machine, which grows fainter as the viewpoint moves away.
_Avoid_: Audio source, emitter, 3D sound, positional audio

**Footsteps**:
The sound of the viewer walking, heard only while the viewpoint travels on foot.
_Avoid_: Step sounds, walking sound, foley
