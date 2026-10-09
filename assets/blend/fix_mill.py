# MILL blade surgery: remove broken sail sticks + old axle, build 4-arm sail cross
# as a separate 'windmill' node (pivot at hub) parented to MILL, export MILL.glb.
import bpy, bmesh
from math import pi

OUT = 'D:/javaprojects/anno1800-server/src/main/resources/static/models/MILL.glb'
HUB = (0.0, -1.30, 1.53)          # blade plane center = old axle tip
Y_PLANE = HUB[1]
Y_CAN = -1.36                     # canvas plane (slightly in front of arms)

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.gltf(filepath='D:/javaprojects/anno1800-server/src/main/resources/static/models/MILL.glb')
mill = next(o for o in bpy.data.objects if o.type == 'MESH')
me = mill.data
print('imported:', mill.name, 'materials:', [m.name for m in me.materials])
mat_timber = bpy.data.materials['timber']
mat_sail = bpy.data.materials['sailcanvas']

# ---- 1) delete old sails (all sailcanvas) + old axle (all timber) from MILL mesh
bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
kill = [f for f in bm.faces
        if me.materials[f.material_index].name in ('sailcanvas', 'timber')]
print('deleting faces:', len(kill))
bmesh.ops.delete(bm, geom=kill, context='FACES')
loose_v = [v for v in bm.verts if not v.link_faces]
loose_e = [e for e in bm.edges if not e.link_faces]
bmesh.ops.delete(bm, geom=loose_v + loose_e, context='EDGES')
bm.to_mesh(me)
bm.free()
me.update()
print('MILL faces after surgery:', len(me.polygons),
      'slots kept:', [m.name for m in me.materials])

# ---- 2) build new blade assembly
parts = []
def add_box(name, mat, sx, sy, sz, loc):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    o.data.materials.append(mat)
    parts.append(o)
    return o

def add_cyl(name, mat, r, depth, loc):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=12, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = (pi / 2, 0, 0)          # axis Y (vertical in blade plane terms)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    o.data.materials.append(mat)
    parts.append(o)
    return o

hx, hy, hz = HUB
# axle: tower front (-0.57) -> hub, embedded into the wall
add_cyl('axle', mat_timber, 0.07, 0.80, (0, -0.90, hz))
# hub disc
add_cyl('hub', mat_timber, 0.15, 0.14, (hx, hy, hz))
# two full-length crossing arms (through hub)
add_box('arm_v', mat_timber, 0.09, 0.09, 1.90, (0, Y_PLANE, hz))
arm_v = add_box('arm_h', mat_timber, 1.90, 0.09, 0.09, (0, Y_PLANE, hz))
# four canvas panels, all on the same (clockwise) side of their arm
add_box('can_up', mat_sail, 0.30, 0.03, 0.78, ( 0.31, Y_CAN, hz + 0.53))
add_box('can_dn', mat_sail, 0.30, 0.03, 0.78, (-0.31, Y_CAN, hz - 0.53))
add_box('can_ri', mat_sail, 0.78, 0.03, 0.30, ( 0.53, Y_CAN, hz - 0.31))
add_box('can_le', mat_sail, 0.78, 0.03, 0.30, (-0.53, Y_CAN, hz + 0.31))

# join -> single 'windmill' object, active = arm_h (origin at hub already)
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = arm_v
bpy.ops.object.join()
wm = bpy.context.view_layer.objects.active
wm.name = 'windmill'
# force origin exactly at hub via 3D cursor
bpy.context.scene.cursor.location = HUB
bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
# parent to MILL, keep world transform (Blender 5.x: no KEEP_TRANSFORM enum)
wm.parent = mill
wm.matrix_parent_inverse = mill.matrix_world.inverted()
print('windmill origin:', tuple(round(v, 3) for v in wm.location),
      'dims:', tuple(round(v, 3) for v in wm.dimensions),
      'parent:', wm.parent.name,
      'verts:', len(wm.data.vertices),
      'mats:', [m.name for m in wm.data.materials])

# ---- 3) export MILL (+windmill child)
bpy.ops.object.select_all(action='DESELECT')
mill.select_set(True)
wm.select_set(True)
bpy.context.view_layer.objects.active = mill
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format='GLB')
print('exported ->', OUT)

# ---- 4) sanity: re-import exported file and verify node tree
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=OUT)
names = [(o.name, o.type, o.parent.name if o.parent else None) for o in bpy.data.objects]
print('reimported:', names)
wm2 = next(o for o in bpy.data.objects if o.name.startswith('windmill'))
print('windmill reimported loc:', tuple(round(v, 3) for v in wm2.location),
      'dims:', tuple(round(v, 3) for v in wm2.dimensions))
