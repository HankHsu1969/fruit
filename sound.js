/* 水果盤 — 機台音效：播放 HeyGen 音效庫的取樣（sfx/sounds.js 內嵌 base64），用 Web Audio 混音；
   入金的金幣聲是即時 FM 合成（仿小瑪莉收分的「鏘」）。 */
(function (root) {
  'use strict';

  // 各音效的相對音量（依實測平均響度配平：連續音偏小聲、短促的按鍵聲不壓）
  const GAIN = {
    coin: 1, button: 1, spin: 0.68, reelstop: 1, win: 0.85, medium: 0.95, bigwin: 1,
    roll: 1, doublewin: 1, doublelose: 0.98, jackpot: 1, error: 0.57,
  };
  const ROLL_HIT_MS = 2270; // roll.mp3（小鼓滾奏）最後一記重擊的時間點，比倍開數字對準它
  const MASTER = 0.9;

  const buffers = {};
  const loops = {};
  let ctx = null;
  let master = null;
  let muted = false;
  let noiseBuf = null;

  // 先用 OfflineAudioContext 解碼（不受瀏覽器「需先互動才能出聲」的限制），AudioBuffer 之後可直接給正式的 context 播
  function decodeAll() {
    const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    const data = root.FRUIT_SFX;
    if (!OAC || !data) return;
    const dec = new OAC(1, 1, 44100);
    for (const [name, b64] of Object.entries(data)) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      dec.decodeAudioData(bytes.buffer).then((buf) => { buffers[name] = buf; }, () => { /* 單一音效壞掉就略過 */ });
    }
  }

  function unlock() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function play(name, { rate = 1, vol = 1, at = 0, loop = false } = {}) {
    if (!ctx || !buffers[name]) return null;
    const src = ctx.createBufferSource();
    src.buffer = buffers[name];
    src.playbackRate.value = rate;
    src.loop = loop;
    const g = ctx.createGain();
    g.gain.value = (GAIN[name] ?? 0.8) * vol;
    src.connect(g);
    g.connect(master);
    src.start(ctx.currentTime + at);
    return { src, g };
  }

  // FM 合成的短金屬鈴：小瑪莉收分時一枚一枚的「鏘」
  function bell(f, t, dur, vol) {
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    const g = ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * 3.01;
    mg.gain.setValueAtTime(f * 1.1, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.02 + 1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    mod.connect(mg).connect(car.frequency);
    car.connect(g).connect(master);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.02);
    mod.stop(t + dur + 0.02);
  }

  // 硬幣碰到的極短高頻「嚓」
  function click(t, vol) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate / 4, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    src.connect(hp).connect(g).connect(master);
    src.start(t, Math.random() * 0.2);
    src.stop(t + 0.02);
  }

  const COIN_NOTES = [2093, 2349, 2637, 2794, 3136]; // C7 D7 E7 F7 G7

  function loopStart(name) {
    if (loops[name]) return;
    const h = play(name, { loop: true });
    if (h) loops[name] = h;
  }
  function loopStop(name, fade = 0.08) {
    const h = loops[name];
    if (!h) return;
    delete loops[name];
    const t = ctx.currentTime;
    h.g.gain.setTargetAtTime(0, t, fade / 3);
    h.src.stop(t + fade);
  }

  const Sound = {
    unlock,
    get loaded() { return Object.keys(buffers).length; }, // 已解碼的音效數
    get muted() { return muted; },
    set muted(v) {
      muted = !!v;
      if (master) master.gain.value = muted ? 0 : MASTER;
    },

    coin() { play('coin'); },
    select() { play('button'); },
    error() { play('error'); },

    spinStart() { play('button', { rate: 1.15 }); loopStart('spin'); },
    spinEnd() { loopStop('spin', 0.15); },
    reelStop(i) { play('reelstop', { rate: 1 - i * 0.06 }); },

    // tier：small = 贏回不到總押注、medium = 總押注 1–3 倍、big = 3 倍以上
    win(tier) { play({ small: 'win', medium: 'medium', big: 'bigwin' }[tier] || 'win'); },
    jackpot() { play('jackpot'); play('bigwin', { at: 0.4, vol: 0.8 }); },
    // 入金：每數一下響一聲短短的金幣「鏘」（0.08 秒，音高在 C7–G7 間隨機）
    coinTick() {
      if (!ctx) return;
      const t = ctx.currentTime + 0.003;
      bell(COIN_NOTES[Math.floor(Math.random() * COIN_NOTES.length)], t, 0.08, 0.17);
      click(t, 0.07);
    },

    rollHitMs: ROLL_HIT_MS,
    roll() { play('roll'); },
    doubleWin() { play('doublewin'); },
    doubleLose() { play('doublelose'); },
  };

  decodeAll();
  root.FruitSound = Sound;
})(window);
