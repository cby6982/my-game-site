/* =========================================================
   霓虹貪食蛇 — Neon Snake
   網格邏輯 + 平滑插值渲染；支援鍵盤、滑動、螢幕方向鍵
   ========================================================= */
(function () {
  'use strict';

  // 邏輯座標系：直式手機用 12x20 的直立盤面，其餘用 22x15 的橫式盤面
  const BOARD_LANDSCAPE = { W: 792, H: 540, COLS: 22, ROWS: 15 };
  const BOARD_PORTRAIT = { W: 480, H: 760, COLS: 12, ROWS: 19 };
  let W = BOARD_LANDSCAPE.W;
  let H = BOARD_LANDSCAPE.H;
  let COLS = BOARD_LANDSCAPE.COLS;
  let ROWS = BOARD_LANDSCAPE.ROWS;
  let CELL = W / COLS;

  const START_INTERVAL = 134;
  const MIN_INTERVAL = 68;
  const GROWTH_FOOD = 2;
  const GROWTH_GOLD = 3;
  const SCORE_FOOD = 10;
  const SCORE_GOLD = 35;

  const STORAGE_KEY = 'neon-arcade:best:snake';

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function randInt(a, b) {
    return Math.floor(a + Math.random() * (b - a + 1));
  }

  function readBest() {
    try {
      return Number(localStorage.getItem(STORAGE_KEY)) || 0;
    } catch (err) {
      return 0;
    }
  }

  function writeBest(v) {
    try {
      localStorage.setItem(STORAGE_KEY, String(v));
    } catch (err) {}
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  class Snake {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts || {};
      this.state = 'idle';
      this.best = readBest();
      this.score = 0;
      this.foodsEaten = 0;
      this.level = 1;
      this.dpr = 1;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.raf = null;
      this.lastTime = 0;
      this.acc = 0;
      this.time = 0;
      this.hintTime = 9;
      this.particles = [];
      this.ripples = [];
      this.dir = DIRS.right;
      this.queue = [];
      this.pendingGrowth = 0;
      this.snake = [];
      this.render = [];
      this._prevBoard = null;
      this.food = null;
      this.gold = null;
      this.speedBoost = 0;

      this._onWindowResize = () => {
        this.resize();
        if (this.state === 'idle') this.renderStatic();
      };

      this._bindEvents();
      this.resize();
      this.ro = new ResizeObserver(() => {
        this.resize();
        if (this.state === 'idle') this.renderStatic();
      });
      this.ro.observe(canvas.parentElement);
      window.addEventListener('resize', this._onWindowResize);

      this._demoSnake();
      this.renderStatic();
      this.emitHud();
    }

    /** 依容器比例切換盤面，直向手機也能把畫面填滿 */
    _applyLayout() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const isPortrait = rect.width > 0 && rect.height / rect.width > 0.95;
      const conf = isPortrait ? BOARD_PORTRAIT : BOARD_LANDSCAPE;
      if (this.board === conf) return;
      this.board = conf;
      W = conf.W;
      H = conf.H;
      COLS = conf.COLS;
      ROWS = conf.ROWS;
      CELL = W / COLS;
      this.aspect = W / H;
      if (this.snake.length) {
        // 只在遊戲進行中換盤面時才需要搬移座標；把蛇按比例縮放到新盤面，
        // 不要重設，否則玩家一旋轉手機就被迫重來。
        const playing = this.state === 'playing' || this.state === 'paused';
        if (playing && this._prevBoard) {
          const sx = conf.COLS / this._prevBoard.COLS;
          const sy = conf.ROWS / this._prevBoard.ROWS;
          this.snake = this.snake.map((p) => ({
            x: clamp(Math.round(p.x * sx), 0, conf.COLS - 1),
            y: clamp(Math.round(p.y * sy), 0, conf.ROWS - 1),
          }));
          this.render = this._points(this.snake);
          if (this.food) this.food = { x: clamp(Math.round(this.food.x * sx), 0, conf.COLS - 1), y: clamp(Math.round(this.food.y * sy), 0, conf.ROWS - 1) };
          if (this.gold) this.gold = { x: clamp(Math.round(this.gold.x * sx), 0, conf.COLS - 1), y: clamp(Math.round(this.gold.y * sy), 0, conf.ROWS - 1), life: this.gold.life, maxLife: this.gold.maxLife };
        } else if (!playing) {
          this._demoSnake();
          this.render = this._points(this.snake);
          this._placeFood();
          this.gold = null;
        }
      }
      this._prevBoard = conf;
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      this._applyLayout();
      const dpr = (window.NeonQuality && window.NeonQuality.dpr) || Math.min(window.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      const pw = Math.round(rect.width * dpr);
      const ph = Math.round(rect.height * dpr);
      if (this.canvas.width !== pw || this.canvas.height !== ph) {
        this.canvas.width = pw;
        this.canvas.height = ph;
        if (this.state === 'playing' || this.state === 'paused') this.draw();
        else this.renderStatic();
      }
      this.scale = Math.min(pw / W, ph / H);
      this.offsetX = (pw - W * this.scale) / 2;
      this.offsetY = (ph - H * this.scale) / 2;
    }

    /* ---------- lifecycle ---------- */
    _demoSnake() {
      // snake[0] 是尾巴，最後一個元素是蛇頭；由左往右推入才有足夠前進空間
      // 起點置中，四周都有空間，玩家有足夠反應時間
      this.snake = [];
      const midY = Math.floor(ROWS / 2);
      const headX = Math.floor(COLS / 2);
      for (let i = 0; i < 7; i++) this.snake.push({ x: headX - 6 + i, y: midY });
      this.render = this.snake.map((s) => ({ x: s.x, y: s.y }));
      this.dir = DIRS.right;
      this.queue = [];
      this.pendingGrowth = 0;
    }

    start() {
      this._stopLoop();
      this.state = 'playing';
      this.score = 0;
      this.foodsEaten = 0;
      this.level = 1;
      this.gold = null;
      this.speedBoost = 0;
      this.particles = [];
      this.ripples = [];
      this._demoSnake();
      this._placeFood();
      this.acc = 0;
      this.hintTime = 0;
      this.lastTime = performance.now();
      this.emitHud();
      this.emitOverlay(null);
      this._run();
      if (window.NeonSFX) NeonSFX.play('start');
    }

    restart() {
      this.start();
    }

    /**
     * 主迴圈：畫面交給 rAF，時間推進則同時由計時器保底，
     * 這樣 rAF 被節流時蛇也不會凍住。
     */
    _run() {
      this._stopLoop();
      const frame = (t) => {
        if (this.state !== 'playing') return;
        this._advance(t);
        this.draw();
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);

      // 保底：rAF 被節流時，用自己的時間戳推進，蛇才不會凍住
      this.tickTime = performance.now();
      this.timer = setInterval(() => {
        if (this.state !== 'playing') return;
        const now = performance.now();
        const dt = Math.min((now - this.tickTime) / 1000, 0.1);
        if (dt <= 0.004) return;
        this.tickTime = now;
        this.update(dt);
        this.draw();
      }, 34);
    }

    _advance(t) {
      const dt = Math.min((t - this.lastTime) / 1000, 0.1);
      if (dt <= 0) return;
      this.lastTime = t;
      this.update(dt);
    }

    _stopLoop() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    }

    pause() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      this._stopLoop();
      this.emitOverlay({
        type: 'paused',
        title: '已暫停',
        sub: '蛇在等你回來，別讓牠等太久。',
        actions: [
          { label: '繼續遊戲', kind: 'primary', act: 'resume' },
          { label: '重新開始', kind: 'ghost', act: 'restart' },
        ],
      });
      if (window.NeonSFX) NeonSFX.play('pause');
    }

    resume() {
      if (this.state !== 'paused') return;
      this.state = 'playing';
      this.lastTime = performance.now();
      this.acc = 0;
      this.emitOverlay(null);
      this._run();
      if (window.NeonSFX) NeonSFX.play('resume');
    }

    togglePause() {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }

    destroy() {
      this._stopLoop();
      this.state = 'idle';
      if (this.ro) this.ro.disconnect();
      window.removeEventListener('resize', this._onWindowResize);
      this._unbindEvents();
    }

    /* ---------- input ---------- */
    _bindEvents() {
      this._onKeyDown = (e) => {
        if (this.state !== 'playing') return;
        const k = e.key;
        let handled = true;
        if (k === 'ArrowUp' || k === 'w' || k === 'W') this.turn('up');
        else if (k === 'ArrowDown' || k === 's' || k === 'S') this.turn('down');
        else if (k === 'ArrowLeft' || k === 'a' || k === 'A') this.turn('left');
        else if (k === 'ArrowRight' || k === 'd' || k === 'D') this.turn('right');
        else handled = false;
        if (handled) e.preventDefault();
      };
      window.addEventListener('keydown', this._onKeyDown);

      const surface = this.canvas;
      let startX = 0;
      let startY = 0;
      let tracking = false;

      this._onPointerDown = (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        tracking = true;
        startX = e.clientX;
        startY = e.clientY;
      };
      this._onPointerMove = (e) => {
        if (!tracking || this.state !== 'playing') return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const threshold = Math.max(16, Math.min(48, surface.getBoundingClientRect().width * 0.06));
        if (Math.hypot(dx, dy) < threshold) return;
        if (Math.abs(dx) > Math.abs(dy)) this.turn(dx > 0 ? 'right' : 'left');
        else this.turn(dy > 0 ? 'down' : 'up');
        startX = e.clientX;
        startY = e.clientY;
      };
      this._onPointerUp = () => {
        tracking = false;
      };
      this._onContext = (e) => e.preventDefault();

      surface.addEventListener('pointerdown', this._onPointerDown);
      surface.addEventListener('pointermove', this._onPointerMove);
      surface.addEventListener('pointerup', this._onPointerUp);
      surface.addEventListener('pointercancel', this._onPointerUp);
      surface.addEventListener('contextmenu', this._onContext);
    }

    _unbindEvents() {
      window.removeEventListener('keydown', this._onKeyDown);
      const surface = this.canvas;
      surface.removeEventListener('pointerdown', this._onPointerDown);
      surface.removeEventListener('pointermove', this._onPointerMove);
      surface.removeEventListener('pointerup', this._onPointerUp);
      surface.removeEventListener('pointercancel', this._onPointerUp);
      surface.removeEventListener('contextmenu', this._onContext);
    }

    turn(name) {
      if (this.state !== 'playing') return;
      const nd = DIRS[name];
      if (!nd) return;
      const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
      if (last.x + nd.x === 0 && last.y + nd.y === 0) return; // 不能 180 度反轉
      if (last.x === nd.x && last.y === nd.y) return;
      if (this.queue.length < 2) {
        this.queue.push(nd);
        if (window.NeonSFX) NeonSFX.play('turn');
      }
    }

    /* ---------- logic ---------- */
    _interval() {
      const base = START_INTERVAL - this.foodsEaten * 2.4 - (this.level - 1) * 4 - this.speedBoost * 3;
      return clamp(base, MIN_INTERVAL, START_INTERVAL);
    }

    _occupied(x, y) {
      for (let i = 0; i < this.snake.length; i++) {
        if (this.snake[i].x === x && this.snake[i].y === y) return true;
      }
      if (this.food && this.food.x === x && this.food.y === y) return true;
      if (this.gold && this.gold.x === x && this.gold.y === y) return true;
      return false;
    }

    _randomFreeCell() {
      for (let attempt = 0; attempt < 500; attempt++) {
        const x = randInt(1, COLS - 2);
        const y = randInt(1, ROWS - 2);
        if (!this._occupied(x, y)) return { x: x, y: y };
      }
      return null;
    }

    _placeFood() {
      const cell = this._randomFreeCell();
      this.food = cell ? { x: cell.x, y: cell.y } : null;
    }

    _placeGold() {
      const cell = this._randomFreeCell();
      if (!cell) return;
      this.gold = { x: cell.x, y: cell.y, life: 8, maxLife: 8 };
      if (this.opts.onToast) this.opts.onToast('金色光點出現！+35', '#ffd166');
    }

    update(dt) {
      this.time += dt;
      this.hintTime += dt;

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.life -= dt;
        if (p.life <= 0) this.particles.splice(i, 1);
      }
      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const r = this.ripples[i];
        r.t += dt;
        if (r.t > 0.6) this.ripples.splice(i, 1);
      }

      if (this.gold) {
        this.gold.life -= dt;
        if (this.gold.life <= 0) this.gold = null;
      }

      // 平滑渲染位置往邏輯格靠攏
      const k = 1 - Math.exp(-dt / 0.038);
      for (let i = 0; i < this.render.length && i < this.snake.length; i++) {
        this.render[i].x += (this.snake[i].x - this.render[i].x) * k;
        this.render[i].y += (this.snake[i].y - this.render[i].y) * k;
      }

      // 步伐（方向在 _step() 內消費，確保每一步都用最新排入的方向）
      this.acc += dt * 1000;
      const interval = this._interval();
      let guard = 0;
      while (this.acc >= interval && guard < 4 && this.state === 'playing') {
        this.acc -= interval;
        this._step();
        guard++;
      }
      if (this.state !== 'playing') return;

      this.emitHud();
    }

    _step() {
      if (this.state !== 'playing') return;
      // 每個步伐先套用一個排入的方向，讓轉向一定不會被吃掉
      if (this.queue.length) this.dir = this.queue.shift();
      const head = this.snake[this.snake.length - 1];
      const nx = head.x + this.dir.x;
      const ny = head.y + this.dir.y;

      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) {
        this._crash(nx, ny);
        return;
      }

      const eatFood = !!(this.food && nx === this.food.x && ny === this.food.y);
      const eatGold = !!(this.gold && nx === this.gold.x && ny === this.gold.y);
      const willGrow = eatFood || eatGold;
      const tailLocked = this.pendingGrowth > 0 || willGrow;
      const limit = tailLocked ? this.snake.length : this.snake.length - 1;

      for (let i = 0; i < limit; i++) {
        if (this.snake[i].x === nx && this.snake[i].y === ny) {
          this._crash(nx, ny);
          return;
        }
      }

      const prevHeadRender = this.render.length
        ? { x: this.render[this.render.length - 1].x, y: this.render[this.render.length - 1].y }
        : { x: head.x, y: head.y };

      this.snake.push({ x: nx, y: ny });
      this.render.push(prevHeadRender);

      if (eatGold) {
        this.score += SCORE_GOLD;
        this.foodsEaten += 1;
        this.speedBoost += 2;
        this.pendingGrowth += GROWTH_GOLD;
        this._burst(nx, ny, '#ffd166', 26);
        this.ripples.push({ x: nx, y: ny, t: 0, color: '255,209,102' });
        this.gold = null;
        if (this.opts.onToast) this.opts.onToast('+' + SCORE_GOLD + ' 金色獎勵', '#ffd166');
        if (window.NeonSFX) NeonSFX.play('bonus');
      }

      if (eatFood) {
        this.score += SCORE_FOOD;
        this.foodsEaten += 1;
        this.pendingGrowth += GROWTH_FOOD;
        const lvl = Math.floor(this.foodsEaten / 5) + 1;
        if (lvl !== this.level) {
          this.level = lvl;
          if (this.opts.onToast) this.opts.onToast('速度提升 LV.' + lvl, '#b8ff4a');
        }
        this._burst(nx, ny, '#b8ff4a', 18);
        this.ripples.push({ x: nx, y: ny, t: 0, color: '184,255,74' });
        if (window.NeonSFX) NeonSFX.play('eat');
        this._placeFood();
        if (this.foodsEaten % 5 === 0 && !this.gold) this._placeGold();
      }

      if (this.pendingGrowth > 0) {
        this.pendingGrowth -= 1;
      } else {
        this.snake.shift();
        this.render.shift();
      }
    }

    _crash(nx, ny) {
      this.state = 'over';
      this._stopLoop();
      const cx = clamp(nx, 0, COLS - 1);
      const cy = clamp(ny, 0, ROWS - 1);
      this._burst(cx, cy, '#ff3fa4', 44);
      this.ripples.push({ x: cx, y: cy, t: 0, color: '255,63,164' });
      if (window.NeonSFX) NeonSFX.play('crash');

      const isRecord = this.score > this.best;
      if (isRecord) {
        this.best = this.score;
        writeBest(this.best);
      }
      this.draw();
      this.emitHud();
      this.emitOverlay({
        type: 'over',
        kicker: 'GAME OVER',
        title: isRecord ? '新紀錄！' : '撞到啦',
        sub: isRecord
          ? '刷新個人最佳成績 ' + this.score + ' 分，下一局挑戰更長的蛇。'
          : '本局拿到 ' + this.score + ' 分。再來一局，手感會更好。',
        stats: [
          { label: '本局分數', value: this.score },
          { label: '最高分', value: this.best, highlight: isRecord },
          { label: '蛇身長度', value: this.snake.length },
        ],
        actions: [
          { label: '再玩一次', kind: 'primary', act: 'restart' },
          { label: '返回選單', kind: 'ghost', act: 'menu' },
        ],
      });
      if (isRecord) {
        setTimeout(() => {
          if (window.NeonSFX) NeonSFX.play('record');
        }, 420);
      }
    }

    _burst(cx, cy, color, count) {
      const x = (cx + 0.5) * CELL;
      const y = (cy + 0.5) * CELL;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 40 + Math.random() * 250;
        this.particles.push({
          x: x,
          y: y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          life: 0.32 + Math.random() * 0.5,
          maxLife: 0.82,
          r: 1.4 + Math.random() * 2.8,
          color: color,
        });
      }
    }

    /* ---------- rendering ---------- */
    _paintBg(ctx) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#070d10');
      g.addColorStop(0.5, '#060a10');
      g.addColorStop(1, '#050810');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = 'rgba(184,255,74,.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= COLS; x++) {
        ctx.moveTo(x * CELL + 0.5, 0);
        ctx.lineTo(x * CELL + 0.5, H);
      }
      for (let y = 0; y <= ROWS; y++) {
        ctx.moveTo(0, y * CELL + 0.5);
        ctx.lineTo(W, y * CELL + 0.5);
      }
      ctx.stroke();

      const g1 = ctx.createRadialGradient(W * 0.2, H * 0.08, 20, W * 0.2, H * 0.08, 500);
      g1.addColorStop(0, 'rgba(57,230,255,.12)');
      g1.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, W, H);

      const g2 = ctx.createRadialGradient(W * 0.86, H * 0.92, 20, W * 0.86, H * 0.92, 440);
      g2.addColorStop(0, 'rgba(184,255,74,.1)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, W, H);

      // 邊框貼齊遊戲格線範圍，避免和 canvas 圓角對不齊
      ctx.strokeStyle = 'rgba(184,255,74,.24)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, W - 2, H - 2);
      ctx.restore();
    }

    _drawFood(ctx, food, isGold) {
      const cx = (food.x + 0.5) * CELL;
      const cy = (food.y + 0.5) * CELL;
      const pulse = 1 + Math.sin(this.time * 3) * 0.12;
      const r = CELL * 0.27 * pulse;
      const color = isGold ? '#ffd166' : '#ff3fa4';

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = isGold ? 30 : 22;
      ctx.fillStyle = color;

      if (isGold) {
        const spikes = 4;
        ctx.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
          const a = (i * Math.PI) / spikes - Math.PI / 2;
          const rr = i % 2 === 0 ? r * 1.35 : r * 0.55;
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath();
      ctx.arc(cx - r * 0.28, cy - r * 0.3, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (isGold && food.maxLife) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,209,102,.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(
          cx,
          cy,
          CELL * 0.46,
          -Math.PI / 2,
          -Math.PI / 2 + (Math.max(0, food.life) / food.maxLife) * Math.PI * 2
        );
        ctx.stroke();
        ctx.restore();
      }
    }

    _drawSnake(ctx, pts) {
      if (!pts.length) return;
      const n = pts.length;
      const head = pts[n - 1];

      // 身體：由尾到頭漸層
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < n - 1; i++) {
        const t = i / Math.max(1, n - 2);
        const r = CELL * (0.4 - t * 0.14);
        const hue = 172 + t * 26;
        const light = 58 - t * 12;
        ctx.shadowColor = t > 0.72 ? 'rgba(184,255,74,.9)' : 'rgba(57,230,255,.8)';
        ctx.shadowBlur = t > 0.72 ? 24 : 14;
        ctx.fillStyle = 'hsl(' + hue + ', 100%, ' + light + '%)';
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // 連接
      for (let i = 0; i < n - 1; i++) {
        const t = i / Math.max(1, n - 1);
        ctx.strokeStyle = 'hsl(' + (172 + t * 26) + ', 100%, ' + (54 - t * 12) + '%)';
        ctx.lineWidth = CELL * (0.55 - t * 0.2);
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
        ctx.stroke();
      }
      ctx.restore();

      // 頭
      let ang = Math.atan2(this.dir.y, this.dir.x);
      if (n >= 2) {
        const dx = head.x - pts[n - 2].x;
        const dy = head.y - pts[n - 2].y;
        if (Math.hypot(dx, dy) > 0.4) ang = Math.atan2(dy, dx);
      }

      ctx.save();
      ctx.translate(head.x, head.y);
      ctx.rotate(ang);
      ctx.shadowColor = '#b8ff4a';
      ctx.shadowBlur = 28;
      const hg = ctx.createLinearGradient(-CELL * 0.42, 0, CELL * 0.42, 0);
      hg.addColorStop(0, '#28d8c4');
      hg.addColorStop(1, '#ecffc4');
      ctx.fillStyle = hg;
      roundRect(ctx, -CELL * 0.42, -CELL * 0.38, CELL * 0.84, CELL * 0.76, CELL * 0.32);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#04121a';
      ctx.beginPath();
      ctx.arc(CELL * 0.15, -CELL * 0.15, CELL * 0.085, 0, Math.PI * 2);
      ctx.arc(CELL * 0.15, CELL * 0.15, CELL * 0.085, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.beginPath();
      ctx.arc(CELL * 0.18, -CELL * 0.17, CELL * 0.032, 0, Math.PI * 2);
      ctx.arc(CELL * 0.18, CELL * 0.13, CELL * 0.032, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _drawParticles(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        const a = Math.max(0, p.life / p.maxLife);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.4 + a * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < this.ripples.length; i++) {
        const r = this.ripples[i];
        const pp = clamp(r.t / 0.6, 0, 1);
        ctx.globalAlpha = 1 - pp;
        ctx.strokeStyle = 'rgba(' + r.color + ',' + (1 - pp).toFixed(3) + ')';
        ctx.lineWidth = 3 * (1 - pp) + 0.5;
        ctx.beginPath();
        ctx.arc((r.x + 0.5) * CELL, (r.y + 0.5) * CELL, CELL * (0.3 + pp * 1.6), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    _points(arr) {
      return arr.map((p) => ({ x: (p.x + 0.5) * CELL, y: (p.y + 0.5) * CELL }));
    }

    renderStatic() {
      const ctx = this.ctx;
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#050810';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
      this._paintBg(ctx);
      this._drawSnake(ctx, this._points(this.snake));
      this._drawFood(ctx, { x: 18, y: 5 }, false);
      this._drawFood(ctx, { x: 21, y: 14 }, true);
    }

    draw() {
      const ctx = this.ctx;
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#050810';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);

      this._paintBg(ctx);
      if (this.food) this._drawFood(ctx, this.food, false);
      if (this.gold) this._drawFood(ctx, this.gold, true);

      const pts = [];
      for (let i = 0; i < this.render.length; i++) {
        const r = this.render[i];
        pts.push({ x: (r.x + 0.5) * CELL, y: (r.y + 0.5) * CELL });
      }
      this._drawSnake(ctx, pts);
      this._drawParticles(ctx);

      // 開場提示：告訴玩家怎麼轉向
      if (this.state === 'playing' && this.hintTime < 3.6) {
        const a = this.hintTime < 2.6 ? 1 : 1 - (this.hintTime - 2.6);
        ctx.save();
        ctx.globalAlpha = Math.max(0, a) * 0.9;
        ctx.fillStyle = 'rgba(6,10,16,.72)';
        roundRect(ctx, W / 2 - 168, H - 74, 336, 46, 14);
        ctx.fill();
        ctx.fillStyle = '#d8ffce';
        ctx.font = '600 15px "Space Grotesk", "Noto Sans TC", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = window.matchMedia('(pointer: coarse)').matches ? '滑動畫面或點方向鍵轉向' : '用方向鍵或 WASD 轉向';
        ctx.fillText(label, W / 2, H - 51);
        ctx.restore();
      }

      if (this.gold && this.gold.life < 2.4) {
        ctx.save();
        ctx.globalAlpha = 0.4 + Math.sin(this.time * 9) * 0.3;
        ctx.strokeStyle = 'rgba(255,209,102,.45)';
        ctx.lineWidth = 3;
        roundRect(ctx, 3, 3, W - 6, H - 6, 15);
        ctx.stroke();
        ctx.restore();
      }
    }

    emitHud() {
      if (this.opts.onHud) {
        this.opts.onHud({
          score: this.score,
          best: this.best,
          length: this.snake.length,
          level: this.level,
        });
      }
    }

    emitOverlay(payload) {
      if (this.opts.onOverlay) this.opts.onOverlay(payload);
    }
  }

  window.NeonSnake = Snake;
})();
