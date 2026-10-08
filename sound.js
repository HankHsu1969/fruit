/* 水果盤 — 機台音效：播放 HeyGen 音效庫的取樣（sfx/sounds.js 內嵌 base64），用 Web Audio 混音。 */
(function (root) {
  'use strict';

  // 各音效的相對音量（依實測平均響度配平：連續音偏小聲、短促的按鍵聲不壓）
  const GAIN = {
    coin: 1, button: 1, spin: 0.68, reelstop: 1, win: 0.85, medium: 0.95, bigwin: 1,
    roll: 1, doublewin: 1, doublelose: 0.98, jackpot: 1, fullfruit: 1, error: 0.57,
  };
  const ROLL_HIT_MS = 2270; // roll.mp3（小鼓滾奏）最後一記重擊的時間點，比倍開數字對準它
  const MASTER = 0.9;

  const buffers = {};
  const loops = {};
  let ctx = null;
  let master = null;
  let muted = false;
  let lastTick = null;

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

  let fanfare = null;
  function stopFanfare(fade = 0.6) {
    if (!fanfare || !ctx) return;
    const h = fanfare, t = ctx.currentTime;
    fanfare = null;
    if (fade > 0) h.g.gain.setTargetAtTime(0, t, fade / 3);
    h.src.stop(t + fade + 0.01);
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

    spinStart() { stopFanfare(); play('button', { rate: 1.15 }); loopStart('spin'); },
    spinEnd() { loopStop('spin', 0.15); },
    reelStop(i) { play('reelstop', { rate: 1 - i * 0.06 }); },

    // tier：small = 贏回不到總押注、medium = 總押注 1–3 倍、big = 3 倍以上
    win(tier) { play({ small: 'win', medium: 'medium', big: 'bigwin' }[tier] || 'win'); },
    jackpot() { play('jackpot'); play('bigwin', { at: 0.4, vol: 0.8 }); },
    // 全盤水果專屬：約 10 秒的電子賭場 Jackpot 音樂（開頭疊中獎鈴聲、硬幣灑落和歡呼）。
    // 下一局開轉或開始比倍時淡出，不會跟轉輪聲、鼓聲疊在一起
    fullFruit() { stopFanfare(0); fanfare = play('fullfruit'); },
    stopFanfare: (fade) => stopFanfare(fade),
    // 入金：每數一下都播一次跟投幣一樣的聲音（硬幣落下＋加分提示）。
    // 像實體機台一樣同時只有一聲——下一聲響時先把上一聲收掉，數得很快也不會糊成一團；
    // 最後一下會完整播完，收尾聽得到加分提示
    coinTick() {
      if (!ctx) return;
      if (lastTick) {
        const t = ctx.currentTime;
        lastTick.g.gain.setTargetAtTime(0, t, 0.0015);
        lastTick.src.stop(t + 0.006);
      }
      lastTick = play('coin');
    },

    rollHitMs: ROLL_HIT_MS,
    roll() { stopFanfare(0.3); play('roll'); },
    doubleWin() { play('doublewin'); },
    doubleLose() { play('doublelose'); },
  };

  decodeAll();
  root.FruitSound = Sound;
})(window);
