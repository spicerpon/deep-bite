// ============================================================
// Deep Bite — renderer (ocean background, camera, entities, particles)
// ============================================================
window.GF = window.GF || {};
(function () {
  const C = GF.CONFIG;

  // 깊이에 따른 물 색 (0=수면, 1=바닥)
  const DEPTH_STOPS = [
    [0.0, [26, 143, 193]],
    [0.25, [12, 103, 150]],
    [0.6, [6, 56, 96]],
    [1.0, [4, 24, 50]],
  ];
  function depthColor(d) {
    d = GF.clamp(d, 0, 1);
    for (let i = 1; i < DEPTH_STOPS.length; i++) {
      if (d <= DEPTH_STOPS[i][0]) {
        const [d0, c0] = DEPTH_STOPS[i - 1], [d1, c1] = DEPTH_STOPS[i];
        const t = (d - d0) / (d1 - d0);
        return `rgb(${(c0[0] + (c1[0] - c0[0]) * t) | 0},${(c0[1] + (c1[1] - c0[1]) * t) | 0},${(c0[2] + (c1[2] - c0[2]) * t) | 0})`;
      }
    }
    return 'rgb(4,24,50)';
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = 1;
      this.w = 1; this.h = 1;          // CSS px
      this.cam = { x: C.WORLD / 2, y: C.WORLD / 2, scale: 1 };
      this.particles = [];
      this.bubbles = [];
      this.pattern = null;
      this.reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this._makePattern();
      for (let i = 0; i < 46; i++) this.bubbles.push(this._newBubble(true));
    }

    resize() {
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = this.canvas.clientWidth || window.innerWidth;
      this.h = this.canvas.clientHeight || window.innerHeight;
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
    }

    _makePattern() {
      const pc = document.createElement('canvas');
      pc.width = pc.height = 96;
      const p = pc.getContext('2d');
      p.fillStyle = 'rgba(255,255,255,0.07)';
      p.beginPath(); p.arc(48, 48, 2.2, 0, Math.PI * 2); p.fill();
      p.fillStyle = 'rgba(255,255,255,0.035)';
      p.beginPath(); p.arc(0, 0, 1.6, 0, Math.PI * 2); p.fill();
      p.beginPath(); p.arc(96, 96, 1.6, 0, Math.PI * 2); p.fill();
      this.pattern = this.ctx.createPattern(pc, 'repeat');
    }

    _newBubble(anywhere) {
      const vw = this.w / this.cam.scale, vh = this.h / this.cam.scale;
      return {
        x: this.cam.x + (Math.random() - 0.5) * vw * 1.4,
        y: anywhere ? this.cam.y + (Math.random() - 0.5) * vh * 1.4 : this.cam.y + vh * 0.75 + Math.random() * 200,
        r: 1.5 + Math.random() * 4,
        vy: 18 + Math.random() * 40,
        ph: Math.random() * Math.PI * 2,
      };
    }

    // 화면 중심 기준 뷰 사각형 (world units)
    viewRect(margin = 0) {
      const hw = this.w / this.cam.scale / 2 + margin, hh = this.h / this.cam.scale / 2 + margin;
      return { x0: this.cam.x - hw, y0: this.cam.y - hh, x1: this.cam.x + hw, y1: this.cam.y + hh };
    }

    // 카메라를 대상 쪽으로 부드럽게
    followCamera(tx, ty, targetScale, dt) {
      const k = 1 - Math.exp(-dt * 7);
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
      this.cam.scale += (targetScale - this.cam.scale) * (1 - Math.exp(-dt * 2.5));
    }
    snapCamera(x, y, scale) { this.cam.x = x; this.cam.y = y; this.cam.scale = scale; }

    // 반지름 → 카메라 스케일. 긴 변이 viewWidth(r) world units가 되게.
    scaleFor(r) {
      const want = GF.viewWidth(r);
      const longSide = Math.max(this.w, this.h * 1.25);
      return GF.clamp(longSide / want, 0.22, 1.6);
    }

    screenToWorld(sx, sy) {
      return { x: this.cam.x + (sx - this.w / 2) / this.cam.scale, y: this.cam.y + (sy - this.h / 2) / this.cam.scale };
    }

    spawnEatParticles(x, y, color, n = 6, big = false) {
      if (this.reduceMotion) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = (big ? 90 : 50) + Math.random() * 60;
        this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.3, max: 0.8, r: big ? 3 + Math.random() * 4 : 1.5 + Math.random() * 2, color });
      }
    }
    spawnBoostBubble(x, y, a, r) {
      if (this.reduceMotion || Math.random() > 0.6) return;
      const bx = x - Math.cos(a) * r * 1.1, by = y - Math.sin(a) * r * 1.1;
      this.particles.push({ x: bx + (Math.random() - 0.5) * r * 0.5, y: by + (Math.random() - 0.5) * r * 0.5, vx: -Math.cos(a) * 40, vy: -Math.sin(a) * 40 - 30, life: 0.6, max: 0.6, r: 1.5 + Math.random() * 2.5, color: 'rgba(220,245,255,0.8)', bubble: true });
      }

    // ------------------------------------------------------------
    draw(state, time, dt) {
      const ctx = this.ctx, cam = this.cam;
      const W = this.w, H = this.h;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // --- background gradient by depth ---
      const vr = this.viewRect();
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, depthColor(vr.y0 / C.WORLD));
      g.addColorStop(0.5, depthColor((vr.y0 + vr.y1) / 2 / C.WORLD));
      g.addColorStop(1, depthColor(vr.y1 / C.WORLD));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // world transform
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(cam.scale, cam.scale);
      ctx.translate(-cam.x, -cam.y);

      // dot pattern (world-space)
      ctx.fillStyle = this.pattern;
      ctx.fillRect(Math.max(0, vr.x0), Math.max(0, vr.y0), Math.min(C.WORLD, vr.x1) - Math.max(0, vr.x0), Math.min(C.WORLD, vr.y1) - Math.max(0, vr.y0));

      // light rays near the surface
      if (vr.y0 < 2600 && !this.reduceMotion) this._drawRays(ctx, vr, time);

      // sand floor
      if (vr.y1 > C.WORLD - 260) this._drawFloor(ctx, vr, time);

      // outside world: dark overlay + boundary
      this._drawBounds(ctx, vr);

      // bubbles
      this._drawBubbles(ctx, vr, dt);

      // --- food & drops ---
      for (const f of state.visibleFood) GF.drawFood(ctx, f, time);
      for (const d of state.visibleDrops) GF.drawDrop(ctx, d, time);

      // --- fish (small first, big on top) ---
      const list = state.fishList; // already sorted by mass asc
      for (const f of list) {
        GF.drawFish(ctx, f, time, { alpha: f.alpha, mouth: f.mouth, speed: f.speedN, glow: f.glow });
      }

      // --- particles ---
      this._drawParticles(ctx, dt);

      // --- names (unrotated, world-positioned) ---
      const fontPx = GF.clamp(13 / cam.scale, 9, 60);
      ctx.font = `600 ${fontPx}px Nunito, "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(1, fontPx * 0.18);
      ctx.lineJoin = 'round';
      for (const f of list) {
        if (!f.name) continue;
        const y = f.y + f.r * 0.62 + 6 / cam.scale;
        ctx.globalAlpha = (f.alpha == null ? 1 : f.alpha) * 0.9;
        ctx.strokeStyle = 'rgba(3,18,36,0.75)';
        ctx.strokeText(f.name, f.x, y);
        ctx.fillStyle = f.isMe ? '#ffe9a8' : '#eaf6ff';
        ctx.fillText(f.name, f.x, y);
        if (f.massLabel) {
          ctx.font = `700 ${fontPx * 0.85}px Nunito, "Segoe UI", system-ui, sans-serif`;
          ctx.strokeText(f.massLabel, f.x, y + fontPx * 1.15);
          ctx.fillStyle = '#9fe8ff';
          ctx.fillText(f.massLabel, f.x, y + fontPx * 1.15);
          ctx.font = `600 ${fontPx}px Nunito, "Segoe UI", system-ui, sans-serif`;
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    _drawRays(ctx, vr, time) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const spacing = 520;
      const start = Math.floor(vr.x0 / spacing) * spacing - spacing;
      for (let x = start; x < vr.x1 + spacing; x += spacing) {
        const sway = Math.sin(time * 0.25 + x * 0.002) * 120;
        const w = 90 + ((x / spacing) % 3) * 40;
        const grad = ctx.createLinearGradient(0, 0, 0, 2600);
        grad.addColorStop(0, 'rgba(180,230,255,0.11)');
        grad.addColorStop(1, 'rgba(180,230,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x, -50);
        ctx.lineTo(x + w, -50);
        ctx.lineTo(x + w * 2.6 + sway + 380, 2600);
        ctx.lineTo(x - w * 0.8 + sway + 380, 2600);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    _drawFloor(ctx, vr, time) {
      const top = C.WORLD - 160;
      const g = ctx.createLinearGradient(0, top, 0, C.WORLD);
      g.addColorStop(0, 'rgba(200,170,110,0)');
      g.addColorStop(0.5, 'rgba(190,160,100,0.45)');
      g.addColorStop(1, 'rgba(170,140,85,0.75)');
      ctx.fillStyle = g;
      ctx.fillRect(Math.max(0, vr.x0), top, Math.min(C.WORLD, vr.x1) - Math.max(0, vr.x0), C.WORLD - top);
      // seaweed
      ctx.strokeStyle = 'rgba(40,150,90,0.6)';
      ctx.lineCap = 'round';
      const sp = 140;
      for (let x = Math.floor(vr.x0 / sp) * sp; x < vr.x1; x += sp) {
        if (x < 0 || x > C.WORLD) continue;
        const h = 70 + ((x / sp) % 4) * 25;
        const sway = Math.sin(time * 1.1 + x * 0.01) * 18;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(x, C.WORLD);
        ctx.quadraticCurveTo(x + sway * 0.5, C.WORLD - h * 0.5, x + sway, C.WORLD - h);
        ctx.stroke();
      }
    }

    _drawBounds(ctx, vr) {
      ctx.fillStyle = 'rgba(2,10,22,0.78)';
      if (vr.x0 < 0) ctx.fillRect(vr.x0, vr.y0, -vr.x0, vr.y1 - vr.y0);
      if (vr.x1 > C.WORLD) ctx.fillRect(C.WORLD, vr.y0, vr.x1 - C.WORLD, vr.y1 - vr.y0);
      if (vr.y0 < 0) ctx.fillRect(Math.max(0, vr.x0), vr.y0, Math.min(C.WORLD, vr.x1) - Math.max(0, vr.x0), -vr.y0);
      if (vr.y1 > C.WORLD) ctx.fillRect(Math.max(0, vr.x0), C.WORLD, Math.min(C.WORLD, vr.x1) - Math.max(0, vr.x0), vr.y1 - C.WORLD);
      ctx.strokeStyle = 'rgba(120,200,255,0.5)';
      ctx.lineWidth = 4 / this.cam.scale;
      ctx.strokeRect(0, 0, C.WORLD, C.WORLD);
    }

    _drawBubbles(ctx, vr, dt) {
      ctx.strokeStyle = 'rgba(210,240,255,0.35)';
      ctx.fillStyle = 'rgba(210,240,255,0.08)';
      ctx.lineWidth = 1 / this.cam.scale + 0.5;
      for (let i = 0; i < this.bubbles.length; i++) {
        const b = this.bubbles[i];
        b.y -= b.vy * dt;
        b.x += Math.sin(b.y * 0.02 + b.ph) * 12 * dt;
        if (b.y < vr.y0 - 100 || b.x < vr.x0 - 300 || b.x > vr.x1 + 300 || b.y > vr.y1 + 400) {
          this.bubbles[i] = this._newBubble(false);
          continue;
        }
        if (b.y < -20) continue;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }

    _drawParticles(ctx, dt) {
      const ps = this.particles;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.life -= dt;
        if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.92; p.vy *= 0.92;
        const a = GF.clamp(p.life / p.max, 0, 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 미니맵 (별도 작은 캨버스)
    drawMinimap(mctx, size, me, others) {
      mctx.clearRect(0, 0, size, size);
      mctx.fillStyle = 'rgba(5,30,55,0.75)';
      mctx.fillRect(0, 0, size, size);
      mctx.strokeStyle = 'rgba(120,200,255,0.6)';
      mctx.lineWidth = 1;
      mctx.strokeRect(0.5, 0.5, size - 1, size - 1);
      const k = size / C.WORLD;
      // view rect
      const vr = this.viewRect();
      mctx.strokeStyle = 'rgba(255,255,255,0.35)';
      mctx.strokeRect(vr.x0 * k, vr.y0 * k, (vr.x1 - vr.x0) * k, (vr.y1 - vr.y0) * k);
      for (const o of others) {
        mctx.fillStyle = GF.canEat(o.m, me.m) ? 'rgba(255,90,90,0.9)' : 'rgba(170,220,255,0.7)';
        mctx.beginPath(); mctx.arc(o.x * k, o.y * k, 1.6, 0, Math.PI * 2); mctx.fill();
      }
      mctx.fillStyle = '#ffe066';
      mctx.beginPath(); mctx.arc(me.x * k, me.y * k, 2.6, 0, Math.PI * 2); mctx.fill();
    }
  }

  GF.Renderer = Renderer;
})();
