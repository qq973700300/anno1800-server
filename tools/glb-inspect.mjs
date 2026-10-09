// parse GLB: node tree, transforms, mesh accessor bounds (glTF Y-up space)
import { readFileSync } from 'fs';
const buf = readFileSync('D:/javaprojects/anno1800-server/src/main/resources/static/models/MILL.glb');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
console.log('nodes:', JSON.stringify(json.nodes, null, 1).replace(/\s+/g, ' '));
console.log('scenes:', JSON.stringify(json.scenes));
console.log('materials:', json.materials.map(m => m.name).join(','));
console.log('meshes:', json.meshes.map(m => `${m.name}(${m.primitives.length}prim)`).join(','));
for (const [i, m] of json.meshes.entries()) {
  for (const p of m.primitives) {
    const acc = json.accessors[p.attributes.POSITION];
    console.log(`mesh[${i}] ${m.name} POS min=[${acc.min.map(v => v.toFixed(2))}] max=[${acc.max.map(v => v.toFixed(2))}] count=${acc.count}`);
  }
}
