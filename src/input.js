// ============================================================
// Deep Bite — input (mouse / touch / keyboard)
// 물고기는 항상 앞으로 헤엄치고, 포인터(또는 키) 방향으로 머리를 돌립니다.
// ============================================================
window.GF = window.GF || {};
(function () {
  class Input {
    constructor(canvas, boostBtn) {
      this.canvas = canvas;
      this.angle = 0;           // 원하는 진행 방향 (rad, 화면 기준 = 월드 기준)
      this.hasAngle = false;
      this.boost = false;
      this.pointer = null;      // {x,y} CSS px
      this.keys = new Set();
      this.touchId = null;
      this.isTouch = false;
      this.mouseDown = false;
      this.btnDown = false;

      const rectOf = () => canvas.getBoundingClientRect();
      const setPointer = (cx, cy) => {
        const r = rectOf();
        this.pointer = { x: cx - r.left, y: cy - r.top };
        this._updateAngleFromPointer();
      };

      canvas.addEventListener('mousemove', (e) => { if (!this.isTouch) setPointer(e.clientX, e.clientY); });
      canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { this.mouseDown = true; setPointer(e.clientX, e.clientY); } });
      window.addEventListener('mouseup', () => { this.mouseDown = false; });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());

      canvas.addEventListener('touchstart', (e) => {
        this.isTouch = true;
        for (const t of e.changedTouches) {
          if (this.touchId == null) { this.touchId = t.identifier; setPointer(t.clientX, t.clientY); }
          else this.btnDown = true; // 두 번째 손가락 = 부스트
        }
        e.preventDefault();
      }, { passive: false });
      canvas.addEventListener('touchmove', (e) => {
        for (const t of e.changedTouches) if (t.identifier === this.touchId) setPointer(t.clientX, t.clientY);
        e.preventDefault();
      }, { passive: false });
      const touchEnd = (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === this.touchId) this.touchId = null;
        }
        if (e.touches.length <= 1) this.btnDown = false;
      };
      canvas.addEventListener('touchend', touchEnd);
      canvas.addEventListener('touchcancel', touchEnd);

      if (boostBtn) {
        const down = (e) => { this.btnDown = true; e.preventDefault(); };
        const up = (e) => { this.btnDown = false; e.preventDefault(); };
        boostBtn.addEventListener('touchstart', down, { passive: false });
        boostBtn.addEventListener('touchend', up);
        boostBtn.addEventListener('touchcancel', up);
        boostBtn.addEventListener('mousedown', down);
        boostBtn.addEventListener('mouseup', up);
      }

      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        this.keys.add(e.code);
        if (e.code === 'Space') e.preventDefault();
      });
      window.addEventListener('keyup', (e) => this.keys.delete(e.code));
      window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; this.btnDown = false; });
    }

    _updateAngleFromPointer() {
      if (!this.pointer) return;
      const cx = this.canvas.clientWidth / 2, cy = this.canvas.clientHeight / 2;
      const dx = this.pointer.x - cx, dy = this.pointer.y - cy;
      if (dx * dx + dy * dy < 12 * 12) return; // 중심 근처면 방향 유지 (떨림 방지)
      this.angle = Math.atan2(dy, dx);
      this.hasAngle = true;
    }

    // 매 프레임 호출: 키보드 방향이 있으면 우선
    poll() {
      let kx = 0, ky = 0;
      if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) kx -= 1;
      if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) kx += 1;
      if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) ky -= 1;
      if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) ky += 1;
      if (kx || ky) { this.angle = Math.atan2(ky, kx); this.hasAngle = true; }
      this.boost = this.mouseDown || this.btnDown || this.keys.has('Space') || this.keys.has('ShiftLeft');
      return { angle: this.angle, hasAngle: this.hasAngle, boost: this.boost };
    }

    reset() { this.hasAngle = false; this.boost = false; this.mouseDown = false; this.btnDown = false; this.touchId = null; }
  }
  GF.Input = Input;
})();
