// ============================================================
// Deep Bite — game constants & balance formulas
// 모든 밸런스 수치는 여기서만 조정합니다.
// ============================================================
window.GF = window.GF || {};

GF.CONFIG = {
  // --- World ---
  WORLD: 7200,          // 정사각 맵 한 변 (world units == px at zoom 1)
  CELL: 600,            // 관심 영역(interest management) 셀 크기 → 12x12 = 144 cells
  FOOD_PER_CELL: 14,    // 셀당 기본 먹이 슬롯 수 (144 * 14 ≈ 2000개)
  FOOD_RESPAWN_MS: 9000,// 먹힌 먹이가 다시 나오기까지 (여기에 슬롯별 0~4초 랜덤 가산)

  // --- Networking ---
  TICK_HZ: 7,           // 내 위치 전송 빈도 (RTDB는 쓰기 무료, 다운로드만 과금)
  BOARD_HZ: 1,          // 리더보드 갱신 빈도
  STAMP_EVERY_MS: 1500, // 서버 타임스탬프(t) 갱신 간격 (유령 정리용)
  STALE_MS: 7000,       // 이 시간 동안 갱신 없으면 화면에서 숨김
  GHOST_MS: 25000,      // 이 시간 지나면 다른 클라이언트가 삭제 가능 (rules와 일치해야 함)
  VIEW_MARGIN: 220,     // 화면 밖 여유 구독 범위
  ROOM_PREFIX: 'ocean',
  ROOM_CAP: 120,        // 방 정원 (초과 시 ocean-2, ocean-3 ...)
  MAX_ROOMS: 30,

  // --- Mass / growth ---
  START_MASS: 10,
  MAX_MASS: 30000,
  EAT_RATIO: 1.25,      // 먹는 쪽이 피해자보다 이 비율 이상 무거워야 함
  KILL_SHARE: 0.6,      // 피해자 질량 중 킬러에게 바로 가는 비율
  DROP_SHARE: 0.3,      // 피해자 질량 중 알갱이로 흩어지는 비율
  DECAY_START: 300,     // 이 질량 초과분부터 서서히 감소
  DECAY_RATE: 0.0012,   // 초당 (mass - DECAY_START) * rate 감소
  SPAWN_PROTECT_MS: 3000,

  // --- Boost ---
  BOOST_MULT: 1.75,
  BOOST_COST: 0.03,     // 초당 질량의 3% (최소 1)
  BOOST_MIN_MASS: 20,

  // --- Drops (죽을 때 흩어지는 알갱이) ---
  DROP_TTL_MS: 45000,
  DROP_MIN: 3,
  DROP_MAX: 24,

  // --- Misc ---
  NAME_MAX: 12,
  SKIN_COUNT: 10,
  BOT_COUNT: 34,        // 오프라인 모드 봇 수

  // --- Online population policy (호스트 봇) ---
  // 방 인구가 ONLINE_MIN_POP 보다 적으면, 가장 먼저 들어온 클라이언트(호스트)가 봇을 굴려서 채움.
  // 진짜 유저가 늘어나면 봇은 하나씩 조용히 '퇴장'함 (다른 .io 게임들의 인구 유지 방식).
  ONLINE_MIN_POP: 22,   // 목표 총 인구 (유저 + 봇)
  ONLINE_BOT_MAX: 26,   // 봇 상한
  BOT_TICK_HZ: 5,       // 봇 위치 전송 빈도
  BOT_SPAWN_EVERY_MS: 1500,
  BOT_LEAVE_EVERY_MS: 8000,
  BOT_ADJUST_MS: 6000,
  HOST_BEAT_MS: 5000,   // 호스트 lease 갱신 주기
  HOST_STALE_MS: 15000, // 이 시간 동안 갱신 없으면 다른 클라이언트가 호스트를 가져감 (rules의 20000보다 짧게)
};

// 질량 → 반지름 (world units)
GF.radius = (m) => 10 + 2.0 * Math.sqrt(Math.max(0, m));
// 반지름 → 전진 속도 (units/s). 작을수록 빠름.
GF.speed = (r) => 150 + 120 * Math.sqrt(16 / r);
// 반지름 → 최대 회전 속도 (rad/s). 클수록 둔함.
GF.turnRate = (r) => 4.5 * Math.pow(16 / r, 0.3);
// 반지름 → 보고 싶은 화면 가로폭(world units). 클수록 멀리 봄.
GF.viewWidth = (r) => Math.min(3400, 1150 + 10 * r);

// 먹이 종류별 질량값
GF.FOOD_TYPES = [
  { name: 'plankton', value: 1, weight: 55 },
  { name: 'shrimp',   value: 2, weight: 25 },
  { name: 'minnow',   value: 3, weight: 20 },
];

// 먹을 수 있는가? (eater가 victim을)
GF.canEat = (eaterMass, victimMass) => eaterMass >= victimMass * GF.CONFIG.EAT_RATIO;
