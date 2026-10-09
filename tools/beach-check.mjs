/**
 * 沙滩验证：岸线得是一条**看得见的亮金沙带**，不是一圈没有对比的泥边。
 *   1. 服务端下发的海岸带宽度与客户端沙滩分带一致
 *   2. 岛上确实分出了近岸沙 / 干沙 / 沙草过渡 / 草地四层
 *   3. 干沙是"沙相"（R>G>B），草地是"草相"（G>R）
 *   4. 干沙与草地明度差够大（远看就是一圈白沙滩，不是泥边）
 *   5. 沙草过渡带落在草与干沙之间；近岸沙与干沙同属一条沙带（不被压成泥）
 *   6. 裙边（岸外沙洲 + 水下斜坡）：沙滩 → 半湿 → 潮线湿沙 → 水下暗沙洲，一层层沉暗
 *      **最亮那一档必须接近干沙**——否则岸线又退化成"一圈深色围裙"
 *   7. 页面零报错
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const NAME = '沙滩验证' + Date.now();
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? ' —— ' + detail : ''));
  ok ? pass++ : fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const toSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
/** 线性 RGB（0~1）→ 感知亮度（0~255，sRGB 口径）：报告和阈值都用它，说人话 */
const lum = rgb => {
  const [r, g, b] = rgb.map(v => toSrgb(v) * 255);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + JSON.stringify(j));
  return j.data;
};

const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '沙滩岛' });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--window-size=1280,800'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await sleep(6000);

  /* 1. 服务端口径 vs 客户端分带 */
  const beach = await page.evaluate(() => window.__annoBeach());
  check('服务端海岸带宽度与客户端沙滩分带一致',
    isl.coastWidth === beach.coast && beach.sand === Math.max(2, beach.coast),
    `服务端 coastWidth=${isl.coastWidth}，客户端 湿沙${beach.wet}圈 / 干沙到${beach.sand}圈`);

  /* 2~5. 全岛按"离水几格"分桶取平均色 */
  const scan = await page.evaluate(() => {
    const b = { wet: [], dry: [], blend: [], grass: [] };
    const G = window.__annoGround;
    for (let i = 0; i < 120; i++) for (let j = 0; j < 120; j++) {
      const g = G(i, j);
      if (!g.land) continue;
      const v = [g.rgb[0] / 255, g.rgb[1] / 255, g.rgb[2] / 255];
      if (g.cd <= 1) b.wet.push(v);
      else if (g.cd <= 2) b.dry.push(v);
      else if (g.cd === 3) b.blend.push(v);
      else if (g.cd >= 6 && b.grass.length < 600) b.grass.push(v);
    }
    const avg = a => a.length ? [0, 1, 2].map(k => a.reduce((s, v) => s + v[k], 0) / a.length) : null;
    return { wet: avg(b.wet), dry: avg(b.dry), blend: avg(b.blend), grass: avg(b.grass),
             counts: { wet: b.wet.length, dry: b.dry.length, blend: b.blend.length, grass: b.grass.length } };
  });
  const c = scan.counts;
  check('四层分带都有格子（湿沙 / 干沙 / 过渡 / 草地）',
    c.wet > 0 && c.dry > 0 && c.blend > 0 && c.grass > 0,
    `湿沙 ${c.wet} 格 · 干沙 ${c.dry} 格 · 过渡 ${c.blend} 格 · 内陆草地 ${c.grass} 格`);

  const [near, dry, blend, grass] = [scan.wet, scan.dry, scan.blend, scan.grass];
  const hex = v => v.map(x => Math.round(toSrgb(x) * 255).toString(16).padStart(2, '0')).join('');
  console.log(`     近岸沙 #${hex(near)} · 干沙 #${hex(dry)} · 过渡 #${hex(blend)} · 草地 #${hex(grass)}`);

  check('干沙是沙相（R>G>B，暖色）', dry[0] > dry[1] && dry[1] > dry[2],
    `R${Math.round(toSrgb(dry[0]) * 255)} G${Math.round(toSrgb(dry[1]) * 255)} B${Math.round(toSrgb(dry[2]) * 255)}`);
  check('草地是草相（G>R，冷绿）', grass[1] > grass[0],
    `R${Math.round(toSrgb(grass[0]) * 255)} G${Math.round(toSrgb(grass[1]) * 255)}`);

  const lDry = lum(dry), lGrass = lum(grass), lNear = lum(near), lBlend = lum(blend);
  check('干沙与草地明度差够大（远看是一圈白沙滩，不是泥边）', lDry - lGrass >= 55,
    `干沙 ${lDry.toFixed(0)} vs 草地 ${lGrass.toFixed(0)}，差 ${(lDry - lGrass).toFixed(0)}/255`);
  check('贴水那圈还是沙、没被压成泥（与干沙同属一条沙带）',
    Math.abs(lNear - lDry) < 18 && lNear > lGrass + 45,
    `近岸沙 ${lNear.toFixed(0)}（干沙 ${lDry.toFixed(0)} / 草地 ${lGrass.toFixed(0)}）`);
  check('沙草过渡带落在草与干沙之间', lBlend > lGrass && lBlend < lDry,
    `过渡 ${lBlend.toFixed(0)}`);

  /* 6. 裙边（岸外沙洲 + 水下斜坡）：四档由亮到暗 */
  const skirt = await page.evaluate(() => window.__annoSkirt());
  const ls = (skirt || []).map(v => lum(v));
  const maxL = Math.max(...ls), minL = Math.min(...ls);
  const near1 = ls.filter(v => v > 0.85 * lDry).length;          // 半湿沙洲内缘
  const wet = ls.filter(v => v > 0.62 * lDry && v <= 0.85 * lDry).length;  // 潮线湿沙
  const deep = ls.filter(v => v <= 0.62 * lDry).length;          // 水下暗沙洲
  check('岸外沙洲内缘够亮，沙滩连成一片（不是一圈深色围裙）',
    skirt && ls.length > 0 && maxL >= 0.85 * lDry && near1 > 0,
    `最亮 ${maxL.toFixed(0)} vs 干沙 ${lDry.toFixed(0)}，够亮的顶点 ${near1}/${ls.length}`);
  check('四档齐全：半湿沙洲 → 潮线湿沙 → 水下暗沙洲',
    near1 > 0 && wet > 0 && deep > 0 && minL < 0.62 * maxL,
    `半湿 ${near1} · 湿沙 ${wet} · 暗沙洲 ${deep}；最暗 ${minL.toFixed(0)} vs 最亮 ${maxL.toFixed(0)}`);

  check('页面零报错', errors.length === 0, errors.join(' | ') || '无');
} finally {
  await browser.close();
}
console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
