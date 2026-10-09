// 端到端验证：**纪元1800 全量建筑表 + 分类建造菜单**（2026-09-25 大扩表）
// 只做数据断言（画面验收交给用户截图，按项目约定不自己截图）。
//   1) 图鉴规模与分组（11 个分页都有建筑）
//   2) 每个 form 都在客户端 proc-buildings.js 的形制表里（不然客户端会退回"盒子加屋顶"）
//   3) 七层居民 / 全量商品
//   4) 真建一座农夫建筑（先铺路）
//   5) 未解锁的建筑被拒（工人业态要农夫住够 120）
//   6) 新地形约束：煤矿要山地、沙矿要海岸
//   7) 骑岸线：码头在平岛贴边能建
//   8) 高阶住宅（工匠住宅）在人口不够时被拒
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:8080';
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  cond ? pass++ : fail++;
};
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const msg = r => String(r.json?.message || r.json?.error || '');

/* ---------- 1. 图鉴 ---------- */
const cat = await api('/api/buildings/catalog');
const list = cat.json?.data || [];
ok(cat.status === 200 && list.length >= 110, '图鉴建筑数量 ≥ 110', `实际 ${list.length} 座`);
ok(list.every(b => b.label && b.cost > 0 && b.sizeW > 0 && b.sizeH > 0), '每座建筑都有名字 / 造价 / 占地');
ok(list.every(b => b.group && b.groupLabel && b.icon), '每座建筑都有分组与图标');
ok(list.every(b => b.form && b.tint != null), '每座建筑都有外观形制与主色');

const groups = {};
for (const b of list) groups[b.group] = (groups[b.group] || 0) + 1;
const want = ['INFRA', 'FARMERS', 'WORKERS', 'ARTISANS', 'ENGINEERS', 'INVESTORS',
              'SCHOLARS', 'TOURISTS', 'PUBLIC', 'HARBOR', 'MILITARY'];
ok(want.every(g => groups[g] > 0), '11 个建造分页都有建筑',
   want.map(g => `${g}:${groups[g] || 0}`).join(' '));

/* 客户端形制表必须覆盖服务端下发的所有 form（否则程序化外观会退回默认盒子） */
const src = fs.readFileSync('src/main/resources/static/jsm/proc-buildings.js', 'utf8');
const forms = new Set([...src.matchAll(/^  ([A-Z_]+)\(g, p, ctx\)/gm)].map(m => m[1]));
const used = [...new Set(list.map(b => b.form))];
const missing = used.filter(f => !forms.has(f));
ok(missing.length === 0, `客户端形制表覆盖全部 ${used.length} 种 form`, missing.length ? '缺：' + missing.join(',') : '');

/* 用途五分 */
const kinds = {};
for (const b of list) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
ok(kinds.PRODUCTION > 50 && kinds.RESIDENCE === 7 && kinds.HARBOR > 5 && kinds.PUBLIC > 10 && kinds.MILITARY > 5,
   '用途分布合理（厂房 / 七种住宅 / 港口 / 公共 / 军事）',
   Object.entries(kinds).map(([k, v]) => `${k}:${v}`).join(' '));

/* ---------- 2. 商品与阶层 ---------- */
const goods = await api('/api/world/goods');
ok((goods.json?.data || []).length >= 70, '商品 ≥ 70 种', `实际 ${(goods.json?.data || []).length}`);

/* ---------- 3. 开一座平岛（坐标可预测）+ 建东西 ---------- */
const stamp = Date.now();
const reg = await api('/api/players/register', 'POST', { name: '全表验证' + stamp });
const me = reg.json?.data;
ok(!!me?.id, '注册测试玩家', `id=${me?.id}`);
const isl = await api('/api/islands', 'POST', { playerId: me.id, name: '全表验证岛', flat: true });
const isle = isl.json?.data;
const G = isle.gridSize;
ok(!!isle?.id, '开平岛', `grid=${G}`);

/* 铺一格路（建筑需要临路） */
const road = await api('/api/roads', 'POST', { playerId: me.id, islandId: isle.id, x: 20, z: 20 });
ok(road.status === 200, '铺一段马路');

const build = (type, x, z) => api('/api/buildings', 'POST',
  { playerId: me.id, islandId: isle.id, type, x, z });

/* 4. 农夫业态：伐木场（无门槛） */
const lum = await build('LUMBERJACK', 21, 20);
ok(lum.status === 200, '建一座伐木场（农夫业态，无门槛）', msg(lum));

/* 5. 工人业态：粮食农场要"农夫住够 120" */
const grain = await build('GRAIN_FARM', 24, 20);
ok(grain.status === 400 && msg(grain).includes('先住够'),
   '工人业态被人口门槛挡住', msg(grain) || `status=${grain.status}`);

