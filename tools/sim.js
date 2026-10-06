// 回饋率精算：node tools/sim.js
// 窮舉三條輪帶所有停點組合（30×30×30），用遊戲同一份 core.js 算分，得到精確的中獎率、大獎率與回饋率。
const path = require('path');
const core = require(path.join(__dirname, '..', 'core.js'));
const { REELS, LINES, gridFromStops, evaluate, BIG_WIN_RATIO } = core;

const [L0, L1, L2] = REELS.map((r) => r.length);
const N = L0 * L1 * L2;
const pct = (x) => (x * 100).toFixed(2) + '%';

console.log(`窮舉 ${N.toLocaleString()} 種停點組合（每線押 1）`);
for (let lines = 1; lines <= LINES.length; lines++) {
  let paid = 0, hits = 0, bigs = 0, full = 0;
  for (let a = 0; a < L0; a++) for (let b = 0; b < L1; b++) for (let c = 0; c < L2; c++) {
    const r = evaluate(gridFromStops([a, b, c]), lines, 1);
    paid += r.total;
    if (r.total > 0) hits++;
    if (r.total >= BIG_WIN_RATIO * lines) bigs++;
    if (r.bonus) full++;
  }
  const line = `  押 ${lines} 線：回饋率 ${pct(paid / (N * lines))}，中獎 ${pct(hits / N)}（每 ${(N / hits).toFixed(1)} 局），` +
    `大獎 ${pct(bigs / N)}（每 ${(N / Math.max(bigs, 1)).toFixed(1)} 局）`;
  console.log(lines === LINES.length ? `${line}，全盤水果每 ${Math.round(N / Math.max(full, 1))} 局` : line);
}
