/**
 * 纪元1800 建筑 3D 模型批量生成器（腾讯混元生3D）
 * ---------------------------------------------------------------------------
 * 三种用法：
 *   1) 只看提示词（不需要任何密钥，复制到 https://3d.hunyuan.tencent.com/ 手搓）
 *        node tools/gen-models.mjs --dry-run
 *        node tools/gen-models.mjs --dry-run --md > tools/model-prompts.md
 *   2) 真·批量生成 + 自动下载（需要腾讯云 SecretId / SecretKey）
 *        TENCENTCLOUD_SECRET_ID=xxx TENCENTCLOUD_SECRET_KEY=yyy node tools/gen-models.mjs
 *   3) 只跑某几个：   node tools/gen-models.mjs LUMBERJACK SAWMILL
 *
 * 生成的 .glb 会直接落到 src/main/resources/static/models/<建筑类型>.glb，
 * 客户端 game.html 会自动探测并按建筑占地尺寸归一化后贴上去，不用改任何代码。
 *
 * 接口：ai3d.tencentcloudapi.com
 *   SubmitHunyuanTo3DProJob / QueryHunyuanTo3DProJob  Version=2025-05-13
 *   默认并发 3 个任务，脚本会自动按 3 个一批推进。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOST = 'ai3d.tencentcloudapi.com';
const SERVICE = 'ai3d';
const VERSION = '2025-05-13';
const REGION = process.env.TENCENTCLOUD_REGION || 'ap-guangzhou';
const OUT_DIR = path.resolve('src/main/resources/static/models');

/* ============================================================
 * 提示词表 —— 这是"该生成什么"的唯一来源
 * 写法要点（文生3D 和文生图不一样，写错就出一堆杂物）：
 *   · 明确"单个独立建筑"，否则模型会把周围场景一起长出来
 *   · 明确"没有底座 / 没有地面 / 没有人物 / 没有文字"
 *   · 给出年代与风格（19世纪工业革命）让全部建筑看起来是一套
 *   · 点明主材质（木/砖/石/铁）—— 混元的 PBR 生成对这个最敏感
 * ============================================================ */
