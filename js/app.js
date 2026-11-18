/* =========================================================
   NEON ARCADE — 網站主控
   負責：路由、遊戲開啟/關閉、HUD 與覆蓋層、卡片預覽動畫
   ========================================================= */
(function () {
  'use strict';

  const GAMES = {
    brick: {
      title: '霓虹打磚塊',
      sub: 'NEON BREAKOUT',
      ctor: 'NeonBreakout',
      bestKey: 'neon-arcade:best:brick',
      aspect: 960 / 640,
      howto: [
        { keys: ['←', '→'], note: '或拖曳畫面移動擋板' },
        { keys: ['Space'], note: '點擊畫面發射光球' },
        { keys: ['P'], note: '暫停 / 繼續' },
      ],
    },
    snake: {
      title: '霓虹貪食蛇',
      sub: 'NEON SNAKE',
      ctor: 'NeonSnake',
      bestKey: 'neon-arcade:best:snake',
      aspect: 792 / 540,
      howto: [
        { keys: ['↑', '↓', '←', '→'], note: '或滑動畫面轉向' },
        { keys: ['Space'], note: '暫停 / 繼續' },
        { keys: ['Esc'], note: '暫停 / 繼續' },
      ],
    },
  };

  const dom = {
    screen: document.getElementById('gameScreen'),
    shell: document.getElementById('canvasShell'),
    canvas: document.getElementById('gameCanvas'),
    hud: document.getElementById('hud'),
    controls: document.getElementById('gameControls'),
    overlay: document.getElementById('gameOverlay'),
    title: document.getElementById('gameNowTitle'),
    sub: document.getElementById('gameNowSub'),
    pauseBtn: document.getElementById('pauseBtn'),
    backBtn: document.getElementById('backBtn'),
    toast: null,
  };

  let activeGame = null;
  let activeKey = null;
  let overlayType = null;
  let lastFocus = null;
  let hudTimer = null;
  let hudPending = null;

  /* ---------------------------------------------------------
     Helpers
     --------------------------------------------------------- */
  function readBest(key) {
    try {
      return Number(localStorage.getItem(key)) || 0;
    } catch (err) {
      return 0;
    }
  }

  function formatScore(v) {
    return Number(v || 0).toLocaleString('en-US');
  }

  function refreshCardBest() {
    document.querySelectorAll('[data-best]').forEach((el) => {
      const key = el.getAttribute('data-best');
      const game = GAMES[key];
      if (!game) return;
      const v = readBest(game.bestKey);
      el.textContent = v > 0 ? formatScore(v) : '—';
    });
  }

  /* ---------------------------------------------------------
     Toast（畫布內的浮動提示）
     --------------------------------------------------------- */
  function ensureToast() {
    if (dom.toast) return dom.toast;
    const el = document.createElement('div');
    el.className = 'toast';
    dom.shell.appendChild(el);
    dom.toast = el;
    return el;
  }

  let toastTimer = null;
  function toast(text, color) {
    const el = ensureToast();
    el.textContent = text;
    el.style.color = color || '#ffd166';
    el.style.borderColor = (color || '#ffd166') + '80';
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 1500);
  }

  function clearToast() {
    if (dom.toast) {
      dom.toast.classList.remove('is-visible');
      dom.toast.remove();
      dom.toast = null;
    }
  }

  /* ---------------------------------------------------------
     HUD
     --------------------------------------------------------- */
  function chip(label, value, mods) {
    return (
      '<div class="hud-chip' +
      (mods && mods.accent ? ' is-accent' : '') +
      '"><span>' +
      label +
      '</span><strong>' +
      value +
      '</strong></div>'
    );
  }

  function flushHud() {
    if (!hudPending || !dom.hud) return;
    const { key, data } = hudPending;
    hudPending = null;
    hudTimer = null;
    if (key === 'brick') {
      let pips = '';
      for (let i = 0; i < 5; i++) {
        pips += '<i class="life-pip' + (i < data.lives ? '' : ' is-off') + '"></i>';
      }
      dom.hud.innerHTML =
        chip('分數', formatScore(data.score), { accent: true }) +
        chip('最高分', formatScore(data.best)) +
        '<div class="hud-chip is-lives"><span>生命</span><strong>' +
        pips +
        '</strong></div>' +
        chip('關卡', data.level) +
        chip('連擊', 'x' + data.combo);
    } else {
      dom.hud.innerHTML =
        chip('分數', formatScore(data.score), { accent: true }) +
        chip('最高分', formatScore(data.best)) +
        chip('蛇長', data.length) +
        chip('等級', data.level);
    }
  }

  /** HUD 每幀都會回報，這裡做節流避免反覆重繪 DOM */
  function renderHud(key, data) {
    hudPending = { key: key, data: data };
    if (hudTimer) return;
    hudTimer = setTimeout(flushHud, 90);
  }

  /* ---------------------------------------------------------
     Overlay
     --------------------------------------------------------- */
  function buildOverlay(payload) {
    const el = dom.overlay;
    const stats = (payload.stats || [])
      .map(
        (s) =>
          '<div class="' +
          (s.highlight ? 'is-new' : '') +
          '"><span>' +
          s.label +
          '</span><strong>' +
          (typeof s.value === 'number' ? formatScore(s.value) : s.value) +
          '</strong></div>'
      )
      .join('');

    const actions = (payload.actions || [])
      .map(
        (a) =>
          '<button type="button" class="btn ' +
          (a.kind === 'primary' ? 'btn-primary' : 'btn-ghost') +
          '" data-act="' +
          a.act +
          '">' +
          a.label +
          '</button>'
      )
      .join('');

    el.innerHTML =
      '<div class="overlay-inner">' +
      (payload.kicker ? '<p class="overlay-kicker">' + payload.kicker + '</p>' : '') +
      '<h2 class="overlay-title">' +
      payload.title +
      '</h2>' +
      (payload.sub ? '<p class="overlay-sub">' + payload.sub + '</p>' : '') +
      (stats ? '<div class="overlay-stats">' + stats + '</div>' : '') +
      (actions ? '<div class="overlay-actions">' + actions + '</div>' : '') +
      '</div>';
  }

  function showOverlay(payload) {
    if (!payload) {
      dom.overlay.hidden = true;
      dom.overlay.innerHTML = '';
      overlayType = null;
      document.body.classList.remove('has-overlay');
      return;
    }
    overlayType = payload.type;
    buildOverlay(payload);
    dom.overlay.hidden = false;
    const primary = dom.overlay.querySelector('.btn-primary');
    if (primary) setTimeout(() => primary.focus({ preventScroll: true }), 60);
  }

  function startOverlay(key) {
    const g = GAMES[key];
    const isTouch = window.matchMedia('(hover: none)').matches;
    showOverlay({
      type: 'start',
      kicker: 'READY PLAYER ONE',
      title: g.title,
      sub:
        key === 'brick'
          ? '接住光球、擊碎霓虹磚牆。連續擊破可累積連擊加成。'
          : '吃掉光點讓蛇身成長，撞到牆壁或自己就會結束。小心愈來愈快！',
      actions: [
        { label: '開始遊戲', kind: 'primary', act: 'start' },
        { label: '返回選單', kind: 'ghost', act: 'menu' },
      ],
      hint: isTouch,
    });
  }

  /* ---------------------------------------------------------
     Controls
     --------------------------------------------------------- */
  function bindHold(el, onDown, onUp) {
    const down = (e) => {
      e.preventDefault();
      el.classList.add('is-pressed');
      onDown();
    };
    const up = (e) => {
      if (e) e.preventDefault();
      el.classList.remove('is-pressed');
      onUp();
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      down(e);
    });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => {
      if (el.classList.contains('is-pressed')) up(e);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const showTouchControls = hasCoarsePointer || hasTouch || window.matchMedia('(hover: none)').matches;

  function renderControls(key) {
    if (!dom.controls) return;
    if (!showTouchControls) {
      // 桌機有鍵盤，隱藏螢幕按鍵讓畫面更大（仍可用鍵盤操作）
      dom.controls.innerHTML = '';
      dom.controls.setAttribute('data-hidden', 'true');
      return;
    }
    dom.controls.removeAttribute('data-hidden');
    if (key === 'brick') {
      dom.controls.innerHTML =
        '<button type="button" class="ctrl-btn" data-ctrl="left" aria-label="向左移動">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>' +
        '</button>' +
        '<button type="button" class="ctrl-btn ctrl-fire" data-ctrl="launch">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>' +
        '發射</button>' +
        '<button type="button" class="ctrl-btn" data-ctrl="right" aria-label="向右移動">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>' +
        '</button>';

      const left = dom.controls.querySelector('[data-ctrl="left"]');
      const right = dom.controls.querySelector('[data-ctrl="right"]');
      const fire = dom.controls.querySelector('[data-ctrl="launch"]');
      bindHold(
        left,
        () => activeGame && activeGame.setTouchDir(-1),
        () => activeGame && activeGame.setTouchDir(0)
      );
      bindHold(
        right,
        () => activeGame && activeGame.setTouchDir(1),
        () => activeGame && activeGame.setTouchDir(0)
      );
      fire.addEventListener('click', (e) => {
        e.preventDefault();
        if (activeGame) activeGame.launch();
      });
    } else if (key === 'snake') {
      dom.controls.innerHTML =
        '<div class="dpad" role="group" aria-label="方向控制">' +
        '<button type="button" class="ctrl-btn up" data-dir="up" aria-label="向上"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15l7-7 7 7"/></svg></button>' +
        '<button type="button" class="ctrl-btn left" data-dir="left" aria-label="向左"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>' +
        '<button type="button" class="ctrl-btn down" data-dir="down" aria-label="向下"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9l7 7 7-7"/></svg></button>' +
        '<button type="button" class="ctrl-btn right" data-dir="right" aria-label="向右"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>' +
        '</div>';

      dom.controls.querySelectorAll('[data-dir]').forEach((btn) => {
        const dir = btn.getAttribute('data-dir');
        const fire = (e) => {
          e.preventDefault();
          btn.classList.add('is-pressed');
          setTimeout(() => btn.classList.remove('is-pressed'), 130);
          if (activeGame) activeGame.turn(dir);
        };
        btn.addEventListener('pointerdown', fire);
        btn.addEventListener('click', fire);
      });
    }
  }

  /* ---------------------------------------------------------
     Sizing
     --------------------------------------------------------- */
  function fitCanvas() {
    if (!activeKey) return;
    const stage = document.getElementById('stage');
    const body = document.querySelector('.game-body');
    if (!stage || !body) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width < 40) return;

    // 用 game-body 的可用高度回推，比量 stage 更可靠
    // （stage 會隨內容縮放，量它容易得到被裁切的數字）
    const bodyStyle = getComputedStyle(body);
    const bodyRect = body.getBoundingClientRect();
    const isRow = bodyStyle.flexDirection === 'row';
    const hud = dom.hud ? dom.hud.getBoundingClientRect() : null;
    const controls = dom.controls ? dom.controls.getBoundingClientRect() : null;
    const gap = parseFloat(bodyStyle.rowGap || bodyStyle.gap) || 10;
    const padY = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
    const padX = parseFloat(bodyStyle.paddingLeft) + parseFloat(bodyStyle.paddingRight);

    const pad = 8;
    let availW;
    let availH;
    if (isRow) {
      availW = Math.max(120, bodyRect.width - padX - (hud ? hud.width : 0) - (controls ? controls.width : 0) - gap * 2 - pad);
      availH = Math.max(120, bodyRect.height - padY - pad);
    } else {
      availW = Math.max(120, bodyRect.width - padX - pad);
      availH = Math.max(120, bodyRect.height - padY - (hud ? hud.height : 0) - (controls ? controls.height : 0) - gap * 2 - pad);
    }

    const aspect = getAspect();
    let w = availW;
    let h = w / aspect;
    if (h > availH) {
      h = availH;
      w = h * aspect;
    }
    // 用四捨五入後的整數尺寸，並讓 canvas 的 CSS 尺寸等於實際像素尺寸，
    // 這樣邏輯解析度才會和版面一致，不會出現拉伸模糊。
    dom.shell.style.width = Math.round(w) + 'px';
    dom.shell.style.height = Math.round(h) + 'px';
    if (activeGame) {
      activeGame.resize();
      syncCanvasCssSize();
    }
  }

  /**
   * 依目前可用空間挑選最適合的邏輯比例。
   * 直向手機打磚塊使用直式棋盤（7x9），橫向使用 3:2。
   */
  function getAspect() {
    const body = document.querySelector('.game-body');
    if (!body) return GAMES[activeKey].aspect;
    const rect = body.getBoundingClientRect();
    const isPortrait = rect.height / rect.width > 0.95;
    const g = GAMES[activeKey];
    if (activeKey === 'brick') return isPortrait ? 440 / 680 : 960 / 640;
    if (activeKey === 'snake') return isPortrait ? 480 / 760 : 792 / 540;
    return g.aspect;
  }

  /** canvas 以 100% 填滿 shell；backing store 依 DPR 放大，維持高解析不模糊 */
  function syncCanvasCssSize() {
    const c = dom.canvas;
    if (!c) return;
    c.style.width = '100%';
    c.style.height = '100%';
  }

  /* ---------------------------------------------------------
     Open / close
     --------------------------------------------------------- */
  function openGame(key) {
    const g = GAMES[key];
    if (!g) return;
    const Ctor = window[g.ctor];
    if (!Ctor) return;

    if (activeGame) closeGame(false);

    lastFocus = document.activeElement;
    activeKey = key;
    dom.screen.setAttribute('data-game', key);
    dom.title.textContent = g.title;
    dom.sub.textContent = g.sub;
    dom.screen.classList.add('is-open');
    dom.screen.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-playing');
    dom.pauseBtn.disabled = true;
    dom.pauseBtn.textContent = '暫停';

    renderControls(key);

    const isFirst = !window.__neonGameKey || window.__neonGameKey !== key;
    if (isFirst) window.__neonGameKey = key;

    fitCanvas();

    activeGame = new Ctor(dom.canvas, {
      onHud: (data) => renderHud(key, data),
      onOverlay: (payload) => {
        if (payload && payload.type === 'over') {
          dom.pauseBtn.disabled = true;
          dom.pauseBtn.textContent = '暫停';
        }
        if (payload && payload.type === 'paused') {
          dom.pauseBtn.disabled = false;
          dom.pauseBtn.textContent = '繼續';
        }
        showOverlay(payload);
      },
      onToast: (text, color) => toast(text, color),
    });

    activeGame.resize();
    syncCanvasCssSize();
    startOverlay(key);

    // 控制列剛插入時尺寸可能還沒算好，下一幀再修正一次
    requestAnimationFrame(() => {
      if (activeKey === key) fitCanvas();
    });
    dom.backBtn.focus({ preventScroll: true });
    dom.screen.scrollTop = 0;

    if (window.NeonSFX) NeonSFX.play('click');
  }

  function closeGame(updateHash) {
    if (!activeKey) return;
    if (activeGame) {
      activeGame.destroy();
      activeGame = null;
    }
    clearToast();
    showOverlay(null);
    dom.screen.classList.remove('is-open');
    dom.screen.setAttribute('aria-hidden', 'true');
    dom.hud.innerHTML = '';
    dom.controls.innerHTML = '';
    dom.pauseBtn.disabled = true;
    dom.pauseBtn.textContent = '暫停';
    document.body.classList.remove('is-playing');
    dom.canvas.width = 1;
    dom.canvas.height = 1;
    dom.shell.style.width = '';
    dom.shell.style.height = '';
    activeKey = null;
    hudPending = null;
    if (hudTimer) {
      clearTimeout(hudTimer);
      hudTimer = null;
    }
    refreshCardBest();
    if (updateHash !== false && location.hash.indexOf('#/play/') === 0) {
      history.replaceState(null, '', location.pathname + location.search + '#games');
      requestAnimationFrame(() => {
        const target = document.getElementById('games');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------
     Route
     --------------------------------------------------------- */
  function handleRoute() {
    const h = location.hash || '';
    const m = h.match(/^#\/play\/(brick|snake)$/);
    if (m) {
      const key = m[1];
      if (key === activeKey) return;
      openGame(key);
    } else if (activeKey) {
      closeGame(false);
    }
  }

  /* ---------------------------------------------------------
     Overlay actions & global keys
     --------------------------------------------------------- */
  function onOverlayClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || !activeGame) return;
    const act = btn.getAttribute('data-act');
    if (window.NeonSFX) NeonSFX.play('click');

    if (act === 'start') {
      activeGame.start();
      dom.pauseBtn.disabled = false;
      dom.pauseBtn.textContent = '暫停';
    } else if (act === 'restart') {
      activeGame.restart();
      dom.pauseBtn.disabled = false;
      dom.pauseBtn.textContent = '暫停';
    } else if (act === 'resume') {
      activeGame.resume();
      dom.pauseBtn.disabled = false;
      dom.pauseBtn.textContent = '暫停';
    } else if (act === 'next') {
      activeGame.nextLevel();
      dom.pauseBtn.disabled = false;
      dom.pauseBtn.textContent = '暫停';
    } else if (act === 'menu') {
      closeGame();
    }
  }

  function togglePause() {
    if (!activeGame) return;
    if (overlayType === 'paused') {
      activeGame.resume();
      dom.pauseBtn.textContent = '暫停';
    } else if (overlayType === null) {
      activeGame.togglePause();
      dom.pauseBtn.textContent = '繼續';
    }
  }

  document.addEventListener('keydown', (e) => {
    if (!activeKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      togglePause();
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      closeGame();
    }
  });

  dom.overlay.addEventListener('click', onOverlayClick);
  dom.screen.addEventListener('click', (e) => {
    if (e.target === dom.screen) closeGame();
  });
  dom.backBtn.addEventListener('click', () => {
    if (window.NeonSFX) NeonSFX.play('click');
    closeGame();
  });
  dom.pauseBtn.addEventListener('click', () => {
    if (window.NeonSFX) NeonSFX.play('click');
    togglePause();
  });

  /* 圖示在 overlay 中放錯了按鈕，補上不會有多餘問題 */
  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('resize', () => {
    if (activeKey) fitCanvas();
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      if (activeKey) fitCanvas();
    }, 240);
  });

  /* 分頁切換時自動暫停 */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && activeGame && activeGame.state === 'playing') {
      activeGame.pause();
      dom.pauseBtn.textContent = '繼續';
    }
  });

  /* ---------------------------------------------------------
     卡片互動
     --------------------------------------------------------- */
  const cards = document.querySelectorAll('.game-card[data-game]');
  cards.forEach((card) => {
    const key = card.getAttribute('data-game');
    const go = () => {
      if (window.NeonSFX) {
        NeonSFX.unlock();
        NeonSFX.play('start');
      }
      location.hash = '#/play/' + key;
    };
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((e.clientX - r.left) / r.width) * 100 + '%');
      card.style.setProperty('--my', ((e.clientY - r.top) / r.height) * 100 + '%');
    });
  });

  /* ---------------------------------------------------------
     音效開關
     --------------------------------------------------------- */
  function syncSoundButtons() {
    const muted = window.NeonSFX ? NeonSFX.isMuted() : false;
    document.querySelectorAll('.sound-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
      btn.setAttribute('aria-label', muted ? '開啟音效' : '關閉音效');
    });
  }

  document.querySelectorAll('.sound-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (window.NeonSFX) {
        NeonSFX.unlock();
        NeonSFX.toggle();
      }
    });
  });
  document.addEventListener('sfxchange', syncSoundButtons);
  syncSoundButtons();

  document.addEventListener(
    'pointerdown',
    () => {
      if (window.NeonSFX) NeonSFX.unlock();
    },
    { once: true }
  );

  /* ---------------------------------------------------------
     卡片預覽動畫
     --------------------------------------------------------- */
  function initPreviews() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const items = [];

    document.querySelectorAll('canvas[data-preview]').forEach((canvas) => {
      const type = canvas.getAttribute('data-preview');
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      const state = {
        type: type,
        ctx: ctx,
        w: w,
        h: h,
        visible: true,
        t: 0,
        ball: { x: w * 0.35, y: h * 0.55, vx: 190, vy: -170, r: 7 },
        paddleX: w * 0.3,
        snake: null,
      };

      if (type === 'snake') {
        const pts = [];
        const inset = 26;
        const pad = 46;
        const rects = [
          [inset, inset, w - inset * 2, h - inset * 2],
        ];
        // 圓角矩形路徑（以分段點近似）
        function pathPoint(t) {
          const r = rects[0];
          const per = 2 * (r[2] + r[3]);
          let d = ((t % 1) + 1) % 1 * per;
          const x0 = r[0];
          const y0 = r[1];
          if (d < r[2]) return { x: x0 + d, y: y0 };
          d -= r[2];
          if (d < r[3]) return { x: x0 + r[2], y: y0 + d };
          d -= r[3];
          if (d < r[2]) return { x: x0 + r[2] - d, y: y0 + r[3] };
          d -= r[2];
          return { x: x0, y: y0 + r[3] - d };
        }
        state.pathPoint = pathPoint;
        state.head = 0;
        state.segs = 30;
        state.spacing = 0.0055;
        state.food = { x: w * 0.5, y: h * 0.5 };
        pts.length = 0;
        state.trailPts = pts;
        state.pad = pad;
      }

      items.push(state);
      canvas.__preview = state;
    });

    if (!items.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const st = entry.target.__preview;
          if (st) st.visible = entry.isIntersecting;
        });
      },
      { threshold: 0.05 }
    );
    document.querySelectorAll('canvas[data-preview]').forEach((c) => io.observe(c));

    let last = performance.now();

    function drawBrick(st) {
      const ctx = st.ctx;
      const w = st.w;
      const h = st.h;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#070b16');
      g.addColorStop(1, '#04060d');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(57,230,255,.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < w; x += 36) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
      }
      for (let y = 0; y < h; y += 36) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
      }
      ctx.stroke();

      const colors = ['#39e6ff', '#4fdcff', '#a78bfa', '#ff5fb4', '#ffd166'];
      const cols = 9;
      const rows = 4;
      const bw = (w - 88) / cols;
      const gap = 6;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = 44 + c * bw + gap / 2;
          const y = 48 + r * 26;
          ctx.save();
          ctx.shadowColor = colors[r];
          ctx.shadowBlur = 10;
          const bg = ctx.createLinearGradient(0, y, 0, y + 16);
          bg.addColorStop(0, 'rgba(255,255,255,.4)');
          bg.addColorStop(0.3, colors[r]);
          bg.addColorStop(1, 'rgba(6,8,18,.9)');
          ctx.fillStyle = bg;
          const bx = x;
          const by = y;
          const bwidth = bw - gap;
          const bheight = 16;
          const rr = 4;
          ctx.beginPath();
          ctx.moveTo(bx + rr, by);
          ctx.arcTo(bx + bwidth, by, bx + bwidth, by + bheight, rr);
          ctx.arcTo(bx + bwidth, by + bheight, bx, by + bheight, rr);
          ctx.arcTo(bx, by + bheight, bx, by, rr);
          ctx.arcTo(bx, by, bx + bwidth, by, rr);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      const ball = st.ball;
      st.paddleX += (ball.x - st.paddleX - 0.5) * Math.min(1, st.dt * 6);
      const paddleW = 96;
      const px = Math.max(8, Math.min(w - paddleW - 8, st.paddleX - paddleW / 2 + 30));
      const py = h - 34;

      // 球尾
      for (let i = 1; i <= 4; i++) {
        ctx.save();
        ctx.globalAlpha = 0.22 * (1 - i / 5);
        ctx.fillStyle = i % 2 ? '#39e6ff' : '#ff8ecb';
        ctx.beginPath();
        ctx.arc(ball.x - ball.vx * 0.006 * i, ball.y - ball.vy * 0.006 * i, ball.r * (1 - i / 7), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#eafcff';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.shadowColor = '#39e6ff';
      ctx.shadowBlur = 18;
      const pg = ctx.createLinearGradient(px, py, px + paddleW, py);
      pg.addColorStop(0, '#ff3fa4');
      pg.addColorStop(0.5, '#b3f4ff');
      pg.addColorStop(1, '#39e6ff');
      ctx.fillStyle = pg;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(px, py, paddleW, 10, 5);
      } else {
        ctx.rect(px, py, paddleW, 10);
      }
      ctx.fill();
      ctx.restore();
    }

    function drawSnake(st) {
      const ctx = st.ctx;
      const w = st.w;
      const h = st.h;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#070d10');
      g.addColorStop(1, '#050810');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(184,255,74,.055)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < w; x += 32) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
      }
      for (let y = 0; y < h; y += 32) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
      }
      ctx.stroke();

      // 食物
      const fx = st.food.x;
      const fy = st.food.y;
      const pulse = 1 + Math.sin(st.t * 3) * 0.14;
      ctx.save();
      ctx.shadowColor = '#ff3fa4';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ff3fa4';
      ctx.beginPath();
      ctx.arc(fx, fy, 7 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const pts = [];
      const spacing = st.spacing;
      for (let i = 0; i < st.segs; i++) {
        const p = st.pathPoint(st.head - i * spacing);
        pts.push(p);
      }

      // 身體
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = pts.length - 1; i >= 1; i--) {
        const t = i / (pts.length - 1);
        ctx.shadowColor = 'rgba(57,230,255,.8)';
        ctx.shadowBlur = 12;
        ctx.fillStyle = 'hsl(' + (165 + t * 38) + ', 100%, ' + (60 - t * 14) + '%)';
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, 9 - t * 4.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // 頭
      ctx.shadowColor = '#b8ff4a';
      ctx.shadowBlur = 22;
      ctx.fillStyle = '#e6ffb8';
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 眼
      const a = Math.atan2(
        st.pathPoint(st.head + 0.004).y - pts[0].y,
        st.pathPoint(st.head + 0.004).x - pts[0].x
      );
      ctx.fillStyle = '#04121a';
      for (let s = -1; s <= 1; s += 2) {
        ctx.beginPath();
        ctx.arc(
          pts[0].x + Math.cos(a) * 5 - Math.sin(a) * 4.6 * s,
          pts[0].y + Math.sin(a) * 5 + Math.cos(a) * 4.6 * s,
          2.1,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }

    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      for (let i = 0; i < items.length; i++) {
        const st = items[i];
        if (!st.visible) continue;
        st.dt = dt;
        st.t += dt;

        if (st.type === 'brick') {
          const ball = st.ball;
          ball.x += ball.vx * dt;
          ball.y += ball.vy * dt;
          if (ball.x < ball.r + 4) {
            ball.x = ball.r + 4;
            ball.vx = Math.abs(ball.vx);
          }
          if (ball.x > st.w - ball.r - 4) {
            ball.x = st.w - ball.r - 4;
            ball.vx = -Math.abs(ball.vx);
          }
          if (ball.y < ball.r + 30) {
            ball.y = ball.r + 30;
            ball.vy = Math.abs(ball.vy);
          }
          if (ball.y > st.h - 50) {
            ball.y = st.h - 50;
            ball.vy = -Math.abs(ball.vy);
          }
          drawBrick(st);
        } else {
          st.head += dt * 0.055;
          drawSnake(st);
        }
      }
      raf = requestAnimationFrame(frame);
    }

    let raf = null;
    if (reduce) {
      // 只畫一張靜態圖
      items.forEach((st) => {
        st.dt = 0;
        if (st.type === 'brick') {
          st.paddleX = st.ball.x;
          drawBrick(st);
        } else {
          drawSnake(st);
        }
      });
    } else {
      raf = requestAnimationFrame(frame);
      window.addEventListener('pagehide', () => {
        if (raf) cancelAnimationFrame(raf);
      });
    }
  }

  /* ---------------------------------------------------------
     依裝置能力自動調整畫質（低階手機也能順跑）
     --------------------------------------------------------- */
  const PIXEL_BUDGET = 2.4e6; // 約 2.4 百萬像素，超過就降 DPR
  const device = {
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    lowPower: false,
  };

  (function probe() {
    // 以核心數與記憶體粗估效能，據此決定是否降低解析度
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    const area = window.innerWidth * window.innerHeight * device.dpr * device.dpr;
    if (area > PIXEL_BUDGET || cores <= 4 || mem <= 4) {
      device.dpr = Math.min(device.dpr, 1.5);
    }
    if (area > PIXEL_BUDGET * 1.8) device.lowPower = true;
  })();

  window.NeonQuality = device;

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */
  refreshCardBest();
  initPreviews();
  handleRoute();

  // 首屏卡片進場
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-inview');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    document.querySelectorAll('.game-card, .control-panel, .feature').forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll('.game-card, .control-panel, .feature').forEach((el) => el.classList.add('is-inview'));
  }

  // 對外提供除錯用
  window.NeonArcade = {
    open: (key) => {
      location.hash = '#/play/' + key;
    },
    close: () => closeGame(),
    get game() {
      return activeGame;
    },
  };
})();
