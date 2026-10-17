// ============================================================
// Deep Bite — LocalNet: 서버 없이 봇과 함께 플레이하는 가짜 네트워크
// FirebaseNet과 같은 인터페이스를 구현해서 게임 코드는 둘을 구분하지 않습니다.
// ============================================================
window.GF = window.GF || {};
(function () {
  const C = GF.CONFIG;

  class LocalNet {
    constructor(botCount = C.BOT_COUNT) {
      this.h = {};
      this.rand = GF.rng((Math.random() * 1e9) | 0);
      this.bots = [];
      for (let i = 0; i < botCount; i++) this.bots.push(new GF.Bot(this.rand, true));
      this.foodState = new Map();   // cell -> Map(slot -> ts)
      this.drops = new Map();       // cell -> Map(id -> drop)
      this.subscribed = new Set();
      this.me = null;
      this.tickAcc = 0;
      this.foodCache = new Map();
      this.time = 0;
      this.botCells = new Map();    // uid -> cell (마지막으로 전파한 셀)
    }

    on(evt, cb) { this.h[evt] = cb; }
    emit(evt, ...args) { if (this.h[evt]) this.h[evt](...args); }
    now() { return Date.now(); }

    async connect({ name, skin }) {
      this.uid = 'me_' + GF.randId(6);
      return { uid: this.uid, room: 'offline', offline: true };
    }
    spawn(rec) {
      this.me = Object.assign({ uid: this.uid, alive: true, r: GF.radius(rec.m) }, rec);
    }
    sendState(rec) {
      if (!this.me) return;
      Object.assign(this.me, rec);
      this.me.r = GF.radius(rec.m);
    }
    sendBoard() { this._emitBoard(); }
    _emitBoard() {
      const all = [];
      if (this.me && this.me.alive) all.push({ uid: this.uid, n: this.me.n, m: this.me.m, s: this.me.s });
      for (const b of this.bots) if (b.alive) all.push({ uid: b.uid, n: b.n, m: Math.round(b.m), s: b.s });
      all.sort((a, b) => b.m - a.m);
      const myRank = all.findIndex((e) => e.uid === this.uid);
      this.emit('board', all.slice(0, 10), all.length, myRank >= 0 ? myRank + 1 : null);
    }

    setView(cells) {
      const next = new Set(cells);
      // 새로 구독된 셀: 현재 상태를 즉시 전달
      for (const c of next) if (!this.subscribed.has(c)) {
        const fs = this.foodState.get(c);
        if (fs) for (const [slot, ts] of fs) this.emit('food', c, slot, ts);
        const ds = this.drops.get(c);
        if (ds) for (const [id, d] of ds) this.emit('drop', c, id, d);
        for (const b of this.bots) if (b.alive && this.botCells.get(b.uid) === c) this.emit('player', b.uid, b.record(), c);
      }
      this.subscribed = next;
    }

    eatFood(cell, slot) {
      let m = this.foodState.get(cell);
      if (!m) { m = new Map(); this.foodState.set(cell, m); }
      const ts = this.now();
      m.set(slot, ts);
      if (this.subscribed.has(cell)) this.emit('food', cell, slot, ts);
    }
    eatDrop(cell, id) {
      const m = this.drops.get(cell);
      if (m) m.delete(id);
    }
    _addDrops(list) {
      const t = this.now();
      for (const d of list) {
        const cell = GF.cellOf(d.x, d.y);
        let m = this.drops.get(cell);
        if (!m) { m = new Map(); this.drops.set(cell, m); }
        const id = GF.randId(6);
        const rec = { x: d.x, y: d.y, v: d.v, t };
        m.set(id, rec);
        if (this.subscribed.has(cell)) this.emit('drop', cell, id, rec);
      }
    }
    die(killerUid, ev, drops) {
      if (this.me) this.me.alive = false;
      this._addDrops(drops);
      const k = this.bots.find((b) => b.uid === killerUid);
      if (k && k.alive) k.m = Math.min(C.MAX_MASS, k.m + ev.m);
    }
    disconnect() { this.me = null; }

    // ---- 봇 세계 시뮬레이션 (게임 루프에서 매 프레임 호출) ----
    step(dt) {
      this.time += dt;
      const now = this.now();
      const entities = this.bots.slice();
      if (this.me && this.me.alive) entities.push(this.me);
      const world = {
        entities,
        foodNear: (x, y, range) => this._foodNear(x, y, range, now),
      };

      for (const b of this.bots) {
        if (!b.alive) {
          b.respawnT -= dt;
          if (b.respawnT <= 0) {
            b.respawn(false);
            this.botCells.delete(b.uid);
          }
          continue;
        }
        b.thinkT -= dt;
        if (b.thinkT <= 0) { b.thinkT = 0.15; b.think(world); }
        b.move(dt);
        this._botEat(b, now);
      }
      // 포식 판정 (피해자 기준) — 봇이 먹히는 경우
      for (const b of this.bots) {
        if (!b.alive || b.protectUntil > 0) continue;
        for (const o of entities) {
          if (o === b || !o.alive || !GF.canEat(o.m, b.m)) continue;
          const orr = GF.radius(o.m);
          const hx = o.x + Math.cos(o.a) * orr * 0.45, hy = o.y + Math.sin(o.a) * orr * 0.45;
          const reach = orr * 0.72 + b.r * 0.25;
          if (GF.dist2(b.x, b.y, hx, hy) < reach * reach) { this._botDie(b, o); break; }
        }
      }

      // 네트워크처럼 TICK_HZ로 상태 전파
      this.tickAcc += dt;
      if (this.tickAcc >= 1 / C.TICK_HZ) {
        this.tickAcc = 0;
        for (const b of this.bots) {
          if (!b.alive) continue;
          const cell = GF.cellOf(b.x, b.y);
          const prev = this.botCells.get(b.uid);
          if (prev !== cell) {
            if (prev && this.subscribed.has(prev)) this.emit('player', b.uid, null, prev);
            this.botCells.set(b.uid, cell);
          }
          if (this.subscribed.has(cell)) this.emit('player', b.uid, b.record(), cell);
        }
      }
    }

    _resolve(cell, slot, ts, now) {
      const key = cell + ':' + slot + ':' + (ts || 0);
      let f = this.foodCache.get(key);
      if (f === undefined) {
        f = GF.foodAt(cell, slot, ts || 0);
        if (this.foodCache.size > 6000) this.foodCache.clear();
        this.foodCache.set(key, f);
      }
      if (ts && now - ts <= f.respawn) return null;
      return f;
    }

    _foodNear(x, y, range, now) {
      const cells = GF.cellsInRect(x - range, y - range, x + range, y + range);
      let best = null, bd = range * range;
      for (const cell of cells) {
        const st = this.foodState.get(cell);
        for (let slot = 0; slot < C.FOOD_PER_CELL; slot++) {
          const f = this._resolve(cell, slot, st ? st.get(slot) : 0, now);
          if (!f) continue;
          const d2 = GF.dist2(x, y, f.x, f.y) / (0.6 + f.value * 0.4); // 가치 높은 먹이 선호
          if (d2 < bd) { bd = d2; best = f; }
        }
        const dm = this.drops.get(cell);
        if (dm) for (const d of dm.values()) {
          const d2 = GF.dist2(x, y, d.x, d.y) / (1 + d.v * 0.3);
          if (d2 < bd) { bd = d2; best = d; }
        }
      }
      return best;
    }

    _botEat(b, now) {
      const rr = b.r * 0.95;
      const cells = GF.cellsInRect(b.x - rr, b.y - rr, b.x + rr, b.y + rr);
      for (const cell of cells) {
        let st = this.foodState.get(cell);
        for (let slot = 0; slot < C.FOOD_PER_CELL; slot++) {
          const ts = st ? st.get(slot) : 0;
          const f = this._resolve(cell, slot, ts, now);
          if (!f) continue;
          if (GF.dist2(b.x, b.y, f.x, f.y) < rr * rr) {
            b.m = Math.min(C.MAX_MASS, b.m + f.value);
            if (!st) { st = new Map(); this.foodState.set(cell, st); }
            st.set(slot, now);
            if (this.subscribed.has(cell)) this.emit('food', cell, slot, now);
          }
        }
        const dm = this.drops.get(cell);
        if (dm) for (const [id, d] of dm) {
          if (now - d.t > C.DROP_TTL_MS) { dm.delete(id); if (this.subscribed.has(cell)) this.emit('drop', cell, id, null); continue; }
          if (GF.dist2(b.x, b.y, d.x, d.y) < rr * rr) {
            b.m = Math.min(C.MAX_MASS, b.m + d.v);
            dm.delete(id);
            if (this.subscribed.has(cell)) this.emit('drop', cell, id, null);
          }
        }
      }
    }

    _botDie(b, killer) {
      b.alive = false;
      b.respawnT = 2 + this.rand() * 4;
      const give = Math.round(b.m * C.KILL_SHARE);
      const dropMass = b.m * C.DROP_SHARE;
      const n = GF.clamp(Math.round(dropMass / 4), C.DROP_MIN, C.DROP_MAX);
      const drops = [];
      for (let i = 0; i < n; i++) {
        const a = this.rand() * Math.PI * 2, d = this.rand() * b.r * 1.6;
        drops.push({ x: Math.round(GF.clamp(b.x + Math.cos(a) * d, 5, C.WORLD - 5)), y: Math.round(GF.clamp(b.y + Math.sin(a) * d, 5, C.WORLD - 5)), v: Math.max(1, Math.round(dropMass / n)) });
      }
      this._addDrops(drops);
      const cell = this.botCells.get(b.uid);
      if (cell && this.subscribed.has(cell)) this.emit('player', b.uid, null, cell);
      this.botCells.delete(b.uid);
      if (killer === this.me) this.emit('event', { m: give, v: b.n });
      else killer.m = Math.min(C.MAX_MASS, killer.m + give);
    }
  }
  GF.LocalNet = LocalNet;
})();