const MODELS = [
  { key: 'LUMBERJACK', label: '伐木场', size: '2×2', prompt:
    '单个独立的19世纪欧洲伐木场木屋，原木堆架、锯木台和成堆的圆木，双坡深棕色木板屋顶，木墙，屋檐下挂着一把斧头，等距视角，完整一栋建筑，没有底座，没有地面，没有人物，没有文字，卡通写实风格的游戏资产，PBR木材与铁件材质' },
  { key: 'CLAY_PIT', label: '黏土矿坑', size: '2×2', prompt:
    '单个独立的19世纪黏土开采场，低矮的木棚架、几堆红褐色黏土、木质输送滑道和一辆小型手推矿车，茅草顶棚，等距视角，完整建筑，没有底座，没有地面，没有人物，没有文字，卡通写实风格的游戏资产，PBR黏土与旧木头材质' },
  { key: 'IRON_MINE', label: '铁矿', size: '2×2', prompt:
    '单个独立的19世纪铁矿矿井入口，木质支撑框架、深色矿洞口、轨道矿车和堆放的灰黑色铁矿石，石板屋顶，等距视角，完整建筑，没有底座，没有地面，没有人物，没有文字，卡通写实风格的游戏资产，PBR铁矿石与深色木材材质' },
  { key: 'SAWMILL', label: '锯木厂', size: '3×3', prompt:
    '单个独立的19世纪蒸汽锯木厂厂房，大型圆形锯片、烟囱、整齐堆放的木板堆和传送木架，灰蓝色木板墙，深灰色坡屋顶，等距视角，完整一栋厂房，没有底座，没有地面，没有人物，没有文字，卡通写实风格的游戏资产，PBR木材与生锈铁皮材质' },
  { key: 'MILL', label: '磨坊', size: '2×3', prompt:
    '单个独立的19世纪风车磨坊，高大砖石塔楼配四片木质风车叶片，小窗，灰白色石墙，深棕色锥形屋顶，等距视角，完整建筑，没有底座，没有地面，没有人物，没有文字，卡通写实风格的游戏资产，PBR石材与木材质' },
  { key: 'BRICKWORKS', label: '砖厂', size: '3×3', prompt:
    '单个独立的19世纪砖厂，方正的砖砌厂房配细高砖烟囱，旁边一叠整齐码放的红砖和一座砖窑，暗红砖墙，铁皮屋顶，等距视角，完整厂房，没有底座，没有地面，没有人物，没有文字，卡通写实风格的游戏资产，PBR红砖与铁皮材质' },
  { key: 'BAKERY', label: '面包房', size: '3×3', prompt:
    '单个独立的19世纪欧式面包房，两层小楼配宽大玻璃橱窗和条纹遮阳篷，门外立着面包招牌，暖黄色墙面，红褐色瓦屋顶，砖砌面包烤炉烟囱，等距视角，完整一栋建筑，没有底座，没有地面，没有人物，没有文字，卡通写实风格的游戏资产，PBR灰泥与陶瓦材质' },
  { key: 'SCHNAPPS_DISTILLERY', label: '酿酒厂', size: '3×3', prompt:
    '单个独立的19世纪马铃薯酿酒厂，木石混合厂房配两个铜色蒸馏塔和成排的橡木酒桶，红色砖墙，深绿色屋顶，等距视角，完整厂房，没有底座，没有地面，没有人物，没有文字，卡通写实风格的游戏资产，PBR铜器与橡木桶材质' },
  { key: 'TEXTILE_MILL', label: '纺织厂', size: '4×3', prompt:
    '单个独立的19世纪纺织厂，长条形砖砌厂房，一整排高窗，顶部锯齿轮状采光屋顶，侧边一个细烟囱和几个纺织纱锭卷轴，灰褐色砖墙，等距视角，完整厂房，没有底座，没有地面，没有人物，没有文字，卡通写实风格的游戏资产，PBR砖墙与玻璃窗材质' },
  { key: 'STEEL_WORKS', label: '炼钢厂', size: '4×4', prompt:
    '单个独立的19世纪炼钢厂，两座高炉配黑色烟囱和高架钢架，钢水包与铁轨矿车，深灰钢铁墙面配红色管道，等距视角，完整工业厂房，没有底座，没有地面，没有人物，没有文字，卡通写实风格的游戏资产，PBR钢铁与耐火砖材质' },
  { key: 'BREWERY', label: '啤酒厂', size: '4×3', prompt:
    '单个独立的19世纪啤酒厂，砖石厂房配一座铜色糖化锅、成排竖立的橡木发酵桶和一段外露输酒管道，米黄色砖墙，暗红色坡屋顶，等距视角，完整厂房，没有底座，没有地面，没有人物，没有文字，卡通写实风格的游戏资产，PBR砖石与铜材质' },
  { key: 'CLOTHING_FACTORY', label: '制衣厂', size: '4×4', prompt:
    '单个独立的19世纪制衣厂，三层砖砌厂房配大玻璃窗、外部铁质楼梯和悬挂的布料招牌，屋顶有通风小塔，赭石色砖墙，深灰铁皮屋顶，等距视角，完整厂房，没有底座，没有地面，没有人物，没有文字，卡通写实风格的游戏资产，PBR砖墙与铁件材质' },

  /* 居民经济那三座：没有配方，但一样要有模型，否则 3D 里只有程序化占位体。
     贸易站是**港口**，外形必须和内陆厂房拉开：矮仓库 + 平缓屋顶 + 屋顶吊机。
     它的门由服务端自动朝海（西/东/北/南视落点而定），所以模型正面朝 +Z 就够，
     客户端会整体转到实际朝向。 */
  { key: 'TRADING_POST', label: '贸易站', size: '3×3', prompt:
    '单个独立的19世纪港口贸易站，低矮宽敞的灰蓝色木石仓库，近乎平缓的深灰屋顶，屋顶一角立着带横臂的木质卸货吊机，正立面一扇宽大的装卸大门，门前堆着几只木箱和麻袋卷，等距视角，完整一栋建筑，没有底座，没有地面，没有人物，没有文字，卡通写实风格的游戏资产，PBR木石与铁件材质' },
  { key: 'FARMER_HOUSE', label: '农夫小屋', size: '2×2', prompt:
    '单个独立的19世纪乡村农夫小屋，单层矮房，红褐色双坡陶瓦屋顶配砖砌小烟囱，米白色灰泥墙配木窗框和木质百叶窗，山墙一侧堆着一小垛劈柴，等距视角，完整一栋房子，没有底座，没有地面，没有人物，没有文字，卡通写实风格的游戏资产，PBR灰泥与陶瓦材质' },
  { key: 'WORKER_HOUSE', label: '工人住宅', size: '3×3', prompt:
    '单个独立的19世纪工业区工人联排住宅，三层红砖小楼，成排窄窗配石质窗楣，屋顶几支砖砌烟囱和一段外露铁质落水管，二层窗口搭着晾衣绳，等距视角，完整一栋建筑，没有底座，没有地面，没有人物，没有文字，卡通写实风格的游戏资产，PBR红砖与陶瓦材质' },
];

