# Three.js static page instead of a Godot web export

Walkthroughs must open seamlessly from a link on a general audience's phones, including old ones, so download size and startup time matter more than authoring comfort. We build the app as a static web page on Three.js rather than exporting from Godot, because a Godot web export ships the whole engine to the browser: a far larger download, slower startup on old phones, and a weaker track record on iPhones. Environments are prepared in Rhino and imported as GLB, so Godot's scene editor is not needed for authoring.

## Consequences

Godot stays an option to revisit only if a later need (for example fine-tuning environments in an editor) outweighs the load cost on old phones.
