# import MILL.glb into an empty scene and inspect materials/clusters
import bpy, bmesh

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.import_scene.gltf(filepath='D:/javaprojects/anno1800-server/src/main/resources/static/models/MILL.glb')

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('imported objects:', [(o.name, o.type, o.parent.name if o.parent else None,
                             tuple(round(v, 3) for v in o.location),
                             tuple(round(v, 3) for v in o.dimensions)) for o in bpy.data.objects])
assert len(meshes) == 1, 'expect single mesh'
mill = meshes[0]
me = mill.data
print('mesh materials:', [m.name if m else 'None' for m in me.materials])

bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()

per = {}
for f in bm.faces:
    mname = me.materials[f.material_index].name if f.material_index < len(me.materials) else '?'
    d = per.setdefault(mname, {'n': 0, 'min': [1e9]*3, 'max': [-1e9]*3})
    d['n'] += 1
    for v in f.verts:
        for i, c in enumerate((v.co.x, v.co.y, v.co.z)):
            d['min'][i] = min(d['min'][i], c)
            d['max'][i] = max(d['max'][i], c)
for k, d in sorted(per.items()):
    mn = tuple(round(x, 2) for x in d['min'])
    mx = tuple(round(x, 2) for x in d['max'])
    print(f'MAT {k:12s} faces={d["n"]:4d} min={mn} max={mx}')

def clusters(matname):
    faces = [f for f in bm.faces
             if f.material_index < len(me.materials) and me.materials[f.material_index].name == matname]
    seen, out = set(), []
    for f0 in faces:
        if f0 in seen:
            continue
        stack, comp = [f0], []
        seen.add(f0)
        while stack:
            f = stack.pop()
            comp.append(f)
            for e in f.edges:
                for nf in e.link_faces:
                    if nf in faces and nf not in seen:
                        seen.add(nf)
                        stack.append(nf)
        mn = [1e9]*3; mx = [-1e9]*3
        for f in comp:
            for v in f.verts:
                for i, c in enumerate((v.co.x, v.co.y, v.co.z)):
                    mn[i] = min(mn[i], c); mx[i] = max(mx[i], c)
        out.append((len(comp), tuple(round(x, 2) for x in mn), tuple(round(x, 2) for x in mx)))
    return out

for m in sorted(per):
    cl = clusters(m)
    if len(cl) > 1 or m in ('sailcanvas', 'timber'):
        print(f'--- clusters of {m}:')
        for n, mn, mx in sorted(cl, reverse=True):
            print(f'   faces={n:4d} min={mn} max={mx}')

# world-space check: object transform
print('mill matrix_world translation:', tuple(round(v, 3) for v in mill.matrix_world.translation))
print('mill scale:', tuple(round(v, 3) for v in mill.scale), 'rotation:', tuple(round(v, 3) for v in mill.rotation_euler))
bm.free()