/* ============================================================
 * 占地规格 —— 与 com.anno.domain.BuildingType 的 sizeW/sizeH 一一对应
 * 改这里之前先确认那边的枚举没变，否则模型和占地会对不上。
 * 下面还推导出"生成模型时该按多大做"，规则来自 game.html 的 loadModel()：
 *   CELL = 每格边长（世界单位）      FIT  = 模型包围盒占占地的比例（0.9 → 四周留 10% 空隙）
 *   等比缩放系数 s = min(targetW/size.x, targetD/size.z, maxH/size.y)
 *   → 三个约束里最紧的那个说了算：长宽比不对就会有一边缩水，太高就会被 maxH 压小。
 * ============================================================ */
const CELL = 1.7;        // 必须与 game.html 的 const CELL 一致
const FIT = 0.9;         // 必须与 game.html loadModel() 里的 0.9 一致
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const spec = (size) => {
  const [w, h] = size.split('×').map(Number);
  const tw = +(w * CELL * FIT).toFixed(2);          // 目标宽度（世界单位，沿 x）
  const td = +(h * CELL * FIT).toFixed(2);          // 目标进深（世界单位，沿 z）
  const maxH = +(0.95 * Math.min(tw, td) + 0.5).toFixed(2);   // 高度上限（超出会被整体压小）
  const g = gcd(w, h);
  return { w, h, tw, td, maxH, ratio: `${w / g}:${h / g}` };
};

/* 生成参数：面向"浏览器里跑的游戏资产"，不是印刷级模型 */
const GEN = {
  Model: '3.0',
  GenerateType: 'Normal',      // Normal=带纹理几何体；LowPoly=智能减面；Geometry=白模
  FaceCount: 40000,            // 默认 50 万面太重，4 万面在网页里跑刚好
  EnablePBR: true,             // 打开 PBR 材质（混元的强项）
  ResultFormat: 'GLB',         // 直接要 glb，省得自己转
};

/* ==================== TC3-HMAC-SHA256 签名 ==================== */
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest();

