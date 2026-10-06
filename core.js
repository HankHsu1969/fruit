/* 水果盤（九宮格 8 線拉霸）— 規則核心，不碰 DOM。瀏覽器遊戲與 tools/sim.js 共用。 */
(function (root) {
  'use strict';

  // pay = 一條線三個相同時的倍數（× 每線押注）。
  // 最低的櫻桃 ×24 = 押滿 8 線時總押注的 3 倍，所以「任何三個一樣」都是大獎。
  const SYMBOLS = {
    seven:  { name: '77',    pay: 150 },
    bar3:   { name: '三BAR', pay: 80, bar: true },
    bar2:   { name: '雙BAR', pay: 60, bar: true },
    star:   { name: '雙星',  pay: 50 },
    bar1:   { name: '單BAR', pay: 40, bar: true },
    melon:  { name: '西瓜',  pay: 32, fruit: true },
    bell:   { name: '鈴鐺',  pay: 30 },
    mango:  { name: '芒果',  pay: 28, fruit: true },
    orange: { name: '橘子',  pay: 26, fruit: true },
    cherry: { name: '櫻桃',  pay: 24, fruit: true },
  };
  const ANY_BAR_PAY = 25;    // 一條線三個 BAR（單/雙/三混合）
  const CHERRY2_PAY = 3;     // 一條線任兩個櫻桃（小獎）
  const FULL_FRUIT_PAY = 100; // 全盤九格都是水果（櫻桃/橘子/芒果/西瓜）：總押注 ×100（另外加上線上的獎）
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

  // 三條輪帶（由上往下捲）。tools/sim.js 精算（押滿 8 線）：每 2 局約中 1 次、每 5 局約 1 次大獎，回饋率約 97%；
  // 依序開放的任何線數（1–8 線）回饋率都低於 100%。
  const REELS = [
    ['bell', 'melon', 'seven', 'cherry', 'bell', 'mango', 'melon', 'melon', 'bar1', 'seven', 'melon', 'melon', 'bar3', 'orange', 'orange',
      'orange', 'bar3', 'bar1', 'cherry', 'bell', 'cherry', 'bar2', 'melon', 'cherry', 'bar2', 'star', 'star', 'cherry', 'mango', 'melon'],
    ['bar2', 'cherry', 'seven', 'bar2', 'bell', 'star', 'orange', 'bell', 'star', 'seven', 'seven', 'melon', 'cherry', 'mango', 'bar1',
      'bar2', 'melon', 'melon', 'bar3', 'orange', 'bar3', 'bar1', 'cherry', 'bell', 'bar3', 'bar2', 'cherry', 'orange', 'bar1', 'bar3'],
    ['bar1', 'mango', 'seven', 'bar3', 'mango', 'cherry', 'bell', 'orange', 'cherry', 'melon', 'star', 'star', 'cherry', 'mango', 'bell',
      'cherry', 'star', 'bar2', 'cherry', 'star', 'melon', 'bar2', 'bar3', 'cherry', 'cherry', 'cherry', 'star', 'melon', 'orange', 'bell'],
  ];

  /** 輪帶停在 stop 時，畫面上由上到下的三個圖 */
  const column = (reel, stop) => [0, 1, 2].map((r) => REELS[reel][(stop + r) % REELS[reel].length]);

  function gridFromStops(stops) {
    const cols = stops.map((s, c) => column(c, s));
    return [0, 1, 2].map((r) => cols.map((col) => col[r])); // grid[列][行]
  }

  function spin(rng = Math.random) {
    const stops = REELS.map((strip) => Math.floor(rng() * strip.length));
    return { stops, grid: gridFromStops(stops) };
  }

  function lineResult(a, b, c) {
    if (a === b && b === c) return { mult: SYMBOLS[a].pay, label: `${SYMBOLS[a].name} ×3`, sym: a };
    if (SYMBOLS[a].bar && SYMBOLS[b].bar && SYMBOLS[c].bar) return { mult: ANY_BAR_PAY, label: '任意 BAR', sym: 'bar1' };
    const cherries = (a === 'cherry') + (b === 'cherry') + (c === 'cherry');
    if (cherries === 2) return { mult: CHERRY2_PAY, label: '櫻桃 ×2', sym: 'cherry', partial: true };
    return null;
  }

  /** 算分：lines = 押幾線（1–8），lineBet = 每線押分 */
  function evaluate(grid, lines, lineBet) {
    const wins = [];
    for (let i = 0; i < lines; i++) {
      const cells = LINES[i].cells;
      const [a, b, c] = cells.map(([r, k]) => grid[r][k]);
      const res = lineResult(a, b, c);
      if (!res) continue;
      const hitCells = res.partial ? cells.filter(([r, k]) => grid[r][k] === 'cherry') : cells;
      wins.push({ line: i, ...res, cells: hitCells, win: res.mult * lineBet });
    }
    let bonus = null;
    if (grid.flat().every((s) => SYMBOLS[s].fruit)) bonus = { label: '全盤水果', win: FULL_FRUIT_PAY * lines * lineBet };
    const total = wins.reduce((a, w) => a + w.win, 0) + (bonus ? bonus.win : 0);
    return { wins, bonus, total };
  }

  // 比倍：電眼開 1–13，小 = 1–6、大 = 8–13、開 7 莊家通殺。
  const DOUBLE_MAX = 13;
  const rollDouble = (rng = Math.random) => 1 + Math.floor(rng() * DOUBLE_MAX);
  const doubleWins = (n, guess) => (guess === 'big' ? n >= 8 : n <= 6);

  const api = {
    SYMBOLS, LINES, REELS, ANY_BAR_PAY, CHERRY2_PAY, FULL_FRUIT_PAY, BIG_WIN_RATIO, DOUBLE_MAX,
    column, gridFromStops, spin, evaluate, rollDouble, doubleWins,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FruitCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
