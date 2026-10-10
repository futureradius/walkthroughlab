# Walkthroughlab

A lightweight, browser-based tool for experiencing architectural spaces from the inside, built as a study prototype.

## Language

**Walkthrough**:
A real-time, first-person traversal of a three-dimensional architectural space, steered by the person viewing it.
_Avoid_: Tour, flythrough, animation, render

**Environment**:
The architectural space an author prepares and a viewer sees and moves through in a walkthrough.
_Avoid_: Model, scene, level, map

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
The single on-screen control that moves the viewpoint through a walkthrough: pushing it forward or back walks, pushing it sideways turns on the spot, and it never sidesteps.
_Avoid_: Gamepad, controller, D-pad, thumbstick

**Free look**:
Turning the view, including up and down, by dragging a second finger anywhere outside the joystick. Not part of the first prototype.
_Avoid_: Camera control, orbit, mouse look
