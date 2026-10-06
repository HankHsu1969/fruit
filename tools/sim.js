// 回饋率精算：node tools/sim.js
// 窮舉三條輪帶所有停點組合（30×30×30），依每個停點的權重（虛擬輪帶）加權，用遊戲同一份 core.js 算分，
// 得到精確的中獎率、大獎率、回饋率與各種額外獎的機率。
const path = require('path');
const core = require(path.join(__dirname, '..', 'core.js'));
const { REELS, WEIGHTS, LINES, gridFromStops, evaluate, BIG_WIN_RATIO } = core;

const [L0, L1, L2] = REELS.map((r) => r.length);
const W = WEIGHTS.map((w) => w.reduce((a, b) => a + b, 0)).reduce((a, b) => a * b);
const pct = (x) => (x * 100).toFixed(2) + '%';
const every = (p) => (p > 0 ? `每 ${(1 / p).toLocaleString(undefined, { maximumFractionDigits: 1 })} 局` : '不會出現');

console.log(`窮舉 ${(L0 * L1 * L2).toLocaleString()} 種停點組合（依停點權重加權，每線押 1）`);
for (let lines = 1; lines <= LINES.length; lines++) {
  let paid = 0, hits = 0, bigs = 0;
  const bonus = {};
  for (let a = 0; a < L0; a++) for (let b = 0; b < L1; b++) for (let c = 0; c < L2; c++) {
    const p = WEIGHTS[0][a] * WEIGHTS[1][b] * WEIGHTS[2][c] / W;
    const r = evaluate(gridFromStops([a, b, c]), lines, 1);
    paid += p * r.total;
    if (r.total > 0) hits += p;
    if (r.total >= BIG_WIN_RATIO * lines) bigs += p;
    if (r.bonus) bonus[r.bonus.label] = (bonus[r.bonus.label] || 0) + p;
  }
  console.log(`  押 ${lines} 線：回饋率 ${pct(paid / lines)}，中獎 ${pct(hits)}（${every(hits)}），大獎 ${pct(bigs)}（${every(bigs)}）`);
  if (lines === LINES.length) {
    const order = ['全盤水果', '5 個 77', '6 個 77', '7 個 77', '8 個 77', '9 個 77'];
    for (const k of order) console.log(`    ${k}：${every(bonus[k] || 0)}`);
  }
}