/* 6. 地形约束：渔场（农夫业态、无门槛）在平岛内陆没有海岸带 → 必被拒，
      这样才真正走到了服务端那条"必须压到海岸沙滩"的校验分支。 */
const fish = await build('FISHERY', 40, 40);
ok(fish.status === 400 && msg(fish).includes('海岸'), '渔场必须建在海岸沙滩上', msg(fish) || `status=${fish.status}`);
/* 依山而建：煤矿 / 石灰石采石场在图鉴里标了 MOUNTAIN（服务端同一段代码校验，
   它们属于工匠 / 工程师业态，这里先被人口门槛挡住，所以只断言元数据与"必被拒"） */
const coal = await build('COAL_MINE', 30, 30);
ok(coal.status === 400, '煤矿在平岛上建不了', msg(coal));
const byKeyNow = Object.fromEntries(list.map(b => [b.type, b]));
ok(byKeyNow.COAL_MINE.terrain === 'MOUNTAIN' && byKeyNow.LIMESTONE_QUARRY.terrain === 'MOUNTAIN'
   && byKeyNow.FISHERY.terrain === 'COAST' && byKeyNow.LUMBERJACK.terrain === 'ANY',
   '地形约束下发正确（依山 / 贴岸 / 不挑地）');
ok(byKeyNow.IRON_MINE.terrain === 'ORE' && byKeyNow.IRON_MINE.requiredOre === 'IRON',
   '矿脉类仍走 ORE 约束');

/* 7. 骑岸线：平岛贴边建码头（网格外当海） */
const quay = await build('QUAY', 0, 0);
ok(quay.status === 200, '码头骑岸线（平岛贴边即临海）', msg(quay) || `status=${quay.status}`);

/* 8. 高阶住宅：住宅的前置是"先有贸易站"，所以必须先建出贸易站再验人口门槛 */
const artisanNoPost = await build('ARTISAN_HOUSE', 40, 40);
ok(artisanNoPost.status === 400 && msg(artisanNoPost).includes('贸易站'),
   '没有贸易站时住宅先被前置拦下', msg(artisanNoPost));
const post = await build('TRADING_POST', 0, 4);
ok(post.status === 200, '贴边建出贸易站（骑岸线）', msg(post) || `status=${post.status}`);
const artisan = await build('ARTISAN_HOUSE', 40, 40);
ok(artisan.status === 400 && msg(artisan).includes('先住够'),
   '工匠住宅被人口门槛挡住', msg(artisan) || `status=${artisan.status}`);

/* 9. 公共设施：教堂也要"农夫住够 120" */
const church = await build('CHURCH', 44, 44);
ok(church.status === 400 && msg(church).includes('先住够'), '教堂有门槛（不是开局就能盖）', msg(church));

/* 10. 七层居民面板 */
const pop = await api(`/api/islands/${isle.id}/population`);
const tiers = pop.json?.data?.tiers || [];
ok(tiers.length === 7, '居民面板有七个阶层', tiers.map(t => t.label).join('/'));
ok(tiers.filter(t => t.unlocked).length === 1, '开局只解锁农夫一层',
   tiers.filter(t => t.unlocked).map(t => t.label).join('/') || '无');

/* 11. 图鉴里的门槛字段与 validate 一致：抽查三座（工人/工匠/投资者业态） */
const byKey = Object.fromEntries(list.map(b => [b.type, b]));
ok(byKey.GRAIN_FARM.requiredTier === 'FARMER' && byKey.GRAIN_FARM.requiredPopulation === 120,
   '工人业态门槛挂"农夫 120"');
ok(byKey.ARTISAN_HOUSE.requiredTier === 'WORKER' && byKey.ARTISAN_HOUSE.requiredPopulation === 200,
   '工匠业态门槛挂"工人 200"');
ok(byKey.PALACE.requiredTier === 'ENGINEER' && byKey.PALACE.requiredPopulation === 400,
   '皇宫门槛挂"工程师 400"');
ok(byKey.MARKETPLACE.requiredTier == null, '集市开局就能建');

/* 12. 服务字段：教堂提供信仰覆盖、小仓库提供仓储加成 */
ok(byKey.CHURCH.service === 'FAITH' && byKey.CHURCH.serviceRadius > 0, '教堂提供「信仰」服务半径覆盖');
ok(byKey.SMALL_WAREHOUSE.service === 'STOCK_BONUS' && byKey.SMALL_WAREHOUSE.serviceValue > 0,
   '小仓库提供全岛待运区加成');
ok(byKey.OIL_POWER_PLANT.service === 'POWER_SUPPLY', '石油发电厂提供全岛供电加成');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
