// ============================================================
// Deep Bite — FirebaseNet: Firebase Realtime Database 기반 네트워크
//
// DB 구조 (rooms/{room}/...)
//   cells/{cell}/{uid}   = {n,s,x,y,a,m,b,t}   ← 위치 등 핫 데이터 (셀 단위 구독)
//   food/{cell}/{slot}   = eatenTs               ← 먹이는 "먹힌 시각"만 저장
//   drops/{cell}/{id}    = {x,y,v,t}             ← 죽은 물고기 알갱이
//   events/{uid}/{id}    = {m,v}                 ← 킬 보상 inbox (피해자가 킬러에게 보냄)
//   board/{uid}          = {n,m,s,t}             ← 리더보드 (orderByChild m, limitToLast 10)
//
// Firebase SDK는 설정이 있을 때만 동적으로 import 합니다. (오프라인 모드에선 로드 안 함)
// ============================================================
window.GF = window.GF || {};
(function () {
  const C = GF.CONFIG;
  const VER = '12.4.0';
  const BASE = `https://www.gstatic.com/firebasejs/${VER}/`;

  GF.hasFirebaseConfig = () => {
    const c = window.GF_FIREBASE_CONFIG;
    return !!(c && c.apiKey && c.databaseURL);
  };

  class FirebaseNet {
    constructor(config) {
      this.cfg = config;
      this.h = {};
      this.offset = 0;
      this.subs = new Map();
      this.myCell = null;
      this.myRef = null;
      this.boardRef = null;
      this.lastStamp = 0;
      this.alive = false;
      this.boardCount = 0;   // 방 전체 인구 (봇 포함) — HUD 표시용
      this.realCount = 1;    // 진짜 유저 수 — 방 배정/봇 수 결정용
      this.globalUnsubs = [];
      // 호스트(봇 운영) 관련
      this.isHost = false;
      this.botHost = null;
      this.hostRef = null;
      this.lastHostVal = null;
      this.claimTimer = null;
      this.beatTimer = null;
      this.hostCheckTimer = null;
    }
    on(evt, cb) { this.h[evt] = cb; }
    emit(evt, ...args) { if (this.h[evt]) this.h[evt](...args); }
    now() { return Date.now() + this.offset; }

    async connect({ name, skin }) {
      let appMod, authMod, dbMod;
      try {
        [appMod, authMod, dbMod] = await Promise.all([
          import(BASE + 'firebase-app.js'),
          import(BASE + 'firebase-auth.js'),
          import(BASE + 'firebase-database.js'),
        ]);
      } catch (e) {
        throw new Error('Firebase SDK를 불러올 수 없습니다. 네트워크/CSP를 확인하세요.');
      }
      this.F = dbMod;
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(this.cfg);
      const auth = authMod.getAuth(app);
      try {
        const cred = await authMod.signInAnonymously(auth);
        // 같은 브라우저의 여러 탭이 익명 계정을 공유하므로, 플레이어 id는 탭마다 다르게 (rules: auth.uid + '~' 접두 허용)
        this.authUid = cred.user.uid;
        this.uid = cred.user.uid + '~p' + GF.randId(4);
      } catch (e) {
        const code = e && e.code || '';
        if (code.includes('operation-not-allowed') || code.includes('admin-restricted'))
          throw new Error('Firebase 콘솔 > Authentication > Sign-in method 에서 "익명(Anonymous)" 로그인을 켜주세요.');
        if (code.includes('configuration-not-found'))
          throw new Error('Firebase 콘솔에서 Authentication을 먼저 시작(Get started)해주세요.');
        throw new Error('로그인 실패: ' + (e.message || code));
      }
      this.db = dbMod.getDatabase(app);
      const F = this.F, db = this.db;

      this.globalUnsubs.push(F.onValue(F.ref(db, '.info/serverTimeOffset'), (s) => { this.offset = s.val() || 0; }));
      let wasConnected = null;
      this.globalUnsubs.push(F.onValue(F.ref(db, '.info/connected'), (s) => {
        const ok = s.val() === true;
        if (wasConnected === true && !ok) this.emit('error', '연결이 끊겼습니다. 다시 연결 중…');
        // 재연결: 서버에서 onDisconnect로 내 레코드가 지워졌을 수 있으므로 다시 씀
        if (wasConnected === false && ok && this.alive && this.lastRec) this.resync(this.lastRec);
        wasConnected = ok;
      }));

      try {
        this.room = await this._pickRoom();
      } catch (e) {
        if (String(e && e.message).toLowerCase().includes('permission'))
          throw new Error('DB 권한 오류: database.rules.json 의 규칙을 Realtime Database > 규칙에 적용했는지 확인하세요.');
        throw e;
      }
      const R = (p) => F.ref(db, `rooms/${this.room}/${p}`);
      this.R = R;

      // 킬 보상 inbox
      this.globalUnsubs.push(F.onChildAdded(R(`events/${this.uid}`), (snap) => {
        const v = snap.val();
        F.remove(snap.ref).catch(() => {});
        if (v && typeof v.m === 'number') this.emit('event', v);
      }));

      // 리더보드 top 10
      const q = F.query(R('board'), F.orderByChild('m'), F.limitToLast(10));
      this.globalUnsubs.push(F.onValue(q, (snap) => {
        const list = [];
        snap.forEach((ch) => { const v = ch.val(); if (v) list.push({ uid: ch.key, n: v.n, m: v.m, s: v.s }); });
        list.sort((a, b) => b.m - a.m);
        this.emit('board', list, this.boardCount);
      }));
      // 접속자 수 (15초마다 가볍게 갱신)
      this.countTimer = setInterval(() => this._refreshCount(), 15000);

      // 호스트 선출 (방 인구 유지용 봇 운영자)
      this._initHost();
      this._visHandler = () => {
        if (document.visibilityState === 'hidden') { if (this.isHost) this._releaseHost(); }
        else this._maybeClaim();
      };
      document.addEventListener('visibilitychange', this._visHandler);

      return { uid: this.uid, room: this.room };
    }

    // board 엔트리를 세어 {all, real} 반환. 봇 id는 'bot~'로 시작 (플레이어는 '{auth}~p...').
    async _countRoom(name) {
      const F = this.F;
      const snap = await F.get(F.ref(this.db, `rooms/${name}/board`));
      let all = 0, real = 0; const now = this.now();
      snap.forEach((ch) => {
        const v = ch.val();
        if (v && (!v.t || now - v.t < C.GHOST_MS)) { all++; if (!ch.key.startsWith('bot~')) real++; }
      });
      return { all, real };
    }
    async _pickRoom() {
      for (let i = 1; i <= C.MAX_ROOMS; i++) {
        const name = `${C.ROOM_PREFIX}-${i}`;
        const c = await this._countRoom(name);
        if (c.real < C.ROOM_CAP) { this.boardCount = c.all + 1; this.realCount = c.real + 1; return name; }
      }
      return `${C.ROOM_PREFIX}-${1 + Math.floor(Math.random() * C.MAX_ROOMS)}`;
    }
    async _refreshCount() {
      try {
        const c = await this._countRoom(this.room);
        this.boardCount = c.all; this.realCount = Math.max(1, c.real);
        if (this.botHost) this.botHost.setRealCount(this.realCount);
      } catch (e) { /* ignore */ }
    }

    // ---------------- host election (population policy) ----------------
    _initHost() {
      const F = this.F;
      this.hostRef = this.R('host');
      this.globalUnsubs.push(F.onValue(this.hostRef, (snap) => {
        const v = snap.val();
        this.lastHostVal = v;
        if (v && v.sid === this.uid) { this._becomeHost(); return; }
        if (this.isHost) this._loseHost();
        this._maybeClaim();
      }));
      this.hostCheckTimer = setInterval(() => this._maybeClaim(), 5000);
    }
    _hostIsStale() {
      const v = this.lastHostVal;
      return !v || !v.t || this.now() - v.t > C.HOST_STALE_MS;
    }
    _maybeClaim() {
      if (this.isHost || this.claimTimer || !this.F || document.visibilityState === 'hidden') return;
      if (!this._hostIsStale()) return;
      this.claimTimer = setTimeout(() => {
        this.claimTimer = null;
        if (this.isHost || !this._hostIsStale()) return;
        this.F.runTransaction(this.hostRef, (cur) => {
          const now = this.now();
          if (!cur || !cur.t || now - cur.t > C.HOST_STALE_MS) return { uid: this.authUid, sid: this.uid, t: now };
          return; // 다른 호스트가 살아있음 → 중단
        }).catch(() => {});
      }, 300 + Math.random() * 1500);
    }
    _becomeHost() {
      if (this.isHost) return;
      const F = this.F;
      this.isHost = true;
      F.onDisconnect(this.hostRef).remove();
      this.beatTimer = setInterval(() => { F.update(this.hostRef, { t: F.serverTimestamp() }).catch(() => {}); }, C.HOST_BEAT_MS);
      if (!this.botHost && GF.BotHost) this.botHost = new GF.BotHost(this);
      if (this.botHost) { this.botHost.setRealCount(this.realCount); this.botHost.start(); }
      this.emit('host', true);
    }
    _loseHost() {
      if (!this.isHost) return;
      this.isHost = false;
      if (this.beatTimer) { clearInterval(this.beatTimer); this.beatTimer = null; }
      if (this.hostRef) this.F.onDisconnect(this.hostRef).cancel();
      if (this.botHost) this.botHost.stop();
      this.emit('host', false);
    }
    _releaseHost() {
      if (!this.isHost) return;
      this._loseHost();
      this.F.remove(this.hostRef).catch(() => {});
    }
    // 게임 루프에서 매 프레임 호출 — 호스트일 때만 봇 시뮬레이션
    step(dt) {
      if (this.isHost && this.botHost) this.botHost.step(dt);
    }

    // ---------------- my state ----------------
    spawn(rec) {
      const F = this.F;
      this.alive = true;
      this.myCell = null;
      this.lastRec = rec;
      this._moveCell(GF.cellOf(rec.x, rec.y), rec);
      this.boardRef = this.R(`board/${this.uid}`);
      F.onDisconnect(this.boardRef).remove();
      F.set(this.boardRef, { n: rec.n, m: rec.m, s: rec.s, t: F.serverTimestamp() }).catch((e) => this._permErr(e));
    }

    _moveCell(cell, rec) {
      const F = this.F;
      const newRef = this.R(`cells/${cell}/${this.uid}`);
      F.onDisconnect(newRef).remove();
      const full = { n: rec.n, s: rec.s, x: rec.x, y: rec.y, a: rec.a, m: rec.m, b: rec.b, t: F.serverTimestamp() };
      if (this.myCell && this.myCell !== cell) {
        const upd = {};
        upd[`rooms/${this.room}/cells/${this.myCell}/${this.uid}`] = null;
        upd[`rooms/${this.room}/cells/${cell}/${this.uid}`] = full;
        F.update(F.ref(this.db), upd).catch((e) => this._permErr(e));
        F.onDisconnect(this.myRef).cancel();
      } else {
        F.set(newRef, full).catch((e) => this._permErr(e));
      }
      this.myCell = cell;
      this.myRef = newRef;
      this.lastStamp = Date.now();
    }

    // 탭 복귀/재연결 시 전체 레코드를 다시 기록 (유령 정리로 지워졌을 수 있음)
    resync(rec) {
      if (!this.alive || !this.F) return;
      const F = this.F;
      this.lastRec = rec;
      const cell = GF.cellOf(rec.x, rec.y);
      if (this.myRef && this.myCell && this.myCell !== cell) F.remove(this.myRef).catch(() => {});
      this.myCell = null;
      this._moveCell(cell, rec);
      if (this.boardRef) {
        F.onDisconnect(this.boardRef).remove();
        F.set(this.boardRef, { n: rec.n, m: rec.m, s: rec.s, t: F.serverTimestamp() }).catch(() => {});
      }
    }

    sendState(rec) {
      if (!this.alive) return;
      this.lastRec = rec;
      const cell = GF.cellOf(rec.x, rec.y);
      if (cell !== this.myCell) { this._moveCell(cell, rec); return; }
      const hot = { x: rec.x, y: rec.y, a: rec.a, m: rec.m, b: rec.b };
      if (Date.now() - this.lastStamp > C.STAMP_EVERY_MS) { hot.t = this.F.serverTimestamp(); this.lastStamp = Date.now(); }
      this.F.update(this.myRef, hot).catch(() => {});
    }

    sendBoard(b) {
      if (!this.alive || !this.boardRef) return;
      this.F.update(this.boardRef, { m: b.m, t: this.F.serverTimestamp() }).catch(() => {});
    }

    // ---------------- interest management ----------------
    setView(cells) {
      const F = this.F, R = this.R;
      const next = new Set(cells);
      for (const [cell, s] of this.subs) if (!next.has(cell)) { s.forEach((u) => u()); this.subs.delete(cell); }
      for (const cell of next) {
        if (this.subs.has(cell)) continue;
        const unsubs = [];
        const pRef = R(`cells/${cell}`);
        const onP = (snap) => { const v = snap.val(); if (v && typeof v.x === 'number') this.emit('player', snap.key, v, cell); };
        unsubs.push(F.onChildAdded(pRef, onP), F.onChildChanged(pRef, onP), F.onChildRemoved(pRef, (snap) => this.emit('player', snap.key, null, cell)));
        const fRef = R(`food/${cell}`);
        const onF = (snap) => this.emit('food', cell, +snap.key, snap.val());
        unsubs.push(F.onChildAdded(fRef, onF), F.onChildChanged(fRef, onF), F.onChildRemoved(fRef, (snap) => this.emit('food', cell, +snap.key, null)));
        const dRef = R(`drops/${cell}`);
        const onD = (snap) => this.emit('drop', cell, snap.key, snap.val());
        unsubs.push(F.onChildAdded(dRef, onD), F.onChildChanged(dRef, onD), F.onChildRemoved(dRef, (snap) => this.emit('drop', cell, snap.key, null)));
        this.subs.set(cell, unsubs);
      }
    }

    // ---------------- actions ----------------
    eatFood(cell, slot) {
      this.F.set(this.R(`food/${cell}/${slot}`), this.F.serverTimestamp()).catch(() => {});
    }
    eatDrop(cell, id) {
      this.F.remove(this.R(`drops/${cell}/${id}`)).catch(() => {});
    }
    die(killerUid, ev, drops) {
      const F = this.F;
      this.alive = false;
      const upd = {};
      for (const d of drops) {
        const cell = GF.cellOf(d.x, d.y);
        const id = F.push(this.R('drops')).key;
        upd[`rooms/${this.room}/drops/${cell}/${id}`] = { x: d.x, y: d.y, v: d.v, t: F.serverTimestamp() };
      }
      if (killerUid) {
        const id = F.push(this.R('events')).key;
        upd[`rooms/${this.room}/events/${killerUid}/${id}`] = { m: ev.m, v: ev.v };
      }
      if (this.myCell) upd[`rooms/${this.room}/cells/${this.myCell}/${this.uid}`] = null;
      upd[`rooms/${this.room}/board/${this.uid}`] = null;
      F.update(F.ref(this.db), upd).catch(() => {});
      if (this.myRef) F.onDisconnect(this.myRef).cancel();
      if (this.boardRef) F.onDisconnect(this.boardRef).cancel();
      this.myCell = null; this.myRef = null;
    }
    // 오랫동안 갱신 없는 유령 레코드 정리 (rules가 허용하는 경우에만 성공)
    cleanupGhost(uid, cell) {
      if (cell) this.F.remove(this.R(`cells/${cell}/${uid}`)).catch(() => {});
      this.F.remove(this.R(`board/${uid}`)).catch(() => {});
    }

    _permErr(e) {
      const msg = String(e && e.message || e);
      if (msg.toLowerCase().includes('permission')) this.emit('error', 'DB 쓰기 거부: Realtime Database 규칙(database.rules.json)을 확인하세요.');
    }

    disconnect() {
      const F = this.F;
      if (!F) return;
      this._releaseHost();
      if (this.hostCheckTimer) clearInterval(this.hostCheckTimer);
      if (this.claimTimer) { clearTimeout(this.claimTimer); this.claimTimer = null; }
      if (this._visHandler) document.removeEventListener('visibilitychange', this._visHandler);
      for (const [, s] of this.subs) s.forEach((u) => u());
      this.subs.clear();
      this.globalUnsubs.forEach((u) => u());
      this.globalUnsubs = [];
      if (this.countTimer) clearInterval(this.countTimer);
      if (this.alive) {
        const upd = {};
        if (this.myCell) upd[`rooms/${this.room}/cells/${this.myCell}/${this.uid}`] = null;
        upd[`rooms/${this.room}/board/${this.uid}`] = null;
        F.update(F.ref(this.db), upd).catch(() => {});
      }
      this.alive = false;
    }
  }
  GF.FirebaseNet = FirebaseNet;
})();
