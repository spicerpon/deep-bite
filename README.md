# Deep Bite 🐟

slither.io 스타일의 바다 물고기 성장 멀티플레이 웹게임.
작은 물고기로 시작해 플랑크톤·새우·송사리와 나보다 작은 유저를 먹으며 커지고, 나보다 25% 이상 큰 물고기에게 먹히면 끝.

- 클라이언트: 순수 HTML/Canvas/JS (빌드 도구 없음) → **GitHub Pages**에 그대로 올리면 됨
- 서버: **Firebase Realtime Database + 익명 인증** (서버 코드 없음)
- Firebase 설정 전에는 **Play vs Bots**(오프라인 봇 모드)만 동작

> **현재 상태 (2026-10-17)**: Firebase 프로젝트 `deep-bite-8eea7`(RTDB: asia-southeast1) 설정 완료, `src/firebase-config.js` 반영됨.
> 플레이 주소: https://spicerpon.github.io/deep-bite/ · 아래 2번은 새 프로젝트를 다시 만들 때만 필요합니다.

---

## 1. 폴더 구조

```
index.html              게임 페이지
css/style.css           UI 스타일
src/config.js           ★ 밸런스/규모 상수 (맵 크기, 셀 크기, 성장 공식 등)
src/firebase-config.js  ★ Firebase 설정 붙여넣는 곳
src/net-firebase.js     Firebase 네트워크 레이어
src/net-local.js        오프라인 봇 모드 (같은 인터페이스)
src/game.js             게임 루프 / 물리 / 포식 판정
src/render.js           바다 배경·카메라·렌더링
src/fish.js             물고기·먹이 그리기 (스킨 10종)
src/bots.js             봇 AI
src/input.js            마우스/터치/키보드
src/world.js            셀 분할, 결정적(deterministic) 먹이 배치
database.rules.json     ★ Realtime Database 보안 규칙
firebase.json           firebase CLI 배포용 (선택)
tools/build-artifact.js 미리보기용 빌드 (무시해도 됨)
```

---

## 2. Firebase 프로젝트 만들기 (약 10분)

### 2-1. 프로젝트 + 웹 앱
1. https://console.firebase.google.com → **프로젝트 추가** (예: `deep-bite`)
   - Google 애널리틱스는 꺼도 됨
2. 프로젝트 개요 → **웹 앱 추가(</>)** → 닉네임 입력 → 등록
3. 표시되는 `firebaseConfig` 값을 `src/firebase-config.js`에 붙여넣기
   - 나중에 다시 보려면: ⚙ 프로젝트 설정 → 일반 → 내 앱 → SDK 설정 및 구성 → **구성**

### 2-2. 익명 인증 켜기
빌드 → **Authentication** → 시작하기 → **Sign-in method** 탭 → **익명(Anonymous)** → 사용 설정 → 저장

### 2-3. Realtime Database 만들기
1. 빌드 → **Realtime Database** → 데이터베이스 만들기
2. 위치: 한국/일본 유저 위주면 **asia-southeast1 (싱가포르)** 추천 (미국 유저 많으면 us-central1)
3. 보안 규칙: **잠금 모드**로 시작
4. 만들어진 DB URL (`https://xxxx.asia-southeast1.firebasedatabase.app`) 을
   `src/firebase-config.js`의 `databaseURL`에 넣기 ← **이 값이 없으면 온라인 모드가 안 켜짐**

### 2-4. 보안 규칙 적용
Realtime Database → **규칙** 탭 → 내용 전부 지우고 `database.rules.json` 의 내용을 붙여넣기 → **게시**

(또는 Firebase CLI: `npm i -g firebase-tools` → `firebase login` → `.firebaserc.example`을 `.firebaserc`로 복사해 프로젝트 ID 수정 → `firebase deploy --only database`)

### 2-5. 승인된 도메인
Authentication → 설정 → **승인된 도메인** → `아이디.github.io` 추가 (익명 로그인엔 필수는 아니지만 넣어두는 게 안전)

---

## 3. GitHub Pages에 올리기

1. GitHub에 새 저장소 생성 (예: `deep-bite`), 이 폴더의 파일을 전부 push
   - `src/firebase-config.js`에 설정이 채워진 채로 올려도 됩니다 (apiKey는 공개 가능한 값. 보안은 DB 규칙이 담당)
2. 저장소 **Settings → Pages → Build and deployment**
   - Source: *Deploy from a branch* / Branch: `main` / 폴더: `/ (root)` → Save
3. 1~2분 후 `https://아이디.github.io/deep-bite/` 접속 → **Play Online**

> Firebase Hosting으로도 가능: `firebase deploy --only hosting` (firebase.json에 설정돼 있음)

---

