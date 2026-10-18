// ============================================================
// Deep Bite — core game loop (physics, eating, death, interpolation)
//
// 권한 모델(서버 없음):
//  - 내 위치/질량은 내가 결정해서 전송
//  - 먹이: 먹은 쪽이 "먹혔다(ts)"를 기록
//  - 물고기 간 포식: *먹히는 쪽*이 자기 죽음을 판정하고, 킬러에게 질량을 보냄(event)
// ============================================================
window.GF = window.GF || {};
(function () {
  const C = GF.CONFIG;

  class Game {
    constructor({ canvas, minimapCanvas, boostBtn, joyEl, ui }) {
      this.renderer = new GF.Renderer(canvas);
      this.input = new GF.Input(canvas, boostBtn, joyEl);
      this.minimap = minimapCanvas ? minimapCanvas.getContext('2d') : null;
      this.minimapCanvas = minimapCanvas;
      this.ui = ui;
      this.net = null;
      this.me = null;
      this.others = new Map();
      this.foodState = new Map();  // cell -> Map(slot -> eatenTs)
      this.drops = new Map();      // cell -> Map(id -> drop)
      this.foodCache = new Map();
      this.subscribed = [];
      this.board = [];
      this.running = false;
      this.lastT = 0;
      this.time = 0;
      this.tickAcc = 0;
      this.boardAcc = 0;
      this.viewAcc = 0;
      this.hudAcc = 0;
      this._raf = 0;
      this._loop = this._loop.bind(this);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.running && this.me && this.me.alive && this.net && this.net.resync) this.net.resync(this._myRecord());
      });
    }

    // ---------------------------------------------------------
    async start(net, { name, skin }) {
      this.stop();
      this.net = net;
      this.others.clear(); this.foodState.clear(); this.drops.clear(); this.foodCache.clear();
      this.subscribed = []; this.board = [];

      net.on('player', (uid, data, cell) => this._onPlayer(uid, data, cell));
      net.on('food', (cell, slot, ts) => this._onFood(cell, slot, ts));
      net.on('drop', (cell, id, data) => this._onDrop(cell, id, data));
      net.on('event', (ev) => this._onEvent(ev));
      net.on('board', (list, total, myRank) => { this.board = list; this.playerCount = total || list.length; this.myRank = myRank || null; });
      net.on('error', (msg) => this.ui.toast(msg, true));

      const info = await net.connect({ name, skin });
      this.uid = info.uid;
      this.room = info.room;
      this._spawn(name, skin);
      this.running = true;
      this.lastT = performance.now();
      this._raf = requestAnimationFrame(this._loop);
      return info;
    }

    stop() {
      this.running = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
    }

    respawn() {
      if (!this.me) return;
      this._spawn(this.me.n, this.me.s);
      this.running = true;
      this.lastT = performance.now();
      if (!this._raf) this._raf = requestAnimationFrame(this._loop);
    }

    // 광고 재생 중 일시정지: 내 조작/렌더만 멈추고, 호스트 봇 시뮬레이션(net.step)은 계속 돈다.
    pause() { this.adPaused = true; this.input.reset(); }
    resume() { this.adPaused = false; this.lastT = performance.now(); if (this.running && !this._raf) this._raf = requestAnimationFrame(this._loop); }

    // 보상형 광고 '이어하기': 죽은 자리 근처에서 직전 질량의 share 비율로 다시 시작 (기록은 이어짐)
    continueRun(share) {
      const me = this.me;
      if (!me || me.alive || !me.deathAt) return false;
      const mass = GF.clamp(Math.round(me.deathAt.m * share), C.START_MASS, C.MAX_MASS);
      const a = Math.random() * Math.PI * 2, d = 420 + Math.random() * 240;
      const x = GF.clamp(me.deathAt.x + Math.cos(a) * d, 40, C.WORLD - 40);
      const y = GF.clamp(me.deathAt.y + Math.sin(a) * d, 40, C.WORLD - 40);
      Object.assign(me, {
        x, y, a: Math.random() * Math.PI * 2, m: mass, r: GF.radius(mass),
        boost: false, alive: true, protectUntil: performance.now() + C.SPAWN_PROTECT_MS * 1.5,
        killedBy: null, continued: (me.continued || 0) + 1, deathAt: null,
      });
      this.input.reset();
      this.renderer.snapCamera(x, y, this.renderer.scaleFor(me.r));
      this.net.spawn(this._myRecord());
      this._updateView(true);
      this.tickAcc = 0; this.boardAcc = 0;
      this.running = true;
      this.lastT = performance.now();
      if (!this._raf) this._raf = requestAnimationFrame(this._loop);
      return true;
    }

    _spawn(name, skin) {
      const p = GF.randomSpawn();
      this.me = {
        uid: this.uid, n: name, s: skin,
        x: p.x, y: p.y, a: Math.random() * Math.PI * 2, m: C.START_MASS, r: GF.radius(C.START_MASS),
        boost: false, alive: true, protectUntil: performance.now() + C.SPAWN_PROTECT_MS,
        born: performance.now(), kills: 0, foodEaten: 0, peak: C.START_MASS, killedBy: null, phase: Math.random() * 6,
        continued: 0, deathAt: null,
      };
      this.input.reset();
      this.renderer.snapCamera(p.x, p.y, this.renderer.scaleFor(this.me.r));
      this.net.spawn(this._myRecord());
      this._updateView(true);
      this.tickAcc = 0; this.boardAcc = 0;
    }

    _myRecord() {
      const m = this.me;
      return { n: m.n, s: m.s, x: Math.round(m.x), y: Math.round(m.y), a: Math.round(m.a * 100) / 100, m: Math.round(m.m), b: m.boost ? 1 : 0 };
    }

    // ---------------------------------------------------------
    _onPlayer(uid, data, cell) {
      if (uid === this.uid) return;
      const now = performance.now();
      if (data == null) {
        const e = this.others.get(uid);
        if (e && (cell == null || e.cell === cell)) this.others.delete(uid);
        return;
      }
      let e = this.others.get(uid);
      if (!e) {
        const m0 = Math.max(1, data.m || 1);
        e = { uid, x: data.x, y: data.y, a: data.a || 0, m: m0, r: GF.radius(m0), stale: false, tx: data.x, ty: data.y, ta: data.a || 0, tm: m0, vx: 0, vy: 0, lastRecv: now, phase: Math.random() * 6 };
        this.others.set(uid, e);
      } else {
        const dtr = (now - e.lastRecv) / 1000;
        if (dtr > 0.02 && dtr < 1.5) {
          let vx = (data.x - e.tx) / dtr, vy = (data.y - e.ty) / dtr;
          const sp = Math.hypot(vx, vy);
          if (sp > 900) { vx = vy = 0; } // 텔레포트(리스폰 등)는 외삽하지 않음
          e.vx = vx; e.vy = vy;
        }
        if (Math.hypot(data.x - e.x, data.y - e.y) > 800) { e.x = data.x; e.y = data.y; e.vx = e.vy = 0; }
        e.lastRecv = now;
      }
      e.tx = data.x; e.ty = data.y; e.ta = data.a || 0; e.tm = Math.max(1, data.m || 1);
      if (data.n != null) e.n = GF.sanitizeName(data.n);
      if (data.s != null) e.s = data.s | 0;
      e.b = !!data.b;
      e.cell = cell;
      e.serverT = data.t || e.serverT || 0;
    }

    _onFood(cell, slot, ts) {
      let m = this.foodState.get(cell);
      if (!m) { m = new Map(); this.foodState.set(cell, m); }
      if (ts == null) m.delete(slot); else m.set(slot, ts);
    }

    _onDrop(cell, id, data) {
      let m = this.drops.get(cell);
      if (!m) { m = new Map(); this.drops.set(cell, m); }
      if (data == null) m.delete(id); else m.set(id, data);
    }

    _onEvent(ev) {
      if (!this.me || !this.me.alive) return;
      const gain = Math.max(0, Math.min(ev.m || 0, C.MAX_MASS));
      this.me.m = Math.min(C.MAX_MASS, this.me.m + gain);
      this.me.kills++;
      this.ui.kill(ev.v || 'a fish', gain);
      this.renderer.spawnEatParticles(this.me.x + Math.cos(this.me.a) * this.me.r, this.me.y + Math.sin(this.me.a) * this.me.r, '#ffd166', 14, true);
    }

    // ---------------------------------------------------------
    _updateView(force) {
      const vr = this.renderer.viewRect(C.VIEW_MARGIN);
      const cells = GF.cellsInRect(vr.x0, vr.y0, vr.x1, vr.y1);
      if (!force && cells.length === this.subscribed.length && cells.every((c, i) => c === this.subscribed[i])) return;
      // 구독 해제되는 셀의 엔티티/먹이 상태 정리
      const next = new Set(cells);
      for (const c of this.subscribed) if (!next.has(c)) {
        for (const [uid, e] of this.others) if (e.cell === c) this.others.delete(uid);
        this.foodState.delete(c);
        this.drops.delete(c);
      }
      this.subscribed = cells;
      this.net.setView(cells);
    }

    _loop(t) {
      if (!this.running) { this._raf = 0; return; }
      let dt = (t - this.lastT) / 1000;
      this.lastT = t;
      if (dt > 0.05) dt = 0.05;
      if (dt < 0) dt = 0;
      this.time += dt;
      this._update(dt, t);
      if (!this.adPaused) this._render(dt);
      this._raf = requestAnimationFrame(this._loop);
    }

    // ---------------------------------------------------------
    _update(dt, nowPerf) {
      const me = this.me, net = this.net;
      const serverNow = net.now();
      if (net.step) net.step(dt);
      if (this.adPaused) return;

      if (me.alive) {
        // --- steering ---
        const inp = this.input.poll();
        me.r = GF.radius(me.m);
        if (inp.hasAngle) {
          const maxTurn = GF.turnRate(me.r) * dt;
          const d = GF.angleDiff(me.a, inp.angle);
          me.a += GF.clamp(d, -maxTurn, maxTurn);
        }
        let sp = GF.speed(me.r);
        me.boost = inp.boost && me.m > C.BOOST_MIN_MASS;
        if (me.boost) {
          sp *= C.BOOST_MULT;
          me.m -= Math.max(1, me.m * C.BOOST_COST) * dt;
          this.renderer.spawnBoostBubble(me.x, me.y, me.a, me.r);
        }
        me.x += Math.cos(me.a) * sp * dt;
        me.y += Math.sin(me.a) * sp * dt;
        const pad = me.r * 0.4;
        me.x = GF.clamp(me.x, pad, C.WORLD - pad);
        me.y = GF.clamp(me.y, pad, C.WORLD - pad);

        // --- decay ---
        if (me.m > C.DECAY_START) me.m -= (me.m - C.DECAY_START) * C.DECAY_RATE * dt;
        if (me.m > me.peak) me.peak = me.m;

        // --- eat food / drops ---
        this._eatAround(serverNow);

        // --- death check (victim authority) ---
        if (nowPerf > me.protectUntil) this._checkDeath(nowPerf);

        // --- network ---
        this.tickAcc += dt;
        if (this.tickAcc >= 1 / C.TICK_HZ) {
          this.tickAcc = 0;
          net.sendState(this._myRecord());
        }
        this.boardAcc += dt;
        if (this.boardAcc >= 1 / C.BOARD_HZ) {
          this.boardAcc = 0;
          net.sendBoard({ n: me.n, m: Math.round(me.m), s: me.s });
        }
      }

      // --- interpolate others ---
      const k = 1 - Math.exp(-dt * 11);
      const km = 1 - Math.exp(-dt * 5);
      for (const [uid, e] of this.others) {
        const age = Math.min(0.25, (nowPerf - e.lastRecv) / 1000);
        const px = e.tx + e.vx * age, py = e.ty + e.vy * age;
        e.x += (px - e.x) * k; e.y += (py - e.y) * k;
        e.a = GF.angleLerp(e.a, e.ta, k);
        e.m += (e.tm - e.m) * km;
        e.r = GF.radius(e.m);
        e.stale = nowPerf - e.lastRecv > C.STALE_MS;
        if (nowPerf - e.lastRecv > C.GHOST_MS && net.cleanupGhost) { net.cleanupGhost(uid, e.cell); this.others.delete(uid); }
      }

      // --- camera & subscriptions ---
      const target = me;
      this.renderer.followCamera(target.x, target.y, this.renderer.scaleFor(me.alive ? me.r : me.r * 1.5), dt);
      this.viewAcc += dt;
      if (this.viewAcc > 0.25) { this.viewAcc = 0; this._updateView(false); }

      // --- HUD ---
      this.hudAcc += dt;
      if (this.hudAcc > 0.2) {
        this.hudAcc = 0;
        let rank = this.myRank || '10+';
        const idx = this.board.findIndex((b) => b.uid === this.uid);
        if (idx >= 0) rank = idx + 1;
        if (!me.alive) rank = '-';
        this.ui.hud({ mass: me.m, rank, board: this.board, uid: this.uid, players: this.playerCount || this.board.length, room: this.room, boost: me.boost });
      }
    }

    _foodKey(cell, slot, ts) { return cell + ':' + slot + ':' + (ts || 0); }
    _resolveFood(cell, slot, ts, serverNow) {
      const key = this._foodKey(cell, slot, ts);
      let f = this.foodCache.get(key);
      if (f === undefined) {
        f = GF.foodAt(cell, slot, ts || 0);
        if (this.foodCache.size > 6000) this.foodCache.clear();
        this.foodCache.set(key, f);
      }
      if (ts && serverNow - ts <= f.respawn) return null;
      return f;
    }

    _eatAround(serverNow) {
      const me = this.me;
      const rr = me.r * 0.95;
      const x0 = me.x - rr, y0 = me.y - rr, x1 = me.x + rr, y1 = me.y + rr;
      const cells = GF.cellsInRect(x0, y0, x1, y1);
      me.mouthNear = false;
      for (const cell of cells) {
        const st = this.foodState.get(cell);
        for (let slot = 0; slot < C.FOOD_PER_CELL; slot++) {
          const ts = st ? st.get(slot) : 0;
          const f = this._resolveFood(cell, slot, ts, serverNow);
          if (!f) continue;
          const d2 = GF.dist2(me.x, me.y, f.x, f.y);
          if (d2 < (rr * 1.9) ** 2) me.mouthNear = true;
          if (d2 < rr * rr) {
            me.m = Math.min(C.MAX_MASS, me.m + f.value);
            me.foodEaten++;
            this._onFood(cell, slot, serverNow);           // optimistic
            this.net.eatFood(cell, slot);
            this.renderer.spawnEatParticles(f.x, f.y, f.type === 0 ? '#9ff5c8' : f.type === 1 ? '#ffb3b3' : '#cfe6ff', 5);
          }
        }
        const dm = this.drops.get(cell);
        if (dm) for (const [id, d] of dm) {
          if (serverNow - d.t > C.DROP_TTL_MS) { dm.delete(id); continue; }
          if (GF.dist2(me.x, me.y, d.x, d.y) < rr * rr) {
            me.m = Math.min(C.MAX_MASS, me.m + d.v);
            me.foodEaten++;
            dm.delete(id);
            this.net.eatDrop(cell, id);
            this.renderer.spawnEatParticles(d.x, d.y, '#ffd166', 6);
          }
        }
      }
    }

    _checkDeath(nowPerf) {
      const me = this.me;
      for (const [uid, e] of this.others) {
        if (e.stale) continue;
        if (!GF.canEat(e.tm, me.m)) continue;
        const er = GF.radius(e.tm);
        // 큰 물고기의 "입" 위치 (머리 앞쪽)
        const hx = e.x + Math.cos(e.a) * er * 0.45, hy = e.y + Math.sin(e.a) * er * 0.45;
        const reach = er * 0.72 + me.r * 0.25;
        if (GF.dist2(me.x, me.y, hx, hy) < reach * reach) { this._die(e); return; }
      }
    }

    _die(killer) {
      const me = this.me;
      me.alive = false;
      me.killedBy = killer.n || 'a fish';
      me.boost = false;
      me.deathAt = { x: me.x, y: me.y, m: me.m }; // 이어하기(보상형 광고)용
      const give = Math.round(me.m * C.KILL_SHARE);
      // 알갱이 흩뿌리기
      const dropMass = me.m * C.DROP_SHARE;
      const n = GF.clamp(Math.round(dropMass / 4), C.DROP_MIN, C.DROP_MAX);
      const drops = [];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * me.r * 1.6;
        drops.push({ x: Math.round(GF.clamp(me.x + Math.cos(a) * d, 5, C.WORLD - 5)), y: Math.round(GF.clamp(me.y + Math.sin(a) * d, 5, C.WORLD - 5)), v: Math.max(1, Math.round(dropMass / n)) });
      }
      this.net.die(killer.uid, { m: give, v: me.n }, drops);
      this.renderer.spawnEatParticles(me.x, me.y, GF.SKINS[me.s % GF.SKINS.length].body, 24, true);
      this.ui.death({
        killedBy: me.killedBy, peak: me.peak, kills: me.kills, foodEaten: me.foodEaten,
        time: performance.now() - me.born,
        mass: me.deathAt.m, continued: me.continued || 0,
      });
    }

    // ---------------------------------------------------------
    _render(dt) {
      const me = this.me, serverNow = this.net.now();
      const vr = this.renderer.viewRect(60);
      const visibleFood = [], visibleDrops = [];
      for (const cell of this.subscribed) {
        const [cx, cy] = GF.cellXY(cell);
        const bx0 = cx * C.CELL, by0 = cy * C.CELL;
        if (bx0 > vr.x1 || by0 > vr.y1 || bx0 + C.CELL < vr.x0 || by0 + C.CELL < vr.y0) continue;
        const st = this.foodState.get(cell);
        for (let slot = 0; slot < C.FOOD_PER_CELL; slot++) {
          const f = this._resolveFood(cell, slot, st ? st.get(slot) : 0, serverNow);
          if (f && f.x > vr.x0 && f.x < vr.x1 && f.y > vr.y0 && f.y < vr.y1) visibleFood.push(f);
        }
        const dm = this.drops.get(cell);
        if (dm) for (const d of dm.values()) if (serverNow - d.t < C.DROP_TTL_MS) visibleDrops.push(d);
      }

      const fishList = [];
      for (const e of this.others.values()) {
        if (e.stale) continue;
        if (e.x < vr.x0 - e.r * 2 || e.x > vr.x1 + e.r * 2 || e.y < vr.y0 - e.r * 2 || e.y > vr.y1 + e.r * 2) continue;
        const danger = me.alive && GF.canEat(e.tm, me.m);
        fishList.push({ x: e.x, y: e.y, a: e.a, r: e.r, skin: e.s || 0, boost: e.b, phase: e.phase, name: e.n, m: e.m, speedN: 1, mouth: 0, glow: danger ? 'rgba(255,80,80,0.55)' : null, massLabel: GF.fmtMass(e.m) });
      }
      if (me.alive) {
        const prot = performance.now() < me.protectUntil;
        fishList.push({ x: me.x, y: me.y, a: me.a, r: me.r, skin: me.s, boost: me.boost, phase: me.phase, name: me.n, m: me.m, isMe: true, speedN: 1, mouth: me.mouthNear ? 0.8 : 0, alpha: prot ? 0.55 + 0.25 * Math.sin(this.time * 12) : 1, glow: prot ? 'rgba(255,255,255,0.5)' : null });
      }
      fishList.sort((a, b) => a.m - b.m);

      this.renderer.draw({ visibleFood, visibleDrops, fishList }, this.time, dt);

      if (this.minimap) {
        const size = this.minimapCanvas.width;
        this.renderer.drawMinimap(this.minimap, size, me, this.others.values());
      }
    }
  }

  GF.Game = Game;
})();
