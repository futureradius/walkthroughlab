# Run by `npm run bake` inside Blender, never by hand. Paints the light that an
# environment's sky casts on its surfaces into one picture, using the second
# set of texture coordinates that `npm run optimize` wrote.
import math
import sys

import bpy

# What `npm run optimize` notes on every collision mesh layer it finds among
# the marks; Blender keeps it as a custom property.
COLLISION_MESH = "collision mesh"
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


# Glass lets light through multiplied by its colour, once for each of its
# surfaces the light crosses, as the walkthrough shows what is behind it.
glass = 0
for material in bpy.data.materials:
    if material.surface_render_method != "BLENDED":
        continue
    tree = material.node_tree
    colour = tuple(tree.nodes["Principled BSDF"].inputs["Base Color"].default_value)
    tree.nodes.clear()
    see_through = tree.nodes.new("ShaderNodeBsdfTransparent")
    see_through.inputs["Color"].default_value = colour
    surface = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(see_through.outputs["BSDF"], surface.inputs["Surface"])
    glass += 1
print(f"bake: {glass} glass materials let tinted light through")

# Metal is baked for its light only, so the walkthrough can dim its
# reflections where little light reaches; a mirror-like surface would bake
# black, so it is baked as if rough and not metal.
metal = 0
for material in bpy.data.materials:
    if material.surface_render_method == "BLENDED" or not material.node_tree:
        continue
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled is None:
        continue
    metallic = principled.inputs["Metallic"]
    if metallic.is_linked or metallic.default_value > 0.5:
        for link in list(metallic.links):
            material.node_tree.links.remove(link)
        metallic.default_value = 0
        metal += 1
print(f"bake: {metal} metal materials baked for their light only")
# Enough for light to cross a row of panes, each a slab with two surfaces.
scene.cycles.transparent_max_bounces = 32


def under(thing, mark):
    """Whether `npm run optimize` noted this mark on the object or a layer above it."""
    while thing is not None:
        if thing.get("walkthrough") == mark:
            return True
        thing = thing.parent
    return False


def in_collision_layer(thing):
    return under(thing, COLLISION_MESH)


def casts_no_shadow(thing):
    """Whether `npm run optimize` noted this as part of a prop that casts no shadow."""
    while thing is not None:
        if thing.get("castsNoShadow"):
            return True
        thing = thing.parent
    return False


# One picture for each `lightPicture` that `npm run optimize` noted on the
# materials: it laid out each surface in the picture its material names.
pictures = {}


def picture_for(material):
    number = int(material.get("lightPicture", 0))
    if number not in pictures:
        pictures[number] = bpy.data.images.new(
            f"BakedLight{number}", int(size), int(size), alpha=False, float_buffer=True
        )
    return pictures[number]


targets = []
painted = set()
for thing in scene.objects:
    if thing.type != "MESH":
        continue
    if in_collision_layer(thing):
        # Its invisible walls must not cast shadows.
        thing.hide_render = True
        continue
    if under(thing, "probe") or casts_no_shadow(thing):
        # A light probe above a prop's crown measures the light there for its
        # leaves (#28), and must not shade anything itself; nor must a prop
        # whose config file says it casts no shadow.
        thing.visible_shadow = False
    if under(thing, "probe"):
        thing.visible_diffuse = False
        thing.visible_glossy = False
        thing.visible_transmission = False
    if under(thing, "elevator-door"):
        # An elevator's doors open whenever the viewer sees inside the car,
        # so light passes them as if open; they are still baked themselves.
        thing.visible_shadow = False
        thing.visible_diffuse = False
        thing.visible_glossy = False
        thing.visible_transmission = False
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
        target.image = picture_for(material)
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

for number, picture in sorted(pictures.items()):
    picture.filepath_raw = output.replace("{}", str(number))
    picture.file_format = "OPEN_EXR"
    picture.save()
print(f"bake: painted {len(targets)} surfaces into {len(pictures)} pictures")
