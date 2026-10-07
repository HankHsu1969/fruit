/* 水果盤（九宮格 8 線拉霸）— 規則核心，不碰 DOM。瀏覽器遊戲與 tools/sim.js 共用。 */
(function (root) {
  'use strict';

  // pay = 一條線三個相同時的倍數（× 每線押注）。
  // 最低的櫻桃 ×24 = 押滿 8 線時總押注的 3 倍，所以「任何三個一樣」都是大獎。
  // WILD 百搭：可以當成任何圖示（含任意 BAR、櫻桃），只出現在中間那一輪。
  const SYMBOLS = {
    seven:  { name: '77',    pay: 300 },
    bar3:   { name: '三BAR', pay: 200, bar: true },
    bar2:   { name: '雙BAR', pay: 100, bar: true },
    bar1:   { name: '單BAR', pay: 50, bar: true },
    star:   { name: '雙星',  pay: 50 },
    melon:  { name: '西瓜',  pay: 32, fruit: true },
    bell:   { name: '鈴鐺',  pay: 30 },
    orange: { name: '橘子',  pay: 26, fruit: true },
    cherry: { name: '櫻桃',  pay: 24, fruit: true },
    wild:   { name: 'WILD',  pay: 0, wild: true },
  };
  const ANY_BAR_PAY = 25;    // 一條線三個 BAR（單/雙/三混合）
  const CHERRY2_PAY = 3;     // 一條線任兩個櫻桃（小獎）
  const FULL_FRUIT_PAY = 100; // 全盤九格都是水果（櫻桃/橘子/西瓜，WILD 也算）：總押注 ×100（另外加上線上的獎）
  // 畫面上（九格任意位置）出現 N 個 77 的額外獎金：× 每線押注（WILD 不算）
  const SEVEN_COUNT_PAY = { 5: 100, 6: 500, 7: 1000, 8: 2000, 9: 3000 };
  const BIG_WIN_RATIO = 3;   // 單局贏得 ≥ 總押注 ×3 算「大獎」

  // 8 條線，順序就是「押線」開放的順序。cells 為 [列, 行]。
  const LINES = [
    { name: '中橫', cells: [[1, 0], [1, 1], [1, 2]] },
    { name: '上橫', cells: [[0, 0], [0, 1], [0, 2]] },
    { name: '下橫', cells: [[2, 0], [2, 1], [2, 2]] },
    { name: '左直', cells: [[0, 0], [1, 0], [2, 0]] },
    { name: '中直', cells: [[0, 1], [1, 1], [2, 1]] },
    { name: '右直', cells: [[0, 2], [1, 2], [2, 2]] },
    { name: '左斜', cells: [[0, 0], [1, 1], [2, 2]] },
    { name: '右斜', cells: [[2, 0], [1, 1], [0, 2]] },
  ];

  // 三條輪帶（由上往下捲，各 30 格）。每輪都有一段連續三個 77；WILD 只在中間那一輪（約每 4 局畫面上會出現一次）。
  // tools/sim.js 依權重精算（押滿 8 線）：中獎約 60%、大獎約每 4 局、全盤水果約每 50 局一次。
  // 這是「爽快版」設定：全盤水果總押注 ×100 又常出現，整體回饋率遠高於 100%，餘額會越玩越多。
  const REELS = [
    ['orange', 'bar3', 'melon', 'seven', 'seven', 'seven', 'cherry', 'orange', 'orange', 'bell', 'star', 'orange', 'bar1', 'melon', 'bar1',
      'bar1', 'bar2', 'orange', 'cherry', 'cherry', 'bell', 'orange', 'bell', 'bell', 'orange', 'melon', 'cherry', 'bell', 'orange', 'cherry'],
    ['cherry', 'wild', 'seven', 'melon', 'orange', 'cherry', 'bell', 'bar3', 'cherry', 'orange', 'wild', 'bar2', 'bar3', 'bell', 'seven',
      'seven', 'seven', 'cherry', 'bar3', 'bell', 'bell', 'orange', 'star', 'melon', 'orange', 'melon', 'melon', 'orange', 'wild', 'bar1'],
    ['star', 'orange', 'bell', 'star', 'bar3', 'bell', 'star', 'cherry', 'cherry', 'melon', 'melon', 'orange', 'melon', 'bar1', 'bell',
      'orange', 'bar1', 'bar2', 'bar3', 'orange', 'melon', 'bar1', 'seven', 'seven', 'seven', 'cherry', 'bell', 'star', 'melon', 'melon'],
  ];
  // 每個停點的權重（虛擬輪帶）：疊 77 附近的停點權重很小——每圈都看得到它轉過去，但很少停在那裡
  const WEIGHTS = [
    [1, 1, 1, 1, 5, 10, 40, 60, 13, 14, 8, 10, 1, 3, 6, 11, 4, 44, 59, 18, 8, 40, 45, 37, 60, 20, 8, 4, 53, 1],
    [10, 1, 47, 57, 7, 60, 10, 53, 31, 11, 14, 16, 15, 18, 1, 2, 28, 10, 41, 2, 25, 41, 43, 27, 26, 18, 40, 20, 60, 1],
    [30, 44, 23, 23, 33, 14, 1, 60, 25, 45, 24, 37, 3, 34, 41, 4, 17, 30, 50, 28, 7, 1, 1, 1, 3, 6, 44, 9, 9, 54],
  ];

  /** 輪帶停在 stop 時，畫面上由上到下的三個圖 */
  const column = (reel, stop) => [0, 1, 2].map((r) => REELS[reel][(stop + r) % REELS[reel].length]);

  function gridFromStops(stops) {
    const cols = stops.map((s, c) => column(c, s));
    return [0, 1, 2].map((r) => cols.map((col) => col[r])); // grid[列][行]
  }

  const WEIGHT_SUM = WEIGHTS.map((w) => w.reduce((x, y) => x + y, 0));
  function pickStop(reel, rng) {
    let x = rng() * WEIGHT_SUM[reel];
    const w = WEIGHTS[reel];
    for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return i; }
    return w.length - 1;
  }

  function spin(rng = Math.random) {
    const stops = REELS.map((_, r) => pickStop(r, rng));
    return { stops, grid: gridFromStops(stops) };
  }

  // 不含 WILD 的基本判斷
  function plainResult(a, b, c) {
    if (a === b && b === c) return { mult: SYMBOLS[a].pay, label: `${SYMBOLS[a].name} ×3`, sym: a };
    if (SYMBOLS[a].bar && SYMBOLS[b].bar && SYMBOLS[c].bar) return { mult: ANY_BAR_PAY, label: '任意 BAR', sym: 'bar1' };
    const cherries = (a === 'cherry') + (b === 'cherry') + (c === 'cherry');
    if (cherries === 2) return { mult: CHERRY2_PAY, label: '櫻桃 ×2', sym: 'cherry', partial: true };
    return null;
  }

  /** 一條線的獎。WILD 會自動當成線上其他圖示中最划算的那一個（例如 WILD＋西瓜＋西瓜 = 西瓜 ×3） */
  function lineResult(a, b, c) {
    const line = [a, b, c];
    const wilds = line.filter((s) => s === 'wild').length;
    if (!wilds) return plainResult(a, b, c);
    if (wilds === 3) return { ...plainResult('seven', 'seven', 'seven'), label: 'WILD ×3（當 77）', wild: true };
    let best = null;
    for (const sub of new Set(line.filter((s) => s !== 'wild'))) {
      const r = plainResult(...line.map((s) => (s === 'wild' ? sub : s)));
      if (r && (!best || r.mult > best.mult)) best = { ...r, label: `${r.label}（WILD）`, wild: true };
    }
    return best;
  }

  /** 算分：lines = 押幾線（1–8），lineBet = 每線押分 */
  function evaluate(grid, lines, lineBet) {
    const wins = [];
    for (let i = 0; i < lines; i++) {
      const cells = LINES[i].cells;
      const [a, b, c] = cells.map(([r, k]) => grid[r][k]);
      const res = lineResult(a, b, c);
      if (!res) continue;
      const hitCells = res.partial ? cells.filter(([r, k]) => grid[r][k] === 'cherry' || grid[r][k] === 'wild') : cells;
      wins.push({ line: i, ...res, cells: hitCells, win: res.mult * lineBet });
    }
    // 額外獎（兩種不會同時出現：77 不是水果）
    let bonus = null;
    const all = [];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) all.push([r, k]);
    const sevens = all.filter(([r, k]) => grid[r][k] === 'seven');
    if (all.every(([r, k]) => SYMBOLS[grid[r][k]].fruit || SYMBOLS[grid[r][k]].wild)) {
      bonus = { label: '全盤水果', desc: `總押注 ×${FULL_FRUIT_PAY}`, win: FULL_FRUIT_PAY * lines * lineBet, cells: all };
    } else if (SEVEN_COUNT_PAY[sevens.length]) {
      const pay = SEVEN_COUNT_PAY[sevens.length];
      bonus = { label: `${sevens.length} 個 77`, desc: `每線押注 ×${pay}`, win: pay * lineBet, cells: sevens };
    }
    const total = wins.reduce((a, w) => a + w.win, 0) + (bonus ? bonus.win : 0);
    return { wins, bonus, total };
  }

  // 比倍：電眼開 1–13，小 = 1–6、大 = 8–13、開 7 莊家通殺。
  const DOUBLE_MAX = 13;
  const rollDouble = (rng = Math.random) => 1 + Math.floor(rng() * DOUBLE_MAX);
  const doubleWins = (n, guess) => (guess === 'big' ? n >= 8 : n <= 6);

  const api = {
    SYMBOLS, LINES, REELS, WEIGHTS, ANY_BAR_PAY, CHERRY2_PAY, FULL_FRUIT_PAY, SEVEN_COUNT_PAY, BIG_WIN_RATIO, DOUBLE_MAX,
    column, gridFromStops, spin, lineResult, evaluate, rollDouble, doubleWins,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FruitCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
