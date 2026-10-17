// ============================================================
// Deep Bite — small math / hashing helpers
// ============================================================
window.GF = window.GF || {};

GF.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
GF.lerp = (a, b, t) => a + (b - a) * t;
GF.dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
GF.angleLerp = (a, b, t) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
GF.angleDiff = (a, b) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// 32-bit integer hash (deterministic across all clients) — used for food placement
GF.hash32 = (a, b = 0, c = 0) => {
  let h = (a | 0) * 0x27d4eb2d ^ (b | 0) * 0x165667b1 ^ (c | 0) * 0x9e3779b1;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
};
GF.hashFloat = (h) => (h >>> 8) / 16777216; // 0..1

// Seeded PRNG for bots / particles (not for shared state)
GF.rng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

GF.randId = (n = 8) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
};

GF.sanitizeName = (s) => {
  s = String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  if (!s) s = 'Fish';
  return s.slice(0, GF.CONFIG.NAME_MAX);
};

GF.fmtMass = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + 'k' : Math.floor(m).toString());
GF.fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

GF.storage = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};
