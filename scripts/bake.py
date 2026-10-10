# Run by `npm run bake` inside Blender, never by hand. Paints the light that an
# environment's sky casts on its surfaces into one picture, using the second
# set of texture coordinates that `npm run optimize` wrote.
import math
import sys

import bpy

COLLISION_LAYER = "Collision Mesh"
# Pixels the light is spread past each surface's edge, so no dark seams show.
MARGIN = 8

model, sky, output, size, samples, strength = sys.argv[sys.argv.index("--") + 1 :]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=model)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = int(samples)
scene.cycles.use_denoising = True

# Use the graphics card when Cycles can; otherwise it falls back to the processor.
preferences = bpy.context.preferences.addons["cycles"].preferences
for kind in ("OPTIX", "CUDA"):
    try:
        preferences.compute_device_type = kind
        preferences.get_devices()
        usable = [device for device in preferences.devices if device.type == kind]
        if usable:
            for device in preferences.devices:
                device.use = device.type == kind
            scene.cycles.device = "GPU"
            break
    except TypeError:
        continue
print(f"bake: rendering on {scene.cycles.device}")

# The sky as the only light. three.js and Blender unroll a panorama half a
# turn apart, hence the rotation.
world = bpy.data.worlds.new("Sky")
world.use_nodes = True
scene.world = world
nodes, links = world.node_tree.nodes, world.node_tree.links
nodes.clear()
coordinates = nodes.new("ShaderNodeTexCoord")
mapping = nodes.new("ShaderNodeMapping")
mapping.inputs["Rotation"].default_value[2] = math.pi
panorama = nodes.new("ShaderNodeTexEnvironment")
panorama.image = bpy.data.images.load(sky)
background = nodes.new("ShaderNodeBackground")
background.inputs["Strength"].default_value = float(strength)
world_output = nodes.new("ShaderNodeOutputWorld")
links.new(coordinates.outputs["Generated"], mapping.inputs["Vector"])
links.new(mapping.outputs["Vector"], panorama.inputs["Vector"])
links.new(panorama.outputs["Color"], background.inputs["Color"])
links.new(background.outputs["Background"], world_output.inputs["Surface"])


def in_collision_layer(thing):
    while thing is not None:
        if thing.name.startswith(COLLISION_LAYER):
            return True
        thing = thing.parent
    return False


picture = bpy.data.images.new(
    "BakedLight", int(size), int(size), alpha=False, float_buffer=True
)
targets = []
painted = set()
for thing in scene.objects:
    if thing.type != "MESH":
        continue
    if in_collision_layer(thing):
        # Its invisible walls must not cast shadows.
        thing.hide_render = True
        continue
    if len(thing.data.uv_layers) < 2:
        continue
    # Paint into the second set of coordinates; textures keep using the first.
    thing.data.uv_layers.active = thing.data.uv_layers[1]
    for slot in thing.material_slots:
        material = slot.material
        if material.name in painted:
            continue
        painted.add(material.name)
        target = material.node_tree.nodes.new("ShaderNodeTexImage")
        target.image = picture
        material.node_tree.nodes.active = target
    targets.append(thing)

if not targets:
    sys.exit("bake: no surfaces with a second set of texture coordinates")

bpy.ops.object.select_all(action="DESELECT")
for thing in targets:
    thing.select_set(True)
bpy.context.view_layer.objects.active = targets[0]

# Light arriving at each surface, direct and bounced, without the surface's
# own colour: the walkthrough multiplies that back in.
bpy.ops.object.bake(
    type="DIFFUSE",
    pass_filter={"DIRECT", "INDIRECT"},
    margin=MARGIN,
    use_clear=True,
)

picture.filepath_raw = output
picture.file_format = "OPEN_EXR"
picture.save()
print(f"bake: painted {len(targets)} surfaces into {output}")
