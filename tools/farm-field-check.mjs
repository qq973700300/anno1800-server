// 纪元式拉田验证（2026-09-26）：田是农场建筑的，作物由农场类型绑定，田格离农场 ≤3 格。
// 布局（平岛 flat:true，坐标写死）：
//   路 (10..12, 10) → 马铃薯农场 (10,7) 3×3（底边贴路）→ 伐木场 (13,8)（当"非农场建筑"用）
// 断言：
//   ① 无 buildingId 播种 → 400「请先建一座农场」
//   ② buildingId 不存在 → 400「农场建筑不存在」
//   ③ buildingId 是非农场建筑 → 400「不是能拉田的农场」
//   ④ 农场绑定的作物之外 → 400「只能种土豆」
//   ⑤ 距离 4 格 → 400「太远」；距离 3 格（临界）→ 200
//   ⑥ plant-batch 撞超范围格 → 部分成功 + stop「太远」
//   ⑦ 拉田成功后 plots 接口带回 buildingId（归属落库）
//   ⑧ plant-batch 无 buildingId → 整批 400（农场校验在循环外，不走部分成功）
const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();

const api = async (path, method, body) => {
  const r = await fetch(BASE + path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const msg = (res) => res.json?.message || res.json?.error || JSON.stringify(res.json);

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  cond ? pass++ : fail++;
};

/* ---- 造景 ---- */
const p = await api('/api/players/register', 'POST', { name: '拉田验证' + stamp });
const player = p.json?.data;
const isl = await api('/api/islands', 'POST', { playerId: player.id, name: '拉田岛', flat: true });
const isle = isl.json?.data;
for (const x of [10, 11, 12]) {
  const r = await api('/api/roads', 'POST', { playerId: player.id, islandId: isle.id, x, z: 10 });
  ok(r.status === 200, `铺路 (${x},10)`);
}
const rFarm = await api('/api/buildings', 'POST',
  { playerId: player.id, islandId: isle.id, type: 'POTATO_FARM', x: 10, z: 7 });
const farm = rFarm.json?.data;
ok(rFarm.status === 200 && farm?.id, '建马铃薯农场 @ (10,7)', `id=${farm?.id}`);
const rLumb = await api('/api/buildings', 'POST',
  { playerId: player.id, islandId: isle.id, type: 'LUMBERJACK', x: 13, z: 8 });
const lumberjack = rLumb.json?.data;
ok(rLumb.status === 200 && !!lumberjack?.id, '建伐木场 @ (13,8)（非农场对照）');
const plant = (body) => api('/api/farm/plant', 'POST', { playerId: player.id, islandId: isle.id, ...body });

/* ---- ① 无 buildingId → 400 ---- */
let r = await plant({ x: 10, z: 11, crop: 'POTATO' });
ok(r.status === 400 && msg(r).includes('请先建一座农场'), '① 无 buildingId 被拒', `msg=${msg(r)}`);

/* ---- ② buildingId 不存在 → 400 ---- */
r = await plant({ x: 10, z: 11, crop: 'POTATO', buildingId: 999999 });
ok(r.status === 400 && msg(r).includes('农场建筑不存在'), '② buildingId 不存在被拒', `msg=${msg(r)}`);

/* ---- ③ 非农场建筑 → 400 ---- */
r = await plant({ x: 10, z: 11, crop: 'POTATO', buildingId: lumberjack.id });
ok(r.status === 400 && msg(r).includes('不是能拉田的农场'), '③ 非农场建筑被拒', `msg=${msg(r)}`);

/* ---- ④ 作物绑定错误 → 400 ---- */
r = await plant({ x: 10, z: 11, crop: 'GRAIN', buildingId: farm.id });
ok(r.status === 400 && msg(r).includes('只能种土豆'), '④ 马铃薯农场拉小麦被拒', `msg=${msg(r)}`);

/* ---- ⑤ 距离：4 格拒、3 格（临界）过 ---- */
r = await plant({ x: 10, z: 13, crop: 'POTATO', buildingId: farm.id });
ok(r.status === 400 && msg(r).includes('太远'), '⑤a 距农场 4 格被拒', `msg=${msg(r)}`);
r = await plant({ x: 10, z: 12, crop: 'POTATO', buildingId: farm.id });
ok(r.status === 200 && r.json?.data?.buildingId === farm.id,
  '⑤b 距农场 3 格（临界）成功且归属落库', `buildingId=${r.json?.data?.buildingId}`);

/* ---- ⑥ batch 撞超范围格：部分成功 + stop ---- */
const batch = (body) => api('/api/farm/plant-batch', 'POST', { playerId: player.id, islandId: isle.id, ...body });
r = await batch({ buildingId: farm.id, crop: 'POTATO',
  cells: [{ x: 11, z: 11 }, { x: 11, z: 12 }, { x: 11, z: 13 }] });
ok(r.status === 200 && r.json?.data?.count === 2 && String(r.json?.data?.stop || '').includes('太远'),
  '⑥ batch 撞 4 格截断：种 2 株后停', `count=${r.json?.data?.count} stop=${r.json?.data?.stop}`);

/* ---- ⑦ plots 接口带回 buildingId ---- */
const plots = await api(`/api/islands/${isle.id}/plots`);
const list = plots.json?.data || [];
const owned = list.filter(pt => pt.buildingId === farm.id);
ok(owned.length === 3, '⑦ plots 归属农场：3 株 buildingId=农场', `owned=${owned.length}/${list.length}`);
ok(list.every(pt => pt.buildingId != null), '⑦b 所有新田都带 buildingId（旧散田入口已关）');

/* ---- ⑧ batch 无 buildingId → 整批 400 ---- */
r = await batch({ crop: 'POTATO', cells: [{ x: 12, z: 11 }] });
ok(r.status === 400 && msg(r).includes('请先建一座农场'), '⑧ batch 无 buildingId 整批被拒', `msg=${msg(r)}`);

console.log(fail === 0 ? `\nALL_PASS (${pass})` : `\nFAILED ${fail} / ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