function callApi(action, payload, secretId, secretKey) {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10);   // UTC 日期
  const scope = `${date}/${SERVICE}/tc3_request`;

  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\nhost:${HOST}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = [
    'POST', '/', '', canonicalHeaders, signedHeaders, sha256(body),
  ].join('\n');

  const stringToSign = [
    'TC3-HMAC-SHA256', ts, scope, sha256(canonicalRequest),
  ].join('\n');

  const kDate = hmac('TC3' + secretKey, date);
  const kService = hmac(kDate, SERVICE);
  const kSigning = hmac(kService, 'tc3_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Host': HOST,
    'X-TC-Action': action,
    'X-TC-Version': VERSION,
    'X-TC-Timestamp': String(ts),
    'X-TC-Region': REGION,
    'Authorization': `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, ` +
                     `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  return fetch(`https://${HOST}/`, { method: 'POST', headers, body })
    .then((r) => r.json())
    .then((j) => {
      const res = j.Response || {};
      if (res.Error) throw new Error(`${action} 失败：${res.Error.Code} ${res.Error.Message}`);
      return res;
    });
}

/* ==================== 下载（兼容直接给 .glb 或给 .zip） ==================== */
async function downloadGlb(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`下载失败 ${r.status}：${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;      // 'PK'
  if (!isZip) { fs.writeFileSync(dest, buf); return 'glb'; }

  const tmp = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'anno3d-'));
  const zip = path.join(tmp, 'm.zip');
  fs.writeFileSync(zip, buf);
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force`], { stdio: 'ignore' });
  const hit = fs.readdirSync(tmp).find((f) => f.toLowerCase().endsWith('.glb'));
  if (!hit) throw new Error('压缩包里没有 .glb');
  fs.copyFileSync(path.join(tmp, hit), dest);
  fs.rmSync(tmp, { recursive: true, force: true });
  return 'zip→glb';
}

