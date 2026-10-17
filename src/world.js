// ============================================================
// Deep Bite — world geometry, cells, deterministic food
//
// 먹이 위치는 DB에 저장하지 않습니다. (cell, slot, generation)만으로
// 모든 클라이언트가 같은 위치를 계산합니다. DB에는 "언제 먹혔는지(ts)"만 저장.
// generation = 마지막으로 먹힌 서버 타임스탬프 (0 = 아직 안 먹힘).
// ============================================================
window.GF = window.GF || {};
(function () {
  const C = GF.CONFIG;
  const CELLS = Math.ceil(C.WORLD / C.CELL);
  GF.CELLS_PER_SIDE = CELLS;

  GF.cellOf = (x, y) => {
    const cx = GF.clamp(Math.floor(x / C.CELL), 0, CELLS - 1);
    const cy = GF.clamp(Math.floor(y / C.CELL), 0, CELLS - 1);
    return cx + '_' + cy;
  };
  GF.cellXY = (id) => { const p = id.split('_'); return [p[0] | 0, p[1] | 0]; };

  // 뷰 사각형과 겹치는 셀 id 목록
  GF.cellsInRect = (x0, y0, x1, y1) => {
    const out = [];
    const cx0 = GF.clamp(Math.floor(x0 / C.CELL), 0, CELLS - 1);
    const cy0 = GF.clamp(Math.floor(y0 / C.CELL), 0, CELLS - 1);
    const cx1 = GF.clamp(Math.floor(x1 / C.CELL), 0, CELLS - 1);
    const cy1 = GF.clamp(Math.floor(y1 / C.CELL), 0, CELLS - 1);
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) out.push(cx + '_' + cy);
    return out;
  };

  // 먹이 타입 선택용 누적 가중치
  const totalW = GF.FOOD_TYPES.reduce((s, t) => s + t.weight, 0);
  function pickType(u) {
    let acc = 0;
    for (let i = 0; i < GF.FOOD_TYPES.length; i++) {
      acc += GF.FOOD_TYPES[i].weight / totalW;
      if (u < acc) return i;
    }
    return GF.FOOD_TYPES.length - 1;
  }

  // 한 먹이 슬롯의 결정적 상태
  //  gen: 0 또는 먹힌 ts. 위치/종류/리스폰 지연은 gen에 따라 바뀜(먹으면 다른 곳에 다시 나옴)
  GF.foodAt = (cellId, slot, gen) => {
    const [cx, cy] = GF.cellXY(cellId);
    const g = gen ? ((gen / 1000) | 0) : 0; // 밀리초 → 초 단위로 줄여 32bit 안에 들어오게
    const h1 = GF.hash32(cx * 1000 + cy, slot, g);
    const h2 = GF.hash32(h1, slot + 77, g + 13);
    const h3 = GF.hash32(h2, cx + 31, cy + 59);
    const pad = 18;
    const x = cx * C.CELL + pad + GF.hashFloat(h1) * (C.CELL - pad * 2);
    const y = cy * C.CELL + pad + GF.hashFloat(h2) * (C.CELL - pad * 2);
    const type = pickType(GF.hashFloat(h3));
    const respawn = C.FOOD_RESPAWN_MS + (h3 % 4000);
    return { x, y, type, value: GF.FOOD_TYPES[type].value, respawn, hue: (h1 % 360), phase: GF.hashFloat(h2) * Math.PI * 2 };
  };

  // 슬롯의 현재 상태: eatenTs(DB값, 없으면 0)와 서버 시각으로 "지금 보이는 먹이"를 계산
  // 반환: food 객체(보이면) 또는 null(리스폰 대기 중)
  GF.resolveFood = (cellId, slot, eatenTs, serverNow) => {
    if (!eatenTs) return GF.foodAt(cellId, slot, 0);
    const f = GF.foodAt(cellId, slot, eatenTs);
    return serverNow - eatenTs > f.respawn ? f : null;
  };

  GF.randomSpawn = (rand = Math.random) => {
    const m = 300;
    return { x: m + rand() * (C.WORLD - m * 2), y: m + rand() * (C.WORLD - m * 2) };
  };

  GF.inWorld = (x, y) => x >= 0 && y >= 0 && x <= C.WORLD && y <= C.WORLD;
})();