## 4. 동작 원리 (규모 확장 관련)

### 데이터 구조 `rooms/{room}/…`
| 경로 | 내용 | 비고 |
|---|---|---|
| `cells/{cell}/{uid}` | `{n,s,x,y,a,m,b,t}` 위치 등 핫 데이터 | 맵을 600px 셀(12×12)로 나눠 **내 화면 근처 셀만 구독** |
| `food/{cell}/{slot}` | 먹힌 시각(ts) | 먹이 위치는 저장 안 함. (셀,슬롯,ts)로 모든 클라이언트가 같은 위치를 계산 |
| `drops/{cell}/{id}` | 죽은 물고기 알갱이 | 45초 후 자동 무시 |
| `events/{uid}/{id}` | 킬 보상 `{m,v}` | 먹힌 쪽이 킬러의 inbox에 넣음 |
| `board/{uid}` | `{n,m,s,t}` | `orderByChild('m').limitToLast(10)` 로 top10만 수신 |

### 왜 100명 이상이 되나
- RTDB는 **쓰기 무료, 다운로드만 과금**(10GB/월 무료, 이후 $1/GB). 각 클라이언트는 7Hz로 자기 상태를 쓰지만, **받는 건 내 화면 근처 셀의 플레이어뿐**이라 방 인원이 늘어도 1인당 수신량이 거의 일정.
- 동시 접속 제한: Spark(무료) **100 연결**, Blaze **200,000 연결**. → 100명 이상 테스트하려면 **Blaze(종량제)로 올려야 함** (무료 한도는 그대로 포함).
- 방 정원(`ROOM_CAP`, 기본 120명)이 차면 자동으로 `ocean-2`, `ocean-3`… 로 분산.

### 비용 감 잡기 (대략)
1인당 다운로드 ≈ 시야 내 플레이어 수 × 7Hz × ~70B.
- 동시 10명: 시야에 1~2명 → 약 1KB/s/인 → 시간당 ~35MB 전체 → 사실상 무료
- 동시 100명: 시야에 8~14명 → 약 5KB/s/인 → 시간당 ~1.8GB 전체 → **무료 10GB를 5~6시간이면 소진, 이후 시간당 약 $2**
- 줄이려면: `TICK_HZ` 7→5, `CELL` 축소, 맵(`WORLD`) 확대(인구 밀도↓)

### 치트 방지 수준
서버가 없어서 **"먹히는 쪽이 자기 죽음을 판정"**합니다. 해킹 클라이언트가 할 수 있는 건 *자기가 안 죽는 것* 정도이고, 남을 죽이거나 질량을 순간적으로 폭증시키는 건 규칙(`database.rules.json`)이 막습니다. 완전한 치트 방지가 필요해지면 그때 전용 서버(Colyseus 등)로 옮기는 게 정석이며, `net-firebase.js`와 같은 인터페이스로 `net-ws.js`를 만들면 게임 코드는 그대로 둘 수 있습니다.

---

## 5. 밸런스 조정 (`src/config.js`)
| 상수 | 기본 | 설명 |
|---|---|---|
| `WORLD` | 7200 | 맵 한 변 |
| `CELL` | 600 | 구독 셀 크기 |
| `FOOD_PER_CELL` | 14 | 셀당 먹이 수 (총 ≈ 2,000) |
| `EAT_RATIO` | 1.25 | 이 배수 이상 무거워야 먹을 수 있음 |
| `KILL_SHARE` / `DROP_SHARE` | 0.6 / 0.3 | 피해자 질량 중 킬러 직접 지급 / 알갱이로 흩어지는 비율 |
| `DECAY_START` / `DECAY_RATE` | 300 / 0.0012 | 큰 물고기 질량 감소 |
| `BOOST_MULT` / `BOOST_COST` | 1.75 / 0.03 | 부스트 배속 / 초당 질량 소모 비율 |
| `ROOM_CAP` | 120 | 방 정원 |
| `BOT_COUNT` | 34 | 오프라인 봇 수 |

`GF.radius / GF.speed / GF.turnRate / GF.viewWidth` 공식도 같은 파일에 있습니다.

---

## 6. 조작
- PC: 마우스 방향으로 헤엄, **클릭 유지 / Space / Shift** = 부스트, WASD·방향키도 가능
- 모바일: 드래그로 방향, **BOOST 버튼 또는 두 번째 손가락** = 부스트

## 7. 로컬 테스트
파일을 더블클릭(file://)하면 스크립트가 막힐 수 있으니 간단한 서버로 띄우세요:
```
python -m http.server 8000   # → http://localhost:8000
```
브라우저 콘솔에서 `GF.debug.game.me` 로 내 상태를 볼 수 있습니다.
