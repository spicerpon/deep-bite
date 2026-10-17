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

// 더미 닉네임 생성기 — 기본 닉네임과 봇 이름에 같이 사용 (사람이 지은 듯한 느낌)
GF.NAME_POOL = [
  'Finn', 'Gill', 'Bubbles', 'Coral', 'Pearl', 'Sandy', 'Kelp', 'Moby', 'Shelly', 'Wavy', 'Splash', 'Tide',
  'Reef', 'Guppy', 'Blub', 'Fathom', 'Nori', 'Mako', 'Scales', 'Puff', 'Drift', 'Marina', 'Otto', 'Pike', 'Roe',
  'Sushi', 'Chum', 'Ripple', 'Barnacle', 'Squirt', 'Flounder', 'Dorsal', 'Minnie', 'Bass', 'Cod', 'Haddock',
  'Krill', 'Wasabi', 'Tako', 'Saba', 'Maguro', 'Hamachi', 'Tuna', 'Salmon', 'Trout', 'Carp', 'Goby', 'Wrasse',
  'Snapper', 'Grouper', 'Mullet', 'Perch', 'Herring', 'Sprat', 'Smelt', 'Anchovy', 'Puffer', 'Marlin', 'Sardine',
  'Blenny', 'Zander', 'Bream', 'Eely', 'Lil Shrimp', 'Big Tuna', 'Sea Pup', 'Deep Dan', 'Kraken Jr', 'Captain',
  'Bubba', 'Gilly', 'Fishy', 'Neptune', 'Nessie', 'Mochi', 'Pico', 'Yuki', 'Momo', 'Kai', 'Luna', 'Ollie',
];
GF.randomName = (rand = Math.random) => {
  const base = GF.NAME_POOL[(rand() * GF.NAME_POOL.length) | 0];
  const u = rand();
  let name = base;
  if (u < 0.22) name = base + (10 + ((rand() * 90) | 0));          // Finn42
  else if (u < 0.32) name = base + '_' + (1 + ((rand() * 99) | 0));  // Finn_7
  else if (u < 0.40) name = base.toLowerCase();                      // finn
  else if (u < 0.46) name = 'x' + base + 'x';                        // xFinnx
  return name.slice(0, GF.CONFIG.NAME_MAX);
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