/* ==================== 主流程 ==================== */
function printPrompts(asMarkdown) {
  if (asMarkdown) {
    console.log('# 建筑 3D 模型生成提示词（混元生3D）\n');
    console.log('在 https://3d.hunyuan.tencent.com/ 里「文生3D」，逐条粘贴下面的提示词。');
    console.log('生成完下载 GLB，命名为 `<TYPE>.glb`（**全大写**，见下表），放进 `src/main/resources/static/models/` 即可，');
    console.log('客户端 `game.html` 会自动探测、按占地归一化后替换掉程序化厂房，不用改代码。\n');
    console.log('## 一、占地与模型尺寸规格\n');
    console.log('| 文件名 | 建筑 | 占地(格) | 格数 | 长宽比 | 目标占地(世界单位) | 高度上限 |');
    console.log('|---|---|---|---|---|---|---|');
    for (const m of MODELS) {
      const s = spec(m.size);
      console.log(`| \`${m.key}.glb\` | ${m.label} | ${m.size} | ${s.w * s.h} | ${s.ratio} | ${s.tw} × ${s.td} | ${s.maxH} |`);
    }
    console.log(`\n> 1 格 = ${CELL} 世界单位。模型会被**按包围盒等比缩放**到占地的 ${FIT * 100}%，水平居中、底面贴地；`);
    console.log('> 缩放系数取「宽 / 深 / 高」三个约束里最紧的那个，所以**长宽比必须按上表来**，');
    console.log('> 否则会有一边白白缩水（例如给 4×3 的占地生成一个正方体，宽度就浪费了）。');
    console.log('> 高度超过"高度上限"不会被截断，而是整体被压小 —— 所以别把烟囱做得又细又高。\n');
    console.log('## 二、生成时必须守的几条\n');
    console.log('1. **朝向**：模型的"正面 / 大门"必须朝 **+Z**（three.js 里 y=0 时指向屏幕外那一侧）。');
    console.log('   游戏按建筑朝向整体绕 Y 轴转（0°=门朝南=+Z，90°=门朝东=+X），门做反了会被转歪。');
    console.log('2. **不要底座 / 地面 / 草坪 / 马路**：会把包围盒撑大，房子反而被压小。');
    console.log('3. **不要人物、不要文字**（招牌上的字母生成出来基本是乱码）。');
    console.log('4. **单栋独立**：别生成"一群建筑"或带环境的地块。');
    console.log('5. 材质统一走 PBR；面数 4 万左右够用。');
    console.log('6. 模型自带的缩放 / 原点**不用管**，进游戏会统一归一化。\n');
    console.log('## 三、提示词\n');
    console.log('| 文件名 | 建筑 | 占地 | 提示词 |');
    console.log('|---|---|---|---|');
    for (const m of MODELS) {
      console.log(`| \`${m.key}.glb\` | ${m.label} | ${m.size} | ${m.prompt.replace(/\|/g, '\\|')} |`);
    }
    return;
  }
  console.log(`共 ${MODELS.length} 座建筑，逐条复制到 https://3d.hunyuan.tencent.com/ 文生3D：\n`);
  MODELS.forEach((m, i) => {
    const s = spec(m.size);
    console.log(`─── ${String(i + 1).padStart(2)}. ${m.label}  →  存成 ${m.key}.glb`);
    console.log(`    占地 ${m.size}（${s.w * s.h} 格）· 长宽比 ${s.ratio} · 目标 ${s.tw} × ${s.td} 世界单位 · 高度上限 ${s.maxH}`);
    console.log(m.prompt + '\n');
  });
  console.log('推荐参数：带纹理 Normal 模式 · 面数 4 万 · 开启 PBR · 输出 GLB');
  console.log('要点：正面(大门)朝 +Z · 不要底座/地面/人物/文字 · 长宽比按上面给的来 · 高度别超上限');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--dry-run')) return printPrompts(args.includes('--md'));

  const secretId = process.env.TENCENTCLOUD_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRET_KEY;
  if (!secretId || !secretKey) {
    console.error('缺少环境变量 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY。');
    console.error('只想看提示词可以跑：node tools/gen-models.mjs --dry-run');
    process.exit(1);
  }

  const want = args.filter((a) => !a.startsWith('--'));
  const todo = want.length ? MODELS.filter((m) => want.includes(m.key)) : MODELS;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`准备生成 ${todo.length} 个模型 → ${OUT_DIR}\n`);

  /* 混元生3D 默认 3 并发，按 3 个一批提交 */
  const CONC = 3;
  for (let i = 0; i < todo.length; i += CONC) {
    const batch = todo.slice(i, i + CONC);
    const jobs = await Promise.all(batch.map(async (m) => {
      const res = await callApi('SubmitHunyuanTo3DProJob',
        { Prompt: m.prompt, ...GEN }, secretId, secretKey);
      console.log(`↑ ${m.label} 已提交（JobId ${res.JobId}）`);
      return { m, jobId: res.JobId };
    }));

    for (const { m, jobId } of jobs) {
      const dest = path.join(OUT_DIR, `${m.key}.glb`);
      for (let n = 0; n < 120; n++) {                     // 最多等 10 分钟
        await new Promise((r) => setTimeout(r, 5000));
        const q = await callApi('QueryHunyuanTo3DProJob', { JobId: jobId }, secretId, secretKey);
        if (q.Status === 'FAIL') { console.error(`✗ ${m.label} 生成失败：${q.ErrorMessage}`); break; }
        if (q.Status !== 'DONE') continue;
        const glb = (q.ResultFile3Ds || []).find((f) => String(f.Type).toUpperCase() === 'GLB')
                 || (q.ResultFile3Ds || [])[0];
        if (!glb) { console.error(`✗ ${m.label} 没有返回文件`); break; }
        const how = await downloadGlb(glb.Url, dest);
        console.log(`✓ ${m.label} → ${path.relative(process.cwd(), dest)}（${how}，消耗积分 ${q.ResultCreditConsumed}）`);
        break;
      }
    }
  }

  const have = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.glb'));
  console.log(`\n完成：models/ 现有 ${have.length}/${MODELS.length} 个模型`);
  console.log('重启服务后打开 game.html，建筑会自动换成这些模型。');
}

main().catch((e) => { console.error('💥 ' + e.message); process.exit(1); });
