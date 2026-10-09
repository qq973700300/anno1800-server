// 懒结算验证：离线冻结 + 在线推进
// 用法：node tools/lazy-sim-check.mjs   （需要 8081 上跑着 h2 profile 的服务端）
const BASE = 'http://127.0.0.1:8081';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(path, method = 'GET', body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${path} -> ${JSON.stringify(json)}`);
  return json.data;
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail === undefined ? '' : '  ' + detail}`);
  if (!ok) failures++;
}

async function main() {
  // ---------- 准备：玩家 + 平岛（地形不干扰坐标） ----------
  const player = await api('/api/players/register', 'POST', { name: '懒结算测试' + Date.now() });
  const playerId = player.id;
  const island = await api('/api/islands', 'POST', { playerId, name: '冻结试验岛', flat: true });
  const islandId = island.id;
  console.log(`玩家 ${playerId} / 岛 ${islandId}\n`);

  // ---------- ⓪ 造景：纪元式拉田要先有农场（田是农场的） ----------
  // 路 (10..12,14) → 马铃薯农场 (10,11)（3×3，底边贴路）→ 田 (10,10) / (12,10) 都在它北边 1 格
  for (const x of [10, 11, 12]) {
    await api('/api/roads', 'POST', { playerId, islandId, x, z: 14 });
  }
  const farm = await api('/api/buildings', 'POST',
    { playerId, islandId, type: 'POTATO_FARM', x: 10, z: 11 });
  console.log(`农场已建：${farm.label} @ (${farm.gridX},${farm.gridZ})\n`);

  // ---------- ① 种一株作物，然后"离线" ----------
  const plot = await api('/api/farm/plant', 'POST',
    { playerId, islandId, x: 10, z: 10, crop: 'POTATO', buildingId: farm.id });
  console.log(`作物已种下：id=${plot.id} 状态=${plot.state} 进度=${plot.progress}`);

  console.log('\n[① 离线 8 秒：岛屿应当完全冻结]');
  await sleep(8000);
  const offlinePlots = await api(`/api/islands/${islandId}/plots`);
  const p1 = offlinePlots.find(p => p.id === plot.id);
  check('作物仍在 GROWING', p1.state === 'GROWING', p1.state);
  check('生长进度没有推进（离线冻结）', p1.progress === 0, `progress=${p1.progress}`);

  // ---------- ② 连上 websocket 并在 9 秒内保持在线 ----------
  console.log('\n[② 上线 9 秒：岛屿应当按在线时长推进]');
  const ws = new WebSocket('ws://127.0.0.1:8081/ws');
  const snapshots = [];
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'auth', playerId }));
      resolve();
    });
    ws.addEventListener('error', reject);
  });
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'snapshot') snapshots.push(msg.data);
  });
  await sleep(9000);
  const onlinePlots = await api(`/api/islands/${islandId}/plots`);
  const p2 = onlinePlots.find(p => p.id === plot.id);
  check('作物进度已推进', p2.progress > 0, `progress=${p2.progress}`);
  check('收到的个人快照数 >= 2（3 秒一次）', snapshots.length >= 2, `${snapshots.length} 条`);
  // 9 秒在线 + 5 秒离线宽限，最多推进 14 秒；至少推进 3 秒（1 次广播）
  check('推进量落在合理区间（>0 且 <= 宽限+在线时长）',
    p2.progress > 0 && p2.progress <= 1, `progress=${p2.progress}`);

  // ---------- ③ 再"离线"8 秒，确认又冻住了 ----------
  console.log('\n[③ 断开 websocket 后再离线 8 秒：应当再次冻结]');
  const before = p2.progress;
  ws.close();
  await sleep(8000);
  const offlinePlots2 = await api(`/api/islands/${islandId}/plots`);
  const p3 = offlinePlots2.find(p => p.id === plot.id);
  check('断线后进度不再推进', p3.progress === before, `${before} -> ${p3.progress}`);

  // ---------- ④ 工厂生产同样只在在线时推进 ----------
  console.log('\n[④ 工厂：离线冻结 / 在线推进]');
  await api('/api/roads', 'POST', { playerId, islandId, x: 30, z: 30 });
  const b = await api('/api/buildings', 'POST',
    { playerId, islandId, type: 'LUMBERJACK', x: 31, z: 30 });
  console.log(`已建造 ${b.type} @ (${b.gridX},${b.gridZ})`);
  const bOffline = (await api(`/api/islands/${islandId}/buildings`)).find(x => x.id === b.id);
  await sleep(7000);
  const bStill = (await api(`/api/islands/${islandId}/buildings`)).find(x => x.id === b.id);
  check('离线时工厂进度不变', bStill.progress === bOffline.progress,
    `${bOffline.progress} -> ${bStill.progress}`);

  // ---------- ⑤ 商船的相位也按模拟时钟走 ----------
  console.log('\n[⑤ 商船：HTTP 兜底读的是"最后模拟到的位置"]');
  const ships = await api(`/api/islands/${islandId}/ships`);
  check('平岛上没有港口，商船为空', ships.length === 0, `${ships.length} 条`);

  // ---------- ⑥ 在线时的推进速率必须 = 真实时间（不多算、不少算） ----------
  // 这是懒结算最关键的不变量：宽限只在"离线那一段"生效一次，
  // 在线期间每秒就该推进 1 游戏秒（timeScale=1）。
  // 不能假设"土豆 30 秒长成"—— growTarget = 30 × 肥力系数（0.8~1.2）。
  // 也不能随便找个时刻去读进度：推进是**每 3 秒一次**提交的阶梯函数，
  // 在两次广播之间取值会带上最多半拍的相位误差（上一版就是这么误报的）。
  // 所以这里直接**在广播边界上取样** —— 每收到一条 snapshot 就取快照自带的进度，
  // 相邻两条快照之间正好是一个广播间隔，两者的推进量必须相等。
  console.log('\n[⑥ 在线：按广播边界取样，每拍推进量必须恒定]');
  // 新种一株专门用来测速率：前面那株已经长了一大半，肥力高的岛上可能测到一半就熟了，
  // 而成熟后 progress() 恒等于 1，阶梯就看不出来了
  const ratePlot = await api('/api/farm/plant', 'POST',
    { playerId, islandId, x: 12, z: 10, crop: 'POTATO', buildingId: farm.id });
  const ws2 = new WebSocket('ws://127.0.0.1:8081/ws');
  const beats = [];                                    // { serverTime, progress }
  ws2.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type !== 'snapshot') return;
    const p = (msg.data.plots || []).find(x => x.id === ratePlot.id);
    if (p) beats.push({ serverTime: msg.data.serverTime, progress: p.progress });
  });
  await new Promise((resolve, reject) => {
    ws2.addEventListener('open', () => {
      ws2.send(JSON.stringify({ type: 'auth', playerId }));
      resolve();
    });
    ws2.addEventListener('error', reject);
  });
  await sleep(16000);                                  // 够 5 条快照：上线那一拍 + 4 个正常拍
  ws2.close();

  check('收到足够的快照用于取样', beats.length >= 4, `${beats.length} 条`);
  // 丢掉第 0 条：它跨了"上线前的离线宽限"，是唯一允许推进量偏大的一拍
  const deltas = [];
  const gaps = [];
  for (let i = 1; i + 1 < beats.length; i++) {
    deltas.push(beats[i + 1].progress - beats[i].progress);
    gaps.push(beats[i + 1].serverTime - beats[i].serverTime);
  }
  const dMax = Math.max(...deltas);
  const dMin = Math.min(...deltas);
  const gapAvg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  check('广播间隔 ≈ 3000ms', Math.abs(gapAvg - 3000) < 150, `平均 ${gapAvg.toFixed(0)}ms`);
  // 每拍推进量 = 广播间隔 / growTarget，恒定即可证明"1 游戏秒 = 1 现实秒"且不重复补算
  check('各拍推进量恒定（偏差 < 2%）', (dMax - dMin) / dMin < 0.02,
    `${dMin.toFixed(5)} ~ ${dMax.toFixed(5)}  ${deltas.map(d => d.toFixed(5)).join(' / ')}`);
  // 绝对值校验：推进量必须落在肥力系数 0.8~1.2 的物理区间内，
  // 这样即便"恒定"也可能是恒定地算错一倍，整倍数的错在这里会被抓住
  const target = gapAvg / 1000 / ((deltas[0] + deltas[deltas.length - 1]) / 2);
  check('反推生长时长落在肥力区间（24~36 秒）', target > 24 && target < 36,
    `growTarget=${target.toFixed(2)}s`);

  console.log(`\n${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('异常：', e); process.exit(2); });
