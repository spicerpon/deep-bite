// ============================================================
// Deep Bite — bot AI (오프라인 모드 / 테스트용)
// 봇은 LocalNet 안에서만 살고, 네트워크 플레이어처럼 7Hz로 상태가 전달됩니다.
// ============================================================
window.GF = window.GF || {};
(function () {
  const C = GF.CONFIG;
  const NAMES = ['Finn', 'Gill', 'Bubbles', 'Coral', 'Pearl', 'Sandy', 'Kelp', 'Moby', 'Shelly', 'Wavy', 'Splash', 'Tide',
    'Reef', 'Guppy', 'Blub', 'Fathom', 'Nori', 'Mako', 'Scales', 'Puff', 'Drift', 'Marina', 'Otto', 'Pike', 'Roe', 'Sushi',
    'Chum', 'Ripple', 'Barnacle', 'Squirt', 'Flounder', 'Dorsal', 'Kraken Jr', 'Minnie', 'Bass', 'Cod', 'Haddock', 'Ling'];

  let seq = 0;
  class Bot {
    constructor(rand, startBig) {
      this.rand = rand;
      this.uid = 'bot' + (++seq) + GF.randId(3);
      this.n = NAMES[(rand() * NAMES.length) | 0];
      this.s = (rand() * C.SKIN_COUNT) | 0;
      this.aggression = rand();          // 0 = 소심, 1 = 사냥꾼
      this.skill = 0.5 + rand() * 0.5;   // 반응 속도
      this.respawn(startBig);
    }
    respawn(startBig) {
      const p = GF.randomSpawn(this.rand);
      this.x = p.x; this.y = p.y;
      this.a = this.rand() * Math.PI * 2;
      this.targetA = this.a;
      const u = this.rand();
      this.m = startBig ? (u < 0.6 ? 10 + this.rand() * 30 : u < 0.9 ? 40 + this.rand() * 160 : 200 + this.rand() * 600) : 10 + this.rand() * 25;
      this.r = GF.radius(this.m);
      this.boost = false;
      this.alive = true;
      this.wanderT = 0;
      this.thinkT = this.rand() * 0.15;
      this.protectUntil = 2.0;
      this.mode = 'wander';
    }

    // world: { entities: iterable of {uid,x,y,m,alive}, foodNear(x,y,range) -> [{x,y,value,cell,slot}|drops], time }
    think(world) {
      const me = this;
      let fleeX = 0, fleeY = 0, threat = null, threatD = 1e9;
      let prey = null, preyD = 1e9;
      for (const o of world.entities) {
        if (o === me || !o.alive) continue;
        const d = Math.hypot(o.x - me.x, o.y - me.y);
        if (GF.canEat(o.m, me.m) && d < 420 + o.r) {
          const w = 1 / Math.max(30, d - o.r);
          fleeX += (me.x - o.x) * w; fleeY += (me.y - o.y) * w;
          if (d < threatD) { threatD = d; threat = o; }
        } else if (GF.canEat(me.m, o.m) && d < 520 && d < preyD) { preyD = d; prey = o; }
      }

      let tx = null, ty = null;
      if (threat) {
        this.mode = 'flee';
        tx = me.x + fleeX * 1000; ty = me.y + fleeY * 1000;
        this.boost = threatD < 260 + threat.r && me.m > 45;
      } else if (prey && (this.aggression > 0.35 || preyD < 160) && prey.m > 6) {
        this.mode = 'hunt';
        // 약간 앞을 노림
        tx = prey.x + Math.cos(prey.a || 0) * 40; ty = prey.y + Math.sin(prey.a || 0) * 40;
        this.boost = preyD < 230 && me.m > 70 && this.aggression > 0.55;
      } else {
        this.boost = false;
        const f = world.foodNear(me.x, me.y, 480);
        if (f) { this.mode = 'eat'; tx = f.x; ty = f.y; }
        else {
          this.mode = 'wander';
          this.wanderT -= 0.15;
          if (this.wanderT <= 0) { this.wanderT = 1 + this.rand() * 2.5; this.targetA = this.a + (this.rand() - 0.5) * 2.4; }
        }
      }
      if (tx != null) this.targetA = Math.atan2(ty - me.y, tx - me.x);

      // 가장자리 회피
      const edge = 260;
      if (me.x < edge || me.y < edge || me.x > C.WORLD - edge || me.y > C.WORLD - edge) {
        const cx = C.WORLD / 2 - me.x, cy = C.WORLD / 2 - me.y;
        const toCenter = Math.atan2(cy, cx);
        this.targetA = GF.angleLerp(this.targetA, toCenter, 0.6);
      }
    }

    move(dt) {
      this.r = GF.radius(this.m);
      const maxTurn = GF.turnRate(this.r) * dt * this.skill * 1.2;
      const d = GF.angleDiff(this.a, this.targetA);
      this.a += GF.clamp(d, -maxTurn, maxTurn);
      let sp = GF.speed(this.r);
      if (this.boost && this.m > C.BOOST_MIN_MASS) { sp *= C.BOOST_MULT; this.m -= Math.max(1, this.m * C.BOOST_COST) * dt; }
      else this.boost = false;
      this.x += Math.cos(this.a) * sp * dt;
      this.y += Math.sin(this.a) * sp * dt;
      const pad = this.r * 0.4;
      this.x = GF.clamp(this.x, pad, C.WORLD - pad);
      this.y = GF.clamp(this.y, pad, C.WORLD - pad);
      if (this.m > C.DECAY_START) this.m -= (this.m - C.DECAY_START) * C.DECAY_RATE * dt;
      if (this.protectUntil > 0) this.protectUntil -= dt;
    }

    record() {
      return { n: this.n, s: this.s, x: Math.round(this.x), y: Math.round(this.y), a: Math.round(this.a * 100) / 100, m: Math.round(this.m), b: this.boost ? 1 : 0 };
    }
  }
  GF.Bot = Bot;
})();
