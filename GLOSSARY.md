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
The light and shadow computed once in advance for an environment under its sky and stored with it, so a viewer's device only has to display it.
_Avoid_: Lightmap, global illumination, GI

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

**Viewpoint**:
The position and direction of the viewer's eyes within the space.
_Avoid_: Camera, player, character

**Joystick**:
The single on-screen control that moves the viewpoint through a walkthrough: pushing it forward or back walks, and pushing it sideways turns on the spot. During free look, pushing it sideways sidesteps instead.
_Avoid_: Gamepad, controller, D-pad, thumbstick

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
Many copies of one small thing, such as a grass tuft, a pebble or a fallen leaf, spread over a surface by the author.
_Avoid_: Instancing, foliage, particles, scattered texture

### Movement

**Moving part**:
A piece of the architecture that moves between set positions, such as a door, a window, a shutter, or an elevator and its doors.
_Avoid_: Dynamic object, animated object, prop, actor

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
