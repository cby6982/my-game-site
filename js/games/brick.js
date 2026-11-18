/* =========================================================
   霓虹打磚塊 — Neon Breakout
   純 Canvas 實作：霓虹光暈、粒子、連擊、強化道具、關卡遞增
   ========================================================= */
(function () {
  'use strict';

  // 邏輯座標系。桌機維持 3:2，直向手機改為 9:14，讓畫面填滿可用空間。
  const LANDSCAPE = { W: 960, H: 640, COLS: 11, ROWS: 6, GAP_TOP: 76 };
  const PORTRAIT = { W: 440, H: 680, COLS: 7, ROWS: 9, GAP_TOP: 64 };

  const PADDLE_H = 15;
  const PADDLE_SPEED = 860;

    const BASE_SPEED = 540;
  const MAX_SPEED = 1080;

  const COLORS = ['#39e6ff', '#4fdcff', '#a78bfa', '#ff5fb4', '#ffd166', '#b8ff4a'];

  const POWER_TYPES = {
    wide: { label: '加寬', color: '#39e6ff', duration: 12, glyph: '↔' },
    multi: { label: '三顆球', color: '#ff3fa4', duration: 0, glyph: '3' },
    slow: { label: '慢速', color: '#a78bfa', duration: 9, glyph: 'S' },
    life: { label: '加命', color: '#b8ff4a', duration: 0, glyph: '♥' },
  };

  const STORAGE_KEY = 'neon-arcade:best:brick';

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
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

  class Breakout {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts || {};

      this.state = 'idle'; // idle | ready | playing | paused | levelclear | over
      this.best = readBest();
      this.score = 0;
      this.lives = 3;
      this.level = 1;
      this.combo = 0;
      this.bestCombo = 0;
      this.keyDir = 0;
      this.touchDir = 0;
      this.pointerX = null;
      this.pointerActive = false;

      this.paddle = { x: 0, y: 0, w: 100, h: PADDLE_H, targetW: 100 };
      this.layout = null;
      this._applyLayout();
      this.balls = [];
      this.bricks = [];
      this.particles = [];
      this.powerups = [];
      this.trail = [];
      this.effects = { wide: 0, slow: 0 };
      this.shake = 0;
      this.launched = false;
      this.time = 0;
      this.dpr = 1;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.raf = null;
      this.lastTime = 0;
      this.sprites = {};
      this.hintTime = 0;

      this._bindEvents();
      this.resize();
      this._observeResize();
      this.renderStatic();
      this.emitHud();
    }

    /* ---------- layout ---------- */
    /** 依容器比例決定直式或橫式棋盤，並重算所有幾何常數 */
    _applyLayout() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const ratio = rect.width > 0 ? rect.height / rect.width : 0.67;
      const conf = ratio > 0.95 ? PORTRAIT : LANDSCAPE;
      if (this.layout === conf) return;

      this.layout = conf;
      this.W = conf.W;
      this.H = conf.H;
      this.COLS = conf.COLS;
      this.ROWS = conf.ROWS;
      this.aspect = conf.W / conf.H;

      this.GAP_X = 8;
      this.GAP_Y = 9;
      this.BW = (conf.W - 72 - (conf.COLS - 1) * this.GAP_X) / conf.COLS;
      this.BH = Math.max(20, Math.min(30, (conf.H * 0.36) / conf.ROWS - this.GAP_Y));
      this.GRID_LEFT = (conf.W - (conf.COLS * this.BW + (conf.COLS - 1) * this.GAP_X)) / 2;
      this.GRID_TOP = conf.GAP_TOP;

      this.PADDLE_BASE_W = Math.min(conf.W * 0.3, 160);
      this.PADDLE_Y = conf.H - 58;
      this.BALL_R = Math.max(8, conf.W / 96);

      this.paddle.y = this.PADDLE_Y;
      this.paddle.w = this.PADDLE_BASE_W;
      this.paddle.x = (conf.W - this.paddle.w) / 2;
      this.sprites = {};
      this.particles = [];
      this.powerups = [];
      this.trail = [];
      this._bg = null;
      this._wall = null;
      this._wallDirty = true;
    }

    /* ---------- lifecycle ---------- */
    _observeResize() {
      this.ro = new ResizeObserver(() => {
        this.resize();
        if (this.state === 'ready' || this.state === 'idle') this.renderStatic();
      });
      this.ro.observe(this.canvas.parentElement);
      window.addEventListener('resize', this._onWindowResize);
    }

    _onWindowResize() {
      this.resize();
      if (this.state === 'ready' || this.state === 'idle') this.renderStatic();
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      // 容器比例改變時切換棋盤方向（用比例判斷，直向手機才會用直式棋盤）
      const wantPortrait = rect.height / rect.width > 0.95;
      if (wantPortrait !== (this.layout === PORTRAIT)) {
        this._applyLayout();
        if (this.state === 'idle' || this.state === 'ready') this.renderStatic();
      }
      const dpr = (window.NeonQuality && window.NeonQuality.dpr) || Math.min(window.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      const pw = Math.round(rect.width * dpr);
      const ph = Math.round(rect.height * dpr);
      if (this.canvas.width !== pw || this.canvas.height !== ph) {
        this.canvas.width = pw;
        this.canvas.height = ph;
        // 改變 backing store 會清空畫面，需要補畫
        if (this.state === 'playing' || this.state === 'paused') {
          this.draw();
        } else {
          this.renderStatic();
        }
      }
      this.scale = Math.min(pw / this.W, ph / this.H);
      this.offsetX = (pw - this.W * this.scale) / 2;
      this.offsetY = (ph - this.H * this.scale) / 2;
    }

    /* ---------- state ---------- */
    start() {
      this.score = 0;
      this.lives = 3;
      this.level = 1;
      this.combo = 0;
      this.bestCombo = 0;
      this.effects = { wide: 0, slow: 0 };
      this.particles = [];
      this.powerups = [];
      this._buildLevel(1);
      this._resetBall(true);
      this.state = 'playing';
      this.lastTime = performance.now();
      this._loop();
      this.emitHud();
      this.emitOverlay(null);
    }

    restart() {
      this._stopLoop();
      this.start();
    }

    nextLevel() {
      this.level += 1;
      this.combo = 0;
      this.powerups = [];
      this._buildLevel(this.level);
      this._resetBall(true);
      this.state = 'playing';
      this.lastTime = performance.now();
      this._loop();
      this.emitHud();
      this.emitOverlay(null);
    }

    pause() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      this._stopLoop();
      this.emitOverlay({
        type: 'paused',
        title: '已暫停',
        sub: '喘口氣，霓虹不會跑掉。',
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
      this._loop();
      this.emitOverlay(null);
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

    /* ---------- level setup ---------- */
    _buildLevel(level) {
      this.bricks = [];
      this.balls = [];
      this.trail = [];
      this.launched = false;
      const hardRow = level >= 2 ? 0 : -1; // 第二關起最上排需要兩次
      for (let r = 0; r < this.ROWS; r++) {
        for (let c = 0; c < this.COLS; c++) {
          // 越後面的關卡挖空越多，做出圖樣
          if (level >= 3) {
            const hole = (r + c + level) % 7 === 0 || (r === 2 && (c + level) % 5 === 0);
            if (hole) continue;
          }
          const hp = r === hardRow ? 2 : r === hardRow + 1 && level >= 4 && c % 3 === 0 ? 2 : 1;
          this.bricks.push({
            x: this.GRID_LEFT + c * (this.BW + this.GAP_X),
            y: this.GRID_TOP + r * (this.BH + this.GAP_Y),
            w: this.BW,
            h: this.BH,
            hp: hp,
            maxHp: hp,
            color: COLORS[r % COLORS.length],
            row: r,
            col: c,
            flash: 0,
          });
        }
      }
      this.paddle.w = this.PADDLE_BASE_W;
      this.paddle.x = (this.W - this.paddle.w) / 2;
      this._wallDirty = true;
    }

    _resetBall(track) {
      const ball = {
        x: this.paddle.x + this.paddle.w / 2,
        y: this.paddle.y - this.BALL_R - 1,
        vx: 0,
        vy: 0,
        r: this.BALL_R,
        stuck: true,
        speed: this._ballSpeed(),
      };
      this.balls = [ball];
      this.launched = false;
      this.combo = 0;
      if (!track) this.emitHud();
    }

    _ballSpeed() {
      return clamp(BASE_SPEED + (this.level - 1) * 34, BASE_SPEED, MAX_SPEED);
    }

    /* ---------- input ---------- */
    _bindEvents() {
      this._onKeyDown = (e) => {
        if (this.state !== 'playing') return;
        const k = e.key;
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
          this.keyDir = -1;
          e.preventDefault();
        } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
          this.keyDir = 1;
          e.preventDefault();
        } else if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
          this.launch();
          e.preventDefault();
        } else if (k === 'p' || k === 'P' || k === 'Escape' || k === 'Esc') {
          // Esc 由主控處理暫停；P 交給這裡，避免和發射鍵衝突
          if (k === 'p' || k === 'P') {
            this.togglePause();
            e.preventDefault();
          }
        }
      };
      this._onKeyUp = (e) => {
        const k = e.key;
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
          if (this.keyDir === -1) this.keyDir = 0;
        } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
          if (this.keyDir === 1) this.keyDir = 0;
        }
      };
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);

      // 事件綁在 canvas 本身（覆蓋層在上層，按鈕才點得到）
      const surface = this.canvas;
      this._onPointerDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        this.pointerActive = true;
        this.pointerX = this._toWorldX(e.clientX);
        this._nudgeToPointer();
        if (this.state === 'playing' && !this.launched) this.launch();
        surface.setPointerCapture && surface.setPointerCapture(e.pointerId);
        e.preventDefault();
      };
      this._onPointerMove = (e) => {
        if (!this.pointerActive) return;
        // 桌機滑鼠只追蹤拖曳；觸控 / 手寫筆可直接移動
        if (e.pointerType === 'mouse' && e.buttons === 0) return;
        this.pointerX = this._toWorldX(e.clientX);
        this._nudgeToPointer();
        e.preventDefault();
      };
      this._onPointerUp = () => {
        this.pointerActive = false;
        this.pointerX = null;
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
      window.removeEventListener('keyup', this._onKeyUp);
      const surface = this.canvas;
      surface.removeEventListener('pointerdown', this._onPointerDown);
      surface.removeEventListener('pointermove', this._onPointerMove);
      surface.removeEventListener('pointerup', this._onPointerUp);
      surface.removeEventListener('pointercancel', this._onPointerUp);
      surface.removeEventListener('contextmenu', this._onContext);
    }

    _toWorldX(clientX) {
      const rect = this.canvas.getBoundingClientRect();
      const px = (clientX - rect.left) * (this.canvas.width / rect.width);
      return clamp((px - this.offsetX) / this.scale, 0, this.W);
    }

    _nudgeToPointer() {
      if (this.pointerX == null) return;
      this.paddle.x = clamp(this.pointerX - this.paddle.w / 2, 0, this.W - this.paddle.w);
    }

    setTouchDir(dir) {
      this.touchDir = dir;
    }

    launch() {
      if (this.state !== 'playing') return;
      if (this.launched) return;
      const ball = this.balls[0];
      if (!ball) return;
      const angle = rand(-38, 38) * (Math.PI / 180);
      const speed = ball.speed;
      ball.vx = Math.sin(angle) * speed;
      ball.vy = -Math.cos(angle) * speed;
      ball.stuck = false;
      this.launched = true;
      if (window.NeonSFX) NeonSFX.play('paddle');
    }

    /* ---------- loop ---------- */
    /**
     * 遊戲主迴圈。
     * 以固定時間累加器推進模擬，畫面則交給 requestAnimationFrame；
     * 若瀏覽器把 rAF 節流（省電模式、背景分頁、低階裝置），
     * 計時器仍會把時間累加起來，確保球不會停住。
     */
    _loop() {
      this._stopLoop();
      this.lastTime = performance.now();
      this.frameCount = 0;
      this.renderEvery = 1; // 效能不足時會自動降幀

      const frame = (t) => {
        if (this.state !== 'playing') return;
        this.currentFrame = (this.currentFrame || 0) + 1;
        this._advance(t);
        // 低效能裝置降到每 2~3 幀畫一次，遊戲速度不受影響
        if (this.currentFrame % this.renderEvery === 0) this.draw();
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);

      // 保底：rAF 被瀏覽器節流（省電、低階裝置、背景分頁）時，
      // 計時器用「自己的時間戳」推進模擬，確保球一定會動。
      this.tickTime = performance.now();
      this.timer = setInterval(() => {
        if (this.state !== 'playing') return;
        const now = performance.now();
        const dt = Math.min((now - this.tickTime) / 1000, 0.05);
        if (dt <= 0.004) return;
        this.tickTime = now;
        this.update(dt);
        this.draw();
      }, 34);
    }

    /** 依經過時間推進 update()，每次最多一次，dt 上限 50ms */
    _advance(t) {
      const dt = Math.min((t - this.lastTime) / 1000, 0.05);
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

    /* ---------- update ---------- */
    update(dt) {
      this.time += dt;
      this.hintTime += dt;

      // 效果倒數
      if (this.effects.wide > 0) this.effects.wide = Math.max(0, this.effects.wide - dt);
      if (this.effects.slow > 0) this.effects.slow = Math.max(0, this.effects.slow - dt);

      const targetW = this.effects.wide > 0 ? this.PADDLE_BASE_W * 1.62 : this.PADDLE_BASE_W;
      this.paddle.w += (targetW - this.paddle.w) * Math.min(1, dt * 10);
      this.paddle.w = clamp(this.paddle.w, 80, this.W * 0.5);
      this.paddle.x = clamp(this.paddle.x, 0, this.W - this.paddle.w);

      // 擋板移動
      const dir = clamp(this.keyDir + this.touchDir, -1, 1);
      if (dir !== 0) {
        this.paddle.x = clamp(this.paddle.x + dir * PADDLE_SPEED * dt, 0, this.W - this.paddle.w);
        this.pointerX = null;
      }

      // 物理以固定小步進模擬，避免穿隧
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const sub = dt / steps;
      for (let i = 0; i < steps; i++) this._substep(sub);

      // 道具落下
      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const p = this.powerups[i];
        p.y += p.vy * dt;
        p.spin += dt * 3;
        if (p.y > this.H + 30) {
          this.powerups.splice(i, 1);
          continue;
        }
        if (
          p.y + p.r > this.paddle.y &&
          p.y - p.r < this.paddle.y + this.paddle.h &&
          p.x + p.r > this.paddle.x &&
          p.x - p.r < this.paddle.x + this.paddle.w
        ) {
          this._applyPower(p.type);
          this.powerups.splice(i, 1);
        }
      }

      // 粒子
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const pt = this.particles[i];
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vy += pt.g * dt;
        pt.vx *= 0.99;
        pt.life -= dt;
        if (pt.life <= 0) this.particles.splice(i, 1);
      }

      // 磚塊閃爍
      for (let i = 0; i < this.bricks.length; i++) {
        if (this.bricks[i].flash > 0) this.bricks[i].flash = Math.max(0, this.bricks[i].flash - dt * 5);
      }

      // 殘影
      this.trail.unshift({ x: this.paddle.x + this.paddle.w / 2, y: this.paddle.y });
      if (this.trail.length > 8) this.trail.pop();

      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 40);

      // 過關判定
      if (this.state === 'playing' && this.bricks.length === 0) this._levelClear();

      this.emitHud();
    }

    _substep(dt) {
      const paddle = this.paddle;

      for (let b = this.balls.length - 1; b >= 0; b--) {
        const ball = this.balls[b];

        if (ball.stuck) {
          ball.x = paddle.x + paddle.w / 2;
          ball.y = paddle.y - ball.r - 1;
          continue;
        }

        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        // 牆壁
        if (ball.x - ball.r < 0) {
          ball.x = ball.r;
          ball.vx = Math.abs(ball.vx);
          this._wallHit();
        } else if (ball.x + ball.r > this.W) {
          ball.x = this.W - ball.r;
          ball.vx = -Math.abs(ball.vx);
          this._wallHit();
        }
        if (ball.y - ball.r < 0) {
          ball.y = ball.r;
          ball.vy = Math.abs(ball.vy);
          this._wallHit();
        }

        // 擋板
        if (
          ball.vy > 0 &&
          ball.y + ball.r >= paddle.y &&
          ball.y - ball.r <= paddle.y + paddle.h &&
          ball.x >= paddle.x - ball.r &&
          ball.x <= paddle.x + paddle.w + ball.r
        ) {
          const rel = clamp((ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2), -1, 1);
          const angle = rel * (Math.PI / 3); // 最大 60 度
          ball.speed = clamp(ball.speed + 6, BASE_SPEED, MAX_SPEED);
          const mult = this.effects.slow > 0 ? 0.74 : 1;
          const speed = ball.speed * mult;
          ball.vx = Math.sin(angle) * speed;
          ball.vy = -Math.abs(Math.cos(angle) * speed);
          ball.y = paddle.y - ball.r - 0.5;
          this.combo = 0;
          this._spawnParticles(ball.x, paddle.y, '#39e6ff', 5, 130);
          if (window.NeonSFX) NeonSFX.play('paddle');
        }

        // 磚塊
        this._ballBricks(ball);

        // 掉出底部
        if (ball.y - ball.r > this.H) {
          this.balls.splice(b, 1);
        }
      }

      if (this.balls.length === 0 && this.state === 'playing') {
        this._loseLife();
      }
    }

    _wallHit() {
      if (this._wallCool && this.time - this._wallCool < 0.04) return;
      this._wallCool = this.time;
      if (window.NeonSFX) NeonSFX.play('wall');
    }

    _ballBricks(ball) {
      for (let i = 0; i < this.bricks.length; i++) {
        const br = this.bricks[i];
        // 圓與矩形碰撞
        const nx = clamp(ball.x, br.x, br.x + br.w);
        const ny = clamp(ball.y, br.y, br.y + br.h);
        const dx = ball.x - nx;
        const dy = ball.y - ny;
        if (dx * dx + dy * dy > ball.r * ball.r) continue;

        // 判斷反彈軸：比較穿透深度
        const overlapX = ball.r - Math.abs(dx);
        const overlapY = ball.r - Math.abs(dy);
        const cx = br.x + br.w / 2;
        const cy = br.y + br.h / 2;

        if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) {
          // 球心在磚塊內：以速度方向反轉
          if (Math.abs(ball.vx) > Math.abs(ball.vy)) ball.vx = -ball.vx;
          else ball.vy = -ball.vy;
        } else if (overlapX > overlapY) {
          ball.vx = ball.x < cx ? -Math.abs(ball.vx) : Math.abs(ball.vx);
          ball.x += ball.x < cx ? -overlapX : overlapX;
        } else {
          ball.vy = ball.y < cy ? -Math.abs(ball.vy) : Math.abs(ball.vy);
          ball.y += ball.y < cy ? -overlapY : overlapY;
        }

        this._hitBrick(i);
        break;
      }
    }

    _hitBrick(index) {
      const br = this.bricks[index];
      br.hp -= 1;
      br.flash = 1;
      this._wallDirty = true;
      this.shake = Math.min(6, this.shake + 1.6);

      if (br.hp > 0) {
        this._spawnParticles(br.x + br.w / 2, br.y + br.h / 2, br.color, 5, 160);
        if (window.NeonSFX) NeonSFX.play('hardBrick');
        return;
      }

      this.bricks.splice(index, 1);
      this._wallDirty = true;
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);

      const mult = Math.min(1 + this.combo * 0.12, 3.4);
      const gain = Math.round((10 + (this.ROWS - br.row) * 2) * mult);
      this.score += gain;

      this._spawnParticles(br.x + br.w / 2, br.y + br.h / 2, br.color, 12, 230);
      this._floatText(br.x + br.w / 2, br.y + br.h / 2, '+' + gain, br.color);
      if (window.NeonSFX) NeonSFX.play('brick', this.combo);

      if (Math.random() < 0.085 && this.powerups.length < 3) {
        this._spawnPowerup(br.x + br.w / 2, br.y + br.h / 2);
      }

      // 磚塊越少，球越快一點點
      for (let i = 0; i < this.balls.length; i++) {
        const ball = this.balls[i];
        if (ball.stuck) continue;
        ball.speed = clamp(ball.speed + 1.4, BASE_SPEED, MAX_SPEED);
        const m = Math.hypot(ball.vx, ball.vy) || 1;
        const mult2 = this.effects.slow > 0 ? 0.74 : 1;
        ball.vx = (ball.vx / m) * ball.speed * mult2;
        ball.vy = (ball.vy / m) * ball.speed * mult2;
      }
    }

    _loseLife() {
      this.lives -= 1;
      this.combo = 0;
      this.shake = 9;
      this.effects.wide = 0;
      this.effects.slow = 0;
      this.powerups = [];
      if (window.NeonSFX) NeonSFX.play('loseLife');

      if (this.lives <= 0) {
        this._gameOver();
        return;
      }

      this._resetBall(true);
      this.paddle.w = this.PADDLE_BASE_W;
      this.emitHud();
    }

    _levelClear() {
      this.state = 'levelclear';
      this._stopLoop();
      const bonus = this.lives * 200 + this.bestCombo * 25;
      this.score += bonus;
      this._commitBest();
      if (window.NeonSFX) NeonSFX.play('levelClear');
      this.draw();
      this.emitHud();
      this.emitOverlay({
        type: 'levelclear',
        kicker: 'LEVEL ' + this.level + ' CLEAR',
        title: '霓虹磚牆已清空',
        sub: '關卡獎勵 +' + bonus + ' 分。下一關磚塊更硬，光球也更快。',
        stats: [
          { label: '總分', value: this.score },
          { label: '最高連擊', value: 'x' + this.bestCombo },
        ],
        actions: [
          { label: '前往第 ' + (this.level + 1) + ' 關', kind: 'primary', act: 'next' },
          { label: '返回選單', kind: 'ghost', act: 'menu' },
        ],
      });
    }

    _gameOver() {
      this.state = 'over';
      this._stopLoop();
      const isRecord = this._commitBest();
      if (window.NeonSFX) NeonSFX.play('gameOver');
      this.draw();
      this.emitHud();
      this.emitOverlay({
        type: 'over',
        kicker: 'GAME OVER',
        title: isRecord ? '新紀錄！' : '再試一次？',
        sub: isRecord
          ? '你刷新了自己的最高分，霓虹為你閃耀。'
          : '這次拿了 ' + this.score + ' 分，離最高分還差 ' + Math.max(0, this.best - this.score) + ' 分。',
        stats: [
          { label: '本局分數', value: this.score },
          { label: '最高分', value: this.best, highlight: isRecord },
          { label: '抵達關卡', value: this.level },
        ],
        actions: [
          { label: '再玩一次', kind: 'primary', act: 'restart' },
          { label: '返回選單', kind: 'ghost', act: 'menu' },
        ],
      });
      if (isRecord) this._playRecord();
    }

    _playRecord() {
      setTimeout(() => {
        if (window.NeonSFX) NeonSFX.play('record');
      }, 420);
    }

    _commitBest() {
      if (this.score > this.best) {
        this.best = this.score;
        writeBest(this.best);
        return true;
      }
      return false;
    }

    _spawnPowerup(x, y) {
      const roll = Math.random();
      let type = 'wide';
      if (roll < 0.32) type = 'multi';
      else if (roll < 0.63) type = 'wide';
      else if (roll < 0.9) type = 'slow';
      else type = 'life';
      this.powerups.push({
        x: clamp(x, 24, this.W - 24),
        y: y,
        vy: 190,
        r: 15,
        type: type,
        spin: 0,
      });
    }

    _applyPower(type) {
      if (type === 'wide') this.effects.wide = POWER_TYPES.wide.duration;
      else if (type === 'slow') this.effects.slow = POWER_TYPES.slow.duration;
      else if (type === 'life') this.lives = Math.min(5, this.lives + 1);
      else if (type === 'multi') {
        const source = this.balls[0];
        if (source) {
          const baseSpeed = Math.hypot(source.vx, source.vy) || source.speed;
          const baseAng = Math.atan2(source.vy, source.vx);
          for (let i = 1; i <= 2; i++) {
            const a = baseAng + (i === 1 ? -0.42 : 0.42);
            this.balls.push({
              x: source.x,
              y: source.y,
              vx: Math.cos(a) * baseSpeed,
              vy: Math.sin(a) * baseSpeed,
              r: this.BALL_R,
              stuck: false,
              speed: source.speed,
            });
          }
        }
      }
      this._toast(POWER_TYPES[type].label + '！', POWER_TYPES[type].color);
      if (window.NeonSFX) NeonSFX.play('bonus');
      this.score += 25;
      this.emitHud();
    }

    _toast(text, color) {
      if (this.opts.onToast) this.opts.onToast(text, color);
    }

    _spawnParticles(x, y, color, count, speed) {
      if (this.particles.length > 260) return;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = rand(speed * 0.25, speed);
        this.particles.push({
          x: x,
          y: y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          life: rand(0.28, 0.7),
          maxLife: 0.7,
          r: rand(1.4, 3.6),
          color: color,
          g: 260,
          text: null,
        });
      }
    }

    _floatText(x, y, text, color) {
      this.particles.push({
        x: x,
        y: y,
        vx: 0,
        vy: -52,
        life: 0.85,
        maxLife: 0.85,
        r: 0,
        color: color,
        g: 0,
        text: text,
      });
    }

    /* ---------- rendering ---------- */
    _sprite(color, hp) {
      const key = color + '|' + hp;
      if (this.sprites[key]) return this.sprites[key];

      const pad = 12;
      const s = 2;
      const c = document.createElement('canvas');
      c.width = (this.BW + pad * 2) * s;
      c.height = (this.BH + pad * 2) * s;
      const g = c.getContext('2d');
      g.scale(s, s);
      g.translate(pad, pad);

      // 外光暈
      g.shadowColor = color;
      g.shadowBlur = 13;
      const grad = g.createLinearGradient(0, 0, 0, this.BH);
      grad.addColorStop(0, 'rgba(255,255,255,.42)');
      grad.addColorStop(0.18, color);
      grad.addColorStop(1, 'rgba(6,8,18,.92)');
      g.fillStyle = grad;
      roundRect(g, 0, 0, this.BW, this.BH, 7);
      g.fill();

      // 內圈亮線
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(255,255,255,.5)';
      g.lineWidth = 1;
      roundRect(g, 1.2, 1.2, this.BW - 2.4, this.BH - 2.4, 6);
      g.stroke();

      // 高光
      g.fillStyle = 'rgba(255,255,255,.2)';
      roundRect(g, 6, 4, this.BW - 12, 5, 2.5);
      g.fill();

      // 硬磚標記
      if (hp > 1) {
        g.strokeStyle = 'rgba(255,255,255,.55)';
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(this.BW * 0.32, this.BH * 0.3);
        g.lineTo(this.BW * 0.4, this.BH * 0.7);
        g.moveTo(this.BW * 0.62, this.BH * 0.28);
        g.lineTo(this.BW * 0.56, this.BH * 0.66);
        g.stroke();
      }

      this.sprites[key] = { canvas: c, pad: pad };
      return this.sprites[key];
    }

    /** 動態背景只畫一次，之後直接 drawImage（軟體渲染環境差很多） */
    _bgCache() {
      if (this._bg && this._bgW === this.W && this._bgH === this.H) return this._bg;
      const c = document.createElement('canvas');
      c.width = this.W;
      c.height = this.H;
      const g = c.getContext('2d');
      this._paintBgTo(g);
      this._bg = c;
      this._bgW = this.W;
      this._bgH = this.H;
      return c;
    }

    _paintBg(ctx) {
      const cache = this._bgCache();
      ctx.drawImage(cache, 0, 0);
    }

    _paintBgTo(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, this.H);
      g.addColorStop(0, '#070b16');
      g.addColorStop(0.55, '#060a13');
      g.addColorStop(1, '#04060d');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);

      // 賽博網格
      ctx.save();
      ctx.strokeStyle = 'rgba(57,230,255,.055)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= this.W; x += 48) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, this.H);
      }
      for (let y = 0; y <= this.H; y += 48) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(this.W, y + 0.5);
      }
      ctx.stroke();
      ctx.restore();

      // 底部光暈
      const gg = ctx.createRadialGradient(this.W / 2, this.H + 40, 40, this.W / 2, this.H + 40, 460);
      gg.addColorStop(0, 'rgba(255,63,164,.22)');
      gg.addColorStop(0.6, 'rgba(167,139,250,.07)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(0, this.H * 0.42, this.W, this.H * 0.58);

      // 頂部光暈
      const gt = ctx.createRadialGradient(this.W * 0.5, -120, 30, this.W * 0.5, -120, 520);
      gt.addColorStop(0, 'rgba(57,230,255,.14)');
      gt.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gt;
      ctx.fillRect(0, 0, this.W, 300);
    }

    renderStatic() {
      const ctx = this.ctx;
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#050810';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
      this._paintBg(ctx);

      // 靜態展示磚牆
      for (let r = 0; r < this.ROWS; r++) {
        for (let c = 0; c < this.COLS; c++) {
          const x = this.GRID_LEFT + c * (this.BW + this.GAP_X);
          const y = this.GRID_TOP + r * (this.BH + this.GAP_Y);
          const sp = this._sprite(COLORS[r % COLORS.length], 1);
          ctx.drawImage(sp.canvas, x - sp.pad, y - sp.pad, this.BW + sp.pad * 2, this.BH + sp.pad * 2);
        }
      }

      // 擋板與球
      this._drawPaddle(ctx, (this.W - this.PADDLE_BASE_W) / 2, this.PADDLE_BASE_W);
      const bx = this.W / 2;
      const by = this.PADDLE_Y - this.BALL_R - 1;
      ctx.save();
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 22;
      ctx.fillStyle = '#eafcff';
      ctx.beginPath();
      ctx.arc(bx, by, this.BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    draw() {
      const ctx = this.ctx;
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#050810';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      const sx = this.shake ? rand(-this.shake, this.shake) : 0;
      const sy = this.shake ? rand(-this.shake, this.shake) : 0;
      ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX + sx * this.scale, this.offsetY + sy * this.scale);

      this._paintBg(ctx);

      // 磚塊：靜止狀態整面牆一次貼上，只有閃爍中的磚塊另外處理
      const stale = this._wallDirty || this._wallW !== this.W || this._wallH !== this.H;
      if (stale) this._buildWallCache();
      ctx.drawImage(this._wall, 0, 0);
      for (let i = 0; i < this.bricks.length; i++) {
        const br = this.bricks[i];
        if (br.flash <= 0) continue;
        ctx.save();
        ctx.globalAlpha = Math.min(1, br.flash * 0.8);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(br.x, br.y, this.BW, this.BH);
        ctx.restore();
      }

      // 道具
      for (let i = 0; i < this.powerups.length; i++) this._drawPowerup(ctx, this.powerups[i]);

      // 擋板
      this._drawPaddle(ctx, this.paddle.x, this.paddle.w);

      // 球與殘影
      for (let i = 0; i < this.balls.length; i++) this._drawBall(ctx, this.balls[i]);

      // 粒子
      this._drawParticles(ctx);

      // 發射提示
      if (this.state === 'playing' && !this.launched) {
        const a = 0.55 + Math.sin(this.time * 3.2) * 0.25;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = '#dff9ff';
        ctx.font = '600 17px "Space Grotesk", "Noto Sans TC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('點擊畫面或按 Space 發射', this.W / 2, this.PADDLE_Y + 62);
        ctx.restore();
      }

      // 道具效果計時
      this._drawEffectBars(ctx);

      // 邊框
      ctx.strokeStyle = 'rgba(57,230,255,.16)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, this.W - 1, this.H - 1);
    }

    /** 把所有磚塊預先畫到一張離屏 canvas，每幀只要一次 drawImage */
    _buildWallCache() {
      const c = document.createElement('canvas');
      c.width = this.W;
      c.height = this.H;
      const g = c.getContext('2d');
      for (let i = 0; i < this.bricks.length; i++) {
        const br = this.bricks[i];
        const sp = this._sprite(br.color, br.hp);
        g.drawImage(sp.canvas, br.x - sp.pad, br.y - sp.pad, this.BW + sp.pad * 2, this.BH + sp.pad * 2);
      }
      this._wall = c;
      this._wallW = this.W;
      this._wallH = this.H;
      this._wallDirty = false;
    }

    _drawPaddle(ctx, x, w) {
      const y = this.paddle.y;
      ctx.save();
      ctx.shadowColor = this.effects.wide > 0 ? '#b8ff4a' : '#39e6ff';
      ctx.shadowBlur = 26;
      const grad = ctx.createLinearGradient(x, y, x + w, y);
      grad.addColorStop(0, '#ff3fa4');
      grad.addColorStop(0.5, '#b3f4ff');
      grad.addColorStop(1, '#39e6ff');
      ctx.fillStyle = grad;
      roundRect(ctx, x, y, w, PADDLE_H, PADDLE_H / 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      roundRect(ctx, x + 6, y + 3, w - 12, 3, 1.5);
      ctx.fill();
      ctx.restore();
    }

    _drawBall(ctx, ball) {
      // 尾巴
      const speed = Math.hypot(ball.vx, ball.vy);
      if (speed > 1 && !ball.stuck) {
        const ux = ball.vx / speed;
        const uy = ball.vy / speed;
        const tx = ball.x - ux * 42;
        const ty = ball.y - uy * 42;
        const trail = ctx.createLinearGradient(tx, ty, ball.x, ball.y);
        trail.addColorStop(0, 'rgba(57,230,255,0)');
        trail.addColorStop(0.55, 'rgba(120,200,255,.28)');
        trail.addColorStop(1, 'rgba(255,180,235,.6)');
        ctx.save();
        ctx.strokeStyle = trail;
        ctx.lineWidth = ball.r * 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(ball.x, ball.y);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.shadowColor = '#8ef4ff';
      ctx.shadowBlur = 24;
      const g = ctx.createRadialGradient(ball.x - 2, ball.y - 3, 1, ball.x, ball.y, ball.r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.55, '#bdf7ff');
      g.addColorStop(1, '#39e6ff');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _drawPowerup(ctx, p) {
      const def = POWER_TYPES[p.type];
      const y = p.y + Math.sin(p.spin * 1.6) * 2;
      ctx.save();
      ctx.shadowColor = def.color;
      ctx.shadowBlur = 20;
      ctx.fillStyle = 'rgba(6,10,18,.94)';
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2;
      roundRect(ctx, p.x - p.r, y - p.r, p.r * 2, p.r * 2, 8);
      ctx.fill();
      ctx.stroke();

      ctx.shadowBlur = 10;
      ctx.fillStyle = def.color;
      ctx.font = '700 15px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.glyph, p.x, y + 1);
      ctx.restore();
    }

    _drawParticles(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        const a = Math.max(0, p.life / p.maxLife);
        if (p.text) {
          ctx.globalAlpha = Math.min(1, a * 1.6);
          ctx.fillStyle = p.color;
          ctx.font = '700 15px "Space Grotesk", "Noto Sans TC", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(p.text, p.x, p.y);
          continue;
        }
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.4 + a * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    _drawEffectBars(ctx) {
      const active = [];
      if (this.effects.wide > 0) active.push({ label: '加寬擋板', t: this.effects.wide, max: POWER_TYPES.wide.duration, color: '#39e6ff' });
      if (this.effects.slow > 0) active.push({ label: '慢速光球', t: this.effects.slow, max: POWER_TYPES.slow.duration, color: '#a78bfa' });
      if (!active.length) return;
      let y = 16;
      ctx.save();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < active.length; i++) {
        const e = active[i];
        const x = this.W - 18;
        ctx.fillStyle = 'rgba(255,255,255,.72)';
        ctx.font = '600 11px "Space Grotesk", "Noto Sans TC", sans-serif';
        ctx.fillText(e.label, x, y + 5);
        const bw = 88;
        ctx.fillStyle = 'rgba(255,255,255,.12)';
        roundRect(ctx, x - bw, y + 14, bw, 4, 2);
        ctx.fill();
        ctx.fillStyle = e.color;
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 8;
        roundRect(ctx, x - bw, y + 14, bw * (e.t / e.max), 4, 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        y += 30;
      }
      ctx.restore();
    }

    /* ---------- bridge to UI ---------- */
    emitHud() {
      if (!this.opts.onHud) return;
      this.opts.onHud({
        score: this.score,
        best: this.best,
        lives: Math.max(0, this.lives),
        level: this.level,
        combo: this.combo,
        effects: (this.effects.wide > 0 ? 1 : 0) + (this.effects.slow > 0 ? 1 : 0),
      });
    }

    emitOverlay(payload) {
      if (this.opts.onOverlay) this.opts.onOverlay(payload);
    }
  }

  window.NeonBreakout = Breakout;
  window.NeonBreakoutStorageKey = STORAGE_KEY;
})();
