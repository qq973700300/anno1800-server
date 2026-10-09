/* 校验马路拼接轮廓：把 game.html 里的 roadOutline 逻辑复制过来，
   对 16 种四邻组合栅格化，确认"车道正好铺到格子边界、相邻格无缝对接"。 */
import * as THREE from './src/main/resources/static/three.module.js';

const CELL = 1.7;
const HALF = CELL * 0.5;
const RW = CELL * 0.30;

function roadOutline(up, right, down, left) {
  const pts = [[-RW, -RW]];
  if (left)  pts.push([-HALF, -RW], [-HALF, RW]);
  pts.push([-RW, RW]);
  if (up)    pts.push([-RW, HALF], [RW, HALF]);
  pts.push([RW, RW]);
  if (right) pts.push([HALF, RW], [HALF, -RW]);
  pts.push([RW, -RW]);
  if (down)  pts.push([RW, -HALF], [-RW, -HALF]);
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

/* 点是否在多边形内（射线法） */
function inside(poly, px, py) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const NAME = ['孤立场', '尽头', '直路', '拐角', 'T字', '十字'];
let fail = 0;
const N = 26;
const step = CELL / N;

for (let m = 0; m < 16; m++) {
  const up = !!(m & 1), right = !!(m & 2), down = !!(m & 4), left = !!(m & 8);
  const shape = roadOutline(up, right, down, left);
  const poly = shape.getPoints().map(p => [p.x, p.y]);

  // 面积：三角形扇（轮廓是简单多边形）
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    area += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  area = Math.abs(area / 2);
  const expect = RW * RW * 4 + (up + right + down + left) * RW * 2 * (HALF - RW);
  const okArea = Math.abs(area - expect) < 1e-6;

  // 车道端点必须精确落在格子边界（否则相邻两格之间会留缝）
  let edge = true;
  for (const [d, ax, want] of [[up, 1, HALF], [right, 0, HALF], [down, 1, -HALF], [left, 0, -HALF]]) {
    if (!d) continue;
    const mx = ax === 0 ? want : 0, my = ax === 0 ? 0 : want;
    if (!inside(poly, mx * 0.999, my * 0.999) || inside(poly, mx * 1.02, my * 1.02)) edge = false;
  }

  // 栅格化（shape 平面：+y 对应世界 -z）
  const rows = [];
  for (let r = 0; r < N; r++) {
    let line = '';
    for (let c = 0; c < N; c++) {
      const px = -CELL / 2 + step * (c + 0.5), py = CELL / 2 - step * (r + 0.5);
      line += inside(poly, px, py) ? '#' : '·';
    }
    rows.push(line);
  }
  const cnt = up + right + down + left;
  const label = cnt === 4 ? NAME[5] : cnt === 3 ? NAME[4] : cnt === 2 ? (up === down || left === right ? NAME[2] : NAME[3]) : NAME[cnt];
  const tid = `${up ? 'N' : '-'}${right ? 'E' : '-'}${down ? 'S' : '-'}${left ? 'W' : '-'}`;
  if (!okArea || !edge) fail++;
  console.log(`\n[${label.padEnd(4,'　')}] ${tid}  顶点${String(poly.length).padStart(2)} 面积${area.toFixed(3)}${okArea ? '✓' : '✗'} 贴边${edge ? '✓' : '✗'}`);
  console.log(rows.join('\n'));
}

console.log(`\n=== 16 种形态：${16 - fail} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
