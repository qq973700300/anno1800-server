// game.html / npc.js 语法冒烟：抽取 <script> 模块内容，剥掉 import/export 后用 new Function 编译检查
// （能抓模板字符串 / 括号 / 标签没闭合这类编辑事故；不执行代码，只 parse）
import { readFileSync } from 'node:fs';

const stripModule = (src) =>
  src
    .replace(/import\s*[^;'"]*from\s*['"][^'"]+['"];?/g, '')  // import ... from 'x'（含多行）
    .replace(/^\s*import\s*['"][^'"]+['"];?\s*$/gm, '')        // 裸 import 'x'
    .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')          // export {...}
    .replace(/\bexport\s+default\s+/g, '')                     // export default
    .replace(/\bexport\s+/g, '');                              // export 前缀（const/class/function）

const html = readFileSync('src/main/resources/static/game.html', 'utf8');
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="importmap")(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1]);
console.log(`game.html: 抽到 ${blocks.length} 个内联 JS script 块（importmap/JSON 已排除）`);

let bad = 0;
for (let i = 0; i < blocks.length; i++) {
  const code = stripModule(blocks[i]);
  try {
    new Function(`"use strict";return (async()=>{${code}})`);
    console.log(`  block#${i + 1} (${blocks[i].length} chars): OK`);
  } catch (e) {
    bad++;
    console.log(`  block#${i + 1}: SYNTAX ERROR -> ${e.message}`);
    const m = /<anonymous>:(\d+)/.exec(e.stack || '');
    if (m) {
      const ln = Number(m[1]) - 1;
      const lines = code.split('\n');
      console.log('    附近内容:', lines.slice(Math.max(0, ln - 2), ln + 2).join('\n    '));
    }
  }
}

for (const f of ['src/main/resources/static/jsm/npc.js']) {
  const src = stripModule(readFileSync(f, 'utf8'));
  try {
    new Function(`"use strict";return (async()=>{${src}})`);
    console.log(`${f}: OK`);
  } catch (e) {
    bad++;
    console.log(`${f}: SYNTAX ERROR -> ${e.message}`);
    const m = /<anonymous>:(\d+)/.exec(e.stack || '');
    if (m) {
      const ln = Number(m[1]) - 1;
      const lines = src.split('\n');
      console.log('    附近内容:', lines.slice(Math.max(0, ln - 2), ln + 2).join('\n    '));
    }
  }
}

console.log(bad ? `\n结果: ${bad} 处语法错误` : '\n结果: 全部通过');
process.exit(bad ? 1 : 0);
