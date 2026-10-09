# rebuild asset-library.blend from the shipped GLBs (single source of truth)
# old disk blend was a stale mid-surgery snapshot (node_0.00x meshes + display Empties)
import bpy, os, glob

MODELS_DIR = 'D:/javaprojects/anno1800-server/src/main/resources/static/models'
OUT = 'D:/javaprojects/anno1800-server/assets/blend/asset-library.blend'

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for c in list(bpy.data.collections):
    bpy.data.collections.remove(c)

glbs = sorted(glob.glob(os.path.join(MODELS_DIR, '*.glb')))
print('found', len(glbs), 'glbs')

game_models = bpy.data.collections.new('GAME_MODELS')
bpy.context.scene.collection.children.link(game_models)

x = 0.0
for path in glbs:
    base = os.path.splitext(os.path.basename(path))[0]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None or o.parent not in new]
    print(f'{base}: {len(new)} objs, roots={[r.name for r in roots]}')
    if len(roots) == 1:
        root = roots[0]
        root.name = base
    else:
        root = bpy.data.objects.new(base, None)          # multi-root: wrap in an empty
        bpy.context.scene.collection.objects.link(root)
        for r in roots:
            r.parent = root
            r.matrix_parent_inverse = root.matrix_world.inverted()
    root.location = (x, 14.0, 0.0)
    for c in list(root.users_collection):
        c.objects.unlink(root)
    game_models.objects.link(root)
    x += 6.0

bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('saved', OUT, 'with', len(game_models.objects), 'roots')
