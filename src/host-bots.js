// ============================================================
// Deep Bite — BotHost: 온라인 방 인구 유지 (호스트가 굴리는 봇)
//
// 정책 (다른 .io 게임들의 방식):
//  - 방 인구(유저+봇)가 ONLINE_MIN_POP 미만이면 봇으로 채운다.
//  - 봇은 진짜 유저와 구분되지 않게 같은 이름 풀·같은 레코드 형식을 쓴다.
//  - 진짜 유저가 들어오면 봇은 하나씩 조용히 '퇴장'한다. (작은 봇부터)
//  - 봇이 먹히면 바로 리스폰하지 않고, 잠시 뒤 '새 유저가 들어온 것처럼' 새 이름으로 등장.
//
// 서버가 없으므로 방의 호스트(lease 보유 클라이언트)가 봇을 시뮬레이션해서 Firebase에 쓴다.
// 봇 id = `bot~{slot}` (방 안에서 고정). rules: 현재 호스트만 bot~ 레코드를 쓸 수 있음.
// 봇 상태 요약은 rooms/{room}/bots/{id} 에 1초마다 저장되고, 호스트가 바뀌면
// 다음 호스트가 그 상태를 그대로 이어받는다 (이름·위치·크기 유지 → 봇이 사라지지 않음).
// ============================================================
window.GF = window.GF || {};
(function () {
  const C = GF.CONFIG;
  const THINK_RANGE = 560;
  const BOT_PREFIX = 'bot~';

  class BotHost {
    constructor(net) {
      this.net = net;
      this.bots = [];
      this.subs = new Map();
      this.entities = new Map();
      this.foodState = new Map();
      this.drops = new Map();
      this.foodCache = new Map();
      this.rand = GF.rng((Math.random() * 1e9) | 0);
      this.running = false;
      this.ready = false;
      this.realCount = 1;
      this.target = 0;
      this.adjustAcc = 0; this.spawnAcc = 0; this.leaveAcc = 0; this.viewAcc = 0;
      this.firstBatch = true;
    }

    async start() {
      this.running = true;
      this.ready = false;
      this.adjustAcc = C.BOT_ADJUST_MS;
      this.spawnAcc = 1e9; this.leaveAcc = 0;
      await this._adopt();           // 이전 호스트가 남긴 봇을 이어받음
      this.firstBatch = this.bots.length === 0;
      this.ready = true;
    }

    // 시뮬레이션 중단. 레코드는 지우지 않음 → 다음 호스트가 이어받는다.
    stop() {
      this.running = false;
      this.ready = false;
      for (const b of this.bots) if (b.inboxUnsub) { b.inboxUnsub(); b.inboxUnsub = null; }
      this.bots = [];
      for (const [, u] of this.subs) u.forEach((f) => f());
      this.subs.clear(); this.entities.clear(); this.foodState.clear(); this.drops.clear();
    }

    setRealCount(n) { this.realCount = Math.max(1, n | 0); }
    get count() { return this.bots.length; }

    // ---------------------------------------------------------
    async _adopt() {
      const net = this.net, F = net.F;
      let snap;
      try { snap = await F.get(net.R('bots')); } catch (e) { return; }
      if (!this.running) return;
      const val = snap.val();
      if (!val) return;
      for (const [uid, v] of Object.entries(val)) {
        if (!uid.startsWith(BOT_PREFIX) || !v || typeof v.x !== 'number') continue;
        const bot = new GF.Bot(this.rand, false, uid);
        bot.n = GF.sanitizeName(v.n || bot.n);
        bot.s = (v.s | 0) % C.SKIN_COUNT;
        bot.x = GF.clamp(v.x, 0, C.WORLD); bot.y = GF.clamp(v.y, 0, C.WORLD);
        bot.a = v.a || 0; bot.targetA = bot.a;
        bot.m = GF.clamp(v.m || C.START_MASS, 1, C.MAX_MASS); bot.r = GF.radius(bot.m);
        bot.protectUntil = 1.5;
        const b = this._track(bot, uid);
        // 셀 레코드를 다시 기록 (유령 정리로 지워졌을 수 있음). 다른 셀에 남은 옛 레코드는 정리.
        const cell = GF.cellOf(bot.x, bot.y);
        const upd = {};
        if (v.cell && v.cell !== cell) upd[`rooms/${net.room}/cells/${v.cell}/${uid}`] = null;
        upd[`rooms/${net.room}/cells/${cell}/${uid}`] = Object.assign(this._record(b), { t: F.serverTimestamp() });
        upd[`rooms/${net.room}/board/${uid}`] = { n: bot.n, m: Math.round(bot.m), s: bot.s, t: F.serverTimestamp() };
        F.update(F.ref(net.db), upd).catch(() => {});
        b.cell = cell; b.ref = net.R(`cells/${cell}/${uid}`); b.lastStamp = Date.now();
      }
    }

    _freeSlot() {
      const used = new Set(this.bots.map((b) => b.uid));
      for (let i = 1; i <= C.ONLINE_BOT_MAX; i++) { const id = BOT_PREFIX + i; if (!used.has(id)) return id; }
      return null;
    }

    _track(bot, uid) {
      const net = this.net, F = net.F;
      const b = { bot, uid, cell: null, ref: null, boardRef: net.R(`board/${uid}`), tickAcc: this.rand() * 0.2, boardAcc: this.rand(), lastStamp: 0, inboxUnsub: null };
      b.inboxUnsub = F.onChildAdded(net.R(`events/${uid}`), (snap) => {
        const v = snap.val();
        F.remove(snap.ref).catch(() => {});
        if (v && typeof v.m === 'number') bot.m = Math.min(C.MAX_MASS, bot.m + Math.max(0, v.m));
      });
      this.bots.push(b);
      return b;
    }

    step(dt) {
      if (!this.running || !this.ready) return;
      const now = this.net.now();
      const perfNow = performance.now();

      // --- 인구 조절 ---
      this.adjustAcc += dt * 1000; this.spawnAcc += dt * 1000; this.leaveAcc += dt * 1000;
      if (this.adjustAcc >= C.BOT_ADJUST_MS) {
        this.adjustAcc = 0;
        this.target = GF.clamp(C.ONLINE_MIN_POP - this.realCount, 0, C.ONLINE_BOT_MAX);
      }
      if (this.bots.length < this.target && this.spawnAcc >= (this.firstBatch ? 200 : C.BOT_SPAWN_EVERY_MS)) {
        this.spawnAcc = 0;
        this._spawnBot(this.firstBatch);
      }
      if (this.bots.length >= this.target) this.firstBatch = false;
      if (this.bots.length > this.target && this.leaveAcc >= C.BOT_LEAVE_EVERY_MS) {
        this.leaveAcc = 0;
        const smallest = this.bots.slice().sort((a, b) => a.bot.m - b.bot.m)[0];
        if (smallest) this._removeBot(smallest);
      }

      // --- 봇 주변 셀 구독 ---
      this.viewAcc += dt;
      if (this.viewAcc > 0.5) { this.viewAcc = 0; this._updateSubs(); }

      // --- 봇이 보는 세계 ---
      const players = [];
      for (const e of this.entities.values()) if (perfNow - e.lastRecv <= C.STALE_MS) players.push(e);
      const botObjs = this.bots.map((b) => b.bot);
      const entities = players.concat(botObjs);
      const world = { entities, foodNear: (x, y, range) => this._foodNear(x, y, range, now) };

      for (const b of this.bots) {
        const bot = b.bot;
        bot.thinkT -= dt;
        if (bot.thinkT <= 0) { bot.thinkT = 0.15; bot.think(world); }
        bot.move(dt);
        this._botEat(b, now);
      }

      // --- 포식 판정 (내 봇이 먹히는 경우: 피해자 권한 = 호스트) ---
      for (const b of this.bots.slice()) {
        const bot = b.bot;
        if (bot.protectUntil > 0) continue;
        for (const o of entities) {
          if (o === bot || !GF.canEat(o.m, bot.m)) continue;
          const orr = GF.radius(o.m);
          const hx = o.x + Math.cos(o.a || 0) * orr * 0.45, hy = o.y + Math.sin(o.a || 0) * orr * 0.45;
          const reach = orr * 0.72 + bot.r * 0.25;
          if (GF.dist2(bot.x, bot.y, hx, hy) < reach * reach) { this._botDie(b, o); break; }
        }
      }

      // --- 네트워크 전송 ---
      const F = this.net.F, net = this.net;
      for (const b of this.bots) {
        b.tickAcc += dt; b.boardAcc += dt;
        if (b.tickAcc >= 1 / C.BOT_TICK_HZ) { b.tickAcc = 0; this._sendState(b); }
        if (b.boardAcc >= 1.0) {
          b.boardAcc = 0;
          const r = b.bot.record();
          const upd = {};
          upd[`rooms/${net.room}/board/${b.uid}/m`] = r.m;
          upd[`rooms/${net.room}/board/${b.uid}/t`] = F.serverTimestamp();
          upd[`rooms/${net.room}/bots/${b.uid}`] = { n: r.n, s: r.s, x: r.x, y: r.y, a: r.a, m: r.m, cell: b.cell };
          F.update(F.ref(net.db), upd).catch(() => {});
        }
      }
    }

    // ---------------------------------------------------------
    _spawnBot(big) {
      const net = this.net, F = net.F;
      const uid = this._freeSlot();
      if (!uid) return;
      const bot = new GF.Bot(this.rand, big, uid);
      bot.protectUntil = 3;
      const b = this._track(bot, uid);
      this._moveCell(b, GF.cellOf(bot.x, bot.y));
      const r = bot.record();
      const upd = {};
      upd[`rooms/${net.room}/board/${uid}`] = { n: bot.n, m: r.m, s: bot.s, t: F.serverTimestamp() };
      upd[`rooms/${net.room}/bots/${uid}`] = { n: r.n, s: r.s, x: r.x, y: r.y, a: r.a, m: r.m, cell: b.cell };
      F.update(F.ref(net.db), upd).catch(() => {});
    }

    _record(b) {
      const r = b.bot.record();
      return { n: r.n, s: r.s, x: r.x, y: r.y, a: r.a, m: r.m, b: r.b };
    }

    _moveCell(b, cell) {
      const net = this.net, F = net.F;
      const newRef = net.R(`cells/${cell}/${b.uid}`);
      const full = Object.assign(this._record(b), { t: F.serverTimestamp() });
      if (b.cell && b.cell !== cell) {
        const upd = {};
        upd[`rooms/${net.room}/cells/${b.cell}/${b.uid}`] = null;
        upd[`rooms/${net.room}/cells/${cell}/${b.uid}`] = full;
        F.update(F.ref(net.db), upd).catch(() => {});
      } else {
        F.set(newRef, full).catch(() => {});
      }
      b.cell = cell; b.ref = newRef; b.lastStamp = Date.now();
    }

    _sendState(b) {
      const F = this.net.F;
      const cell = GF.cellOf(b.bot.x, b.bot.y);
      if (cell !== b.cell) { this._moveCell(b, cell); return; }
      const r = b.bot.record();
      const hot = { x: r.x, y: r.y, a: r.a, m: r.m, b: r.b };
      if (Date.now() - b.lastStamp > C.STAMP_EVERY_MS) { hot.t = F.serverTimestamp(); b.lastStamp = Date.now(); }
      F.update(b.ref, hot).catch(() => {});
    }

    // 봇 퇴장/사망: 레코드 완전 삭제
    _removeBot(b) {
      const net = this.net, F = net.F;
      const i = this.bots.indexOf(b);
      if (i >= 0) this.bots.splice(i, 1);
      if (b.inboxUnsub) { b.inboxUnsub(); b.inboxUnsub = null; }
      const upd = {};
      if (b.cell) upd[`rooms/${net.room}/cells/${b.cell}/${b.uid}`] = null;
      upd[`rooms/${net.room}/board/${b.uid}`] = null;
      upd[`rooms/${net.room}/bots/${b.uid}`] = null;
      F.update(F.ref(net.db), upd).catch(() => {});
    }

    _botDie(b, killer) {
      const net = this.net, F = net.F;
      const bot = b.bot;
      const give = Math.round(bot.m * C.KILL_SHARE);
      const dropMass = bot.m * C.DROP_SHARE;
      const n = GF.clamp(Math.round(dropMass / 4), C.DROP_MIN, C.DROP_MAX);
      const upd = {};
      for (let i = 0; i < n; i++) {
        const a = this.rand() * Math.PI * 2, d = this.rand() * bot.r * 1.6;
        const x = Math.round(GF.clamp(bot.x + Math.cos(a) * d, 5, C.WORLD - 5)), y = Math.round(GF.clamp(bot.y + Math.sin(a) * d, 5, C.WORLD - 5));
        const id = F.push(net.R('drops')).key;
        upd[`rooms/${net.room}/drops/${GF.cellOf(x, y)}/${id}`] = { x, y, v: Math.max(1, Math.round(dropMass / n)), t: F.serverTimestamp() };
      }
      if (killer instanceof GF.Bot) {
        killer.m = Math.min(C.MAX_MASS, killer.m + give);
      } else if (killer && killer.uid) {
        const id = F.push(net.R('events')).key;
        upd[`rooms/${net.room}/events/${killer.uid}/${id}`] = { m: give, v: bot.n };
      }
      F.update(F.ref(net.db), upd).catch(() => {});
      this._removeBot(b);
      this.spawnAcc = 0; // 잠시 뒤 새 봇이 '새 유저처럼' 등장
    }

    // ---------------------------------------------------------
    _updateSubs() {
      const net = this.net, F = net.F;
      const want = new Set();
      for (const b of this.bots) {
        const r = THINK_RANGE + b.bot.r;
        for (const c of GF.cellsInRect(b.bot.x - r, b.bot.y - r, b.bot.x + r, b.bot.y + r)) want.add(c);
      }
      for (const [cell, u] of this.subs) if (!want.has(cell)) {
        u.forEach((f) => f());
        this.subs.delete(cell);
        for (const [uid, e] of this.entities) if (e.cell === cell) this.entities.delete(uid);
        this.foodState.delete(cell); this.drops.delete(cell);
      }
      for (const cell of want) {
        if (this.subs.has(cell)) continue;
        const unsubs = [];
        const pRef = net.R(`cells/${cell}`);
        const onP = (snap) => {
          const key = snap.key, v = snap.val();
          if (key.startsWith(BOT_PREFIX) || !v || typeof v.x !== 'number') return; // 봇은 로컬 상태를 씀
          let e = this.entities.get(key);
          if (!e) { e = { uid: key, alive: true, cell }; this.entities.set(key, e); }
          e.x = v.x; e.y = v.y; e.a = v.a || 0; e.m = Math.max(1, v.m || 1); e.r = GF.radius(e.m); e.n = v.n; e.cell = cell; e.lastRecv = performance.now();
        };
        unsubs.push(F.onChildAdded(pRef, onP), F.onChildChanged(pRef, onP), F.onChildRemoved(pRef, (snap) => {
          const e = this.entities.get(snap.key);
          if (e && e.cell === cell) this.entities.delete(snap.key);
        }));
        const fRef = net.R(`food/${cell}`);
        const onF = (snap) => { let m = this.foodState.get(cell); if (!m) { m = new Map(); this.foodState.set(cell, m); } m.set(+snap.key, snap.val()); };
        unsubs.push(F.onChildAdded(fRef, onF), F.onChildChanged(fRef, onF), F.onChildRemoved(fRef, (snap) => { const m = this.foodState.get(cell); if (m) m.delete(+snap.key); }));
        const dRef = net.R(`drops/${cell}`);
        const onD = (snap) => { let m = this.drops.get(cell); if (!m) { m = new Map(); this.drops.set(cell, m); } m.set(snap.key, snap.val()); };
        unsubs.push(F.onChildAdded(dRef, onD), F.onChildChanged(dRef, onD), F.onChildRemoved(dRef, (snap) => { const m = this.drops.get(cell); if (m) m.delete(snap.key); }));
        this.subs.set(cell, unsubs);
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
      let best = null, bd = range * range;
      for (const cell of GF.cellsInRect(x - range, y - range, x + range, y + range)) {
        if (!this.subs.has(cell)) continue;
        const st = this.foodState.get(cell);
        for (let slot = 0; slot < C.FOOD_PER_CELL; slot++) {
          const f = this._resolve(cell, slot, st ? st.get(slot) : 0, now);
          if (!f) continue;
          const d2 = GF.dist2(x, y, f.x, f.y) / (0.6 + f.value * 0.4);
          if (d2 < bd) { bd = d2; best = f; }
        }
        const dm = this.drops.get(cell);
        if (dm) for (const d of dm.values()) {
          if (now - d.t > C.DROP_TTL_MS) continue;
          const d2 = GF.dist2(x, y, d.x, d.y) / (1 + d.v * 0.3);
          if (d2 < bd) { bd = d2; best = d; }
        }
      }
      return best;
    }

    _botEat(b, now) {
      const net = this.net, F = net.F, bot = b.bot;
      const rr = bot.r * 0.95;
      for (const cell of GF.cellsInRect(bot.x - rr, bot.y - rr, bot.x + rr, bot.y + rr)) {
        if (!this.subs.has(cell)) continue;
        let st = this.foodState.get(cell);
        for (let slot = 0; slot < C.FOOD_PER_CELL; slot++) {
          const ts = st ? st.get(slot) : 0;
          const f = this._resolve(cell, slot, ts, now);
          if (!f) continue;
          if (GF.dist2(bot.x, bot.y, f.x, f.y) < rr * rr) {
            bot.m = Math.min(C.MAX_MASS, bot.m + f.value);
            if (!st) { st = new Map(); this.foodState.set(cell, st); }
            st.set(slot, now);
            F.set(net.R(`food/${cell}/${slot}`), F.serverTimestamp()).catch(() => {});
          }
        }
        const dm = this.drops.get(cell);
        if (dm) for (const [id, d] of dm) {
          if (now - d.t > C.DROP_TTL_MS) { dm.delete(id); continue; }
          if (GF.dist2(bot.x, bot.y, d.x, d.y) < rr * rr) {
            bot.m = Math.min(C.MAX_MASS, bot.m + d.v);
            dm.delete(id);
            F.remove(net.R(`drops/${cell}/${id}`)).catch(() => {});
          }
        }
      }
    }
  }
  GF.BotHost = BotHost;
})();
