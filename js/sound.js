/* =========================================================
   NeonSFX — 以 Web Audio API 即時合成的 8-bit 霓虹音效
   不需要任何音訊檔案，第一次互動時才建立 AudioContext。
   ========================================================= */
(function () {
  'use strict';

  const STORAGE_KEY = 'neon-arcade:muted';

  let ctx = null;
  let master = null;
  let muted = false;

  try {
    muted = localStorage.getItem(STORAGE_KEY) === '1';
  } catch (err) {
    muted = false;
  }

  function ensureContext() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(function () {});
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;

    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    return ctx;
  }

  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  /**
   * 單一音粒：oscillator + gain envelope
   */
  function tone(opts) {
    if (!ensureContext() || muted) return;
    const {
      type = 'square',
      freq = 440,
      to = null,
      start = 0,
      dur = 0.12,
      vol = 0.2,
      attack = 0.006,
      release = null,
      detune = 0,
    } = opts;

    const t0 = now() + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    }
    if (detune) osc.detune.setValueAtTime(detune, t0);

    const rel = release === null ? dur : release;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(attack + 0.01, rel));

    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + Math.max(rel, dur) + 0.05);
  }

  /**
   * 短促噪音：用於撞擊、爆炸
   */
  function noise(opts) {
    if (!ensureContext() || muted) return;
    const { dur = 0.12, vol = 0.16, start = 0, filter = 1400, q = 0.8, type = 'lowpass' } = opts || {};
    const t0 = now() + start;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const biquad = ctx.createBiquadFilter();
    biquad.type = type;
    biquad.frequency.setValueAtTime(filter, t0);
    biquad.Q.value = q;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(biquad);
    biquad.connect(gain);
    gain.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const sounds = {
    click: function () {
      tone({ type: 'triangle', freq: 720, to: 1120, dur: 0.07, vol: 0.13 });
    },
    start: function () {
      tone({ type: 'square', freq: 392, dur: 0.1, vol: 0.12 });
      tone({ type: 'square', freq: 523, dur: 0.1, vol: 0.12, start: 0.09 });
      tone({ type: 'square', freq: 784, dur: 0.2, vol: 0.13, start: 0.18 });
    },
    paddle: function () {
      tone({ type: 'triangle', freq: 300, to: 480, dur: 0.07, vol: 0.17 });
    },
    wall: function () {
      tone({ type: 'triangle', freq: 220, to: 180, dur: 0.055, vol: 0.11 });
    },
    brick: function (combo) {
      const step = Math.min(combo || 0, 7);
      const scale = [523, 587, 659, 784, 880, 1047, 1175, 1319];
      tone({ type: 'square', freq: scale[step], dur: 0.075, vol: 0.1 });
      noise({ dur: 0.05, vol: 0.05, filter: 3200, type: 'highpass' });
    },
    hardBrick: function () {
      tone({ type: 'square', freq: 180, to: 120, dur: 0.09, vol: 0.12 });
      noise({ dur: 0.08, vol: 0.07, filter: 900 });
    },
    loseLife: function () {
      tone({ type: 'sawtooth', freq: 320, to: 90, dur: 0.5, vol: 0.14 });
      noise({ dur: 0.4, vol: 0.1, filter: 700 });
    },
    levelClear: function () {
      [659, 784, 988, 1319].forEach(function (f, i) {
        tone({ type: 'triangle', freq: f, dur: 0.16, vol: 0.13, start: i * 0.09 });
      });
    },
    gameOver: function () {
      [440, 349, 262].forEach(function (f, i) {
        tone({ type: 'sawtooth', freq: f, dur: 0.26, vol: 0.11, start: i * 0.16 });
      });
      noise({ dur: 0.5, vol: 0.08, filter: 500, start: 0.1 });
    },
    eat: function () {
      tone({ type: 'square', freq: 660, to: 990, dur: 0.08, vol: 0.13 });
      tone({ type: 'sine', freq: 1320, dur: 0.09, vol: 0.07, start: 0.05 });
    },
    bonus: function () {
      [880, 1108, 1319, 1760].forEach(function (f, i) {
        tone({ type: 'triangle', freq: f, dur: 0.1, vol: 0.11, start: i * 0.055 });
      });
    },
    crash: function () {
      tone({ type: 'sawtooth', freq: 260, to: 60, dur: 0.55, vol: 0.15 });
      noise({ dur: 0.45, vol: 0.14, filter: 1200 });
    },
    turn: function () {
      tone({ type: 'sine', freq: 900, dur: 0.035, vol: 0.045 });
    },
    pause: function () {
      tone({ type: 'triangle', freq: 520, to: 320, dur: 0.12, vol: 0.1 });
    },
    resume: function () {
      tone({ type: 'triangle', freq: 320, to: 520, dur: 0.12, vol: 0.1 });
    },
    record: function () {
      [784, 988, 1319, 1568].forEach(function (f, i) {
        tone({ type: 'square', freq: f, dur: 0.14, vol: 0.1, start: i * 0.1 });
      });
    },
  };

  window.NeonSFX = {
    play: function (name, arg) {
      if (muted) return;
      const fn = sounds[name];
      if (fn) {
        try {
          fn(arg);
        } catch (err) {
          /* 忽略音效錯誤，不影響遊戲 */
        }
      }
    },
    unlock: function () {
      ensureContext();
    },
    toggle: function () {
      muted = !muted;
      try {
        localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
      } catch (err) {}
      if (master && ctx) {
        master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
      }
      if (!muted) {
        ensureContext();
        sounds.click();
      }
      document.dispatchEvent(new CustomEvent('sfxchange', { detail: { muted: muted } }));
      return muted;
    },
    isMuted: function () {
      return muted;
    },
  };
})();
