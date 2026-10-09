// 羊毛牧场制验证（2026-09-27）：羊毛不拉田（纪元1800式），羊场=牧场地坪配方无输入直接产毛。
// 布局（平岛 flat:true，坐标写死）：
//   路 (10..19, 10) → 羊场 (10,7) 3×3 → 马铃薯农场 (16,7) 3×3 → 农夫住宅 (14,8) 2×2
// 断言：
//   ① 羊场拉羊毛田 → 400「羊场不是能拉田的农场」
//   ② 马铃薯农场拉羊毛田 → 400「只能种土豆」
//   ③ 马铃薯农场拉土豆田 → 200，plots 带回 buildingId（拉田链路不受影响）
//   ④ 羊场在生产（无输入直接产毛）：progress>0 或 pendingQty≥1，且不缺工人
//   ⑤ island 视图已无 crops 字段（岛屿适种机制删除干净）
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

/* 懒结算只 tick 在线玩家：必须挂 WS auth，否则岛的 tick 不跑，羊场永远 progress=0 */
const WS = BASE.replace(/^http/, 'ws') + '/ws';
async function attachWs(playerId) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS);
    const timer = setTimeout(() => resolve(false), 5000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', playerId }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'authed') { clearTimeout(timer); resolve(true); }
    };
    ws.onerror = () => { clearTimeout(timer); resolve(false); };
  });
}

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  cond ? pass++ : fail++;
};

/* ---- 造景 ---- */
const p = await api('/api/players/register', 'POST', { name: '羊场验证' + stamp });
const player = p.json?.data;
ok(!!player?.id, '注册玩家');
ok(await attachWs(player.id), '挂 WS auth（懒结算需要在线玩家）');
const isl = await api('/api/islands', 'POST', { playerId: player.id, name: '羊场岛', flat: true });
const isle = isl.json?.data;
ok(!!isle?.id, '建平岛');

for (const x of [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]) {
  const r = await api('/api/roads', 'POST', { playerId: player.id, islandId: isle.id, x, z: 10 });
  ok(r.status === 200, `铺路 (${x},10)`);
}
const rSheep = await api('/api/buildings', 'POST',
  { playerId: player.id, islandId: isle.id, type: 'SHEEP_FARM', x: 10, z: 7 });
const sheep = rSheep.json?.data;
ok(rSheep.status === 200 && !!sheep?.id, '建羊场 @ (10,7)', `id=${sheep?.id}`);
const rPotato = await api('/api/buildings', 'POST',
  { playerId: player.id, islandId: isle.id, type: 'POTATO_FARM', x: 16, z: 7 });
const potato = rPotato.json?.data;
ok(rPotato.status === 200 && !!potato?.id, '建马铃薯农场 @ (16,7)', `id=${potato?.id}`);
const rPost = await api('/api/buildings', 'POST',
  { playerId: player.id, islandId: isle.id, type: 'TRADING_POST', x: 0, z: 11 });
ok(rPost.status === 200 && !!rPost.json?.data?.id, '建贸易站 @ (0,11)（住宅前置）');
const rHouse = await api('/api/buildings', 'POST',
  { playerId: player.id, islandId: isle.id, type: 'FARMER_HOUSE', x: 14, z: 8 });
ok(rHouse.status === 200 && !!rHouse.json?.data?.id, '建农夫住宅 @ (14,8)（送初始移民供劳动力）');

const plant = (body) => api('/api/farm/plant', 'POST', { playerId: player.id, islandId: isle.id, ...body });

/* ---- ① 羊场拉羊毛田 → 400 ---- */
let r = await plant({ x: 10, z: 11, crop: 'WOOL', buildingId: sheep.id });
ok(r.status === 400 && msg(r).includes('不是能拉田的农场'), '① 羊场拉田被拒（牧场制）', `msg=${msg(r)}`);

/* ---- ② 马铃薯农场拉羊毛田 → 400 ---- */
r = await plant({ x: 16, z: 11, crop: 'WOOL', buildingId: potato.id });
ok(r.status === 400 && msg(r).includes('只能种土豆'), '② 羊毛不是可拉田作物', `msg=${msg(r)}`);

/* ---- ③ 马铃薯农场拉土豆田 → 200 ---- */
r = await plant({ x: 16, z: 11, crop: 'POTATO', buildingId: potato.id });
ok(r.status === 200, '③ 土豆农场拉田正常', `msg=${msg(r)}`);
r = await api(`/api/islands/${isle.id}/plots`);
const plots = r.json?.data || [];
ok(plots.some(pl => pl.buildingId === potato.id), '③b 田归属农场落库', `plots=${plots.length}`);

/* ---- ⑤ island 视图无 crops 字段 ---- */
r = await api(`/api/islands/${isle.id}`);
const islView = r.json?.data || {};
ok(!('crops' in islView), '⑤ island 视图已无 crops 字段');

/* ---- ④ 羊场在生产（轮询 90s 提前退）---- */
console.log('…… 等羊场开工产毛（最多 90s）');
let running = false, detail = '';
const dl = Date.now() + 90000;
while (Date.now() < dl) {
  const br = await api(`/api/islands/${isle.id}/buildings`);
  const v = (br.json?.data || []).find(b => b.id === sheep.id);
  if (v) {
    detail = `noWorkers=${v.noWorkers} progress=${(v.progress ?? 0).toFixed(2)} pending=${v.pendingQty ?? 0}`;
    if (!v.noWorkers && ((v.progress ?? 0) > 0 || (v.pendingQty ?? 0) > 0)) { running = true; break; }
  }
  await new Promise(res => setTimeout(res, 3000));
}
ok(running, '④ 羊场无输入直接产毛（生产运行中）', detail);

console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
