// ============================================================
// Deep Bite — procedural fish / food drawing (Canvas 2D)
// 모든 그리기는 "물고기가 +x 방향을 보는 로컬 좌표"에서 수행.
// ============================================================
window.GF = window.GF || {};
(function () {
  // 스킨 팔레트. pattern: 'bands' | 'tangs' | 'none' | 'scales' | 'veil' | 'stripe' | 'waves' | 'dots' | 'koi' | 'lion'
  GF.SKINS = [
    { name: 'Clown',    body: '#ff7a1a', belly: '#ffc07a', fin: '#ff9a40', dark: '#8a3a00', pattern: 'bands' },
    { name: 'Tang',     body: '#2b6cff', belly: '#6f9dff', fin: '#ffd400', dark: '#0b2a7a', pattern: 'tangs' },
    { name: 'Lemon',    body: '#ffd21f', belly: '#fff0a0', fin: '#ffb400', dark: '#8a6a00', pattern: 'none' },
    { name: 'Parrot',   body: '#1fb48d', belly: '#8ff0d0', fin: '#ff6fa5', dark: '#0a5a44', pattern: 'scales' },
    { name: 'Betta',    body: '#7b3fe4', belly: '#b893ff', fin: '#ff4d94', dark: '#3a1480', pattern: 'veil' },
    { name: 'Snapper',  body: '#e23e3e', belly: '#ff9a90', fin: '#b82727', dark: '#6e0f0f', pattern: 'stripe' },
    { name: 'Mackerel', body: '#8fa6bf', belly: '#eaf2fa', fin: '#5f7590', dark: '#2a3a4e', pattern: 'waves' },
    { name: 'Anthias',  body: '#ff5fc1', belly: '#ffbce9', fin: '#ffd166', dark: '#8a1f66', pattern: 'dots' },
    { name: 'Koi',      body: '#f7f2e8', belly: '#ffffff', fin: '#f0e8d8', dark: '#6a6050', pattern: 'koi' },
    { name: 'Lion',     body: '#c76b3a', belly: '#f0c39a', fin: '#8a3b1f', dark: '#4a1c0a', pattern: 'lion' },
  ];

  function ellipse(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  }

  /**
   * 물고기 그리기
   * @param ctx    canvas context (이미 카메라 변환 적용됨)
   * @param f      {x, y, a, r, skin, boost}
   * @param t      time (seconds) — 꼬리 흔들림 등
   * @param opt    {alpha, mouth(0..1), speed, glow}
   */
  GF.drawFish = function (ctx, f, t, opt = {}) {
    const S = GF.SKINS[f.skin % GF.SKINS.length];
    const r = f.r;
    const alpha = opt.alpha == null ? 1 : opt.alpha;
    const speedN = opt.speed == null ? 1 : opt.speed; // 1 = 보통
    const wagHz = (1.6 + speedN * 1.2) * (f.boost ? 1.6 : 1);
    const wag = Math.sin(t * wagHz * Math.PI * 2 + (f.phase || 0)) * (0.28 + (f.boost ? 0.12 : 0));
    const mouth = opt.mouth || 0;

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.a);
    ctx.globalAlpha = alpha;
    const lw = Math.max(0.8, r * 0.045);
    ctx.lineJoin = 'round';

    if (opt.glow) {
      ctx.shadowColor = opt.glow;
      ctx.shadowBlur = r * 0.6;
    }

    // --- tail (pivot at back of body) ---
    ctx.save();
    ctx.translate(-r * 0.78, 0);
    ctx.rotate(wag);
    const tl = r * (S.pattern === 'veil' ? 0.95 : 0.7);
    const th = r * (S.pattern === 'veil' ? 0.75 : 0.5);
    ctx.fillStyle = S.fin;
    ctx.strokeStyle = S.dark;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-tl * 0.5, -th * 0.25, -tl, -th);
    ctx.quadraticCurveTo(-tl * 0.55, 0, -tl, th);
    ctx.quadraticCurveTo(-tl * 0.5, th * 0.25, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // --- dorsal fin ---
    ctx.fillStyle = S.fin;
    ctx.strokeStyle = S.dark;
    ctx.lineWidth = lw;
    ctx.beginPath();
    const dfh = S.pattern === 'veil' ? 1.15 : S.pattern === 'lion' ? 1.05 : 0.92;
    ctx.moveTo(-r * 0.5, -r * 0.42);
    ctx.quadraticCurveTo(-r * 0.15, -r * dfh, r * 0.35, -r * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // --- anal fin ---
    ctx.beginPath();
    ctx.moveTo(-r * 0.45, r * 0.4);
    ctx.quadraticCurveTo(-r * 0.3, r * (S.pattern === 'veil' ? 0.95 : 0.7), r * 0.05, r * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // --- body ---
    const ry = r * 0.56;
    const grad = ctx.createLinearGradient(0, -ry, 0, ry);
    grad.addColorStop(0, S.body);
    grad.addColorStop(0.55, S.body);
    grad.addColorStop(1, S.belly);
    ctx.fillStyle = grad;
    ctx.strokeStyle = S.dark;
    ellipse(ctx, 0, 0, r, ry);
    ctx.fill();
    ctx.shadowBlur = 0;

    // --- pattern (clipped to body) ---
    ctx.save();
    ellipse(ctx, 0, 0, r, ry);
    ctx.clip();
    drawPattern(ctx, S, r, ry, t);
    ctx.restore();

    // body outline
    ctx.lineWidth = lw;
    ellipse(ctx, 0, 0, r, ry);
    ctx.stroke();

    // --- pectoral fin (flaps) ---
    ctx.save();
    ctx.translate(r * 0.1, ry * 0.45);
    ctx.rotate(0.5 + Math.sin(t * wagHz * Math.PI * 2 * 0.8) * 0.2);
    ctx.globalAlpha = alpha * 0.85;
    ctx.fillStyle = S.fin;
    ellipse(ctx, -r * 0.18, 0, r * 0.3, r * 0.14);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // --- gill line (머리/몸통 구분, 은은하게) ---
    ctx.strokeStyle = S.dark;
    ctx.lineWidth = lw * 0.8;
    ctx.globalAlpha = alpha * 0.3;
    ctx.beginPath();
    ctx.moveTo(r * 0.34, -ry * 0.55);
    ctx.quadraticCurveTo(r * 0.2, 0, r * 0.34, ry * 0.6);
    ctx.stroke();
    ctx.globalAlpha = alpha;

    // --- mouth (눈보다 먼저 그려서 어떤 경우에도 눈을 덮지 않음) ---
    // 턱 관절(jx)은 눈의 앞·아래에 두고, 위턱은 살짝만 들리고 아래턱이 크게 벌어지게 (실제 물고기처럼)
    ctx.strokeStyle = S.dark;
    ctx.lineWidth = lw;
    const jx = r * 0.68;
    if (mouth > 0.05) {
      const up = ry * (0.07 + 0.18 * mouth);   // 위턱 들림 (최대 0.14r — 눈과 겹치지 않음)
      const dn = ry * (0.12 + 0.48 * mouth);   // 아래턱 벌어짐 (최대 0.34r — 몸통 안)
      ctx.fillStyle = '#2a0f14';
      ctx.beginPath();
      ctx.moveTo(r * 0.99, -ry * 0.02);
      ctx.lineTo(jx, -up);
      ctx.quadraticCurveTo(jx - r * 0.07, ry * 0.06, jx + r * 0.02, dn);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(r * 0.98, 0);
      ctx.quadraticCurveTo(r * 0.84, ry * 0.14, jx + r * 0.04, ry * 0.1);
      ctx.stroke();
    }

    // --- eye (턱 관절보다 위·뒤) ---
    const ex = r * 0.53, ey = -ry * 0.4, er = Math.max(1.5, r * 0.115);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = Math.max(0.6, lw * 0.5);
    ctx.stroke();
    ctx.fillStyle = '#111622';
    ctx.beginPath(); ctx.arc(ex + er * 0.3, ey + er * 0.05, er * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(ex + er * 0.45, ey - er * 0.3, er * 0.18, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  };

  function drawPattern(ctx, S, r, ry, t) {
    ctx.lineWidth = Math.max(0.8, r * 0.04);
    switch (S.pattern) {
      case 'bands': {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = S.dark;
        for (const bx of [0.25, -0.35]) {
          ctx.beginPath();
          ctx.moveTo(r * (bx + 0.08), -ry * 1.1);
          ctx.quadraticCurveTo(r * (bx - 0.02), 0, r * (bx + 0.08), ry * 1.1);
          ctx.lineTo(r * (bx - 0.1), ry * 1.1);
          ctx.quadraticCurveTo(r * (bx - 0.2), 0, r * (bx - 0.1), -ry * 1.1);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        break;
      }
      case 'tangs': {
        ctx.fillStyle = '#0b1b4a';
        ctx.beginPath();
        ctx.moveTo(-r * 0.9, -ry * 0.1);
        ctx.quadraticCurveTo(-r * 0.2, -ry * 0.9, r * 0.5, -ry * 0.45);
        ctx.quadraticCurveTo(r * 0.1, -ry * 0.2, -r * 0.9, ry * 0.25);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'scales': {
        ctx.strokeStyle = 'rgba(0,60,50,0.35)';
        const s = Math.max(3, r * 0.22);
        for (let yy = -ry; yy < ry; yy += s * 0.8)
          for (let xx = -r; xx < r * 0.6; xx += s) {
            const off = (Math.round(yy / (s * 0.8)) % 2) * s * 0.5;
            ctx.beginPath();
            ctx.arc(xx + off, yy, s * 0.5, Math.PI * 0.15, Math.PI * 0.85);
            ctx.stroke();
          }
        break;
      }
      case 'veil': {
        ctx.fillStyle = 'rgba(255,77,148,0.35)';
        ellipse(ctx, -r * 0.35, 0, r * 0.5, ry * 0.9);
        ctx.fill();
        break;
      }
      case 'stripe': {
        ctx.strokeStyle = 'rgba(120,10,10,0.35)';
        ctx.beginPath();
        ctx.moveTo(-r * 0.9, -ry * 0.05);
        ctx.quadraticCurveTo(0, -ry * 0.25, r * 0.85, 0);
        ctx.stroke();
        break;
      }
      case 'waves': {
        ctx.strokeStyle = 'rgba(30,45,70,0.55)';
        for (let i = 0; i < 6; i++) {
          const xx = -r * 0.8 + i * r * 0.3;
          ctx.beginPath();
          ctx.moveTo(xx, -ry);
          ctx.quadraticCurveTo(xx - r * 0.15, -ry * 0.45, xx, -ry * 0.05);
          ctx.stroke();
        }
        break;
      }
      case 'dots': {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        for (let i = 0; i < 7; i++) {
          const xx = -r * 0.7 + i * r * 0.22, yy = -ry * 0.35 + ((i % 2) * 2 - 1) * ry * 0.18;
          ctx.beginPath(); ctx.arc(xx, yy, Math.max(1, r * 0.06), 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'koi': {
        ctx.fillStyle = '#ff6a1f';
        ellipse(ctx, -r * 0.3, -ry * 0.25, r * 0.38, ry * 0.5); ctx.fill();
        ellipse(ctx, r * 0.45, ry * 0.1, r * 0.22, ry * 0.35); ctx.fill();
        ctx.fillStyle = '#20232a';
        ellipse(ctx, r * 0.05, -ry * 0.55, r * 0.15, ry * 0.25); ctx.fill();
        break;
      }
      case 'lion': {
        ctx.fillStyle = 'rgba(60,20,8,0.5)';
        for (let i = 0; i < 7; i++) {
          const xx = -r * 0.85 + i * r * 0.27;
          ctx.beginPath();
          ctx.moveTo(xx, -ry * 1.1);
          ctx.lineTo(xx + r * 0.08, -ry * 1.1);
          ctx.lineTo(xx - r * 0.02, ry * 1.1);
          ctx.lineTo(xx - r * 0.1, ry * 1.1);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      default: break;
    }
  }

  // --- 먹이 ---
  GF.drawFood = function (ctx, f, t) {
    const type = GF.FOOD_TYPES[f.type].name;
    const pulse = 0.85 + 0.15 * Math.sin(t * 3 + f.phase);
    ctx.save();
    ctx.translate(f.x, f.y);
    if (type === 'plankton') {
      const rr = 4.2 * pulse;
      ctx.fillStyle = `hsla(${150 + (f.hue % 60)}, 90%, 70%, 0.35)`;
      ctx.beginPath(); ctx.arc(0, 0, rr * 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `hsl(${150 + (f.hue % 60)}, 95%, 78%)`;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'shrimp') {
      ctx.rotate(f.phase + Math.sin(t * 2 + f.phase) * 0.15);
      ctx.strokeStyle = '#ff8c8c';
      ctx.lineCap = 'round';
      ctx.lineWidth = 4.2;
      ctx.beginPath(); ctx.arc(0, 0, 6, Math.PI * 0.1, Math.PI * 1.05); ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#ffb3b3';
      for (let i = 0; i < 4; i++) {
        const ang = Math.PI * 0.35 + i * 0.22;
        ctx.beginPath(); ctx.moveTo(Math.cos(ang) * 5, Math.sin(ang) * 5); ctx.lineTo(Math.cos(ang) * 9.5, Math.sin(ang) * 9.5 + 1.5); ctx.stroke();
      }
      ctx.fillStyle = '#2a0f14';
      ctx.beginPath(); ctx.arc(5.6, -1.6, 1.1, 0, Math.PI * 2); ctx.fill();
    } else { // minnow
      const ang = f.phase + Math.sin(t * 0.7 + f.phase) * 0.6;
      ctx.rotate(ang);
      const wag = Math.sin(t * 9 + f.phase) * 0.4;
      ctx.fillStyle = '#cfe6ff';
      ctx.strokeStyle = '#5a7a9c';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, 7, 3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.translate(-6, 0); ctx.rotate(wag);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-5, -3.2); ctx.lineTo(-5, 3.2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(3.5, -0.8, 0.9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  };

  // --- 죽은 물고기가 흩뿌린 알갱이 ---
  GF.drawDrop = function (ctx, d, t) {
    const rr = 3.5 + Math.sqrt(d.v) * 1.6;
    const pulse = 0.9 + 0.1 * Math.sin(t * 4 + (d.x + d.y) * 0.01);
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.fillStyle = 'rgba(255,190,70,0.28)';
    ctx.beginPath(); ctx.arc(0, 0, rr * 2 * pulse, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(-rr * 0.3, -rr * 0.3, rr * 0.1, 0, 0, rr);
    g.addColorStop(0, '#fff3c4');
    g.addColorStop(1, '#ffb020');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rr * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
})();
