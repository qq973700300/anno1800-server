const BASE = 'http://127.0.0.1:8080';
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(j.message); return j.data;
};
const p = await api('/api/players/register', 'POST', { name: '大岛检查' + Date.now() });
let bad = 0;
for (let t = 1; t <= 4; t++) {
  const i = await api('/api/islands', 'POST', { playerId: p.id, name: '大岛' + t });
  const G = Math.sqrt(i.terrain.length) | 0;
  const land = (i.terrain.match(/[.^ic]/g) || []).length;
  const peaks = (i.terrain.match(/\^/g) || []).length;
  const iron = (i.terrain.match(/i/g) || []).length, clay = (i.terrain.match(/c/g) || []).length;
  let edge = 0;
  for (let k = 0; k < G; k++) {
    if (i.terrain[k] !== '~') edge++;
    if (i.terrain[(G - 1) * G + k] !== '~') edge++;
    if (i.terrain[k * G] !== '~') edge++;
    if (i.terrain[k * G + G - 1] !== '~') edge++;
  }
  console.log(`island ${i.id}: ${G}x${G} 陆地=${land}(${(land / (G * G) * 100).toFixed(0)}%) 山=${peaks} 铁=${iron} 黏土=${clay} 边界陆地=${edge} plotLimit=${i.plotLimit}`);
  if (edge > 0) bad++;
}
console.log(bad === 0 ? 'ALL_CLEAN' : 'EDGE_LAND_FOUND');
