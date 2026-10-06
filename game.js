/* 水果盤（九宮格 8 線拉霸）— 轉輪演出、遊戲流程與操作 */
(function () {
  'use strict';

  const C = window.FruitCore;
  const Snd = window.FruitSound;
  const { SYMBOLS, LINES, REELS } = C;

  const YUAN = 10;            // 1 分 = 10 元（畫面上的金額一律顯示元）
  const COIN_VALUE = 10;      // 投幣一次 = 10 分 = 100 元
  const START_CREDIT = 100;   // 第一次開機送 100 分 = 1,000 元
  const MAX_LINE_BET = 10;    // 每線押注上限 10 分 = 100 元
  const MAX_SCORE = 99999;    // 99,999 分 = 999,990 元（六位數 LED 顯示得下）
  const COLLECT_MIN_MS = 35;  // 入金加速到最快時，每數一下的間隔
  const STORE_KEY = 'fruit-machine-9grid-v1';
  const LINE_COLORS = ['#ff3b3b', '#ffd400', '#33d6ff', '#4cff6a', '#ff8a1a', '#c86bff', '#ff4fd8', '#3f8bff'];
  const VMAX = 17;                       // 轉速（格/秒）
  const AUTO_STOP_MS = [950, 1300, 1650]; // 沒按停時，三輪自動停的時間
  const MIN_SPIN_MS = 280;
  const IMG = (sym) => `img/${sym}.png`;

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mod = (a, n) => ((a % n) + n) % n;
  const clampScore = (n) => Math.max(0, Math.min(MAX_SCORE, Math.floor(n) || 0));
  const money = (n) => `${(n * YUAN).toLocaleString()} 元`;

  // ---------------- 狀態 ----------------
  const st = {
    mode: 'idle', // idle | spinning | showing | win | doubling | collecting
    credit: START_CREDIT,
    win: 0,
    lines: 8,
    lineBet: 1,
    auto: false,
    games: 0,
    coins: 0,
    best: 0,
    history: [],
  };
  let firstVisit = true;
  const totalBet = () => st.lines * st.lineBet;

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (d && typeof d.credit === 'number') {
        firstVisit = false;
        st.credit = clampScore(d.credit);
        st.lines = Math.min(8, Math.max(1, d.lines | 0 || 8));
        st.lineBet = Math.min(MAX_LINE_BET, Math.max(1, d.lineBet | 0 || 1));
        st.games = d.games | 0;
        st.coins = d.coins | 0;
        st.best = d.best | 0;
        Snd.muted = !!d.muted;
        if (Array.isArray(d.history)) st.history = d.history.slice(0, 8);
      }
    } catch (e) { /* 無痕模式等情況就用預設值 */ }
  }

  function save() {
    try {
      // 還沒收的得分、轉到一半的押注都算回分數，重新整理不會不見
      const pending = st.win + (st.mode === 'spinning' ? totalBet() : 0);
      localStorage.setItem(STORE_KEY, JSON.stringify({
        credit: clampScore(st.credit + pending), lines: st.lines, lineBet: st.lineBet, games: st.games,
        coins: st.coins, best: st.best, muted: Snd.muted, history: st.history,
      }));
    } catch (e) { /* ignore */ }
  }

  // ---------------- 七段顯示器 ----------------
  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '' };
  function makeSeg(el, n) {
    const digits = [];
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'd7';
      const segs = {};
      for (const s of 'abcdefg') {
        const e = document.createElement('i');
        e.className = s;
        d.appendChild(e);
        segs[s] = e;
      }
      el.appendChild(d);
      digits.push(segs);
    }
    let last = null;
    return (value) => {
      const str = String(value).padStart(n, ' ').slice(-n);
      if (str === last) return;
      last = str;
      [...str].forEach((ch, i) => {
        const on = SEG[ch] || '';
        for (const s of 'abcdefg') digits[i][s].classList.toggle('on', on.includes(s));
      });
    };
  }
  let segWin, segCredit, segBet, segDbl;

  // ---------------- 轉輪 ----------------
  let cellH = 140;
  const reels = [];

  function buildReels() {
    document.querySelectorAll('.reel').forEach((el, idx) => {
      const strip = REELS[idx];
      const syms = [];
      for (let k = 0; k < 4; k++) {
        const d = document.createElement('div');
        d.className = 'sym';
        const img = document.createElement('img');
        img.alt = '';
        d.appendChild(img);
        el.appendChild(d);
        syms.push({ d, img, idx: -1 });
      }
      const r = { el, idx, strip, L: strip.length, syms, p: Math.floor(Math.random() * strip.length), v: 0, state: 'idle', stopReq: false, stopAt: 0 };
      reels.push(r);
      drawReel(r);
    });
    cellH = reels[0].el.clientHeight / 3;
    reels.forEach(drawReel);
  }

  function drawReel(r) {
    const base = Math.floor(r.p);
    const f = r.p - base;
    for (let k = 0; k < 4; k++) {
      const s = r.syms[k];
      const i = mod(base + k, r.L);
      if (s.idx !== i) { s.idx = i; s.img.src = IMG(r.strip[i]); }
      s.d.style.transform = `translateY(${((k - f) * cellH).toFixed(1)}px)`;
    }
  }

  // 減速時帶一點回彈。輪子在 u = 1 - c1/c3（約 53%）時第一次到位，之後是衝過頭再彈回；停輪聲要在「到位」那一刻響
  const BOUNCE_C1 = 0.9;
  const LAND_U = 1 - BOUNCE_C1 / (BOUNCE_C1 + 1);
  const easeOutBack = (u) => { const c1 = BOUNCE_C1, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };

  function beginStop(r, now) {
    // 保留目前的小數位移，換成「離目標 3 格多」的位置再減速停下（高速模糊中看不出來）
    const f = mod(r.p, 1);
    r.dist = 3 + f;
    r.from = r.target + r.dist;
    r.p = r.from;
    r.dur = Math.min(950, Math.max(450, (3.9 * r.dist / Math.max(r.v, 6)) * 1000));
    r.ts = now;
    r.state = 'stopping';
  }

  function updateReel(r, now, dt) {
    if (r.state === 'spin') {
      const t = now - r.t0;
      if (t < 0) return;
      if (t < 110) {
        r.p += 2.6 * dt; // 起轉前先往上頓一下
      } else {
        r.v = Math.min(VMAX, r.v + (VMAX * dt) / 0.22);
        r.p = mod(r.p - r.v * dt, r.L);
      }
      r.el.classList.toggle('fast', r.v > 9);
      if (r.stopReq && now >= r.stopAt && r.v >= VMAX * 0.6) beginStop(r, now);
    } else if (r.state === 'stopping') {
      const u = (now - r.ts) / r.dur;
      if (u > 0.35) r.el.classList.remove('fast');
      if (!r.landed && u >= LAND_U) {
        r.landed = true;
        Snd.reelStop(r.idx);
        setStopButton(r.idx, false);
        if (reels.every((x) => x.landed)) {
          // 最後一輪到位：轉輪聲停、馬上開獎（回彈動畫在背景跑完）
          Snd.spinEnd();
          if (allStoppedResolve) { const res = allStoppedResolve; allStoppedResolve = null; res(); }
        }
      }
      if (u >= 1) {
        r.p = r.target;
        r.v = 0;
        r.state = 'idle';
      } else {
        r.p = r.from - r.dist * easeOutBack(u);
      }
    }
  }

  let lastT = 0;
  let allStoppedResolve = null;

  // 用 requestAnimationFrame 驅動；視窗被遮住、rAF 停擺時改由 setTimeout 接手，轉輪才不會卡住
  let scheduled = false;
  let rafHandle = 0;
  let timerHandle = 0;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    const go = () => {
      if (!scheduled) return;
      scheduled = false;
      cancelAnimationFrame(rafHandle);
      clearTimeout(timerHandle);
      frame(performance.now());
    };
    rafHandle = requestAnimationFrame(go);
    timerHandle = setTimeout(go, 50);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    let active = false;
    for (const r of reels) {
      updateReel(r, now, dt);
      drawReel(r);
      if (r.state !== 'idle') active = true;
    }
    if (active) {
      schedule();
    } else if (allStoppedResolve) {
      const res = allStoppedResolve;
      allStoppedResolve = null;
      res();
    }
  }

  function runReels(stops) {
    const now = performance.now();
    reels.forEach((r, i) => {
      r.state = 'spin';
      r.t0 = now + i * 70;
      r.v = 0;
      r.target = stops[i];
      r.stopReq = false;
      r.landed = false;
      setStopButton(i, true);
    });
    lastT = now;
    schedule();
    return new Promise((res) => { allStoppedResolve = res; });
  }

  function requestStop(i, delay = 0) {
    const r = reels[i];
    if (!r || r.state !== 'spin' || r.stopReq) return;
    r.stopReq = true;
    r.stopAt = Math.max(performance.now() + delay, r.t0 + MIN_SPIN_MS);
  }

  // ---------------- 押線指示燈與連線 ----------------
  const markers = [];
  const lineEls = [];
  const hlCells = [];
  const geo = {};

  function buildLines() {
    const win = $('window');
    const box = $('reelBox');
    const W = win.clientWidth;
    const Hh = win.clientHeight;
    const reelW = reels[0].el.clientWidth;
    const gap = reels[1].el.offsetLeft - reels[0].el.offsetLeft - reelW;
    const cx = [0, 1, 2].map((c) => c * (reelW + gap) + reelW / 2);
    const cy = [0, 1, 2].map((r) => r * cellH + cellH / 2);
    const slope = (cy[2] - cy[0]) / (cx[2] - cx[0]);
    const mx = -34; // 左側指示燈中心 x
    const my = -26; // 上方指示燈中心 y
    Object.assign(geo, { W, Hh, cx, cy });

    // 每條線：指示燈位置與線段端點（以轉輪視窗左上角為原點）
    const spec = [
      { m: [mx, cy[1]], a: [mx + 22, cy[1]], b: [W, cy[1]] },
      { m: [mx, cy[0]], a: [mx + 22, cy[0]], b: [W, cy[0]] },
      { m: [mx, cy[2]], a: [mx + 22, cy[2]], b: [W, cy[2]] },
      { m: [cx[0], my], a: [cx[0], my + 17], b: [cx[0], Hh] },
      { m: [cx[1], my], a: [cx[1], my + 17], b: [cx[1], Hh] },
      { m: [cx[2], my], a: [cx[2], my + 17], b: [cx[2], Hh] },
      { m: [mx, cy[0] - (cx[0] - mx) * slope], a: [mx, cy[0] - (cx[0] - mx) * slope], b: [W, cy[2] + (W - cx[2]) * slope] },
      { m: [mx, cy[2] + (cx[0] - mx) * slope], a: [mx, cy[2] + (cx[0] - mx) * slope], b: [W, cy[0] - (W - cx[2]) * slope] },
    ];

    const svg = $('paylines');
    svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`);
    const ox = win.offsetLeft;
    const oy = win.offsetTop;
    spec.forEach((s, i) => {
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', s.a[0]);
      ln.setAttribute('y1', s.a[1]);
      ln.setAttribute('x2', s.b[0]);
      ln.setAttribute('y2', s.b[1]);
      ln.setAttribute('stroke', LINE_COLORS[i]);
      svg.appendChild(ln);
      lineEls.push(ln);

      const m = document.createElement('div');
      m.className = 'marker';
      m.style.left = `${ox + s.m[0] - 22}px`;
      m.style.top = `${oy + s.m[1] - 17}px`;
      m.style.setProperty('--lc', LINE_COLORS[i]);
      m.title = `第 ${i + 1} 線（${LINES[i].name}）`;
      m.innerHTML = `<b></b><i>${i + 1}</i>`;
      box.appendChild(m);
      markers.push(m);
    });

    const grid = $('hlGrid');
    for (let k = 0; k < 9; k++) {
      const d = document.createElement('div');
      d.className = 'hl';
      grid.appendChild(d);
      hlCells.push(d);
    }
  }

  function showLines(list, cls = 'show') {
    lineEls.forEach((ln, i) => {
      ln.classList.toggle('show', cls === 'show' && list.includes(i));
      ln.classList.toggle('dim', cls === 'dim' && list.includes(i));
    });
  }
  function markCells(cells) {
    hlCells.forEach((d) => d.classList.remove('win', 'flash'));
    for (const [r, c] of cells) hlCells[r * 3 + c].classList.add('win');
  }
  function clearWinDisplay() {
    stopLineCycle();
    showLines([]);
    markCells([]);
    markers.forEach((m) => m.classList.remove('hit'));
    hideTag();
  }

  let hlFlash = false;
  setInterval(() => {
    hlFlash = !hlFlash;
    hlCells.forEach((d) => { if (d.classList.contains('win')) d.classList.toggle('flash', hlFlash); });
  }, 180);

  let flashTimer = 0;
  function flashActiveLines() {
    if (st.mode !== 'idle') return;
    stopAttract();
    clearTimeout(flashTimer);
    showLines([...Array(st.lines).keys()]);
    flashTimer = setTimeout(() => { if (st.mode === 'idle') showLines([]); }, 1200);
  }

  // 中獎後一條一條輪流顯示
  let cycleTimer = 0;
  function startLineCycle(ev) {
    stopLineCycle();
    if (!ev.wins.length) return;
    let k = 0;
    const step = () => {
      const w = ev.wins[k % ev.wins.length];
      showLines([w.line]);
      markCells(w.cells);
      markers.forEach((m, i) => m.classList.toggle('hit', i === w.line));
      k++;
    };
    step();
    if (ev.wins.length > 1) cycleTimer = setInterval(step, 1100);
  }
  function stopLineCycle() { clearInterval(cycleTimer); cycleTimer = 0; }

  let tagTimer = 0;
  function showTag(text) {
    clearTimeout(tagTimer);
    tagTimer = setTimeout(hideTag, 2000);
    const t = $('winTag');
    t.textContent = text;
    t.classList.remove('show');
    void t.offsetWidth; // 重播動畫
    t.classList.add('show');
  }
  const hideTag = () => $('winTag').classList.remove('show');

  // ---------------- 畫面更新 ----------------
  function setStopButton(i, on) { $(`btnStop${i}`).classList.toggle('lit', on); }

  function render() {
    segCredit(st.credit * YUAN);
    segWin(st.win * YUAN);
    segBet(totalBet() * YUAN);
    markers.forEach((m, i) => {
      const on = i < st.lines;
      m.classList.toggle('on', on);
      m.querySelector('b').textContent = on ? st.lineBet * YUAN : '';
    });
    document.querySelectorAll('.thumb').forEach((t, i) => t.classList.toggle('on', i < st.lines));

    const idle = st.mode === 'idle';
    const win = st.mode === 'win';
    const spinning = st.mode === 'spinning';
    for (const id of ['btnBig', 'btnSmall', 'btnTake']) {
      $(id).classList.toggle('ready', win && !st.auto);
      $(id).classList.toggle('dim', !win);
    }
    for (const id of ['btnBet', 'btnLines', 'btnMax']) $(id).classList.toggle('dim', !(idle || win) || st.auto);
    for (let i = 0; i < 3; i++) $(`btnStop${i}`).classList.toggle('dim', !spinning);
    const canSpin = spinning || win || (idle && st.credit >= totalBet());
    $('btnSpin').classList.toggle('ready', canSpin && !spinning && !st.auto);
    $('btnSpin').classList.toggle('lit', spinning);
    $('btnAuto').classList.toggle('lit', st.auto);
    $('btnCoin').classList.toggle('ready', idle && st.credit < totalBet());
    $('btnMute').classList.toggle('off', Snd.muted);
    $('btnMute').textContent = Snd.muted ? '靜音' : '音效';
    $('statGames').textContent = st.games.toLocaleString();
    $('statCoins').textContent = money(st.coins * COIN_VALUE);
    $('statBest').textContent = money(st.best);
  }

  let msgText = '';
  function msg(text) {
    if (text === msgText) return;
    msgText = text;
    const span = $('msg');
    const box = span.parentElement;
    box.classList.remove('scroll');
    span.textContent = text;
    if (span.offsetWidth > box.clientWidth - 16) {
      box.style.setProperty('--dur', `${4 + text.length * 0.3}s`);
      box.classList.add('scroll');
    }
  }

  function idleMsg() {
    if (st.credit < totalBet()) return st.credit === 0 ? '請投幣 INSERT COIN' : '餘額不足・請投幣或降低押注';
    return `押 ${st.lines} 線 × ${st.lineBet * YUAN} 元・請按 轉`;
  }

  let idleMsgTimer = 0;
  function msgThenIdle(text, ms = 2000) {
    msg(text);
    clearTimeout(idleMsgTimer);
    idleMsgTimer = setTimeout(() => { if (st.mode === 'idle') msg(idleMsg()); }, ms);
  }

  let lastErr = 0;
  function errorBeep(text) {
    if (text) msgThenIdle(text);
    const now = performance.now();
    if (now - lastErr > 350) { Snd.error(); lastErr = now; }
  }

  const party = (on) => document.body.classList.toggle('party', on);

  function setDoubleBox(guess) {
    const box = document.querySelector('.dbl-box');
    box.classList.toggle('big', guess === 'big');
    box.classList.toggle('small', guess === 'small');
    $('dblHint').textContent = guess === 'big' ? '押大 8–13' : guess === 'small' ? '押小 1–6' : '小1–6 大8–13';
  }

  // ---------------- 遊戲流程 ----------------
  let autoStopTimers = [];
  let autoTimer = 0;

  async function spinOrStop() {
    if (st.mode === 'spinning') { stopAll(); return; }
    await spin();
  }

  function stopAll() {
    reels.forEach((r, i) => requestStop(i, i * 120));
  }

  async function spin() {
    if (st.mode === 'win') await collect();
    if (st.mode !== 'idle') return;
    const total = totalBet();
    if (st.credit < total) {
      setAuto(false);
      errorBeep(st.credit === 0 ? '請投幣 INSERT COIN' : '餘額不足・請投幣或降低押注');
      return;
    }
    stopAttract();
    clearTimeout(flashTimer);
    clearTimeout(idleMsgTimer);
    st.credit -= total;
    st.mode = 'spinning';
    st.win = 0;
    clearWinDisplay();
    setDoubleBox(null);
    segDbl('');
    party(false);
    msg(st.auto ? '自動遊戲中…' : 'GOOD LUCK！');
    render();
    Snd.spinStart();

    const res = C.spin();
    const done = runReels(res.stops);
    autoStopTimers = AUTO_STOP_MS.map((ms, i) => setTimeout(() => requestStop(i), ms));
    await done;
    autoStopTimers.forEach(clearTimeout);
    Snd.spinEnd();

    st.games++;
    const ev = C.evaluate(res.grid, st.lines, st.lineBet);
    if (ev.total > 0) {
      await presentWin(ev);
    } else {
      st.mode = 'idle';
      if (!st.auto) msgThenIdle('沒中・再接再厲！');
    }
    render();
    save();
    if (st.auto) scheduleAuto();
  }

  async function presentWin(ev) {
    st.mode = 'showing';
    party(true);
    render();
    const fast = st.auto;
    const big = ev.total >= totalBet() * C.BIG_WIN_RATIO;
    const tier = big ? 'big' : ev.total >= totalBet() ? 'medium' : 'small';
    // 輪子一停就響：大獎放慶祝音樂、中獎播收銀機叮＋亮晶晶的短樂句、小獎播兩聲門鈴
    if (ev.bonus) {
      showTag(ev.bonus.label);
      Snd.jackpot();
    } else {
      if (big) showTag(ev.total >= totalBet() * 10 ? '超級大獎' : '大獎');
      Snd.win(tier);
    }
    const shown = [];
    for (const w of ev.wins) {
      shown.push(w.line);
      showLines(shown);
      markCells(ev.wins.filter((x) => shown.includes(x.line)).flatMap((x) => x.cells));
      markers[w.line].classList.add('hit');
      msg(`第${w.line + 1}線 ${w.label} ＝ ${money(w.win)}`);
      await sleep(fast ? 240 : 450);
    }
    markers.forEach((m) => m.classList.remove('hit'));
    if (ev.bonus) {
      markCells(ev.bonus.cells);
      msg(`${ev.bonus.label}！${ev.bonus.desc} ＝ ${money(ev.bonus.win)}`);
      await sleep(1500);
    }
    await countUp(ev.total);
    st.best = Math.max(st.best, ev.total);
    pushHistory(ev);
    st.mode = 'win';
    startLineCycle(ev);
    msg(st.auto ? `贏得 ${money(ev.total)}` : `贏得 ${money(ev.total)}！請按得分・或押大／小比倍`);
  }

  // 贏得金額跳上去（不另外出聲，讓中獎音樂乾淨）
  async function countUp(target) {
    const steps = Math.min(30, target);
    for (let k = 1; k <= steps; k++) {
      segWin(Math.round((target * k) / steps) * YUAN);
      await sleep(26);
    }
    st.win = target;
  }

  async function collect() {
    if (st.mode !== 'win') return;
    st.mode = 'collecting';
    clearWinDisplay();
    setDoubleBox(null);
    render();
    // 入金像小瑪莉收分：一開始一分一分慢慢數（叮…叮…叮），越數越快；
    // 速度到頂之後每下多收幾分，大獎也能在約 2 秒內收完。每數一下響一聲投幣聲
    const total = st.win;
    let delay = 120;
    while (st.win > 0) {
      const fast = delay <= COLLECT_MIN_MS;
      const m = Math.min(fast ? Math.max(1, Math.ceil(total / 45)) : 1, st.win);
      st.win -= m;
      st.credit = clampScore(st.credit + m);
      segWin(st.win * YUAN);
      segCredit(st.credit * YUAN);
      Snd.coinTick();
      await sleep(delay);
      delay = Math.max(COLLECT_MIN_MS, delay * 0.86);
    }
    st.mode = 'idle';
    party(false);
    msg(idleMsg());
    render();
    save();
  }

  function collectNow() {
    if (st.mode !== 'win') return;
    st.credit = clampScore(st.credit + st.win);
    st.win = 0;
    st.mode = 'idle';
    clearWinDisplay();
    setDoubleBox(null);
    party(false);
    Snd.coin();
  }

  async function double(guess) {
    if (st.mode !== 'win') {
      if (st.mode === 'idle') errorBeep('中獎後才能比倍');
      return;
    }
    setAuto(false);
    if (st.win * 2 > MAX_SCORE) { errorBeep('得分已達上限・請按得分'); return; }
    st.mode = 'doubling';
    stopLineCycle();
    setDoubleBox(guess);
    clearTimeout(idleMsgTimer);
    msg(`押${guess === 'big' ? '大' : '小'} ${money(st.win)}…開！`);
    render();

    // 小鼓滾奏一路加強，電眼數字越跳越慢，最後一記重擊時開出數字
    const n = C.rollDouble();
    Snd.roll();
    const t0 = performance.now();
    const hit = Snd.rollHitMs;
    while (performance.now() - t0 < hit - 70) {
      segDbl(1 + Math.floor(Math.random() * C.DOUBLE_MAX));
      const prog = (performance.now() - t0) / hit;
      await sleep(Math.min(40 + prog * prog * 230, hit - (performance.now() - t0)));
    }
    const left = hit - (performance.now() - t0);
    if (left > 0) await sleep(left);
    segDbl(n);

    if (C.doubleWins(n, guess)) {
      st.win *= 2;
      st.best = Math.max(st.best, st.win);
      st.mode = 'win';
      Snd.doubleWin();
      msg(`開 ${n}・猜中了！得分加倍 ${money(st.win)}`);
    } else {
      st.win = 0;
      st.mode = 'idle';
      party(false);
      clearWinDisplay();
      Snd.doubleLose();
      msgThenIdle(n === 7 ? '開 7・莊家通殺！' : `開 ${n}・沒猜中…`, 2600);
    }
    render();
    save();
  }

  function stopReel(i) {
    if (st.mode !== 'spinning') return;
    requestStop(i);
  }

  function canAdjust() {
    if (st.auto) { errorBeep('自動中不能改押注'); return false; }
    if (st.mode === 'win') collectNow();
    return st.mode === 'idle';
  }

  function changeLineBet() {
    if (!canAdjust()) return;
    st.lineBet = st.lineBet >= MAX_LINE_BET ? 1 : st.lineBet + 1;
    afterAdjust();
  }
  function changeLines() {
    if (!canAdjust()) return;
    st.lines = st.lines >= LINES.length ? 1 : st.lines + 1;
    afterAdjust();
  }
  function maxBet() {
    if (!canAdjust()) return;
    st.lines = LINES.length;
    st.lineBet = MAX_LINE_BET;
    afterAdjust();
  }
  function afterAdjust() {
    Snd.select();
    flashActiveLines();
    msgThenIdle(`押 ${st.lines} 線 × ${st.lineBet * YUAN} 元 ＝ 總押注 ${money(totalBet())}`, 1800);
    render();
    save();
  }

  function insertCoin() {
    if (st.credit + COIN_VALUE > MAX_SCORE) { errorBeep('分數已滿'); return; }
    st.credit += COIN_VALUE;
    st.coins++;
    Snd.coin();
    if (st.mode === 'idle') msgThenIdle(`投幣 +${money(COIN_VALUE)}`, 1200);
    render();
    save();
  }

  function setAuto(on) {
    st.auto = on;
    clearTimeout(autoTimer);
    render();
  }
  function toggleAuto() {
    setAuto(!st.auto);
    Snd.select();
    if (st.auto) {
      if (st.mode === 'idle' || st.mode === 'win') spin();
    } else if (st.mode === 'idle') {
      msg(idleMsg());
    }
  }
  function scheduleAuto() {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (st.auto && (st.mode === 'idle' || st.mode === 'win')) spin();
    }, st.mode === 'win' ? 900 : 450);
  }

  function toggleMute() {
    Snd.muted = !Snd.muted;
    render();
    save();
  }

  function pushHistory(ev) {
    const desc = ev.bonus ? ev.bonus.label : ev.wins.length > 1 ? `${ev.wins.length} 線中獎` : `第${ev.wins[0].line + 1}線 ${ev.wins[0].label}`;
    st.history.unshift({ d: desc, w: ev.total });
    st.history.length = Math.min(st.history.length, 8);
    renderHistory();
  }
  function renderHistory() {
    $('history').innerHTML = st.history.length
      ? st.history.map((h) => `<li><span>${h.d}</span><b>+${money(h.w)}</b></li>`).join('')
      : '<li class="empty">還沒有中獎紀錄</li>';
  }

  // ---------------- 側欄資訊 ----------------
  function buildInfo() {
    const icons = (list) => list.map((s) => `<img src="${IMG(s)}" alt="">`).join('');
    const rows = Object.entries(SYMBOLS).filter(([, s]) => !s.wild).map(([key, s]) => ({ icons: [key, key, key], name: s.name, mult: `×${s.pay}` }));
    rows.push({ icons: ['bar1', 'bar2', 'bar3'], name: '任意 BAR', mult: `×${C.ANY_BAR_PAY}` });
    rows.push({ icons: ['cherry', 'cherry'], name: '任兩個櫻桃', mult: `×${C.CHERRY2_PAY}` });
    rows.push({ icons: ['cherry', 'orange', 'melon'], name: '全盤水果', mult: `<small>總押注</small>×${C.FULL_FRUIT_PAY}` });
    rows.push({ icons: ['wild'], name: 'WILD 百搭', mult: '<small>當任何圖示</small>' });
    $('paytable').innerHTML = rows
      .map((r) => `<tr><td class="icons">${icons(r.icons)}</td><td class="pname">${r.name}</td><td class="pmult">${r.mult}</td></tr>`)
      .join('');
    $('sevensTable').innerHTML =
      `<div class="st-title">${icons(['seven'])}畫面上 77 的數量<small>× 每線押注</small></div>` +
      `<div class="st-grid">${Object.entries(C.SEVEN_COUNT_PAY).map(([n, pay]) => `<div><b>${n} 個</b><span>×${pay}</span></div>`).join('')}</div>`;

    // 8 條線的小圖
    const dot = (r, c) => [14 + c * 22, 10 + r * 16];
    $('lineThumbs').innerHTML = LINES.map((l, i) => {
      const pts = l.cells.map(([r, c]) => dot(r, c));
      const dots = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const [x, y] = dot(r, c); dots.push(`<circle cx="${x}" cy="${y}" r="3" fill="#5a3a20"/>`); }
      return `<div class="thumb"><svg viewBox="0 0 72 52">${dots.join('')}` +
        `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${LINE_COLORS[i]}" stroke-width="4" stroke-linecap="round"/>` +
        `</svg>${i + 1}・${l.name}</div>`;
    }).join('');
  }

  // ---------------- 待機展示 ----------------
  let idleTimer = 0;
  let attractTimer = 0;
  function startAttract() {
    if (st.mode !== 'idle') { kickIdle(); return; }
    let k = 0;
    attractTimer = setInterval(() => { showLines([k % LINES.length]); k++; }, 420);
  }
  function kickIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(startAttract, 20000);
  }
  function stopAttract() {
    if (attractTimer) {
      clearInterval(attractTimer);
      attractTimer = 0;
      if (st.mode === 'idle') showLines([]);
    }
    kickIdle();
  }

  // ---------------- 按鈕與鍵盤 ----------------
  function pressable(btn, fn) {
    const up = () => btn.classList.remove('pressed');
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      btn.classList.add('pressed');
      fn();
    });
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
  }
  function pressFlash(btn) {
    if (!btn) return;
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 110);
  }

  function wireControls() {
    const actions = {
      btnBig: () => double('big'),
      btnSmall: () => double('small'),
      btnStop0: () => stopReel(0),
      btnStop1: () => stopReel(1),
      btnStop2: () => stopReel(2),
      btnTake: collect,
      btnCoin: insertCoin,
      btnBet: changeLineBet,
      btnLines: changeLines,
      btnMax: maxBet,
      btnAuto: toggleAuto,
      btnSpin: spinOrStop,
      btnMute: toggleMute,
    };
    for (const [id, fn] of Object.entries(actions)) pressable($(id), fn);

    const KEYS = {
      ' ': 'btnSpin', enter: 'btnSpin', '1': 'btnStop0', '2': 'btnStop1', '3': 'btnStop2',
      b: 'btnBig', s: 'btnSmall', t: 'btnTake', c: 'btnCoin', q: 'btnBet', arrowup: 'btnBet',
      w: 'btnLines', arrowright: 'btnLines', e: 'btnMax', a: 'btnAuto', m: 'btnMute',
    };
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const id = KEYS[e.key.toLowerCase()];
      if (!id) return;
      e.preventDefault();
      if (e.repeat) return;
      Snd.unlock();
      stopAttract();
      pressFlash($(id).classList.contains('rb') ? $(id) : null);
      actions[id]();
    });

    // 任何操作都會解鎖音效（瀏覽器規定）並結束待機展示
    document.addEventListener('pointerdown', () => { Snd.unlock(); stopAttract(); }, true);
    window.addEventListener('beforeunload', save);
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  }

  // ---------------- 縮放 ----------------
  function fit() {
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    if (!w || !h) return; // 視窗被隱藏時先不縮放，等 resize 再算
    const sLand = Math.min(w / 1600, h / 1000);
    const sPort = Math.min(w / 900, h / 1170);
    const portrait = sPort > sLand * 1.15;
    document.body.classList.toggle('portrait', portrait);
    document.documentElement.style.setProperty('--s', portrait ? sPort : sLand);
  }

  // ---------------- 開機 ----------------
  async function boot() {
    load();
    Object.keys(SYMBOLS).forEach((s) => { new Image().src = IMG(s); });
    buildReels();
    buildLines();
    buildInfo();
    segWin = makeSeg($('ledWin'), 6);
    segBet = makeSeg($('ledBet'), 3);
    segCredit = makeSeg($('ledCredit'), 6);
    segDbl = makeSeg($('ledDouble'), 2);
    segDbl('');
    wireControls();
    renderHistory();
    fit();
    window.addEventListener('resize', fit);
    render();
    save();
    await waitForAssets();
    msgThenIdle(firstVisit ? `歡迎光臨！開機贈送 ${money(START_CREDIT)}` : '歡迎光臨 水果盤', 2600);
    kickIdle();
  }

  // 等封面上的圖片預載完、所有音效解碼完，才收起封面顯示機台（最多等 20 秒，避免卡在封面）
  async function waitForAssets() {
    const L = window.FruitLoader;
    if (!L) return;
    const total = Object.keys(window.FRUIT_SFX || {}).length;
    const t0 = performance.now();
    await Promise.race([L.images, sleep(20000)]);
    while (Snd.loaded < total && performance.now() - t0 < 20000) {
      L.sounds(Snd.loaded, total);
      await sleep(50);
    }
    L.sounds(total, total);
    await sleep(250);
    L.finish();
  }

  boot();
})();
