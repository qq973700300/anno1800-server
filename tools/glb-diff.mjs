// parse GLB: node tree, transforms, mesh accessor bounds (glTF Y-up space)
// usage: node tools/glb-diff.mjs <path1> [path2]
import { readFileSync } from 'fs';
const files = process.argv.slice(2);
if (!files.length) files.push('D:/javaprojects/anno1800-server/src/main/resources/static/models/MILL.glb');
for (const f of files) {
  const buf = readFileSync(f);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  console.log('=== ' + f.split('/').pop() + ' (' + buf.length + 'B) ===');
  console.log('nodes:', JSON.stringify(json.nodes).replace(/\s+/g, ' '));
  console.log('scene roots:', JSON.stringify(json.scenes[json.scene ?? 0].nodes));
  for (const [i, m] of (json.meshes ?? []).entries()) {
    for (const p of m.primitives) {
      const acc = json.accessors[p.attributes.POSITION];
      console.log(`mesh[${i}] ${m.name} POS min=[${acc.min.map(v => v.toFixed(2))}] max=[${acc.max.map(v => v.toFixed(2))}] count=${acc.count}`);
    }
  }
}
